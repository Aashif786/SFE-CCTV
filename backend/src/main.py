import cv2
import numpy as np
import base64
import json
import math
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timezone
from typing import Optional

# --- Ultralytics YOLO ---
from ultralytics import YOLO
import torch

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from .db.database import engine, Base, get_db, SessionLocal
from .db.models import ActivityLog, Alert, ActivitySession, WorkstationZone

from .config import config, SETTINGS_FILE, SettingsPayload
from .detectors.pose_detector import WorkerDetector
from .activity.classifier import classifier

# ---------------------------------------------------------------------------
# Identity Management module
# ---------------------------------------------------------------------------
from .identity.api import router as identity_router
from .identity.correlation import correlation_engine
from .identity.session_manager import worker_session_manager
from .identity.models import CameraEntryEvent

# ---------------------------------------------------------------------------
# Create / migrate tables on startup (includes new identity_events, worker_sessions)
# ---------------------------------------------------------------------------
Base.metadata.create_all(bind=engine)

# Close any stale active worker sessions left over from previous runs
with SessionLocal() as db:
    from .db.models import WorkerSessionDB
    from datetime import datetime, timezone
    stale_sessions = db.query(WorkerSessionDB).filter(WorkerSessionDB.status == "ACTIVE").all()
    if stale_sessions:
        print(f"[Startup] Found {len(stale_sessions)} stale active sessions. Closing them...")
        for s in stale_sessions:
            s.status = "CLOSED"
            s.end_time = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()


class ZonePayload(BaseModel):
    x_min: float = Field(ge=0.0, le=1.0)
    y_min: float = Field(ge=0.0, le=1.0)
    x_max: float = Field(ge=0.0, le=1.0)
    y_max: float = Field(ge=0.0, le=1.0)


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register the identity management router
app.include_router(identity_router)


# ---------------------------------------------------------------------------
# Zone cache — avoids a DB round-trip on every frame.
# Invalidated explicitly by POST /api/zones and DELETE /api/zones endpoints.
# ---------------------------------------------------------------------------
_zone_cache: dict[str, tuple[float, float, float, float]] = {}


def _get_zone_cached(camera_id: str) -> tuple[float, float, float, float]:
    """Return workstation zone from in-memory cache; populate from DB on miss."""
    if camera_id in _zone_cache:
        return _zone_cache[camera_id]
    with SessionLocal() as db:
        row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
        zone = (row.x_min, row.y_min, row.x_max, row.y_max) if row else (0.0, 0.0, 1.0, 1.0)
    _zone_cache[camera_id] = zone
    return zone


# ---------------------------------------------------------------------------
# Per-camera state (in-memory, reset on server restart)
# ---------------------------------------------------------------------------
detectors: dict[str, WorkerDetector] = {}
session_managers: dict[str, "SessionManager"] = {}
# Track whether a person was detected in the PREVIOUS frame per camera.
# Key: camera_id → set of currently active track_ids from previous frame.
_prev_track_ids: dict[str, set[int]] = {}
# Track consecutive frames of track absence per camera to support grace period before session close.
# Key: camera_id → dict[track_id → absent_frames_count]
_track_absent_frames: dict[str, dict[int, int]] = {}
TRACK_CLOSE_GRACE_FRAMES = 30  # ~6 seconds at 5 FPS


# ---------------------------------------------------------------------------
# SessionManager
# ---------------------------------------------------------------------------
class SessionManager:
    def __init__(self, camera_id: str):
        self.camera_id = camera_id
        self._open_id: Optional[int] = None
        self._open_activity: Optional[str] = None
        self._open_start: Optional[datetime] = None
        self._flush_frames: int = 0
        self._FLUSH_EVERY: int = 10  # ~2 s at 5 fps

    def _utcnow(self) -> datetime:
        return datetime.now(timezone.utc).replace(tzinfo=None)

    def process(self, activity: str) -> None:
        self._flush_frames += 1
        if activity != self._open_activity:
            self._close_session()
            self._open_session(activity)
        elif self._flush_frames % self._FLUSH_EVERY == 0:
            self._flush_open_session()

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


# ---------------------------------------------------------------------------
# API — Root & Settings
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"message": "Worker Monitoring API v2", "status": "running"}


@app.get("/api/settings")
async def get_settings():
    return {
        "idle_threshold_seconds": config.idle_threshold_seconds,
        "movement_sensitivity": config.movement_sensitivity,
        "confidence_threshold": config.confidence_threshold,
    }


@app.post("/api/settings")
async def save_settings(payload: SettingsPayload):
    config.idle_threshold_seconds = payload.idle_threshold_seconds
    config.movement_sensitivity = payload.movement_sensitivity
    config.confidence_threshold = payload.confidence_threshold
    
    # Save to disk
    try:
        with open(SETTINGS_FILE, "w") as f:
            json.dump({
                "idle_threshold_seconds": config.idle_threshold_seconds,
                "movement_sensitivity": config.movement_sensitivity,
                "confidence_threshold": config.confidence_threshold,
            }, f, indent=4)
    except Exception as e:
        print(f"Failed to persist settings: {e}")
        
    # Apply correlation window immediately (no longer applied per-frame)
    correlation_engine.set_window(config.correlation_window_seconds)
    print(f"⚙️  Settings: idle={config.idle_threshold_seconds}s  sens={config.movement_sensitivity}  conf={config.confidence_threshold}")
    return {
        "status": "saved",
        "idle_threshold_seconds": config.idle_threshold_seconds,
        "movement_sensitivity": config.movement_sensitivity,
        "confidence_threshold": config.confidence_threshold,
    }


# ---------------------------------------------------------------------------
# API — Workstation Zone (per-camera)
# ---------------------------------------------------------------------------

@app.get("/api/zones/{camera_id}")
async def get_zone(camera_id: str, db: Session = Depends(get_db)):
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if not row:
        return {"camera_id": camera_id, "x_min": 0.0, "y_min": 0.0, "x_max": 1.0, "y_max": 1.0, "is_default": True}
    return {"camera_id": row.camera_id, "x_min": row.x_min, "y_min": row.y_min, "x_max": row.x_max, "y_max": row.y_max, "is_default": False}


@app.post("/api/zones/{camera_id}")
async def set_zone(camera_id: str, payload: ZonePayload, db: Session = Depends(get_db)):
    if payload.x_min >= payload.x_max or payload.y_min >= payload.y_max:
        raise HTTPException(status_code=400, detail="x_min must be < x_max and y_min must be < y_max")
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if row:
        row.x_min, row.y_min, row.x_max, row.y_max = payload.x_min, payload.y_min, payload.x_max, payload.y_max
    else:
        row = WorkstationZone(camera_id=camera_id, x_min=payload.x_min, y_min=payload.y_min, x_max=payload.x_max, y_max=payload.y_max)
        db.add(row)
    db.commit()
    _zone_cache.pop(camera_id, None)  # invalidate cache so next frame picks up new zone
    print(f"🗺️  Zone updated for {camera_id}: ({payload.x_min},{payload.y_min}) → ({payload.x_max},{payload.y_max})")
    return {"status": "saved", "camera_id": camera_id, "x_min": payload.x_min, "y_min": payload.y_min, "x_max": payload.x_max, "y_max": payload.y_max}


@app.delete("/api/zones/{camera_id}")
async def delete_zone(camera_id: str, db: Session = Depends(get_db)):
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if row:
        db.delete(row)
        db.commit()
    _zone_cache.pop(camera_id, None)  # invalidate cache
    return {"status": "deleted", "camera_id": camera_id}


# ---------------------------------------------------------------------------
# API — Stats, Alerts, History
# ---------------------------------------------------------------------------

@app.get("/api/stats")
async def get_stats(db: Session = Depends(get_db)):
    # Active workers = cameras currently showing "working" or "walking"
    active_workers = sum(
        1 for sm in session_managers.values()
        if sm._open_activity in ("working", "walking")
    )
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    idle_alerts = db.query(Alert).filter(Alert.timestamp >= today_start).count()
    total_logs = db.query(ActivityLog).filter(ActivityLog.timestamp >= today_start).count()
    active_logs = db.query(ActivityLog).filter(
        ActivityLog.timestamp >= today_start,
        ActivityLog.activity.in_(["working", "walking"]),
    ).count()

    avg_productivity = int((active_logs / total_logs) * 100) if total_logs > 0 else 100

    return {
        "active_workers": active_workers,
        "idle_alerts": idle_alerts,
        "avg_productivity": avg_productivity,
        "system_status": "Healthy",
        "idle_threshold_seconds": config.idle_threshold_seconds,
    }


@app.get("/api/alerts")
async def get_alerts(db: Session = Depends(get_db)):
    alerts = db.query(Alert).order_by(Alert.timestamp.desc()).limit(50).all()
    return [
        {"id": a.id, "timestamp": a.timestamp.isoformat(), "message": a.message, "resolved": a.resolved}
        for a in alerts
    ]


@app.put("/api/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if alert:
        alert.resolved = True
        db.commit()
    return {"status": "success"}


@app.get("/api/history")
async def get_history(db: Session = Depends(get_db)):
    logs = db.query(ActivityLog).order_by(ActivityLog.timestamp.desc()).limit(50).all()
    return [
        {
            "id": l.id,
            "timestamp": l.timestamp.isoformat(),
            "status": l.status,
            "activity": l.activity,
            "idle_seconds": l.idle_seconds,
            "movement_score": l.movement_score,
            "confidence": l.confidence,
        }
        for l in logs
    ]


# ---------------------------------------------------------------------------
# API — Activity Sessions
# ---------------------------------------------------------------------------

@app.get("/api/sessions/current")
async def get_current_sessions():
    return [
        info for sm in session_managers.values()
        if (info := sm.current_session_info()) is not None
    ]


@app.get("/api/sessions")
async def get_sessions(db: Session = Depends(get_db)):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sessions = (
        db.query(ActivitySession)
        .filter(ActivitySession.start_time >= today_start, ActivitySession.end_time.isnot(None))
        .order_by(ActivitySession.start_time.asc())
        .all()
    )
    return [
        {
            "id": s.id, "camera_id": s.camera_id, "activity": s.activity,
            "start_time": s.start_time.isoformat(),
            "end_time": s.end_time.isoformat() if s.end_time else None,
            "duration_seconds": s.duration_seconds,
            "is_open": False,
        }
        for s in sessions
    ]


# ---------------------------------------------------------------------------
# WebSocket — camera stream + AI + classification
# ---------------------------------------------------------------------------

# Colour per activity for the overlay label sent in WS response
ACTIVITY_COLOUR: dict[str, str] = {
    "working":   "#10b981",   # emerald
    "walking":   "#3b82f6",   # blue
    "idle":      "#f59e0b",   # amber
    "no_person": "#6b7280",   # gray
}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ WebSocket connected")
    camera_id: Optional[str] = None

    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            image_b64 = payload["image"]
            camera_id = payload.get("camera_id", "default")

            # Lazy-init per-camera objects
            if camera_id not in detectors:
                detectors[camera_id] = WorkerDetector()
            if camera_id not in session_managers:
                session_managers[camera_id] = SessionManager(camera_id)
            if camera_id not in _prev_track_ids:
                _prev_track_ids[camera_id] = set()
            if camera_id not in _track_absent_frames:
                _track_absent_frames[camera_id] = {}

            detector = detectors[camera_id]
            sm = session_managers[camera_id]

            # Decode frame
            image_bytes = base64.b64decode(image_b64)
            np_arr = np.frombuffer(image_bytes, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is None:
                continue
            h, w, _ = frame.shape

            # Run multi-pose detection + native YOLO tracking
            try:
                poses = detector.update(frame)
            except Exception as det_err:
                print(f"⚠️  Detector error: {det_err}")
                poses = []

            # Load workstation zone from cache (DB only on first access or after zone update)
            zone = _get_zone_cached(camera_id)

            current_track_ids: set[int] = {p["track_id"] for p in poses}
            current_track_ids_str: set[str] = {str(t) for t in current_track_ids}
            prev_ids = _prev_track_ids[camera_id]

            # Detect newly entered tracks → notify correlation engine
            for p in poses:
                trk_id = p["track_id"]
                if trk_id not in prev_ids:
                    camera_entry = CameraEntryEvent(
                        track_id=str(trk_id),
                        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
                        camera_id=camera_id,
                        first_bounding_box=[
                            int(round(p["box"][0] * w)),
                            int(round(p["box"][1] * h)),
                            int(round(p["box"][2] * w)),
                            int(round(p["box"][3] * h)),
                        ],
                        first_frame_number=detector.frame_count,
                    )
                    correlation_engine.on_new_track(camera_entry, active_track_ids=current_track_ids_str)

            # Detect departed tracks → manage close grace period
            if camera_id not in _track_absent_frames:
                _track_absent_frames[camera_id] = {}
            absent_map = _track_absent_frames[camera_id]

            # 1. Increment absent frame counters for tracks no longer present
            for trk_id in prev_ids - current_track_ids:
                absent_map[trk_id] = absent_map.get(trk_id, 0) + 1

            # 2. Reset absent counter if a track is present in this frame
            for trk_id in current_track_ids:
                absent_map.pop(trk_id, None)

            # 3. Close sessions only if grace period has expired
            for trk_id, frames_gone in list(absent_map.items()):
                if frames_gone >= TRACK_CLOSE_GRACE_FRAMES:
                    absent_map.pop(trk_id, None)
                    closed = worker_session_manager.close_session(str(trk_id))
                    if closed:
                        print(f"[Identity] 🚪 Session closed (grace expired) for employee={closed.employee_id} track={trk_id}")

            _prev_track_ids[camera_id] = current_track_ids

            # Build per-track detection list for the WS response
            detections_out = []
            for p in poses:
                trk_id = p["track_id"]
                
                # Check confidence threshold to decide whether to send skeleton
                keypoints_to_send = p["keypoints"] if p["confidence"] >= config.confidence_threshold else []

                activity = classifier.classify(
                    has_pose=True,
                    confidence=p["confidence"],
                    movement_score=p["movement_score"],
                    worker_pos=p["worker_pos"],
                    zone=zone,
                    keypoints=p["keypoints"],
                )

                idle_sec = p["idle_seconds"]

                # Idle alert per track
                if activity == "idle" and idle_sec >= config.idle_threshold_seconds and not detector.alert_triggered:
                    with SessionLocal() as db:
                        db.add(Alert(
                            message=f"Worker (track {trk_id}) idle for {round(idle_sec)}s on {camera_id}",
                            resolved=False,
                        ))
                        db.commit()
                    detector.alert_triggered = True
                elif activity in ("working", "walking", "no_person"):
                    detector.alert_triggered = False

                # Resolve identity for this track
                worker_session = worker_session_manager.get_by_track(str(trk_id))

                detections_out.append({
                    "track_id":        trk_id,
                    "activity":        activity,
                    "activity_colour": ACTIVITY_COLOUR.get(activity, "#6b7280"),
                    "movement_score":  round(p["movement_score"], 5),
                    "confidence":      round(p["confidence"], 3),
                    "idle_seconds":    round(idle_sec, 1),
                    "worker_position": list(p["worker_pos"]) if p["worker_pos"] else None,
                    "keypoints":       keypoints_to_send,
                    "box":             [
                        round(float(p["box"][0]), 5),
                        round(float(p["box"][1]), 5),
                        round(float(p["box"][2]), 5),
                        round(float(p["box"][3]), 5)
                    ],
                    "identity": {
                        "employee_id":       worker_session.employee_id if worker_session else None,
                        "session_id":        worker_session.session_id if worker_session else None,
                        "correlation_delay": worker_session.correlation_delay_seconds if worker_session else None,
                    },
                })

            # Drive legacy SessionManager with the primary (first) person
            if detections_out:
                sm.process(detections_out[0]["activity"])
            else:
                sm.process("no_person")

            # ActivityLog snapshot every 25 frames
            if detector.frame_count % 25 == 0 and detections_out:
                p = detections_out[0]
                legacy_status = {
                    "working":      "active",
                    "walking":      "active",
                    "idle":         "idle",
                    "no_person":    "no_person",
                }.get(p["activity"], "unknown")
                with SessionLocal() as db:
                    db.add(ActivityLog(
                        status=legacy_status,
                        activity=p["activity"],
                        idle_seconds=p["idle_seconds"],
                        movement_score=p["movement_score"],
                        confidence=p["confidence"],
                    ))
                    db.commit()

            response = {
                "timestamp": datetime.utcnow().isoformat(),
                # Legacy single-person fields (still valid for 1-person scenes)
                "status":   detections_out[0]["activity"] if detections_out else "no_person",
                "activity": detections_out[0]["activity"] if detections_out else "no_person",
                "activity_colour": detections_out[0]["activity_colour"] if detections_out else "#6b7280",
                "movement_score":  detections_out[0]["movement_score"] if detections_out else 0.0,
                "confidence":      detections_out[0]["confidence"] if detections_out else 0.0,
                "idle_seconds":    detections_out[0]["idle_seconds"] if detections_out else 0.0,
                "idle_threshold_seconds": config.idle_threshold_seconds,
                "zone": list(zone),
                "session": sm.current_session_info(),
                "worker_position": detections_out[0]["worker_position"] if detections_out else None,
                "keypoints":       detections_out[0]["keypoints"] if detections_out else [],
                "boxes":           [d["box"] for d in detections_out],
                "identity":        detections_out[0]["identity"] if detections_out else None,
                # Multi-person: full tracked list
                "detections":      detections_out,
                "detection_count": len(detections_out),
            }
            await websocket.send_text(json.dumps(response))

    except WebSocketDisconnect:
        print("❌ WebSocket disconnected")
        if camera_id and camera_id in session_managers:
            session_managers[camera_id].close_on_disconnect()
        if camera_id in _prev_track_ids:
            _prev_track_ids[camera_id] = set()
    except Exception as e:
        print(f"❌ Fatal WS error: {e}")
        if camera_id and camera_id in session_managers:
            session_managers[camera_id].close_on_disconnect()