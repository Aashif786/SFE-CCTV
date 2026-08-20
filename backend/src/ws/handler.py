"""
WebSocket Handler — Real-time camera stream processing pipeline.

Receives base64 encoded video frames over WebSocket, runs multi-pose
detection with YOLO tracking, classifies worker activity, manages worker identity
sessions and correlation, persists activity logs & alerts, and sends real-time
annotated JSON responses back to the client.
"""

from __future__ import annotations

import asyncio
import base64
import json
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from ..config import config
from ..db.database import SessionLocal
from ..db.models import ActivityLog, Alert
from ..detectors.pose_detector import WorkerDetector
from ..activity.classifier import classifier
from ..identity.correlation import correlation_engine
from ..identity.session_manager import worker_session_manager
from ..identity.models import CameraEntryEvent
from ..identity.tracking_strategy import TrackingStrategyFactory
from ..spatial.engine import spatial_handoff_engine
from ..zones.dwell_tracker import _to_utc
from ..state import (
    detectors,
    get_or_create_detector,
    session_managers,
    prev_track_ids,
    track_absent_frames,
    TRACK_CLOSE_GRACE_FRAMES,
    get_track_close_grace_frames,
    track_activity_totals,
    track_last_time,
    get_zone_cached,
    SessionManager,
)

# Colour per activity for the overlay label sent in WS response
ACTIVITY_COLOUR: dict[str, str] = {
    "working": "#10b981",    # emerald
    "walking": "#3b82f6",    # blue
    "idle": "#f59e0b",       # amber
    "no_person": "#6b7280",  # gray
}


async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ WebSocket connected")
    camera_id: Optional[str] = None
    last_track_attributes: dict[int, tuple[float, tuple[float, ...] | None]] = {}
    # Cross-camera anonymous tracking ID continuity map
    track_id_continuity_map: dict[str, str] = {}

    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            image_b64 = payload["image"]
            camera_id = payload.get("camera_id", "default")

            # Lazy-init per-camera objects using thread-safe state registry
            detector = await asyncio.to_thread(get_or_create_detector, camera_id)

            if camera_id not in session_managers:
                session_managers[camera_id] = SessionManager(camera_id)
            if camera_id not in prev_track_ids:
                prev_track_ids[camera_id] = set()
            if camera_id not in track_absent_frames:
                track_absent_frames[camera_id] = {}

            sm = session_managers[camera_id]

            # Decode frame
            image_bytes = base64.b64decode(image_b64)
            np_arr = np.frombuffer(image_bytes, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is None:
                continue
            h, w, _ = frame.shape

            # Run multi-pose detection + native YOLO tracking (off event loop)
            try:
                poses = await asyncio.to_thread(detector.update, frame)
            except Exception as det_err:
                print(f"⚠️  Detector error: {det_err}")
                poses = []

            # Load workstation zone from cache (DB only on first access or after zone update)
            zone = get_zone_cached(camera_id)

            current_track_ids: set[int] = {p["track_id"] for p in poses}
            stream_camera_id = f"ws:{camera_id}"
            current_track_ids_str: set[str] = {f"{stream_camera_id}:{t}" for t in current_track_ids}
            previous_ids = prev_track_ids[camera_id]

            # Detect newly entered tracks → notify correlation engine
            for p in poses:
                trk_id = p["track_id"]
                if trk_id not in previous_ids:
                    camera_entry = CameraEntryEvent(
                        track_id=f"{stream_camera_id}:{trk_id}",
                        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
                        camera_id=stream_camera_id,
                        first_bounding_box=[
                            int(round(p["box"][0] * w)),
                            int(round(p["box"][1] * h)),
                            int(round(p["box"][2] * w)),
                            int(round(p["box"][3] * h)),
                        ],
                        first_frame_number=detector.frame_count,
                    )
                    correlation_engine.on_new_track(camera_entry, active_track_ids=current_track_ids_str)

            # Detect departed tracks → manage close grace period
            if camera_id not in track_absent_frames:
                track_absent_frames[camera_id] = {}
            absent_map = track_absent_frames[camera_id]

            # 1. Increment absent frame counters for tracks no longer present
            for trk_id in previous_ids - current_track_ids:
                absent_map[trk_id] = absent_map.get(trk_id, 0) + 1

            # 2. Reset absent counter if a track is present in this frame
            for trk_id in current_track_ids:
                absent_map.pop(trk_id, None)

            # 3. Close sessions only if grace period has expired
            for trk_id, frames_gone in list(absent_map.items()):
                if frames_gone >= get_track_close_grace_frames():
                    absent_map.pop(trk_id, None)
                    str_trk_id = f"{stream_camera_id}:{trk_id}"
                    confidence, embedding = last_track_attributes.pop(trk_id, (0.0, None))
                    spatial_handoff_engine.track_disappeared(str(camera_id), str_trk_id, datetime.now(timezone.utc).replace(tzinfo=None), confidence, embedding)
                    totals = track_activity_totals.get(str_trk_id)
                    closed = None if spatial_handoff_engine.cache.has_origin_track(str_trk_id) else worker_session_manager.close_session(str_trk_id, totals)
                    if closed:
                        print(f"[Identity] 🚪 Session closed (grace expired) for employee={closed.employee_id} track={trk_id}")
                    track_activity_totals.pop(str_trk_id, None)
                    track_last_time.pop(str_trk_id, None)

            prev_track_ids[camera_id] = current_track_ids

            # Build per-track detection list for the WS response
            detections_out = []
            now_time = datetime.now(timezone.utc).replace(tzinfo=None)
            for p in poses:
                trk_id = p["track_id"]
                str_trk_id = f"{stream_camera_id}:{trk_id}"

                # Resolve identity
                worker_session = worker_session_manager.get_by_track(str_trk_id)
                employee_id = worker_session.employee_id if worker_session else None

                box = p["box"]
                foot_point = ((float(box[0]) + float(box[2])) / 2.0, float(box[3]))
                embedding = tuple(p["reid_embedding"]) if p.get("reid_embedding") is not None else None
                last_track_attributes[trk_id] = (float(p["confidence"]), embedding)
                handoff_results = spatial_handoff_engine.observe_track(str(camera_id), str_trk_id, foot_point, now_time, float(p["confidence"]), embedding)
                # Record anonymous handoff mappings
                if handoff_results:
                    for hr in handoff_results:
                        if isinstance(hr, dict) and hr.get("type") == "ANON_HANDOFF":
                            origin_key = hr["origin_track_key"]
                            new_key = hr["new_track_key"]
                            root_key = track_id_continuity_map.get(origin_key, origin_key)
                            track_id_continuity_map[new_key] = root_key
                worker_session = worker_session_manager.get_by_track(str_trk_id)
                employee_id = worker_session.employee_id if worker_session else None

                tracking_strategy = TrackingStrategyFactory.get_strategy()
                if not tracking_strategy.should_track(str_trk_id, str(camera_id), person_identifier=employee_id):
                    continue

                # Check confidence threshold to decide whether to send skeleton
                keypoints_to_send = p["keypoints"] if p["confidence"] >= config.confidence_threshold else []

                activity = classifier.classify(
                    has_pose=True,
                    confidence=p["confidence"],
                    movement_score=p["movement_score"],
                    velocity=p["velocity"],
                    worker_pos=p["worker_pos"],
                    zone=zone,
                    keypoints=p["keypoints"],
                )

                idle_sec = p["idle_seconds"]

                # Idle alert per track
                if activity == "idle" and idle_sec >= config.idle_threshold_seconds and not detector.alert_triggered:
                    with SessionLocal() as db:
                        db.add(Alert(
                            message=f"Worker (track {trk_id}) idle for {round(idle_sec)}s on {camera_id}",
                            resolved=False,
                        ))
                        db.commit()
                    detector.alert_triggered = True
                elif activity in ("working", "walking", "no_person"):
                    detector.alert_triggered = False

                # Resolve identity for this track
                worker_session = worker_session_manager.get_by_track(str_trk_id)

                # Determine the ID to expose downstream
                exposed_track_id = trk_id
                if worker_session and worker_session.persistent_track_id:
                    pers_parts = worker_session.persistent_track_id.split(":")
                    exposed_track_id = int(pers_parts[-1]) if pers_parts[-1].isdigit() else pers_parts[-1]
                elif str_trk_id in track_id_continuity_map:
                    origin_key = track_id_continuity_map[str_trk_id]
                    origin_parts = origin_key.rsplit(":", 1)
                    if len(origin_parts) == 2 and origin_parts[-1].isdigit():
                        exposed_track_id = int(origin_parts[-1])
                    else:
                        exposed_track_id = origin_parts[-1] if len(origin_parts) == 2 else origin_key

                detections_out.append({
                    "track_id": exposed_track_id,
                    "activity": activity,
                    "activity_colour": ACTIVITY_COLOUR.get(activity, "#6b7280"),
                    "movement_score": round(p["movement_score"], 5),
                    "confidence": round(p["confidence"], 3),
                    "idle_seconds": round(idle_sec, 1),
                    "worker_position": list(p["worker_pos"]) if p["worker_pos"] else None,
                    "keypoints": keypoints_to_send,
                    "box": [
                        round(float(p["box"][0]), 5),
                        round(float(p["box"][1]), 5),
                        round(float(p["box"][2]), 5),
                        round(float(p["box"][3]), 5),
                    ],
                    "identity": {
                        "employee_id": worker_session.employee_id if worker_session else None,
                        "session_id": worker_session.session_id if worker_session else None,
                        "correlation_delay": worker_session.correlation_delay_seconds if worker_session else None,
                    },
                })

                # Accumulate per-track activity time
                if str_trk_id not in track_activity_totals:
                    track_activity_totals[str_trk_id] = {"working": 0.0, "walking": 0.0, "idle": 0.0, "no_person": 0.0}

                if str_trk_id in track_last_time:
                    dt = (_to_utc(now_time) - _to_utc(track_last_time[str_trk_id])).total_seconds()
                    if dt < 2.0:  # Cap at 2s to prevent huge spikes if frame drops
                        track_activity_totals[str_trk_id][activity] += dt

                track_last_time[str_trk_id] = now_time

            # Drive legacy SessionManager with the primary (first) person
            if detections_out:
                sm.process(detections_out[0]["activity"])
            else:
                sm.process("no_person")

            # ActivityLog snapshot every 25 frames
            if detector.frame_count % 25 == 0 and detections_out:
                p = detections_out[0]
                legacy_status = {
                    "working": "active",
                    "walking": "active",
                    "idle": "idle",
                    "no_person": "no_person",
                }.get(p["activity"], "unknown")
                with SessionLocal() as db:
                    db.add(ActivityLog(
                        status=legacy_status,
                        activity=p["activity"],
                        idle_seconds=p["idle_seconds"],
                        movement_score=p["movement_score"],
                        confidence=p["confidence"],
                    ))
                    db.commit()

            response = {
                "timestamp": datetime.utcnow().isoformat(),
                # Legacy single-person fields (still valid for 1-person scenes)
                "status": detections_out[0]["activity"] if detections_out else "no_person",
                "activity": detections_out[0]["activity"] if detections_out else "no_person",
                "activity_colour": detections_out[0]["activity_colour"] if detections_out else "#6b7280",
                "movement_score": detections_out[0]["movement_score"] if detections_out else 0.0,
                "confidence": detections_out[0]["confidence"] if detections_out else 0.0,
                "idle_seconds": detections_out[0]["idle_seconds"] if detections_out else 0.0,
                "idle_threshold_seconds": config.idle_threshold_seconds,
                "zone": list(zone),
                "session": sm.current_session_info(),
                "worker_position": detections_out[0]["worker_position"] if detections_out else None,
                "keypoints": detections_out[0]["keypoints"] if detections_out else [],
                "boxes": [d["box"] for d in detections_out],
                "identity": detections_out[0]["identity"] if detections_out else None,
                # Multi-person: full tracked list
                "detections": detections_out,
                "detection_count": len(detections_out),
            }
            await websocket.send_text(json.dumps(response))

    except WebSocketDisconnect:
        print("❌ WebSocket disconnected")
        if camera_id and camera_id in session_managers:
            session_managers[camera_id].close_on_disconnect()
        if camera_id:
            for s in worker_session_manager.get_all_active():
                if s.camera_id == f"ws:{camera_id}":
                    str_trk_id = s.current_track_id
                    totals = track_activity_totals.get(str_trk_id)
                    closed = None if spatial_handoff_engine.cache.has_origin_track(str_trk_id) else worker_session_manager.close_session(str_trk_id, totals)
                    if closed:
                        print(f"[Identity] 🚪 Session closed (disconnect) for employee={closed.employee_id} track={str_trk_id}")
                    track_activity_totals.pop(str_trk_id, None)
                    track_last_time.pop(str_trk_id, None)
            if camera_id in prev_track_ids:
                prev_track_ids[camera_id] = set()
            if camera_id in track_absent_frames:
                track_absent_frames[camera_id] = {}

    except Exception as e:
        print(f"❌ Fatal WS error: {e}")
        if camera_id and camera_id in session_managers:
            session_managers[camera_id].close_on_disconnect()
        if camera_id:
            for s in worker_session_manager.get_all_active():
                if s.camera_id == f"ws:{camera_id}":
                    str_trk_id = s.current_track_id
                    totals = track_activity_totals.get(str_trk_id)
                    closed = None if spatial_handoff_engine.cache.has_origin_track(str_trk_id) else worker_session_manager.close_session(str_trk_id, totals)
                    if closed:
                        print(f"[Identity] 🚪 Session closed (error) for employee={closed.employee_id} track={str_trk_id}")
                    track_activity_totals.pop(str_trk_id, None)
                    track_last_time.pop(str_trk_id, None)
            if camera_id in prev_track_ids:
                prev_track_ids[camera_id] = set()
            if camera_id in track_absent_frames:
                track_absent_frames[camera_id] = {}
