"""
Background Zone Tracker Engine.

Continuously processes background frames from active RTSP camera streams managed by
StreamManager to perform multi-person pose detection and zone dwell tracking 24/7.
This ensures Active Occupants and Zone Analytics remain accurate regardless of whether
a user has an AI WebSocket open in their browser.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from datetime import datetime, timezone
from typing import Dict, Optional

from ..cameras.stream_manager import stream_manager
from ..config import config
from ..db.database import SessionLocal
from ..db.models import CameraZoneDB, Camera
from ..detectors.pose_detector import WorkerDetector
from .dwell_tracker import dwell_tracker
from .polygon_eval import is_point_in_polygon
from ..ws.ai_stream import is_ai_stream_active
from ..state import get_or_create_detector
from ..identity.tracking_strategy import TrackingStrategyFactory


class BackgroundZoneTracker:
    """Background worker for 24/7 RTSP camera zone tracking."""

    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
        self._zone_cache: Dict[str, list] = {}
        self._last_zone_fetch = 0.0

    def start(self) -> None:
        """Start the background zone tracking thread."""
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._run_loop,
                name="background-zone-tracker",
                daemon=True,
            )
            self._thread.start()
            print("🚀 [BackgroundZoneTracker] Engine started (24/7 continuous tracking)")

    def stop(self) -> None:
        """Stop the background zone tracking thread."""
        with self._lock:
            self._stop_event.set()
            if self._thread and self._thread.is_alive():
                self._thread.join(timeout=2.0)
            self._thread = None
            print("🛑 [BackgroundZoneTracker] Engine stopped")

    def _get_zones_for_camera(self, camera_id: str) -> list:
        now = time.monotonic()
        if now - self._last_zone_fetch > 10.0 or str(camera_id) not in self._zone_cache:
            try:
                with SessionLocal() as db:
                    rows = db.query(CameraZoneDB).filter(
                        CameraZoneDB.camera_id == str(camera_id),
                        CameraZoneDB.enabled == True
                    ).all()
                    zones_data = []
                    for z in rows:
                        try:
                            pts = json.loads(z.points_json)
                        except Exception:
                            pts = []
                        zones_data.append({
                            "id": z.zone_id,
                            "name": z.name,
                            "color": z.color or "#3B82F6",
                            "points": pts,
                            "enabled": z.enabled,
                        })
                    self._zone_cache[str(camera_id)] = zones_data
                    self._last_zone_fetch = now
            except Exception as e:
                print(f"⚠️ [BackgroundZoneTracker] Error fetching zones: {e}")

        return self._zone_cache.get(str(camera_id), [])

    def _run_loop(self) -> None:
        """Main tracking loop running at ~4 FPS per camera."""
        while not self._stop_event.is_set():
            try:
                # Fetch all online stream IDs from StreamManager
                online_cids = [cid for cid, cs in list(stream_manager._streams.items()) if cs.state.value == "ONLINE"]

                for cid in online_cids:
                    if self._stop_event.is_set():
                        break

                    # Skip duplicate background inference if an active WebSocket stream is running for this camera
                    if is_ai_stream_active(cid):
                        continue

                    try:
                        frame = stream_manager.get_frame(cid)
                        if frame is None:
                            continue

                        # Reuse shared detector from state registry
                        detector = get_or_create_detector(cid)

                        poses = detector.update(frame)
                        h, w, _ = frame.shape

                        camera_zones = self._get_zones_for_camera(str(cid))
                        now_time = datetime.now(timezone.utc)
                        active_track_ids = set()

                        for p in poses:
                            trk_id = p["track_id"]
                            str_trk_id = str(trk_id)

                            tracking_strategy = TrackingStrategyFactory.get_strategy()
                            if not tracking_strategy.should_track(str_trk_id, str(cid)):
                                continue

                            active_track_ids.add(str_trk_id)

                            box_n = p["box"]  # [x1, y1, x2, y2]
                            foot_x = float(box_n[0] + box_n[2]) / 2.0
                            foot_y = float(box_n[3])
                            center_y = float(box_n[1] + box_n[3]) / 2.0
                            torso_y = float(box_n[1]) + 0.75 * float(box_n[3] - box_n[1])
                            head_y = float(box_n[1]) + 0.25 * float(box_n[3] - box_n[1])

                            candidate_points = [
                                (foot_x, foot_y),
                                (foot_x, center_y),
                                (foot_x, torso_y),
                                (foot_x, head_y),
                            ]

                            matched_zone_dict = None
                            for cz in camera_zones:
                                if cz.get("enabled", True) and cz.get("points"):
                                    is_inside = any(
                                        is_point_in_polygon(cx, cy, cz["points"], frame_width=w, frame_height=h)
                                        for cx, cy in candidate_points
                                    )
                                    if is_inside:
                                        matched_zone_dict = {
                                            "id": cz["id"],
                                            "name": cz["name"],
                                            "color": cz.get("color", "#3B82F6"),
                                        }
                                        break

                            dwell_tracker.update_track_zone(
                                camera_id=str(cid),
                                track_id=str_trk_id,
                                current_zone=matched_zone_dict,
                                person_identifier=None,
                                timestamp=now_time,
                            )

                        dwell_tracker.cleanup_absent_tracks(
                            camera_id=str(cid),
                            active_track_ids=active_track_ids,
                            timestamp=now_time,
                        )
                    except Exception as cam_err:
                        print(f"⚠️ [BackgroundZoneTracker] Camera {cid} tracking error: {cam_err}")

                time.sleep(0.20)  # ~5 FPS loop budget

            except Exception as e:
                print(f"⚠️ [BackgroundZoneTracker] Loop error: {e}")
                time.sleep(1.0)



background_tracker = BackgroundZoneTracker()
