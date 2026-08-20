"""
Unit test suite for Zone Analytics module.
"""

import os
import sys
import unittest
from datetime import datetime

# Add backend/src to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from src.zones.polygon_eval import is_point_in_polygon, validate_zone_config
from src.zones.dwell_tracker import ZoneDwellTracker, format_dwell_time


class TestPolygonEval(unittest.TestCase):
    def test_point_in_polygon_square(self):
        # Square: (0,0) to (100,100)
        square = [(0.0, 0.0), (100.0, 0.0), (100.0, 100.0), (0.0, 100.0)]
        self.assertTrue(is_point_in_polygon(50.0, 50.0, square))
        self.assertFalse(is_point_in_polygon(150.0, 50.0, square))
        self.assertFalse(is_point_in_polygon(-10.0, 50.0, square))

    def test_normalized_point_scaling(self):
        # Pixel polygon on 1920x1080 frame
        poly_pixel = [(100.0, 100.0), (500.0, 100.0), (500.0, 500.0), (100.0, 500.0)]
        # Normalized point (0.15, 0.2) -> (288, 216) which is inside
        self.assertTrue(is_point_in_polygon(0.15, 0.2, poly_pixel, frame_width=1920, frame_height=1080))
        # Normalized point (0.8, 0.8) -> (1536, 864) which is outside
        self.assertFalse(is_point_in_polygon(0.8, 0.8, poly_pixel, frame_width=1920, frame_height=1080))

    def test_validate_zone_config_valid(self):
        sample = {
            "zones": [
                {
                    "id": "z1",
                    "name": "Assembly",
                    "color": "#10B981",
                    "points": [[10, 10], [100, 10], [100, 100], [10, 100]]
                }
            ]
        }
        ok, err, zones = validate_zone_config(sample)
        self.assertTrue(ok)
        self.assertEqual(err, "")
        self.assertEqual(len(zones), 1)
        self.assertEqual(zones[0]["id"], "z1")

    def test_validate_zone_config_invalid_points(self):
        # Less than 3 points
        sample = {
            "zones": [
                {
                    "id": "z1",
                    "name": "Assembly",
                    "points": [[10, 10], [100, 10]]
                }
            ]
        }
        ok, err, zones = validate_zone_config(sample)
        self.assertFalse(ok)
        self.assertIn("at least 3 points", err)

    def test_validate_zone_config_duplicate_ids(self):
        sample = {
            "zones": [
                {"id": "z1", "name": "A", "points": [[0,0], [1,0], [1,1]]},
                {"id": "z1", "name": "B", "points": [[0,0], [2,0], [2,2]]},
            ]
        }
        ok, err, zones = validate_zone_config(sample)
        self.assertFalse(ok)
        self.assertIn("Duplicate zone ID", err)


class TestDwellTracker(unittest.TestCase):
    def test_format_dwell_time(self):
        self.assertEqual(format_dwell_time(45), "00:45")
        self.assertEqual(format_dwell_time(125), "02:05")
        self.assertEqual(format_dwell_time(3665), "01:01:05")

    def test_concurrent_multi_person_tracking(self):
        tracker = ZoneDwellTracker()
        # Mock _open_visit_in_db and _close_visit_in_db to avoid needing real SQLite session
        tracker._open_visit_in_db = lambda **kwargs: 1
        tracker._close_visit_in_db = lambda *args, **kwargs: None

        zone_dict = {"id": "zone-2", "name": "Zone 2", "color": "#EF4444"}

        # Simulate 6 distinct people entering zone 2
        for i in range(1, 7):
            status, dwell = tracker.update_track_zone(
                camera_id="17",
                track_id=f"track-{i}",
                current_zone=zone_dict,
                person_identifier=None,
            )
            self.assertIsNotNone(status)
            self.assertEqual(status["zone_id"], "zone-2")

        # Verify all 6 are concurrently tracked in memory
        self.assertEqual(tracker.get_active_visits_count(camera_id="17", zone_id="zone-2"), 6)
        active_details = tracker.get_all_active_visits_detail()
        self.assertEqual(len(active_details), 6)

    def test_identified_person_stitching(self):
        tracker = ZoneDwellTracker()
        tracker._open_visit_in_db = lambda **kwargs: 1
        tracker._close_visit_in_db = lambda *args, **kwargs: None

        zone_dict = {"id": "zone-2", "name": "Zone 2", "color": "#EF4444"}

        # Person with employee ID EMP101 enters on track-1
        tracker.update_track_zone(
            camera_id="17",
            track_id="track-1",
            current_zone=zone_dict,
            person_identifier="EMP101",
        )

        # Track ID switches to track-99 for same employee EMP101
        tracker.update_track_zone(
            camera_id="17",
            track_id="track-99",
            current_zone=zone_dict,
            person_identifier="EMP101",
        )

        # Should stitch to 1 active visit under track-99
        self.assertEqual(tracker.get_active_visits_count(camera_id="17", zone_id="zone-2"), 1)
        active_details = tracker.get_all_active_visits_detail()
        self.assertEqual(len(active_details), 1)
        self.assertEqual(active_details[0]["track_id"], "track-99")
        self.assertEqual(active_details[0]["person_identifier"], "EMP101")


if __name__ == "__main__":
    unittest.main()
