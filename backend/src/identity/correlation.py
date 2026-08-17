"""
CorrelationEngine — matches IdentityEvents to CameraEntryEvents by time and allowed cameras.

ALGORITHM
=========
1. When an identity event (ENTRY or EXIT) occurs from any door terminal:
   - Door-specific camera configuration (check_in_cameras or check_out_cameras)
     and correlation_window_seconds are attached to the event.
   - The event is queued in the pending FIFO queue with status WAITING_FOR_TRACK.

2. When the camera pipeline detects a new person / track on a camera:
   - on_new_track() checks pending identity events.
   - Only events where camera_id matches event.allowed_cameras (or unrestricted)
     AND delay <= window are eligible.
   - On match:
     * Event is marked MATCHED with matched_camera_id and matched_track_id.
     * If ENTRY: WorkerSession is created and tracked.
     * If EXIT: WorkerSession is closed with the exit camera appearance recorded.

3. Bi-directional matching:
   - If a person was detected on an allowed camera slightly before the card swipe / face scan,
     the pending anonymous track in _unmatched_tracks is claimed by the identity event.
"""

from __future__ import annotations

import json
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Optional, List, Union

from .models import CameraEntryEvent, IdentityEvent, WorkerSession
from ..config import env_settings
from ..db.database import SessionLocal
from ..db.models import IdentityEventDB
from .session_manager import worker_session_manager


REBIND_WINDOW_SECONDS = 8.0  # max seconds after session close to allow re-binding


def _to_utc(dt: Optional[datetime]) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _normalize_cam_id(cid: Union[str, int]) -> str:
    """Normalize camera ID representations (e.g. 'ai-14' -> '14', 14 -> '14')."""
    s = str(cid).strip()
    if s.startswith("ai-"):
        s = s[3:]
    elif s.startswith("cam-"):
        s = s[4:]
    return s


def _is_camera_allowed(camera_id: Union[str, int], allowed_cameras: List[Union[str, int]]) -> bool:
    """
    Check if a camera matches the allowed_cameras list.
    If allowed_cameras is empty, return True (unrestricted / backwards compatible).
    """
    if not allowed_cameras:
        return True
    target = _normalize_cam_id(camera_id)
    allowed_set = {_normalize_cam_id(c) for c in allowed_cameras}
    return target in allowed_set


def enrich_door_event_config(event: IdentityEvent) -> None:
    """Attach allowed_cameras and correlation_window_seconds from door configuration if not set."""
    gate_clean = event.entry_gate.lower().strip()
    matched_door = None

    for d in env_settings.hikvision_doors:
        d_name = (d.get("name") or "").lower().strip()
        d_ip = (d.get("ip") or "").lower().strip()
        if gate_clean == d_name or gate_clean == d_ip or d_name in gate_clean:
            matched_door = d
            break

    if matched_door:
        if not event.allowed_cameras:
            if event.event_type == "EXIT":
                raw_cams = matched_door.get("check_out_cameras") or []
            else:
                raw_cams = matched_door.get("check_in_cameras") or []
            event.allowed_cameras = [str(c) for c in raw_cams]

        if event.correlation_window_seconds is None:
            event.correlation_window_seconds = float(matched_door.get("correlation_window_seconds") or 10.0)


class CorrelationEngine:
    """
    Time-window and camera-constrained correlation between identity scans and camera detections.
    """

    def __init__(self, correlation_window_seconds: float = 10.0) -> None:
        self._window: float = correlation_window_seconds
        self._pending: deque[IdentityEvent] = deque()             # WAITING_FOR_TRACK events
        self._unmatched_tracks: deque[CameraEntryEvent] = deque() # WAITING_FOR_IDENTITY tracks
        self._history: list[IdentityEvent] = []                   # MATCHED + EXPIRED events
        self._lock = threading.Lock()

    def set_window(self, seconds: float) -> None:
        self._window = seconds

    # ------------------------------------------------------------------
    # Called by identity providers (REST, RFID, Hikvision ISAPI, …)
    # ------------------------------------------------------------------

    def register_identity_event(self, event: IdentityEvent) -> None:
        """
        Accept a new IdentityEvent from any provider and queue it for correlation.
        Persists the event to PostgreSQL immediately.
        """
        # Ensure door config (allowed cameras & window) is enriched
        enrich_door_event_config(event)
        event_window = event.correlation_window_seconds or self._window

        with self._lock:
            # Clean up stale pending events and anonymous tracks
            self._expire_stale(_utcnow())
            self._expire_stale_tracks(event.timestamp)

            # If it's an EXIT event with NO check-out cameras configured, complete it immediately
            if event.event_type == "EXIT" and not event.allowed_cameras:
                event.correlation_status = "MATCHED"
                event.matched_at = _utcnow()
                event.correlation_delay_seconds = 0.0
                self._history.append(event)
                self._persist_identity_event(event)
                worker_session_manager.close_sessions_for_employee(event.employee_id)
                print(f"[Identity] 🚪 Immediate EXIT recorded for employee={event.employee_id} at {event.entry_gate} (no exit cameras configured)")
                return

            # Try to match with an existing anonymous track (Bi-directional)
            matched_track: Optional[CameraEntryEvent] = None
            matched_delay: float = 0.0

            for track_event in list(self._unmatched_tracks):
                if not _is_camera_allowed(track_event.camera_id, event.allowed_cameras):
                    continue
                delay = abs((_to_utc(track_event.timestamp) - _to_utc(event.timestamp)).total_seconds())
                if delay <= event_window:
                    matched_track = track_event
                    matched_delay = delay
                    break

            if matched_track:
                self._unmatched_tracks.remove(matched_track)
                event.correlation_status = "MATCHED"
                event.matched_track_id = matched_track.track_id
                event.matched_camera_id = _normalize_cam_id(matched_track.camera_id)
                event.matched_at = _utcnow()
                event.correlation_delay_seconds = round(matched_delay, 3)
                self._history.append(event)
            else:
                self._pending.append(event)
                cams_desc = f"allowed_cams={event.allowed_cameras}" if event.allowed_cameras else "all cameras"
                print(f"[Identity] [QUEUED] Queued {event.event_type} event for employee={event.employee_id} gate={event.entry_gate} [{cams_desc}, window={event_window}s]")

        self._persist_identity_event(event)

        if matched_track:
            if event.event_type == "ENTRY":
                worker_session_manager.create_session(
                    employee_id=event.employee_id,
                    track_id=matched_track.track_id,
                    camera_id=matched_track.camera_id,
                    correlation_delay=matched_delay,
                )
                print(f"[Identity] [MATCHED] Bi-directional Match! Employee {event.employee_id} (Gate {event.entry_gate}) matched on Camera {matched_track.camera_id} Track {matched_track.track_id} | Delay: {matched_delay:.1f}s")
            elif event.event_type == "EXIT":
                worker_session_manager.close_sessions_for_employee(event.employee_id)
                print(f"[Identity] [EXIT] Bi-directional Exit Match! Employee {event.employee_id} (Gate {event.entry_gate}) matched on Exit Camera {matched_track.camera_id} | Delay: {matched_delay:.1f}s")
            self._update_identity_event_matched(event)

    # ------------------------------------------------------------------
    # Called by the camera pipeline when a new person/track appears
    # ------------------------------------------------------------------

    def on_new_track(self, camera_event: CameraEntryEvent, active_track_ids: Optional[set[str]] = None) -> Optional[WorkerSession]:
        """
        Try to match this new camera entry with a pending identity event.
        Only matches if the camera is permitted by the door event's allowed_cameras.
        """
        with self._lock:
            self._expire_stale(camera_event.timestamp)

            matched_event: Optional[IdentityEvent] = None
            matched_delay: float = 0.0

            for ev in list(self._pending):
                if not _is_camera_allowed(camera_event.camera_id, ev.allowed_cameras):
                    continue

                delay = abs((_to_utc(camera_event.timestamp) - _to_utc(ev.timestamp)).total_seconds())
                ev_window = ev.correlation_window_seconds or self._window
                if delay <= ev_window:
                    matched_event = ev
                    matched_delay = delay
                    break  # earliest eligible event within window wins

            if matched_event is None:
                # --- Re-binding pass for active camera sessions ---
                rebind_session = worker_session_manager.try_rebind_recent(
                    new_track_id=camera_event.track_id,
                    camera_id=camera_event.camera_id,
                    reference_time=camera_event.timestamp,
                    max_gap_seconds=REBIND_WINDOW_SECONDS,
                    active_track_ids=active_track_ids,
                )
                if rebind_session:
                    print(
                        f"[Identity] [REBOUND] Re-bound Track {camera_event.track_id} -> "
                        f"Employee {rebind_session.employee_id} (previous Track "
                        f"{rebind_session.current_track_id} went absent)"
                    )
                    return rebind_session

                self._unmatched_tracks.append(camera_event)
                return None

            # Mark as MATCHED
            self._pending.remove(matched_event)
            matched_event.correlation_status = "MATCHED"
            matched_event.matched_track_id = camera_event.track_id
            matched_event.matched_camera_id = _normalize_cam_id(camera_event.camera_id)
            matched_event.matched_at = _utcnow()
            matched_event.correlation_delay_seconds = round(matched_delay, 3)
            self._history.append(matched_event)

        # Handle match according to event type
        if matched_event.event_type == "ENTRY":
            session = worker_session_manager.create_session(
                employee_id=matched_event.employee_id,
                track_id=camera_event.track_id,
                camera_id=camera_event.camera_id,
                correlation_delay=matched_delay,
            )
            print(
                f"[Identity] [CORRELATED] Correlated Door ENTRY ({matched_event.entry_gate}) -> "
                f"Employee {matched_event.employee_id} -> Camera {camera_event.camera_id} "
                f"(Track {camera_event.track_id}) | Delay: {matched_delay:.1f}s"
            )
            self._update_identity_event_matched(matched_event)
            return session
        else:
            # EXIT event correlation
            worker_session_manager.close_sessions_for_employee(matched_event.employee_id)
            print(
                f"[Identity] [EXIT] Correlated Door EXIT ({matched_event.entry_gate}) -> "
                f"Employee {matched_event.employee_id} on Exit Camera {camera_event.camera_id} "
                f"(Track {camera_event.track_id}) | Delay: {matched_delay:.1f}s"
            )
            self._update_identity_event_matched(matched_event)
            return None

    # ------------------------------------------------------------------
    # Read operations (for debug & live dashboard endpoints)
    # ------------------------------------------------------------------

    def get_pending(self) -> list[IdentityEvent]:
        with self._lock:
            self._expire_stale(_utcnow())
            return list(self._pending)

    def get_history(self) -> list[IdentityEvent]:
        with self._lock:
            self._expire_stale(_utcnow())
            return list(self._history)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _expire_stale(self, reference_time: datetime) -> None:
        """Move events older than their correlation window to history with EXPIRED status."""
        ref_utc = _to_utc(reference_time)
        still_pending: deque[IdentityEvent] = deque()
        for ev in self._pending:
            delay = abs((ref_utc - _to_utc(ev.timestamp)).total_seconds())
            ev_window = ev.correlation_window_seconds or self._window
            if delay > ev_window:
                ev.correlation_status = "EXPIRED"
                self._history.append(ev)
                self._update_identity_event_expired(ev)
                if ev.event_type == "EXIT":
                    # If an exit event timed out waiting for exit cameras, ensure sessions are closed
                    worker_session_manager.close_sessions_for_employee(ev.employee_id)
                print(f"[Identity] [EXPIRED] Expired unmatched {ev.event_type} event for employee={ev.employee_id} (age={delay:.1f}s > window={ev_window}s)")
            else:
                still_pending.append(ev)
        self._pending = still_pending


    def _expire_stale_tracks(self, reference_time: datetime) -> None:
        """Drop anonymous tracks from the queue if they are older than the window."""
        ref_utc = _to_utc(reference_time)
        still_pending: deque[CameraEntryEvent] = deque()
        for ev in list(self._unmatched_tracks):
            delay = (ref_utc - _to_utc(ev.timestamp)).total_seconds()
            if delay <= self._window:
                still_pending.append(ev)
        self._unmatched_tracks = still_pending

    @staticmethod
    def _persist_identity_event(event: IdentityEvent) -> None:
        with SessionLocal() as db:
            cams_json = json.dumps(event.allowed_cameras) if event.allowed_cameras else None
            row = IdentityEventDB(
                event_id=event.event_id,
                employee_id=event.employee_id,
                employee_name=event.employee_name,
                event_type=event.event_type,
                timestamp=event.timestamp,
                entry_gate=event.entry_gate,
                provider=event.provider,
                correlation_status=event.correlation_status,
                allowed_cameras=cams_json,
                matched_track_id=event.matched_track_id,
                matched_camera_id=event.matched_camera_id,
                matched_at=event.matched_at,
                correlation_delay_seconds=event.correlation_delay_seconds,
            )
            db.add(row)
            db.commit()

    @staticmethod
    def _update_identity_event_matched(event: IdentityEvent) -> None:
        with SessionLocal() as db:
            row = db.query(IdentityEventDB).filter(
                IdentityEventDB.event_id == event.event_id
            ).first()
            if row:
                row.correlation_status = "MATCHED"
                row.matched_track_id = event.matched_track_id
                row.matched_camera_id = event.matched_camera_id
                row.matched_at = event.matched_at
                row.correlation_delay_seconds = event.correlation_delay_seconds
                if event.allowed_cameras:
                    row.allowed_cameras = json.dumps(event.allowed_cameras)
                db.commit()

    @staticmethod
    def _update_identity_event_expired(event: IdentityEvent) -> None:
        with SessionLocal() as db:
            row = db.query(IdentityEventDB).filter(
                IdentityEventDB.event_id == event.event_id
            ).first()
            if row:
                row.correlation_status = "EXPIRED"
                db.commit()


# ---------------------------------------------------------------------------
# Module-level singleton — default window (overridden from DetectionConfig)
# ---------------------------------------------------------------------------
correlation_engine = CorrelationEngine(correlation_window_seconds=10.0)

