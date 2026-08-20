"""Identity/session transfer adapter, isolated from matching policy."""

from __future__ import annotations

from datetime import datetime

from .models import MatchResult
from ..identity.session_manager import WorkerSessionManager


class IdentityTransferManager:
    def __init__(self, sessions: WorkerSessionManager) -> None:
        self._sessions = sessions

    def transfer(self, match: MatchResult, destination_track_key: str, destination_camera_id: str, timestamp: datetime):
        return self._sessions.transfer_session(
            session_id=match.record.session_id,
            old_track_id=match.record.origin_track_key,
            new_track_id=destination_track_key,
            camera_id=destination_camera_id,
            timestamp=timestamp,
            correlation_delay=match.transit_seconds,
        )
