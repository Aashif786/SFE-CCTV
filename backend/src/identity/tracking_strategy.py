"""
Modular Person Tracking Strategy Framework.

Supports switching between Tracking Modes:
  1. TRACK_ALL (Default): Tracks, analyzes, and logs all detected people.
  2. TRACK_SPECIFIC: Only actively monitors designated personnel after check-in.
     Non-checked-in or non-designated individuals are bypassed to optimize compute.
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
        """Return True if this detected person/track should be actively analyzed."""
        pass


class TrackAllStrategy(BaseTrackingStrategy):
    """Default strategy: track and analyze every detected person."""

    def should_track(
        self,
        track_id: str,
        camera_id: str,
        person_identifier: Optional[str] = None,
    ) -> bool:
        return True


class TrackSpecificStrategy(BaseTrackingStrategy):
    """
    Track Specific People strategy:
    - Only tracks individuals whose tracking status (is_tracked) is enabled
      AND have successfully checked in (has an active WorkerSession).
    - Un-checked-in anonymous tracks or employees with tracking OFF are ignored to minimize compute.
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

        # Check DB for employee tracking status
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


class TrackingStrategyFactory:
    """Factory creating the appropriate tracking strategy based on system config."""

    _strategies = {
        "TRACK_ALL": TrackAllStrategy(),
        "TRACK_SPECIFIC": TrackSpecificStrategy(),
    }

    @classmethod
    def get_strategy(cls) -> BaseTrackingStrategy:
        mode = getattr(config, "tracking_mode", "TRACK_ALL").upper()
        return cls._strategies.get(mode, cls._strategies["TRACK_ALL"])
