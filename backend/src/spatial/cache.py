"""Small, thread-safe, expiry-aware bridge between disconnected camera streams."""

from __future__ import annotations

import threading
import uuid
from collections import deque
from datetime import datetime, timezone
from typing import Deque

from .config_service import SpatialConfigurationService
from .models import HandoffRecord, PortalConnection


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


# How many per-frame embeddings to average into a departing track's cache record.
_ROLLING_WINDOW = 6


class HandoffCache:
    def __init__(self, configuration: SpatialConfigurationService) -> None:
        self._configuration = configuration
        self._records: dict[str, HandoffRecord] = {}
        # track_key -> deque of embeddings accumulated while track is inside portal
        self._rolling_embeddings: dict[str, Deque[tuple[float, ...]]] = {}
        self._lock = threading.RLock()

    def put(self, employee_id: str, session_id: str, origin_track_key: str, origin_camera_id: str,
            exit_portal_id: str, timestamp: datetime, embedding: tuple[float, ...], confidence: float,
            direction: tuple[float, float] | None, history: tuple[str, ...] = ()) -> HandoffRecord:
        """Store a departure record using the rolling-averaged embedding if available."""
        # Use averaged embedding for better Re-ID robustness if we have accumulated frames
        with self._lock:
            rolled = self._rolling_embeddings.get(origin_track_key)
            if rolled and len(rolled) >= 2:
                n = len(rolled)
                avg = tuple(sum(v[i] for v in rolled) / n for i in range(len(rolled[0])))
                final_embedding = avg
            else:
                final_embedding = embedding
            self._rolling_embeddings.pop(origin_track_key, None)

        record = HandoffRecord(str(uuid.uuid4()), employee_id, session_id, origin_track_key, origin_camera_id,
                               exit_portal_id, timestamp, final_embedding, confidence, direction, history)
        with self._lock:
            self.expire(timestamp)
            self._records[record.record_id] = record
        return record

    def accumulate_embedding(self, track_key: str, embedding: tuple[float, ...]) -> None:
        """
        Accumulate a per-frame embedding for a track that is currently inside an
        outgoing portal. Called each frame the track is still inside the polygon.
        When the track eventually departs and put() is called, the stored average
        is used instead of the single final-frame snapshot.
        """
        with self._lock:
            if track_key not in self._rolling_embeddings:
                self._rolling_embeddings[track_key] = deque(maxlen=_ROLLING_WINDOW)
            self._rolling_embeddings[track_key].append(embedding)

    def clear_rolling(self, track_key: str) -> None:
        """Discard accumulated embeddings for a track that left without crossing."""
        with self._lock:
            self._rolling_embeddings.pop(track_key, None)

    def candidates(self, connection: PortalConnection, now: datetime) -> tuple[HandoffRecord, ...]:
        with self._lock:
            self.expire(now)
            now_u = _utc(now)
            # Allow a 1.0s early grace margin on min_transit_seconds to accommodate fast physical walks / frame timing
            min_sec = max(0.0, connection.min_transit_seconds - 1.0)
            return tuple(
                r for r in self._records.values()
                if r.exit_portal_id == connection.exit_portal_id
                and min_sec <= (now_u - _utc(r.timestamp)).total_seconds() <= connection.max_transit_seconds
            )

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
