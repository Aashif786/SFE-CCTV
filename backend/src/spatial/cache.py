"""Small, thread-safe, expiry-aware bridge between disconnected camera streams."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone

from .config_service import SpatialConfigurationService
from .models import HandoffRecord, PortalConnection


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


class HandoffCache:
    def __init__(self, configuration: SpatialConfigurationService) -> None:
        self._configuration = configuration
        self._records: dict[str, HandoffRecord] = {}
        self._lock = threading.RLock()

    def put(self, employee_id: str, session_id: str, origin_track_key: str, origin_camera_id: str,
            exit_portal_id: str, timestamp: datetime, embedding: tuple[float, ...], confidence: float,
            direction: tuple[float, float] | None, history: tuple[str, ...] = ()) -> HandoffRecord:
        record = HandoffRecord(str(uuid.uuid4()), employee_id, session_id, origin_track_key, origin_camera_id,
                               exit_portal_id, timestamp, embedding, confidence, direction, history)
        with self._lock:
            self.expire(timestamp)
            self._records[record.record_id] = record
        return record

    def candidates(self, connection: PortalConnection, now: datetime) -> tuple[HandoffRecord, ...]:
        with self._lock:
            self.expire(now)
            now_u = _utc(now)
            return tuple(r for r in self._records.values() if r.exit_portal_id == connection.exit_portal_id
                         and connection.min_transit_seconds <= (now_u - _utc(r.timestamp)).total_seconds() <= connection.max_transit_seconds)

    def consume(self, record_id: str) -> None:
        with self._lock:
            self._records.pop(record_id, None)

    def has_origin_track(self, track_key: str) -> bool:
        with self._lock:
            return any(record.origin_track_key == track_key for record in self._records.values())

    def expire(self, now: datetime) -> list[HandoffRecord]:
        now_u = _utc(now)
        with self._lock:
            stale = [record for record in self._records.values() if now_u > _utc(record.timestamp) and
                     (now_u - _utc(record.timestamp)).total_seconds() > self._max_window(record.exit_portal_id)]
            for record in stale:
                self._records.pop(record.record_id, None)
            return stale

    def snapshot(self) -> list[HandoffRecord]:
        with self._lock:
            self.expire(datetime.now(timezone.utc))
            return list(self._records.values())

    def _max_window(self, exit_portal_id: str) -> float:
        routes = self._configuration.outgoing(exit_portal_id)
        return max((route.max_transit_seconds for route in routes), default=0.0)
