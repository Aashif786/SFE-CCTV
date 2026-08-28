"""
WorkerSessionManager — in-memory store + PostgreSQL persistence.

Maintains the canonical mapping:  track_id  →  WorkerSession

All downstream modules (activity logging, alerts) call get_by_track()
to resolve a track ID to a named employee — they never need to know
how the identity was obtained.

Track-ID reassignment:
  If the underlying tracker assigns a new ID to the same physical person
  (common in multi-object trackers), call update_track(old, new).
  The WorkerSession is updated in-place — no duplicate employee record is created.

Daily Summary:
  When a WorkerSession closes, _update_daily_summary() is called automatically.
  It queries all ActivitySession records that overlapped the employee's on-camera
  window (same camera_id, start_time within the worker session's time range),
  aggregates by activity type, and upserts into EmployeeDailySummary.
  Multiple check-ins per day accumulate correctly.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from .models import WorkerSession
from ..db.database import SessionLocal
from ..db.models import WorkerSessionDB, ActivitySession, EmployeeDailySummary


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class WorkerSessionManager:
    """
    In-memory session store with synchronous PostgreSQL persistence.

    The in-memory dict provides O(1) lookup per frame (critical for real-time
    pipeline). DB rows are the durable record for dashboards and reports.
    """

    def __init__(self) -> None:
        # track_id → WorkerSession  (only ACTIVE sessions)
        self._sessions: dict[str, WorkerSession] = {}
        # All closed sessions for the /history endpoint
        self._closed: list[WorkerSession] = []
        # Sessions that have left through an approved portal stay transferable
        # until their route cache expires; they are not visible as on-camera.
        self._pending_handoffs: dict[str, WorkerSession] = {}

    # ------------------------------------------------------------------
    # Write operations
    # ------------------------------------------------------------------

    def create_session(
        self,
        employee_id: str,
        track_id: str,
        camera_id: str,
        correlation_delay: float,
    ) -> WorkerSession:
        """Create a new ACTIVE WorkerSession and persist it to the DB."""
        session = WorkerSession(
            session_id=str(uuid.uuid4()),
            employee_id=employee_id,
            persistent_track_id=track_id,
            current_track_id=track_id,
            camera_id=camera_id,
            start_time=_utcnow(),
            status="ACTIVE",
            correlation_delay_seconds=round(correlation_delay, 3),
        )
        self._sessions[track_id] = session
        self._persist(session)
        return session

    def bind_employee_to_track(
        self,
        employee_id: str,
        track_id: str,
        camera_id: str,
        correlation_delay: float,
    ) -> WorkerSession:
        """Bind an employee identity to an existing track, or create a new session.

        If the track already has an ACTIVE WorkerSession, the employee_id is
        associated with that session (overriding any previous identity) and the
        existing session is returned — preserving tracking continuity.

        If no session exists, a fresh WorkerSession is created as usual.

        This is the primary entry point for ACS door correlation when the person
        may already be under an anonymous tracking ID.
        """
        existing = self._sessions.get(track_id)
        if existing is not None:
            old_emp = existing.employee_id
            existing.employee_id = employee_id
            existing.correlation_delay_seconds = round(correlation_delay, 3)
            # Persist the employee override to DB
            with SessionLocal() as db:
                row = db.query(WorkerSessionDB).filter(
                    WorkerSessionDB.session_id == existing.session_id
                ).first()
                if row:
                    row.employee_id = employee_id
                    row.correlation_delay_seconds = existing.correlation_delay_seconds
                    db.commit()
            print(
                f"[Identity] 🔗 Bound employee {employee_id} to existing session "
                f"(track={track_id}, prev_employee={old_emp})"
            )
            return existing
        # No existing session — create a new one
        return self.create_session(
            employee_id=employee_id,
            track_id=track_id,
            camera_id=camera_id,
            correlation_delay=correlation_delay,
        )

    def associate_track_continuity(
        self,
        origin_track_key: str,
        new_track_key: str,
        camera_id: str,
        correlation_delay: float,
    ) -> Optional[WorkerSession]:
        """Transfer tracking continuity for anonymous cross-camera handoff.

        When a Re-ID match confirms the same person crossed from one camera to
        another without an employee identity, this method carries over the
        session (if any) from the origin track to the new track.

        If the origin has a session (in _sessions or _pending_handoffs), it is
        transferred to the new track.  If not, no session is created — the
        handoff is still recorded for display-level track ID continuity by the
        caller.

        Returns the transferred session, or None if no origin session existed.
        """
        # Check active sessions first, then pending handoffs
        session = self._sessions.get(origin_track_key)
        source = "_sessions"
        if session is None:
            # Search pending handoffs by origin track key
            for sid, s in list(self._pending_handoffs.items()):
                if s.current_track_id == origin_track_key:
                    session = s
                    source = "_pending_handoffs"
                    break
        if session is None:
            return None

        # Prevent stealing an occupied destination track
        occupied = self._sessions.get(new_track_key)
        if occupied is not None and occupied.session_id != session.session_id:
            print(
                f"[IdentityTransfer] ❌ associate_track_continuity: destination "
                f"{new_track_key} occupied by {occupied.employee_id}"
            )
            return None

        # Move session to the new track
        if source == "_sessions":
            self._sessions.pop(origin_track_key, None)
        else:
            self._pending_handoffs.pop(session.session_id, None)

        session.current_track_id = new_track_key
        session.camera_id = camera_id
        session.correlation_delay_seconds = round(correlation_delay, 3)
        self._sessions[new_track_key] = session

        with SessionLocal() as db:
            row = db.query(WorkerSessionDB).filter(
                WorkerSessionDB.session_id == session.session_id
            ).first()
            if row:
                row.current_track_id = new_track_key
                row.camera_id = camera_id
                row.correlation_delay_seconds = session.correlation_delay_seconds
                db.commit()

        print(
            f"[IdentityTransfer] 🔄 Anonymous continuity: {origin_track_key} → "
            f"{new_track_key} on {camera_id} (employee={session.employee_id})"
        )
        return session

    def update_track(self, old_track_id: str, new_track_id: str) -> bool:
        """
        Reassign a WorkerSession to a new track ID without duplicating the employee.

        Use this when the tracker changes the numeric ID for the same physical person
        (e.g. ByteTrack track 17 → track 25 after occlusion recovery).

        Returns True if the session was found and updated, False otherwise.
        """
        session = self._sessions.pop(old_track_id, None)
        if session is None:
            return False
        session.current_track_id = new_track_id
        self._sessions[new_track_id] = session
        with SessionLocal() as db:
            row = db.query(WorkerSessionDB).filter(
                WorkerSessionDB.session_id == session.session_id
            ).first()
            if row:
                row.current_track_id = new_track_id
                db.commit()
        return True

    def transfer_session(
        self,
        session_id: str,
        old_track_id: str,
        new_track_id: str,
        camera_id: str,
        timestamp: datetime,
        correlation_delay: float,
    ) -> Optional[WorkerSession]:
        """Move one active employee session to a topology-validated camera track.

        This is deliberately a different operation from tracker-ID rebinding: the
        caller must have completed a spatial handoff match before invoking it.
        It preserves ``session_id`` so downstream consumers see one continuous
        employee session rather than a camera-specific duplicate.
        """
        session = self._sessions.get(old_track_id) or self._pending_handoffs.get(session_id)
        if session is None or session.session_id != session_id:
            print(f"[IdentityTransfer] ❌ transfer_session failed: session {session_id} not found in _sessions or _pending_handoffs")
            return None
        # A destination track must never silently steal an already active identity.
        occupied = self._sessions.get(new_track_id)
        if occupied is not None and occupied.session_id != session_id:
            print(f"[IdentityTransfer] ❌ transfer_session failed: destination track {new_track_id} already occupied by session {occupied.session_id} ({occupied.employee_id})")
            return None
        self._sessions.pop(old_track_id, None)
        self._pending_handoffs.pop(session_id, None)
        session.current_track_id = new_track_id
        session.camera_id = camera_id
        session.correlation_delay_seconds = round(correlation_delay, 3)
        self._sessions[new_track_id] = session
        with SessionLocal() as db:
            row = db.query(WorkerSessionDB).filter(WorkerSessionDB.session_id == session_id).first()
            if row:
                row.current_track_id = new_track_id
                row.camera_id = camera_id
                row.correlation_delay_seconds = session.correlation_delay_seconds
                db.commit()
        print(f"[IdentityTransfer] 🔄 Successfully transferred session for Employee {session.employee_id}: {old_track_id} -> {new_track_id} on {camera_id}")
        return session

    def hold_for_handoff(self, track_id: str) -> bool:
        """Remove a departed track from live lookups while preserving its session."""
        session = self._sessions.pop(track_id, None)
        if session is None:
            return False
        self._pending_handoffs[session.session_id] = session
        return True

    def close_pending_handoff(self, session_id: str) -> Optional[WorkerSession]:
        """Close a handoff hold after every configured destination window expired."""
        session = self._pending_handoffs.pop(session_id, None)
        if session is None:
            return None
        session.status = "CLOSED"
        session.end_time = _utcnow()
        self._closed.append(session)
        with SessionLocal() as db:
            row = db.query(WorkerSessionDB).filter(WorkerSessionDB.session_id == session_id).first()
            if row:
                row.status = "CLOSED"
                row.end_time = session.end_time
                db.commit()
        self._update_daily_summary(session)
        return session

    def close_session(self, track_id: str, activity_totals: dict[str, float] = None) -> Optional[WorkerSession]:
        """
        Mark the session for this track as CLOSED (person left frame).
        Persists end_time to DB and aggregates activity time into EmployeeDailySummary.
        """
        session = self._sessions.pop(track_id, None)
        if session is None:
            return None
        session.status = "CLOSED"
        session.end_time = _utcnow()
        self._closed.append(session)

        with SessionLocal() as db:
            row = db.query(WorkerSessionDB).filter(
                WorkerSessionDB.session_id == session.session_id
            ).first()
            if row:
                row.status = "CLOSED"
                row.end_time = session.end_time
                db.commit()

        # Aggregate and persist daily summary
        self._update_daily_summary(session, activity_totals)
        return session

    def close_sessions_for_employee(self, employee_id: str) -> None:
        """
        Force-close any active camera sessions for the given employee.
        Use this when they physically check out of the building.
        """
        active_track_ids = [
            track_id for track_id, s in self._sessions.items()
            if s.employee_id == employee_id
        ]
        for track_id in active_track_ids:
            self.close_session(track_id)

        # Ensure any active sessions are also marked closed in the database
        with SessionLocal() as db:
            active_rows = db.query(WorkerSessionDB).filter(
                WorkerSessionDB.employee_id == employee_id,
                WorkerSessionDB.status == "ACTIVE"
            ).all()
            for row in active_rows:
                row.status = "CLOSED"
                row.end_time = _utcnow()
            db.commit()

    # ------------------------------------------------------------------
    # Read operations
    # ------------------------------------------------------------------

    def try_rebind_recent(
        self,
        new_track_id: str,
        camera_id: str,
        reference_time: datetime,
        max_gap_seconds: float = 8.0,
        active_track_ids: Optional[set[str]] = None,
    ) -> Optional[WorkerSession]:
        """
        Look for the most-recently-closed (or absent active) session on this camera.
        If found, re-activate it under the new track_id.

        This handles the BoT-SORT first-frame ID flicker: a person enters,
        gets Track 5, briefly loses tracking, then reappears as Track 17.
        The session is either still ACTIVE (in grace period) or recently CLOSED,
        and is re-bound under Track 17.
        """
        # 0. Check if the exact track ID is already active (tracker survived occlusion)
        if new_track_id in self._sessions:
            # The BoT-SORT tracker successfully recovered the person using its ReID & Spatial features.
            # We strictly trust the tracker and preserve their existing session perfectly.
            return self._sessions[new_track_id]

        # Note: We intentionally do NOT perform blind temporal rebinding (e.g. if a track appears within
        # X seconds of another track disappearing). Doing so aggressively stole identities from new workers
        # (e.g. Worker A leaves, Worker B enters 2s later and gets Worker A's identity).
        # We rely entirely on BoT-SORT's track_buffer and ReID engine to maintain identity across occlusions.
        return None

    # Alias for backward compatibility
    try_rebind_absent = try_rebind_recent

    def get_by_track(self, track_id: str | int) -> Optional[WorkerSession]:
        """Look up the active WorkerSession for a given track ID with prefix normalization."""
        if track_id is None:
            return None
        raw_key = str(track_id).strip()
        # 1. Direct lookup
        session = self._sessions.get(raw_key)
        if session is not None:
            return session

        # 2. Camera prefix normalization (e.g. "ai-1:75" vs "1:75" vs "cam1:75" vs "75")
        if ":" in raw_key:
            cam_part, num_part = raw_key.rsplit(":", 1)
            norm_cam = cam_part.replace("ai-", "").replace("cam-", "").replace("cam", "")
            for k, s in self._sessions.items():
                if ":" in k:
                    k_cam, k_num = k.rsplit(":", 1)
                    k_norm_cam = k_cam.replace("ai-", "").replace("cam-", "").replace("cam", "")
                    if k_norm_cam == norm_cam and k_num == num_part:
                        return s
                elif k == num_part:
                    return s
        else:
            # Numeric/suffix match (e.g. searching "75" matches "1:75" or "ai-1:75")
            for k, s in self._sessions.items():
                if k == raw_key or k.endswith(f":{raw_key}"):
                    return s
                if s.persistent_track_id and (s.persistent_track_id == raw_key or s.persistent_track_id.endswith(f":{raw_key}")):
                    return s
        return None

    def get_all_active(self) -> list[WorkerSession]:
        """Return all currently ACTIVE sessions."""
        return list(self._sessions.values())

    def get_history(self) -> list[WorkerSession]:
        """Return all CLOSED sessions (today's server run)."""
        return list(self._closed)

    # ------------------------------------------------------------------
    # Daily summary aggregation
    # ------------------------------------------------------------------

    def _update_daily_summary(self, session: WorkerSession, activity_totals: dict[str, float] = None) -> None:
        """
        Aggregate activity time for this WorkerSession and upsert into
        EmployeeDailySummary.

        Strategy:
        - Use the activity_totals passed from the real-time tracker directly.
        - Sum durations per activity type.
        - Upsert into EmployeeDailySummary (increment existing row if present).
        """
        if session.end_time is None:
            return

        date_key = session.start_time.date()

        # Aggregate seconds per activity
        agg: dict[str, float] = {"working": 0.0, "idle": 0.0, "walking": 0.0}
        if activity_totals:
            for k in agg.keys():
                agg[k] = activity_totals.get(k, 0.0)

        total = sum(agg.values())

        with SessionLocal() as db:
            from ..db.models import EmployeeZoneDB, ZoneVisitDB

            # Fetch assigned work zones for this employee
            assigned_zones = db.query(EmployeeZoneDB).filter(
                EmployeeZoneDB.employee_id == session.employee_id,
                EmployeeZoneDB.is_designated == True,
            ).all()
            assigned_zone_ids = {az.zone_id for az in assigned_zones}

            # Fetch completed zone visits for this employee during the session window
            zone_visits = db.query(ZoneVisitDB).filter(
                ZoneVisitDB.person_identifier == session.employee_id,
                ZoneVisitDB.entry_time >= session.start_time,
            ).all()

            desig_sec = 0.0
            outside_sec = 0.0
            common_sec = 0.0

            for zv in zone_visits:
                dur = zv.duration_seconds or 0.0
                if not assigned_zone_ids or zv.zone_id in assigned_zone_ids:
                    desig_sec += dur
                else:
                    outside_sec += dur

            # Upsert into EmployeeDailySummary
            summary = (
                db.query(EmployeeDailySummary)
                .filter(
                    EmployeeDailySummary.employee_id == session.employee_id,
                    EmployeeDailySummary.date == date_key,
                )
                .first()
            )

            if summary is None:
                summary = EmployeeDailySummary(
                    employee_id=session.employee_id,
                    date=date_key,
                    working_seconds=0.0,
                    idle_seconds=0.0,
                    walking_seconds=0.0,
                    designated_zone_seconds=0.0,
                    outside_zone_seconds=0.0,
                    common_area_seconds=0.0,
                    break_seconds=0.0,
                    total_seconds=0.0,
                    productivity_score=100.0,
                    check_in_count=0,
                    first_seen=None,
                    last_seen=None,
                )
                db.add(summary)

            # Accumulate (not overwrite) so multiple check-ins stack up
            summary.working_seconds         += agg["working"]
            summary.idle_seconds            += agg["idle"]
            summary.walking_seconds         += agg["walking"]
            summary.designated_zone_seconds += desig_sec
            summary.outside_zone_seconds    += outside_sec
            summary.common_area_seconds     += common_sec
            summary.total_seconds           += total
            summary.check_in_count          += 1

            tot_sec = summary.total_seconds if summary.total_seconds > 0 else 1.0
            summary.productivity_score = round(
                (summary.designated_zone_seconds / tot_sec) * 100.0, 1
            ) if summary.designated_zone_seconds > 0 else (
                round((summary.working_seconds / tot_sec) * 100.0, 1) if summary.working_seconds > 0 else 0.0
            )

            # Track earliest/latest appearance today
            if summary.first_seen is None or session.start_time < summary.first_seen:
                summary.first_seen = session.start_time
            if summary.last_seen is None or session.end_time > summary.last_seen:
                summary.last_seen = session.end_time

            db.commit()

            print(
                f"[Identity] [SUMMARY] Daily summary updated for {session.employee_id} "
                f"| +working={agg['working']:.1f}s  +idle={agg['idle']:.1f}s  "
                f"+designated_zone={desig_sec:.1f}s  score={summary.productivity_score}%"
            )

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _persist(self, session: WorkerSession) -> None:
        with SessionLocal() as db:
            row = WorkerSessionDB(
                session_id=session.session_id,
                employee_id=session.employee_id,
                persistent_track_id=session.persistent_track_id,
                current_track_id=session.current_track_id,
                camera_id=session.camera_id,
                start_time=session.start_time,
                status=session.status,
                correlation_delay_seconds=session.correlation_delay_seconds,
            )
            db.add(row)
            db.commit()


# ---------------------------------------------------------------------------
# Module-level singleton — imported by correlation.py and api.py
# ---------------------------------------------------------------------------
worker_session_manager = WorkerSessionManager()
