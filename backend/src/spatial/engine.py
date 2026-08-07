"""Orchestrates portal crossings, constrained matching, and session transfer."""

from __future__ import annotations

from datetime import datetime

from .cache import HandoffCache
from .config_service import SpatialConfigurationService
from .matcher import ReIDMatchingEngine
from .portal_manager import PortalManager
from .transfer import IdentityTransferManager
from ..identity.session_manager import worker_session_manager


class SpatialHandoffEngine:
    def __init__(self, configuration: SpatialConfigurationService | None = None) -> None:
        self.configuration = configuration or SpatialConfigurationService()
        self.portals = PortalManager(self.configuration)
        self.cache = HandoffCache(self.configuration)
        self.matcher = ReIDMatchingEngine(self.configuration, self.cache)
        self.transfers = IdentityTransferManager(worker_session_manager)
        self.events: list[dict] = []  # bounded explainability audit, no video/biometrics persisted

    def observe_track(self, camera_id: str, track_key: str, point: tuple[float, float], timestamp: datetime,
                      confidence: float, embedding: tuple[float, ...] | None):
        self._expire(timestamp)
        return self._process(self.portals.observe(camera_id, track_key, point, timestamp, confidence, embedding))

    def track_disappeared(self, camera_id: str, track_key: str, timestamp: datetime, confidence: float,
                          embedding: tuple[float, ...] | None):
        self._expire(timestamp)
        results = self._process(self.portals.force_exit(camera_id, track_key, timestamp, confidence, embedding))
        if self.cache.has_origin_track(track_key):
            worker_session_manager.hold_for_handoff(track_key)
        return results

    def _expire(self, timestamp: datetime) -> None:
        for record in self.cache.expire(timestamp):
            closed = worker_session_manager.close_pending_handoff(record.session_id)
            if closed:
                self.events.append({"type": "HANDOFF_EXPIRED", "employee_id": record.employee_id,
                                    "record_id": record.record_id, "timestamp": timestamp.isoformat()})

    def _process(self, crossings):
        results = []
        for crossing in crossings:
            if crossing.portal.kind == "EXIT_PORTAL":
                session = worker_session_manager.get_by_track(crossing.track_key)
                # An unconnected exit is not a handoff candidate and must not
                # leave its worker session waiting indefinitely.
                if session and crossing.embedding and self.configuration.outgoing(crossing.portal.id):
                    record = self.cache.put(session.employee_id, session.session_id, crossing.track_key, crossing.portal.camera_id,
                                            crossing.portal.id, crossing.timestamp, crossing.embedding, crossing.track_confidence,
                                            crossing.direction, (crossing.portal.id,))
                    self._audit("EXIT_CACHED", crossing, record_id=record.record_id)
            else:
                match = self.matcher.match_entry(crossing)
                if match:
                    # Session-manager camera IDs identify the stream instance
                    # (e.g. ai-12), while topology uses the physical camera id.
                    destination_camera = crossing.track_key.rsplit(":", 1)[0]
                    session = self.transfers.transfer(match, crossing.track_key, destination_camera, crossing.timestamp)
                    if session:
                        self.cache.consume(match.record.record_id)
                        self._audit("HANDOFF_COMPLETED", crossing, employee_id=session.employee_id, score=round(match.score, 4),
                                    similarity=round(match.similarity, 4), transit_seconds=round(match.transit_seconds, 3),
                                    connection_id=match.connection.id)
                        results.append(session)
        return results

    def _audit(self, kind: str, crossing, **details) -> None:
        self.events.append({"type": kind, "portal_id": crossing.portal.id, "track_key": crossing.track_key,
                            "timestamp": crossing.timestamp.isoformat(), **details})
        if len(self.events) > 500:
            del self.events[:-500]


spatial_handoff_engine = SpatialHandoffEngine()
