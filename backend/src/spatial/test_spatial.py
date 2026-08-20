from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .cache import HandoffCache
from .config_service import SpatialConfigurationService
from .matcher import ReIDMatchingEngine
from .portal_manager import PortalManager


LAYOUT = {
    "facilities": [{
        "id": "f1",
        "cameras": [
            {"id": "origin", "portals": [{"id": "out", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}]},
            {"id": "target", "portals": [{"id": "in",  "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]}]},
        ],
    }],
    "connections": [
        {"id": "route", "exitPortal": "f1:origin:out", "entryPortal": "f1:target:in",
         "minTransitSeconds": 5, "maxTransitSeconds": 15, "minSimilarity": .8},
    ],
}


class SpatialHandoffTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.config = SpatialConfigurationService(Path(self.tmp.name) / "layout.json")
        self.config.replace(LAYOUT, persist=False)
        self.portals = PortalManager(self.config)
        self.cache = HandoffCache(self.config)
        self.matcher = ReIDMatchingEngine(self.config, self.cache)
        self.now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        self.embedding = (1.0, 0.0, 0.0)

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_crossings_emit_events(self):
        # A departure portal (exit in a connection) fires only when a tracked worker leaves its polygon.
        self.assertFalse(self.portals.observe("origin", "origin:7", (.8, .5), self.now, .9, self.embedding))
        exits = self.portals.observe("origin", "origin:7", (.6, .5), self.now, .9, self.embedding)
        self.assertEqual(1, len(exits))
        self.assertEqual("f1:origin:out", exits[0].portal.id)
        # An arrival portal (entry in a connection) fires only on its outside -> inside edge.
        self.assertFalse(self.portals.observe("target", "target:3", (.5, .5), self.now, .9, self.embedding))
        entries = self.portals.observe("target", "target:3", (.2, .5), self.now, .9, self.embedding)
        self.assertEqual(1, len(entries))
        self.assertEqual("f1:target:in", entries[0].portal.id)

    def test_reid_is_limited_to_connected_time_valid_candidates(self):
        exit_portal = self.config.portal("f1:origin:out")
        entry_portal = self.config.portal("f1:target:in")
        route = self.config.incoming(entry_portal.id)[0]
        self.cache.put("E-1", "S-1", "origin:7", "origin", exit_portal.id, self.now,
                       self.embedding, .9, None)
        entry = self.portals.observe("target", "target:3", (.2, .5), self.now + timedelta(seconds=6), .9, self.embedding)[0]
        result = self.matcher.match_entry(entry)
        self.assertIsNotNone(result)
        self.assertEqual(route.id, result.connection.id)
        self.assertEqual("E-1", result.record.employee_id)
        # The same appearance outside the 5-15 second route window cannot match.
        late = self.portals.observe("target", "target:4", (.2, .5), self.now + timedelta(seconds=20), .9, self.embedding)[0]
        self.assertIsNone(self.matcher.match_entry(late))

    def test_bidirectional_unified_portals(self):
        """Portals with no kind act as both departure and arrival depending on which connections reference them."""
        layout = {
            "facilities": [{
                "id": "f1",
                "cameras": [
                    {"id": "camA", "portals": [{"id": "doorA", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}]},
                    {"id": "camB", "portals": [{"id": "doorB", "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]}]},
                ],
            }],
            "connections": [
                {"id": "fwd", "exitPortal": "f1:camA:doorA", "entryPortal": "f1:camB:doorB", "minTransitSeconds": 2, "maxTransitSeconds": 10},
                {"id": "rev", "exitPortal": "f1:camB:doorB", "entryPortal": "f1:camA:doorA", "minTransitSeconds": 2, "maxTransitSeconds": 10},
            ],
        }
        config = SpatialConfigurationService(Path(self.tmp.name) / "layout_bi.json")
        config.replace(layout, persist=False)
        portals = PortalManager(config)
        cache = HandoffCache(config)
        matcher = ReIDMatchingEngine(config, cache)

        # Forward: camA:doorA departs -> camB:doorB arrives
        portals.observe("camA", "camA:1", (.8, .5), self.now, .9, self.embedding)
        exits = portals.observe("camA", "camA:1", (.6, .5), self.now, .9, self.embedding)
        self.assertEqual(1, len(exits))
        cache.put("E-100", "S-100", "camA:1", "camA", exits[0].portal.id, self.now, self.embedding, .9, None)
        entry = portals.observe("camB", "camB:2", (.1, .5), self.now + timedelta(seconds=4), .9, self.embedding)[0]
        result = matcher.match_entry(entry)
        self.assertIsNotNone(result)
        self.assertEqual("fwd", result.connection.id)

        # Reverse: camB:doorB departs -> camA:doorA arrives
        portals.observe("camB", "camB:3", (.1, .5), self.now + timedelta(seconds=20), .9, self.embedding)
        rev_exits = portals.observe("camB", "camB:3", (.5, .5), self.now + timedelta(seconds=20), .9, self.embedding)
        self.assertEqual(1, len(rev_exits))
        cache.put("E-200", "S-200", "camB:3", "camB", rev_exits[0].portal.id, self.now + timedelta(seconds=20), self.embedding, .9, None)
        rev_entry = portals.observe("camA", "camA:4", (.8, .5), self.now + timedelta(seconds=24), .9, self.embedding)[0]
        rev_result = matcher.match_entry(rev_entry)
        self.assertIsNotNone(rev_result)
        self.assertEqual("rev", rev_result.connection.id)

    def test_single_frame_entry_with_direction(self):
        """A person detected on their very first frame inside a portal with direction configured must not be dropped."""
        layout = {
            "facilities": [{
                "id": "f1",
                "cameras": [
                    {"id": "camA", "portals": [{"id": "doorA", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}]},
                    {"id": "camB", "portals": [{"id": "doorB", "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]], "direction": [1.0, 0.0], "minDirectionCosine": 0.2}]},
                ],
            }],
            "connections": [
                {"id": "conn1", "exitPortal": "f1:camA:doorA", "entryPortal": "f1:camB:doorB", "minTransitSeconds": 2, "maxTransitSeconds": 10},
            ],
        }
        config = SpatialConfigurationService(Path(self.tmp.name) / "layout_dir.json")
        config.replace(layout, persist=False)
        portals = PortalManager(config)
        cache = HandoffCache(config)
        matcher = ReIDMatchingEngine(config, cache)

        # CamA departure
        portals.observe("camA", "camA:1", (.8, .5), self.now, .9, self.embedding)
        exits = portals.observe("camA", "camA:1", (.6, .5), self.now, .9, self.embedding)
        self.assertEqual(1, len(exits))
        cache.put("EMP001", "S-EMP001", "camA:1", "camA", exits[0].portal.id, self.now, self.embedding, .9, None)

        # CamB arrival: frame 1 appears directly inside doorB
        entries = portals.observe("ai-camB", "ai-camB:99", (.1, .5), self.now + timedelta(seconds=5), .9, self.embedding)
        self.assertEqual(1, len(entries), "Initial frame inside entry portal must emit crossing")
        match = matcher.match_entry(entries[0])
        self.assertIsNotNone(match)
        self.assertEqual("EMP001", match.record.employee_id)

    def test_unconnected_portal_transitions_prevented(self):
        """Cross-camera matching must be rejected when portals are not connected in Portal Flow."""
        layout = {
            "facilities": [{
                "id": "f1",
                "cameras": [
                    {"id": "camA", "portals": [{"id": "doorA", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}]},
                    {"id": "camB", "portals": [{"id": "doorB", "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]}]},
                    {"id": "camC", "portals": [{"id": "doorC", "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]}]},
                ],
            }],
            "connections": [
                # camA connects ONLY to camB (camC is not connected to camA)
                {"id": "conn_ab", "exitPortal": "f1:camA:doorA", "entryPortal": "f1:camB:doorB", "minTransitSeconds": 2, "maxTransitSeconds": 10},
            ],
        }
        config = SpatialConfigurationService(Path(self.tmp.name) / "layout_unconn.json")
        config.replace(layout, persist=False)
        portals = PortalManager(config)
        cache = HandoffCache(config)
        matcher = ReIDMatchingEngine(config, cache)

        # Person exits camA:doorA
        portals.observe("camA", "camA:1", (.8, .5), self.now, .9, self.embedding)
        exits = portals.observe("camA", "camA:1", (.6, .5), self.now, .9, self.embedding)
        self.assertEqual(1, len(exits))
        cache.put("EMP001", "S-EMP001", "camA:1", "camA", exits[0].portal.id, self.now, self.embedding, .9, None)

        # Person appears at camC:doorC (unconnected!)
        entries = portals.observe("camC", "camC:88", (.1, .5), self.now + timedelta(seconds=5), .9, self.embedding)
        self.assertEqual(0, len(entries), "doorC has no incoming connections, so no entry crossing is emitted")

    def test_concurrent_multiple_people_transition(self):
        """Multiple employees in transit are distinguished by appearance and connections are consumed."""
        layout = {
            "facilities": [{
                "id": "f1",
                "cameras": [
                    {"id": "camA", "portals": [{"id": "doorA", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}]},
                    {"id": "camB", "portals": [{"id": "doorB", "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]}]},
                ],
            }],
            "connections": [
                {"id": "conn_ab", "exitPortal": "f1:camA:doorA", "entryPortal": "f1:camB:doorB", "minTransitSeconds": 2, "maxTransitSeconds": 10, "minSimilarity": 0.70},
            ],
        }
        config = SpatialConfigurationService(Path(self.tmp.name) / "layout_multi.json")
        config.replace(layout, persist=False)
        portals = PortalManager(config)
        cache = HandoffCache(config)
        matcher = ReIDMatchingEngine(config, cache)

        emb_emp1 = (1.0, 0.0, 0.0)
        emb_emp2 = (0.0, 1.0, 0.0)

        # EMP1 & EMP2 both exit camA:doorA in sequence
        cache.put("EMP001", "S-1", "camA:1", "camA", "f1:camA:doorA", self.now, emb_emp1, .9, None)
        cache.put("EMP002", "S-2", "camA:2", "camA", "f1:camA:doorA", self.now + timedelta(seconds=1), emb_emp2, .9, None)

        # EMP2 arrives first at camB with emb_emp2
        entry_emp2 = portals.observe("camB", "camB:10", (.1, .5), self.now + timedelta(seconds=4), .9, emb_emp2)[0]
        match2 = matcher.match_entry(entry_emp2)
        self.assertIsNotNone(match2)
        self.assertEqual("EMP002", match2.record.employee_id)
        cache.consume(match2.record.record_id)

        # EMP1 arrives second at camB with emb_emp1
        entry_emp1 = portals.observe("camB", "camB:11", (.1, .5), self.now + timedelta(seconds=6), .9, emb_emp1)[0]
        match1 = matcher.match_entry(entry_emp1)
        self.assertIsNotNone(match1)
        self.assertEqual("EMP001", match1.record.employee_id)
        cache.consume(match1.record.record_id)

    def test_multi_camera_multi_portal_chain(self):
        """End-to-end multi-hop handoff: Camera A -> Camera B -> Camera C follows Portal Flow chain."""
        from .engine import SpatialHandoffEngine
        from ..identity.session_manager import worker_session_manager

        layout = {
            "facilities": [{
                "id": "f1",
                "cameras": [
                    {"id": "camA", "portals": [{"id": "pA_out", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}]},
                    {"id": "camB", "portals": [
                        {"id": "pB_in",  "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]},
                        {"id": "pB_out", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]},
                    ]},
                    {"id": "camC", "portals": [{"id": "pC_in",  "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]}]},
                ],
            }],
            "connections": [
                {"id": "hop1", "exitPortal": "f1:camA:pA_out", "entryPortal": "f1:camB:pB_in",  "minTransitSeconds": 1, "maxTransitSeconds": 10, "minSimilarity": 0.70},
                {"id": "hop2", "exitPortal": "f1:camB:pB_out", "entryPortal": "f1:camC:pC_in",  "minTransitSeconds": 1, "maxTransitSeconds": 10, "minSimilarity": 0.70},
            ],
        }
        config = SpatialConfigurationService(Path(self.tmp.name) / "layout_chain.json")
        config.replace(layout, persist=False)
        engine = SpatialHandoffEngine(config)

        # 1. Initial Card Swipe creates WorkerSession on CamA
        initial_session = worker_session_manager.create_session(
            employee_id="EMP001", track_id="ai-camA:1", camera_id="ai-camA", correlation_delay=0.0
        )
        self.assertEqual("ai-camA:1", initial_session.current_track_id)

        # 2. Employee steps through pA_out on CamA
        t0 = self.now
        engine.observe_track("camA", "ai-camA:1", (.8, .5), t0, .9, self.embedding)
        engine.observe_track("camA", "ai-camA:1", (.6, .5), t0, .9, self.embedding)
        engine.track_disappeared("camA", "ai-camA:1", t0, .9, self.embedding)

        # Verified held in handoff cache
        self.assertTrue(engine.cache.has_origin_track("ai-camA:1"))

        # 3. Employee arrives on CamB at pB_in (Hop 1)
        t1 = t0 + timedelta(seconds=3)
        res1 = engine.observe_track("camB", "ai-camB:10", (.1, .5), t1, .9, self.embedding)
        self.assertEqual(1, len(res1))
        self.assertEqual("EMP001", res1[0].employee_id)
        self.assertEqual("ai-camB:10", res1[0].current_track_id)
        self.assertEqual("ai-camB", res1[0].camera_id)
        self.assertEqual(initial_session.session_id, res1[0].session_id, "Session ID must be preserved across hops")

        # 4. Employee walks across CamB and exits through pB_out
        t2 = t1 + timedelta(seconds=10)
        engine.observe_track("camB", "ai-camB:10", (.8, .5), t2, .9, self.embedding)
        engine.observe_track("camB", "ai-camB:10", (.6, .5), t2, .9, self.embedding)
        engine.track_disappeared("camB", "ai-camB:10", t2, .9, self.embedding)

        # 5. Employee arrives on CamC at pC_in (Hop 2)
        t3 = t2 + timedelta(seconds=4)
        res2 = engine.observe_track("camC", "ai-camC:25", (.1, .5), t3, .9, self.embedding)
        self.assertEqual(1, len(res2))
        self.assertEqual("EMP001", res2[0].employee_id)
        self.assertEqual("ai-camC:25", res2[0].current_track_id)
        self.assertEqual("ai-camC", res2[0].camera_id)
        self.assertEqual(initial_session.session_id, res2[0].session_id, "Session ID must persist across all multi-camera hops")

        # Cleanup
        worker_session_manager.close_session("ai-camC:25")

    def test_portal_constrained_door_checkin(self):
        """Card swipe on a door with portal_id only associates when track enters that portal polygon."""
        from .engine import SpatialHandoffEngine
        from ..identity.correlation import correlation_engine
        from ..identity.models import IdentityEvent, CameraEntryEvent
        from ..identity.session_manager import worker_session_manager

        layout = {
            "facilities": [{
                "id": "f1",
                "cameras": [
                    {"id": "camA", "portals": [
                        {"id": "door_portal", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}
                    ]},
                ],
            }],
            "connections": [],
        }
        config = SpatialConfigurationService(Path(self.tmp.name) / "layout_door.json")
        config.replace(layout, persist=False)
        engine = SpatialHandoffEngine(config)

        # 1. Register a door entry event for employee EMP-999 associated with portal f1:camA:door_portal
        door_event = IdentityEvent(
            employee_id="EMP-999",
            entry_gate="Main Entrance",
            timestamp=self.now,
            provider="RFID",
            portal_id="f1:camA:door_portal",
            correlation_window_seconds=10.0,
        )
        correlation_engine.register_identity_event(door_event)

        # 2. An unrelated anonymous person appears elsewhere on camA (at x=0.2, y=0.5 — NOT inside portal)
        camera_entry = CameraEntryEvent(
            track_id="ai-camA:random_guy",
            timestamp=self.now + timedelta(seconds=1),
            camera_id="ai-camA",
            first_bounding_box=[100, 100, 200, 300],
            first_frame_number=1,
        )
        # on_new_track must NOT steal EMP-999 for random_guy
        res = correlation_engine.on_new_track(camera_entry)
        self.assertIsNone(res, "Random person outside portal must NOT be associated with portal-constrained door event")
        self.assertIsNone(worker_session_manager.get_by_track("ai-camA:random_guy"))

        # 3. Person walking outside portal polygon generates observation -> no association
        engine.observe_track("camA", "ai-camA:random_guy", (.2, .5), self.now + timedelta(seconds=2), .9, self.embedding)
        self.assertIsNone(worker_session_manager.get_by_track("ai-camA:random_guy"))

        # 4. The actual employee steps into the portal polygon (x=0.85, y=0.5)
        res_portal = engine.observe_track("camA", "ai-camA:real_worker", (.85, .5), self.now + timedelta(seconds=3), .9, self.embedding)
        self.assertEqual(1, len(res_portal))
        self.assertEqual("EMP-999", res_portal[0].employee_id)
        self.assertEqual("ai-camA:real_worker", res_portal[0].current_track_id)

        # Verify session is active for real_worker
        active = worker_session_manager.get_by_track("ai-camA:real_worker")
        self.assertIsNotNone(active)
        self.assertEqual("EMP-999", active.employee_id)

        # Cleanup
        worker_session_manager.close_session("ai-camA:real_worker")

    def test_rolling_average_reid_embedding(self):
        """HandoffCache averages per-frame embeddings while the track is inside the portal."""
        layout = {
            "facilities": [{
                "id": "f1",
                "cameras": [
                    {"id": "camA", "portals": [{"id": "out", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}]},
                    {"id": "camB", "portals": [{"id": "in",  "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]}]},
                ],
            }],
            "connections": [
                {"id": "route1", "exitPortal": "f1:camA:out", "entryPortal": "f1:camB:in",
                 "minTransitSeconds": 1, "maxTransitSeconds": 10, "minSimilarity": 0.85},
            ],
        }
        config = SpatialConfigurationService(Path(self.tmp.name) / "layout_rolling.json")
        config.replace(layout, persist=False)
        cache = HandoffCache(config)
        matcher = ReIDMatchingEngine(config, cache)
        portals = PortalManager(config)

        # Base embedding is (1.0, 0.0, 0.0)
        # Frames inside portal have minor noise: (0.9, 0.1, 0.0), (1.0, 0.0, 0.0), (0.95, 0.05, 0.0)
        cache.accumulate_embedding("ai-camA:1", (0.9, 0.1, 0.0))
        cache.accumulate_embedding("ai-camA:1", (1.0, 0.0, 0.0))
        cache.accumulate_embedding("ai-camA:1", (0.95, 0.05, 0.0))

        # Put with snapshot (0.8, 0.2, 0.0) — put() will use the accumulated average: (0.95, 0.05, 0.0)
        rec = cache.put("EMP001", "S-1", "ai-camA:1", "camA", "f1:camA:out", self.now, (0.8, 0.2, 0.0), 0.9, None)
        self.assertAlmostEqual(rec.embedding[0], 0.95, places=2)

        # Arrival with clean embedding (1.0, 0.0, 0.0)
        entry = portals.observe("camB", "ai-camB:2", (.1, .5), self.now + timedelta(seconds=3), .9, (1.0, 0.0, 0.0))[0]
        match = matcher.match_entry(entry)
        self.assertIsNotNone(match)
        self.assertEqual("EMP001", match.record.employee_id)





