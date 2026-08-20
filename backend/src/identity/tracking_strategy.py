"""
Modular Person Tracking Strategy Framework.

Supports switching between Tracking Modes:
  1. NORMAL (or TRACK_ALL): Tracks, analyzes, and logs all detected people in camera feeds.
  2. DOOR_BASED (or TRACK_SPECIFIC): Only tracks employees who have successfully checked in/accessed
     through a Door ACS, then tracks them on their designated cameras and follows their identity
     across connected cameras according to the configured Portal Flow.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from ..config import config
from .session_manager import worker_session_manager


class BaseTrackingStrategy(ABC):
    """Abstract interface for person tracking strategies."""

    @abstractmethod
    def should_track(
        self,
        track_id: str,
        camera_id: str,
        person_identifier: Optional[str] = None,
    ) -> bool:
        """Return True if this detected person/track should be actively analyzed and tracked."""
        pass


class NormalTrackingStrategy(BaseTrackingStrategy):
    """Normal Tracking mode: track, analyze, and display all detected people."""

    def should_track(
        self,
        track_id: str,
        camera_id: str,
        person_identifier: Optional[str] = None,
    ) -> bool:
        return True


# Backward-compatible alias
TrackAllStrategy = NormalTrackingStrategy


class DoorBasedTrackingStrategy(BaseTrackingStrategy):
    """
    Door-Based Tracking mode:
    - Only tracks employees who have successfully checked in/accessed through a Door ACS
      (has an active WorkerSession).
    - Un-checked-in anonymous tracks are ignored (bypassed from AI analysis and metrics),
      focusing compute strictly on authenticated personnel as they move through designated
      cameras and connected portals.
    """

    def should_track(
        self,
        track_id: str,
        camera_id: str,
        person_identifier: Optional[str] = None,
    ) -> bool:
        # Check active session resolved for this track
        session = worker_session_manager.get_by_track(str(track_id))
        emp_id = person_identifier or (session.employee_id if session else None)

        if not emp_id:
            return False  # Anonymous track not checked in yet → bypass

        target_ids: list[str] = getattr(config, "tracked_employee_ids", [])
        if target_ids and str(emp_id) in target_ids:
            return True

        # Check DB for employee tracking status if registered
        try:
            from ..db.database import SessionLocal
            from ..db.models import EmployeeDB
            with SessionLocal() as db:
                emp = db.query(EmployeeDB).filter(EmployeeDB.employee_id == str(emp_id)).first()
                if emp is not None:
                    return emp.is_tracked
        except Exception:
            pass

        return True


# Backward-compatible alias
TrackSpecificStrategy = DoorBasedTrackingStrategy


class TrackingStrategyFactory:
    """Factory creating the appropriate tracking strategy based on system config."""

    _strategies = {
        "NORMAL": NormalTrackingStrategy(),
        "TRACK_ALL": NormalTrackingStrategy(),
        "DOOR_BASED": DoorBasedTrackingStrategy(),
        "DOOR": DoorBasedTrackingStrategy(),
        "TRACK_SPECIFIC": DoorBasedTrackingStrategy(),
    }

    @classmethod
    def get_strategy(cls) -> BaseTrackingStrategy:
        mode = getattr(config, "tracking_mode", "NORMAL").upper()
        return cls._strategies.get(mode, cls._strategies["NORMAL"])
