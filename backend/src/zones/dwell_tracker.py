"""
Dwell Time & Zone Transition Tracking Engine.

Tracks active zone visits per camera and track ID, handles seamless zone transitions,
persists completed visits to SQLite database (ZoneVisitDB), and calculates real-time
dwell time durations.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Optional, Tuple

from ..db.database import SessionLocal
from ..db.models import ZoneVisitDB


def format_dwell_time(seconds: float) -> str:
    """Format seconds into HH:MM:SS or MM:SS string."""
    total_sec = int(max(0, seconds))
    hours = total_sec // 3600
    minutes = (total_sec % 3600) // 60
    secs = total_sec % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


@dataclass
class ActiveZoneVisit:
    camera_id: str
    zone_id: str
    zone_name: str
    zone_color: str
    tracking_id: str
    person_identifier: Optional[str]
    entry_time: datetime
    db_visit_id: int
    last_updated: datetime


class ZoneDwellTracker:
    """Thread-safe active visit & transition manager."""

    def __init__(self) -> None:
        # { camera_id: { track_id: ActiveZoneVisit } }
        self._active_visits: Dict[str, Dict[str, ActiveZoneVisit]] = {}
        self._lock = threading.Lock()

    def update_track_zone(
        self,
        camera_id: str,
        track_id: str,
        current_zone: Optional[Dict[str, str]],  # {"id": str, "name": str, "color": str}
        person_identifier: Optional[str] = None,
        timestamp: Optional[datetime] = None,
    ) -> Tuple[Optional[Dict[str, Any]], float]:
        """
        Process a track's current zone evaluation.

        Returns:
            (zone_status_dict, dwell_seconds)
            where zone_status_dict = {
                "zone_id": str,
                "zone_name": str,
                "zone_color": str,
                "dwell_seconds": float,
                "formatted_dwell": str,
                "entry_time": str (ISO format),
            }
        """
        cam_key = str(camera_id)
        str_trk_id = str(track_id)
        now = timestamp or datetime.now(timezone.utc).replace(tzinfo=None)

        with self._lock:
            if cam_key not in self._active_visits:
                self._active_visits[cam_key] = {}

            cam_visits = self._active_visits[cam_key]
            active_visit = cam_visits.get(str_trk_id)

            current_zone_id = current_zone["id"] if current_zone else None

            # Case 1: Outside all zones
            if not current_zone_id:
                if active_visit:
                    self._close_visit_in_db(active_visit, now)
                    cam_visits.pop(str_trk_id, None)
                return None, 0.0

            # Case 2: In same zone as active visit
            if active_visit and active_visit.zone_id == current_zone_id:
                active_visit.last_updated = now
                dwell_sec = max(0.0, (now - active_visit.entry_time).total_seconds())
                # Update person identifier if newly resolved
                if person_identifier and not active_visit.person_identifier:
                    active_visit.person_identifier = person_identifier
                    self._update_person_identifier_in_db(active_visit.db_visit_id, person_identifier)

                return {
                    "zone_id": active_visit.zone_id,
                    "zone_name": active_visit.zone_name,
                    "zone_color": active_visit.zone_color,
                    "dwell_seconds": round(dwell_sec, 1),
                    "formatted_dwell": format_dwell_time(dwell_sec),
                    "entry_time": active_visit.entry_time.isoformat(),
                }, dwell_sec

            # Case 3: Transitioning from zone_A -> zone_B (or new entry)
            if active_visit:
                self._close_visit_in_db(active_visit, now)
                cam_visits.pop(str_trk_id, None)

            # Check if another track in the same zone on this camera was active within the last 3.0 seconds (Track Stitching)
            stitched_visit = None
            for trk_key, v in list(cam_visits.items()):
                if trk_key != str_trk_id and v.zone_id == current_zone_id:
                    if (now - v.last_updated).total_seconds() <= 3.0:
                        stitched_visit = v
                        cam_visits.pop(trk_key, None)
                        break

            if stitched_visit:
                # Reuse existing visit — seamless track ID re-identification
                stitched_visit.tracking_id = str_trk_id
                stitched_visit.last_updated = now
                if person_identifier and not stitched_visit.person_identifier:
                    stitched_visit.person_identifier = person_identifier
                    self._update_person_identifier_in_db(stitched_visit.db_visit_id, person_identifier)

                cam_visits[str_trk_id] = stitched_visit
                dwell_sec = max(0.0, (now - stitched_visit.entry_time).total_seconds())
                return {
                    "zone_id": stitched_visit.zone_id,
                    "zone_name": stitched_visit.zone_name,
                    "zone_color": stitched_visit.zone_color,
                    "dwell_seconds": round(dwell_sec, 1),
                    "formatted_dwell": format_dwell_time(dwell_sec),
                    "entry_time": stitched_visit.entry_time.isoformat(),
                }, dwell_sec

            # Open new visit
            db_id = self._open_visit_in_db(
                camera_id=cam_key,
                zone_id=current_zone_id,
                tracking_id=str_trk_id,
                person_identifier=person_identifier,
                entry_time=now,
            )

            new_visit = ActiveZoneVisit(
                camera_id=cam_key,
                zone_id=current_zone_id,
                zone_name=current_zone.get("name", current_zone_id),
                zone_color=current_zone.get("color", "#3B82F6"),
                tracking_id=str_trk_id,
                person_identifier=person_identifier,
                entry_time=now,
                db_visit_id=db_id,
                last_updated=now,
            )
            cam_visits[str_trk_id] = new_visit

            return {
                "zone_id": new_visit.zone_id,
                "zone_name": new_visit.zone_name,
                "zone_color": new_visit.zone_color,
                "dwell_seconds": 0.0,
                "formatted_dwell": "00:00",
                "entry_time": now.isoformat(),
            }, 0.0

    def close_track_visit(self, camera_id: str, track_id: str) -> None:
        """Close active visit when a track disappears or closes."""
        cam_key = str(camera_id)
        str_trk_id = str(track_id)
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        with self._lock:
            if cam_key in self._active_visits:
                visit = self._active_visits[cam_key].pop(str_trk_id, None)
                if visit:
                    self._close_visit_in_db(visit, now)

    def close_all_camera_visits(self, camera_id: str) -> None:
        """Close all active visits for a camera on stream shutdown/disconnect."""
        cam_key = str(camera_id)
        now = datetime.now(timezone.utc).replace(tzinfo=None)

        with self._lock:
            if cam_key in self._active_visits:
                visits = self._active_visits.pop(cam_key, {})
                for visit in visits.values():
                    self._close_visit_in_db(visit, now)

    def cleanup_absent_tracks(
        self,
        camera_id: str,
        active_track_ids: set[str],
        timestamp: Optional[datetime] = None,
    ) -> None:
        """Close active visits for tracks on a camera that are no longer detected in the frame."""
        cam_key = str(camera_id)
        now = timestamp or datetime.now(timezone.utc).replace(tzinfo=None)

        with self._lock:
            if cam_key not in self._active_visits:
                return

            cam_visits = self._active_visits[cam_key]
            absent_ids = [trk_id for trk_id in cam_visits.keys() if trk_id not in active_track_ids]
            for trk_id in absent_ids:
                visit = cam_visits.pop(trk_id, None)
                if visit:
                    self._close_visit_in_db(visit, now)

    def is_visit_active_in_mem(self, db_visit_id: int, max_stale_seconds: float = 8.0) -> bool:
        """Check if a database visit ID is currently tracked active in memory with recent frame updates."""
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        with self._lock:
            for trk_map in self._active_visits.values():
                for visit in trk_map.values():
                    if visit.db_visit_id == db_visit_id:
                        return (now - visit.last_updated).total_seconds() <= max_stale_seconds
            return False

    def get_active_db_visit_ids(self, max_stale_seconds: float = 8.0) -> set[int]:
        """Return set of database visit IDs currently active in memory."""
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        active_ids = set()
        with self._lock:
            for trk_map in self._active_visits.values():
                for visit in trk_map.values():
                    if visit.db_visit_id > 0 and (now - visit.last_updated).total_seconds() <= max_stale_seconds:
                        active_ids.add(visit.db_visit_id)
        return active_ids

    def get_active_visits_count(
        self, camera_id: Optional[str] = None, zone_id: Optional[str] = None, max_stale_seconds: float = 8.0
    ) -> int:
        """Get total count of currently active in-memory visits inside zones with recent frame updates."""
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        with self._lock:
            count = 0
            to_remove = []
            for cam_key, trk_map in list(self._active_visits.items()):
                if camera_id and str(cam_key) != str(camera_id):
                    continue
                for trk_id, visit in list(trk_map.items()):
                    if zone_id and str(visit.zone_id) != str(zone_id):
                        continue
                    if (now - visit.last_updated).total_seconds() <= max_stale_seconds:
                        count += 1
                    else:
                        to_remove.append((cam_key, trk_id, visit))

            # Auto-close stale visits that haven't received a frame update in > 8.0 seconds
            for cam_key, trk_id, visit in to_remove:
                self._close_visit_in_db(visit, visit.last_updated)
                if cam_key in self._active_visits:
                    self._active_visits[cam_key].pop(trk_id, None)

            return count

    # ── Database Helpers ───────────────────────────────────────────────────

    def _open_visit_in_db(
        self,
        camera_id: str,
        zone_id: str,
        tracking_id: str,
        person_identifier: Optional[str],
        entry_time: datetime,
    ) -> int:
        try:
            with SessionLocal() as db:
                row = ZoneVisitDB(
                    camera_id=camera_id,
                    zone_id=zone_id,
                    tracking_id=tracking_id,
                    person_identifier=person_identifier,
                    entry_time=entry_time,
                    exit_time=None,
                    duration_seconds=None,
                )
                db.add(row)
                db.commit()
                db.refresh(row)
                return row.id
        except Exception as e:
            print(f"⚠️  [DwellTracker] Error opening visit in DB: {e}")
            return -1

    def _close_visit_in_db(self, visit: ActiveZoneVisit, exit_time: datetime) -> None:
        if visit.db_visit_id <= 0:
            return
        duration = max(0.0, (exit_time - visit.entry_time).total_seconds())
        try:
            with SessionLocal() as db:
                row = db.query(ZoneVisitDB).filter(ZoneVisitDB.id == visit.db_visit_id).first()
                if row:
                    # Fleeting visit filter: if duration is less than 3.0 seconds (fleeting track jitter), purge row
                    if duration < 3.0:
                        db.delete(row)
                    else:
                        row.exit_time = exit_time
                        row.duration_seconds = round(duration, 2)
                        if visit.person_identifier:
                            row.person_identifier = visit.person_identifier
                    db.commit()
        except Exception as e:
            print(f"⚠️  [DwellTracker] Error closing visit in DB: {e}")

    def _update_person_identifier_in_db(self, db_visit_id: int, person_identifier: str) -> None:
        if db_visit_id <= 0:
            return
        try:
            with SessionLocal() as db:
                row = db.query(ZoneVisitDB).filter(ZoneVisitDB.id == db_visit_id).first()
                if row and not row.person_identifier:
                    row.person_identifier = person_identifier
                    db.commit()
        except Exception as e:
            print(f"⚠️  [DwellTracker] Error updating person_identifier in DB: {e}")


dwell_tracker = ZoneDwellTracker()
