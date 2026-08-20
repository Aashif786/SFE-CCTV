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

        # ── Rolling embedding accumulation ────────────────────────────────────
        # While a track is inside an outgoing portal, accumulate its embedding
        # so that the HandoffCache can use a per-portal rolling average at
        # departure time rather than a single noisy final-frame snapshot.
        if embedding is not None:
            for portal in self.configuration.portals_for_camera(camera_id):
                if self.configuration.outgoing(portal.id):
                    tracks_inside = self.portals.get_tracks_inside_portal(portal.id)
                    if track_key in tracks_inside:
                        self.cache.accumulate_embedding(track_key, embedding)

        return self._process(self.portals.observe(camera_id, track_key, point, timestamp, confidence, embedding))

    def track_disappeared(self, camera_id: str, track_key: str, timestamp: datetime, confidence: float,
                          embedding: tuple[float, ...] | None):
        self._expire(timestamp)

        # Clear any accumulated rolling embeddings for this track — it left without a clean portal crossing.
        self.cache.clear_rolling(track_key)

        results = self._process(self.portals.force_exit(camera_id, track_key, timestamp, confidence, embedding))

        # ── Unconditional hold for employee sessions ───────────────────────────
        # hold_for_handoff() was previously only called when has_origin_track() was
        # True (i.e. only when a cache record existed, which requires an embedding).
        # If the embedding was None at departure, no cache record was stored and the
        # session was immediately closed, preventing cross-camera transfer.
        #
        # We now hold the session whenever:
        # (a) a cache record was created (original logic), OR
        # (b) the track belonged to an employee — so the session survives transit
        #     even if Re-ID matching ultimately fails at the destination.
        session = worker_session_manager.get_by_track(track_key)
        if self.cache.has_origin_track(track_key):
            worker_session_manager.hold_for_handoff(track_key)
        elif session is not None:
            # Employee session with no cache record (embedding was missing at departure).
            # Still hold the session so it is not immediately closed.
            worker_session_manager.hold_for_handoff(track_key)
            print(f"[HANDOFF] 🔒 Session held (no embedding) for employee={session.employee_id} track={track_key}")

        return results

    def _expire(self, timestamp: datetime) -> None:
        for record in self.cache.expire(timestamp):
            closed = worker_session_manager.close_pending_handoff(record.session_id)
            if closed:
                self.events.append({"type": "HANDOFF_EXPIRED", "employee_id": record.employee_id,
                                    "record_id": record.record_id, "timestamp": timestamp.isoformat()})

    def _process(self, crossings):
        # Deferred import to avoid a circular import at module load time
        from ..identity.correlation import correlation_engine

        results = []
        for crossing in crossings:
            # ── Departure side ─────────────────────────────────────────────────
            # Portal has at least one outgoing connection.
            # Cache the person's appearance so they can be matched on the other end.
            if self.configuration.outgoing(crossing.portal.id):
                session = worker_session_manager.get_by_track(crossing.track_key)
                if not session:
                    # Check if there is an active session on this camera that experienced track ID flicker
                    cam_prefix = crossing.track_key.rsplit(":", 1)[0]
                    cam_sessions = [s for s in worker_session_manager.get_all_active() if s.camera_id == cam_prefix]
                    if len(cam_sessions) == 1:
                        old_tid = cam_sessions[0].current_track_id
                        worker_session_manager.update_track(old_tid, crossing.track_key)
                        session = cam_sessions[0]
                        print(f"[HANDOFF] 🔄 Recovered active session for {session.employee_id}: re-bound track {old_tid} -> {crossing.track_key} before portal exit")

                if crossing.embedding:
                    emp_id = session.employee_id if session else ""
                    sess_id = session.session_id if session else f"anon_{crossing.track_key}"
                    record = self.cache.put(
                        emp_id, sess_id, crossing.track_key,
                        crossing.portal.camera_id, crossing.portal.id, crossing.timestamp,
                        crossing.embedding, crossing.track_confidence,
                        crossing.direction, (crossing.portal.id,),
                    )
                    self._audit("EXIT_CACHED", crossing, record_id=record.record_id)
                    if session:
                        print(f"[HANDOFF] 🚪 Exit Cached: Employee {session.employee_id} (track {crossing.track_key}) departed through portal {crossing.portal.id}")
                    else:
                        print(f"[HANDOFF] 🚪 Exit Cached: Anonymous Track {crossing.track_key} departed through portal {crossing.portal.id}")
                else:
                    print(f"[HANDOFF] ⚠️ Departure crossing at {crossing.portal.id} for track {crossing.track_key} ignored: no Re-ID embedding")

            # ── Arrival side ───────────────────────────────────────────────────
            destination_camera = crossing.track_key.rsplit(":", 1)[0]

            # Step 1: Portal-constrained employee association.
            # If a door event was registered for this specific portal_id, associate
            # the employee to this track immediately — before Re-ID matching.
            portal_session = correlation_engine.claim_portal_event(
                portal_id=crossing.portal.id,
                track_id=crossing.track_key,
                camera_id=destination_camera,
                timestamp=crossing.timestamp,
            )
            if portal_session:
                results.append(portal_session)
                self._audit("PORTAL_ENTRY_ASSOCIATED", crossing, employee_id=portal_session.employee_id)
                print(f"[HANDOFF] 🎫 Portal entry association: Employee {portal_session.employee_id} "
                      f"→ Track {crossing.track_key} at portal {crossing.portal.id}")

            # Step 2: Re-ID spatial handoff matching.
            # Match this arriving track against cached departures from connected portals.
            elif self.configuration.incoming(crossing.portal.id):
                match = self.matcher.match_entry(crossing)
                if match:
                    if match.record.employee_id:
                        session = self.transfers.transfer(
                            match, crossing.track_key, destination_camera, crossing.timestamp
                        )
                        if session:
                            self.cache.consume(match.record.record_id)
                            self._audit(

                                "HANDOFF_COMPLETED", crossing,
                                employee_id=session.employee_id,
                                score=round(match.score, 4),
                                similarity=round(match.similarity, 4),
                                transit_seconds=round(match.transit_seconds, 3),
                                connection_id=match.connection.id,
                            )
                            results.append(session)
                    else:
                        # Anonymous track continuity handoff
                        self.cache.consume(match.record.record_id)
                        self._audit(
                            "HANDOFF_COMPLETED_ANON", crossing,
                            origin_track_key=match.record.origin_track_key,
                            score=round(match.score, 4),
                            similarity=round(match.similarity, 4),
                            transit_seconds=round(match.transit_seconds, 3),
                            connection_id=match.connection.id,
                        )
                        print(f"[HANDOFF] 🔄 Anonymous handoff completed: {match.record.origin_track_key} -> {crossing.track_key} via connection {match.connection.id}")
        return results

    def _audit(self, kind: str, crossing, **details) -> None:
        self.events.append({"type": kind, "portal_id": crossing.portal.id, "track_key": crossing.track_key,
                            "timestamp": crossing.timestamp.isoformat(), **details})
        if len(self.events) > 500:
            del self.events[:-500]


spatial_handoff_engine = SpatialHandoffEngine()
