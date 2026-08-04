"""
CorrelationEngine — matches IdentityEvents to CameraEntryEvents by time.

ALGORITHM
=========
1. Identity events (from any provider) are pushed into a FIFO pending queue
   with status WAITING_FOR_TRACK.

2. When the camera pipeline detects a new person / track, it calls on_new_track().

3. The engine scans the pending queue for the EARLIEST WAITING event whose
   timestamp is within the configured window (default: 5 seconds).

4. If a match is found:
   - The identity event is marked MATCHED.
   - A WorkerSession is created via WorkerSessionManager.
   - The match is logged: [Identity] Employee EMP001 matched with Track X | Delay: 1.2s
   - Both the IdentityEvent and WorkerSession are persisted to PostgreSQL.

5. Events older than the window that have not been matched are expired lazily
   (moved to history with status EXPIRED) during the next on_new_track() call.

THREAD SAFETY
=============
The engine is accessed from the async WebSocket handler (asyncio event loop) and
the REST API. All mutations are protected by a threading.Lock for safety,
since SQLAlchemy session operations are synchronous and may run in thread-pool
workers under uvicorn.
"""

from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timezone
from typing import Optional

from .models import CameraEntryEvent, IdentityEvent, WorkerSession
from ..db.database import SessionLocal
from ..db.models import IdentityEventDB
from .session_manager import worker_session_manager


REBIND_WINDOW_SECONDS = 8.0  # max seconds after session close to allow re-binding


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CorrelationEngine:
    """
    Time-window correlation between identity scans and camera detections.

    correlation_window_seconds:
        Maximum time difference (absolute) between an identity event timestamp
        and a camera entry event timestamp for them to be considered the same
        physical entry. Configurable at runtime via DetectionConfig.
    """

    def __init__(self, correlation_window_seconds: float = 5.0) -> None:
        self._window: float = correlation_window_seconds
        self._pending: deque[IdentityEvent] = deque()  # WAITING_FOR_TRACK events
        self._unmatched_tracks: deque[CameraEntryEvent] = deque() # WAITING_FOR_IDENTITY tracks
        self._history: list[IdentityEvent] = []        # MATCHED + EXPIRED events
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    # Configuration (updated live from DetectionConfig)
    # ------------------------------------------------------------------

    def set_window(self, seconds: float) -> None:
        self._window = seconds

    # ------------------------------------------------------------------
    # Called by identity providers (REST, RFID, NFC, …)
    # ------------------------------------------------------------------

    def register_identity_event(self, event: IdentityEvent) -> None:
        """
        Accept a new IdentityEvent from any provider and queue it for correlation.
        Persists the event to PostgreSQL immediately.
        """
        with self._lock:
            # Clean up old pending events and anonymous tracks first
            self._expire_stale(_utcnow())
            self._expire_stale_tracks(event.timestamp)

            if event.event_type == "EXIT":
                self._history.append(event)
                self._persist_identity_event(event)
                return

            # Try to match with an existing anonymous track (Bi-directional)
            matched_track: Optional[CameraEntryEvent] = None
            matched_delay: float = 0.0

            for track_event in list(self._unmatched_tracks):
                delay = abs((track_event.timestamp - event.timestamp).total_seconds())
                if delay <= self._window:
                    matched_track = track_event
                    matched_delay = delay
                    break

            if matched_track:
                self._unmatched_tracks.remove(matched_track)
                event.correlation_status = "MATCHED"
                event.matched_track_id = matched_track.track_id
                event.matched_at = _utcnow()
                event.correlation_delay_seconds = round(matched_delay, 3)
                self._history.append(event)
            else:
                self._pending.append(event)
                print(f"[Identity] ⏳ Queued identity event for employee={event.employee_id} gate={event.entry_gate} ts={event.timestamp.isoformat()}")

        self._persist_identity_event(event)

        if matched_track:
            worker_session_manager.create_session(
                employee_id=event.employee_id,
                track_id=matched_track.track_id,
                camera_id=matched_track.camera_id,
                correlation_delay=matched_delay,
            )
            self._update_identity_event_matched(event)
            print(f"[Identity] 🔄 Bi-directional Match! Employee {event.employee_id} claimed anonymous Track {matched_track.track_id} | Delay: {matched_delay:.1f}s")

    # ------------------------------------------------------------------
    # Called by the camera pipeline when a new person/track appears
    # ------------------------------------------------------------------

    def on_new_track(self, camera_event: CameraEntryEvent, active_track_ids: Optional[set[str]] = None) -> Optional[WorkerSession]:
        """
        Try to match this new camera entry with a pending identity event.

        Returns the created WorkerSession on success, or None if no match
        was found within the correlation window.

        Also expires any stale events in the pending queue (older than window).
        """
        with self._lock:
            self._expire_stale(camera_event.timestamp)

            matched_event: Optional[IdentityEvent] = None
            matched_delay: float = 0.0

            for ev in list(self._pending):
                delay = abs((camera_event.timestamp - ev.timestamp).total_seconds())
                if delay <= self._window:
                    matched_event = ev
                    matched_delay = delay
                    break  # earliest WAITING event within window wins

            if matched_event is None:
                # --- Re-binding pass: look for a recently closed (or absent active) session on the same camera ---
                rebind_session = worker_session_manager.try_rebind_recent(
                    new_track_id=camera_event.track_id,
                    camera_id=camera_event.camera_id,
                    reference_time=camera_event.timestamp,
                    max_gap_seconds=REBIND_WINDOW_SECONDS,
                    active_track_ids=active_track_ids,
                )
                if rebind_session:
                    print(
                        f"[Identity] 🔁 Re-bound Track {camera_event.track_id} → "
                        f"Employee {rebind_session.employee_id} (previous Track "
                        f"{rebind_session.current_track_id} went absent)"
                    )
                    return rebind_session  # identity preserved

                self._unmatched_tracks.append(camera_event)
                print(f"[Identity] 🔍 New track {camera_event.track_id} on {camera_event.camera_id}"
                      f" — no matching identity event within {self._window}s window. Added to anonymous queue.")
                return None

            # Mark as MATCHED
            self._pending.remove(matched_event)
            matched_event.correlation_status = "MATCHED"
            matched_event.matched_track_id = camera_event.track_id
            matched_event.matched_at = _utcnow()
            matched_event.correlation_delay_seconds = round(matched_delay, 3)
            self._history.append(matched_event)

        # Create worker session (outside lock — avoids holding lock during DB I/O)
        session = worker_session_manager.create_session(
            employee_id=matched_event.employee_id,
            track_id=camera_event.track_id,
            camera_id=camera_event.camera_id,
            correlation_delay=matched_delay,
        )

        print(
            f"[Identity] ✅ Employee {matched_event.employee_id} matched with"
            f" Track {camera_event.track_id} | Delay: {matched_delay:.1f}s"
        )

        # Update DB record
        self._update_identity_event_matched(matched_event)
        return session

    # ------------------------------------------------------------------
    # Read operations (for debug API endpoints)
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
        """Move events older than the window to history with EXPIRED status."""
        still_pending: deque[IdentityEvent] = deque()
        for ev in self._pending:
            delay = abs((reference_time - ev.timestamp).total_seconds())
            if delay > self._window:
                ev.correlation_status = "EXPIRED"
                self._history.append(ev)
                self._update_identity_event_expired(ev)
                print(f"[Identity] ⏰ Expired unmatched event for employee={ev.employee_id}"
                      f" (age={delay:.1f}s > window={self._window}s)")
            else:
                still_pending.append(ev)
        self._pending = still_pending

    def _expire_stale_tracks(self, reference_time: datetime) -> None:
        """Drop anonymous tracks from the queue if they are older than the window."""
        still_pending: deque[CameraEntryEvent] = deque()
        for ev in list(self._unmatched_tracks):
            delay = (reference_time - ev.timestamp).total_seconds()
            if delay <= self._window:
                still_pending.append(ev)
        self._unmatched_tracks = still_pending

    @staticmethod
    def _persist_identity_event(event: IdentityEvent) -> None:
        with SessionLocal() as db:
            row = IdentityEventDB(
                event_id=event.event_id,
                employee_id=event.employee_id,
                employee_name=event.employee_name,
                event_type=event.event_type,
                timestamp=event.timestamp,
                entry_gate=event.entry_gate,
                provider=event.provider,
                correlation_status=event.correlation_status,
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
                row.matched_at = event.matched_at
                row.correlation_delay_seconds = event.correlation_delay_seconds
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
correlation_engine = CorrelationEngine(correlation_window_seconds=5.0)
