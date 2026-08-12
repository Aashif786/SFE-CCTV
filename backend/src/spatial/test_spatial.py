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


