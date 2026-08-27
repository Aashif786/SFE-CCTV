"""
Shared in-memory state for the CALVISION pipeline.

This module centralises all per-camera runtime state that is shared between
the REST API routes (e.g. /api/stats reads session_managers) and the
WebSocket processing pipeline.

Modules import from here instead of main.py to avoid circular dependencies.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Optional

from .db.database import SessionLocal
from .db.models import ActivitySession, WorkstationZone
from .detectors.pose_detector import WorkerDetector


# ---------------------------------------------------------------------------
# SessionManager — tracks activity sessions per camera
# ---------------------------------------------------------------------------

class SessionManager:
    def __init__(self, camera_id: str):
        self.camera_id = camera_id
        self._open_id: Optional[int] = None
        self._open_activity: Optional[str] = None
        self._open_start: Optional[datetime] = None
        self._last_flush_time: float = 0.0
        self._FLUSH_INTERVAL_SECONDS: float = 2.0  # time-based: flush every 2s regardless of FPS

    def _utcnow(self) -> datetime:
        return datetime.now(timezone.utc)

    def process(self, activity: str) -> None:
        now_mono = time.monotonic()
        if activity != self._open_activity:
            self._close_session()
            self._open_session(activity)
            self._last_flush_time = now_mono
        elif (now_mono - self._last_flush_time) >= self._FLUSH_INTERVAL_SECONDS:
            self._flush_open_session()
            self._last_flush_time = now_mono

    def _open_session(self, activity: str) -> None:
        now = self._utcnow()
        with SessionLocal() as db:
            s = ActivitySession(camera_id=self.camera_id, activity=activity, start_time=now)
            db.add(s)
            db.commit()
            db.refresh(s)
            self._open_id = s.id
        self._open_activity = activity
        self._open_start = now
        print(f"📂 Session [{self._open_id}] → {activity}")

    def _close_session(self) -> None:
        if self._open_id is None:
            return
        now = self._utcnow()
        dur = (now - self._open_start).total_seconds() if self._open_start else 0.0
        with SessionLocal() as db:
            s = db.get(ActivitySession, self._open_id)
            if s:
                s.end_time = now
                s.duration_seconds = round(dur, 2)
                db.commit()
        print(f"📁 Session [{self._open_id}] closed ({round(dur, 1)}s)")
        self._open_id = self._open_activity = self._open_start = None

    def _flush_open_session(self) -> None:
        if self._open_id is None:
            return
        now = self._utcnow()
        dur = (now - self._open_start).total_seconds() if self._open_start else 0.0
        with SessionLocal() as db:
            s = db.get(ActivitySession, self._open_id)
            if s:
                s.end_time = now
                s.duration_seconds = round(dur, 2)
                db.commit()

    def current_session_info(self) -> Optional[dict]:
        if self._open_id is None:
            return None
        now = self._utcnow()
        dur = (now - self._open_start).total_seconds() if self._open_start else 0.0
        return {
            "id": self._open_id,
            "camera_id": self.camera_id,
            "activity": self._open_activity,
            "start_time": self._open_start.isoformat() if self._open_start else None,
            "end_time": None,
            "duration_seconds": round(dur, 2),
            "is_open": True,
        }

    def close_on_disconnect(self) -> None:
        self._close_session()


import threading

# ---------------------------------------------------------------------------
# Per-camera state (in-memory, reset on server restart)
# ---------------------------------------------------------------------------

# Per-camera WorkerDetector registry.
# Each camera needs its OWN WorkerDetector so that BoT-SORT maintains
# independent temporal track continuity per camera feed. Sharing one detector
# across cameras causes the tracker to confuse frames from different cameras,
# producing rapid track resets and erratic session open/close behaviour.
#
# To avoid the Windows cascading-lock deadlock (each WorkerDetector.__init__
# grabs _yolo_init_lock while waiting for GPU model load), we pre-warm the
# underlying YOLO .pt model into _pt_model_cache at startup via
# preload_model_cache(). Subsequent WorkerDetector() calls find the model
# already cached and return in milliseconds.
detectors: dict[str, WorkerDetector] = {}
_detector_init_lock = threading.RLock()



def preload_model_cache() -> None:
    """Pre-warm the shared YOLO model into GPU VRAM.

    Call this ONCE at server startup (in a background thread so it doesn't
    block uvicorn). After this returns, all subsequent WorkerDetector()
    constructor calls skip the expensive model load and finish in <1 second.
    """
    from .detectors.pose_detector import _load_pt_model, get_model_filepath
    from .config import config as _cfg
    target_model = getattr(_cfg, "yolo_model", "yolo11m-pose.pt")
    pt_path = get_model_filepath(target_model)
    from .console import Console
    Console.system("STARTUP", "Pre-warming YOLO model into GPU cache...")
    try:
        _load_pt_model(pt_path)
        Console.system("READY", "YOLO model pre-warm complete — detectors initialized")
    except Exception as e:
        Console.error("SYSTEM", f"Model pre-warm warning (lazy init): {e}")


def get_or_create_detector(camera_id: str | int) -> WorkerDetector:
    """Thread-safe lazy initialization of a per-camera WorkerDetector.

    Because the underlying YOLO .pt model is pre-warmed at startup
    (see preload_model_cache), each WorkerDetector() call here completes
    in <1 second regardless of how many cameras connect simultaneously.
    """
    cam_key = str(camera_id)
    if cam_key not in detectors:
        with _detector_init_lock:
            if cam_key not in detectors:
                detectors[cam_key] = WorkerDetector()
    return detectors[cam_key]


def get_detector(camera_id: str | int) -> Optional[WorkerDetector]:
    """Non-blocking safe lookup for an existing per-camera WorkerDetector."""
    return detectors.get(str(camera_id))

session_managers: dict[str, SessionManager] = {}

# Track whether a person was detected in the PREVIOUS frame per camera.
# Key: camera_id → set of currently active track_ids from previous frame.
prev_track_ids: dict[str, set[int]] = {}

# Track consecutive frames of track absence per camera to support grace
# period before session close.
# Key: camera_id → dict[track_id → absent_frames_count]
track_absent_frames: dict[str, dict[int, int]] = {}

# Grace period: ~6 seconds regardless of FPS. Computed dynamically.
_TRACK_CLOSE_GRACE_SECONDS = 6.0


def get_track_close_grace_frames() -> int:
    """Compute grace frames from current FPS config so the grace period
    is always ~6 seconds, not dependent on frame rate."""
    from .config import config as _cfg
    fps = max(1, getattr(_cfg, 'ai_stream_fps', 15))
    return max(10, int(fps * _TRACK_CLOSE_GRACE_SECONDS))


# Legacy constant kept for any code that reads it directly — but callers
# should migrate to get_track_close_grace_frames().
TRACK_CLOSE_GRACE_FRAMES = 30  # fallback, overridden by get_track_close_grace_frames()

# Multi-person per-track activity accumulators
track_activity_totals: dict[str, dict[str, float]] = {}
track_last_time: dict[str, datetime] = {}


# ---------------------------------------------------------------------------
# Zone cache — avoids a DB round-trip on every frame.
# Invalidated explicitly by the zone CRUD endpoints.
# ---------------------------------------------------------------------------

_zone_cache: dict[str, tuple[float, float, float, float]] = {}


def get_zone_cached(camera_id: str) -> tuple[float, float, float, float]:
    """Return workstation zone from in-memory cache; populate from DB on miss."""
    if camera_id in _zone_cache:
        return _zone_cache[camera_id]
    with SessionLocal() as db:
        row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
        zone = (row.x_min, row.y_min, row.x_max, row.y_max) if row else (0.0, 0.0, 1.0, 1.0)
    _zone_cache[camera_id] = zone
    return zone


def invalidate_zone_cache(camera_id: str) -> None:
    """Remove a camera_id from the zone cache so the next read fetches from DB."""
    _zone_cache.pop(camera_id, None)
