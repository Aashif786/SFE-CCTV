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
            {"id": "origin", "portals": [{"id": "out", "kind": "EXIT_PORTAL", "polygon": [[.7, 0], [1, 0], [1, 1], [.7, 1]]}]},
            {"id": "target", "portals": [{"id": "in", "kind": "ENTRY_PORTAL", "polygon": [[0, 0], [.3, 0], [.3, 1], [0, 1]]}]},
        ],
        "connections": [{"id": "route", "exitPortal": "origin:out", "entryPortal": "target:in",
                         "minTransitSeconds": 5, "maxTransitSeconds": 15, "minSimilarity": .8}],
    }]
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
        # An EXIT portal fires only when a tracked worker leaves its polygon.
        self.assertFalse(self.portals.observe("origin", "origin:7", (.8, .5), self.now, .9, self.embedding))
        exits = self.portals.observe("origin", "origin:7", (.6, .5), self.now, .9, self.embedding)
        self.assertEqual("EXIT_PORTAL", exits[0].portal.kind)
        # An ENTRY portal fires only on its outside -> inside edge.
        self.assertFalse(self.portals.observe("target", "target:3", (.5, .5), self.now, .9, self.embedding))
        entries = self.portals.observe("target", "target:3", (.2, .5), self.now, .9, self.embedding)
        self.assertEqual("ENTRY_PORTAL", entries[0].portal.kind)

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


if __name__ == "__main__":
    unittest.main()
