"""
Server-side AI WebSocket — per-camera YOLO tracking pipeline.

Endpoint
--------
WS  /ws/camera/{camera_id}  — reads frames from stream_manager, runs YOLO
                               pose detection, sends detection JSON to client.

The client never sends frames — the backend already has them from the RTSP
stream.  The client receives detection JSON and overlays it on the MJPEG
<img> element.

Lifecycle
---------
1.  Client opens WS → backend validates camera is online.
2.  Backend loops at ~5 FPS: grab frame → detect → classify → send JSON.
3.  Client closes WS → backend cleans up detector state.
"""

from __future__ import annotations

import asyncio
import json
import time
from datetime import datetime, timezone

import cv2
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from ..cameras.stream_manager import stream_manager
from ..config import config
from ..db.database import SessionLocal
from ..db.models import Alert
from ..detectors.pose_detector import WorkerDetector
from ..activity.classifier import classifier
from ..identity.correlation import correlation_engine
from ..identity.session_manager import worker_session_manager
from ..identity.models import CameraEntryEvent
from ..state import (
    session_managers,
    prev_track_ids,
    track_absent_frames,
    TRACK_CLOSE_GRACE_FRAMES,
    track_activity_totals,
    track_last_time,
    get_zone_cached,
    SessionManager,
)

# Colour per activity for the overlay label
ACTIVITY_COLOUR: dict[str, str] = {
    "working": "#10b981",    # emerald
    "walking": "#3b82f6",    # blue
    "idle": "#f59e0b",       # amber
    "no_person": "#6b7280",  # gray
}

# Per-camera AI detector instances (separate from webcam detectors in state.py)
_ai_detectors: dict[int, WorkerDetector] = {}
_ai_detector_lock = asyncio.Lock()

TARGET_FPS = 5.0
FRAME_INTERVAL = 1.0 / TARGET_FPS


async def camera_ai_endpoint(websocket: WebSocket, camera_id: int):
    """Server-side AI processing WebSocket for a specific camera."""

    await websocket.accept()

    # Validate camera stream is running
    if not stream_manager.is_online(camera_id):
        await websocket.send_text(json.dumps({
            "error": "Camera stream is not online",
            "camera_id": camera_id,
        }))
        await websocket.close(code=1008)
        return

    print(f"🧠 [AI-WS] Connected for camera {camera_id}")

    cam_key = f"ai-{camera_id}"

    # Lazy-init detector for this camera
    async with _ai_detector_lock:
        if camera_id not in _ai_detectors:
            _ai_detectors[camera_id] = WorkerDetector()

    detector = _ai_detectors[camera_id]

    # Init per-camera state objects if needed
    if cam_key not in session_managers:
        session_managers[cam_key] = SessionManager(cam_key)
    if cam_key not in prev_track_ids:
        prev_track_ids[cam_key] = set()
    if cam_key not in track_absent_frames:
        track_absent_frames[cam_key] = {}

    sm = session_managers[cam_key]

    # Send initial "loading" status
    await websocket.send_text(json.dumps({
        "status": "loading",
        "camera_id": camera_id,
        "message": "AI model loading...",
    }))

    try:
        frame_count = 0
        while True:
            loop_start = time.monotonic()

            # Check if client disconnected (non-blocking)
            try:
                # Use a very short timeout to check for incoming messages
                # (client might send control messages like "stop")
                msg = await asyncio.wait_for(
                    websocket.receive_text(), timeout=0.01
                )
                ctrl = json.loads(msg)
                if ctrl.get("action") == "stop":
                    break
            except asyncio.TimeoutError:
                pass  # No message — continue processing
            except WebSocketDisconnect:
                break

            # Grab latest frame from stream buffer
            frame = stream_manager.get_frame(camera_id)
            if frame is None:
                # Stream might have gone offline
                if not stream_manager.is_online(camera_id):
                    await websocket.send_text(json.dumps({
                        "status": "offline",
                        "camera_id": camera_id,
                        "message": "Camera stream went offline",
                    }))
                    await asyncio.sleep(1.0)
                    continue
                await asyncio.sleep(FRAME_INTERVAL)
                continue

            h, w, _ = frame.shape
            frame_count += 1

            # Run YOLO detection + tracking (offloaded to thread pool to prevent event loop blocking)
            try:
                poses = await asyncio.to_thread(detector.update, frame)
            except Exception as det_err:
                print(f"⚠️  [AI-WS] Detector error cam {camera_id}: {det_err}")
                poses = []

            # Load workstation zone
            zone = get_zone_cached(cam_key)

            current_track_ids: set[int] = {p["track_id"] for p in poses}
            current_track_ids_str: set[str] = {str(t) for t in current_track_ids}
            previous_ids = prev_track_ids.get(cam_key, set())

            # Detect newly entered tracks → notify correlation engine
            for p in poses:
                trk_id = p["track_id"]
                if trk_id not in previous_ids:
                    camera_entry = CameraEntryEvent(
                        track_id=str(trk_id),
                        timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
                        camera_id=cam_key,
                        first_bounding_box=[
                            int(round(p["box"][0] * w)),
                            int(round(p["box"][1] * h)),
                            int(round(p["box"][2] * w)),
                            int(round(p["box"][3] * h)),
                        ],
                        first_frame_number=detector.frame_count,
                    )
                    correlation_engine.on_new_track(camera_entry, active_track_ids=current_track_ids_str)

            # Handle departed tracks with grace period
            absent_map = track_absent_frames.get(cam_key, {})

            for trk_id in previous_ids - current_track_ids:
                absent_map[trk_id] = absent_map.get(trk_id, 0) + 1

            for trk_id in current_track_ids:
                absent_map.pop(trk_id, None)

            for trk_id, frames_gone in list(absent_map.items()):
                if frames_gone >= TRACK_CLOSE_GRACE_FRAMES:
                    absent_map.pop(trk_id, None)
                    str_trk_id = str(trk_id)
                    totals = track_activity_totals.get(str_trk_id)
                    closed = worker_session_manager.close_session(str_trk_id, totals)
                    if closed:
                        print(f"[AI-WS] 🚪 Session closed for employee={closed.employee_id} track={trk_id}")
                    track_activity_totals.pop(str_trk_id, None)
                    track_last_time.pop(str_trk_id, None)

            track_absent_frames[cam_key] = absent_map
            prev_track_ids[cam_key] = current_track_ids

            # Build per-track detection list
            detections_out = []
            now_time = datetime.now(timezone.utc).replace(tzinfo=None)

            for p in poses:
                trk_id = p["track_id"]
                str_trk_id = str(trk_id)

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
                            message=f"Worker (track {trk_id}) idle for {round(idle_sec)}s on camera {camera_id}",
                            resolved=False,
                        ))
                        db.commit()
                    detector.alert_triggered = True
                elif activity in ("working", "walking", "no_person"):
                    detector.alert_triggered = False

                # Resolve identity
                worker_session = worker_session_manager.get_by_track(str_trk_id)

                detections_out.append({
                    "track_id": trk_id,
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
                    dt = (now_time - track_last_time[str_trk_id]).total_seconds()
                    if dt < 2.0:
                        track_activity_totals[str_trk_id][activity] += dt

                track_last_time[str_trk_id] = now_time

            # Drive session manager
            if detections_out:
                sm.process(detections_out[0]["activity"])
            else:
                sm.process("no_person")

            # Send response
            response = {
                "status": "tracking",
                "camera_id": camera_id,
                "timestamp": datetime.utcnow().isoformat(),
                "activity": detections_out[0]["activity"] if detections_out else "no_person",
                "activity_colour": detections_out[0]["activity_colour"] if detections_out else "#6b7280",
                "idle_seconds": detections_out[0]["idle_seconds"] if detections_out else 0.0,
                "idle_threshold_seconds": config.idle_threshold_seconds,
                "confidence": detections_out[0]["confidence"] if detections_out else 0.0,
                "movement_score": detections_out[0]["movement_score"] if detections_out else 0.0,
                "zone": list(zone),
                "detections": detections_out,
                "detection_count": len(detections_out),
            }
            await websocket.send_text(json.dumps(response))

            # Throttle to target FPS
            elapsed = time.monotonic() - loop_start
            sleep_time = FRAME_INTERVAL - elapsed
            if sleep_time > 0:
                await asyncio.sleep(sleep_time)

    except WebSocketDisconnect:
        print(f"🧠 [AI-WS] Disconnected for camera {camera_id}")
    except Exception as e:
        print(f"❌ [AI-WS] Fatal error for camera {camera_id}: {e}")
    finally:
        # Cleanup
        if cam_key in session_managers:
            session_managers[cam_key].close_on_disconnect()

        # Close any active worker sessions for this AI camera
        for s in worker_session_manager.get_all_active():
            if s.camera_id == cam_key:
                str_trk_id = s.current_track_id
                totals = track_activity_totals.get(str_trk_id)
                closed = worker_session_manager.close_session(str_trk_id, totals)
                if closed:
                    print(f"[AI-WS] 🚪 Session closed (cleanup) for employee={closed.employee_id}")
                track_activity_totals.pop(str_trk_id, None)
                track_last_time.pop(str_trk_id, None)

        if cam_key in prev_track_ids:
            prev_track_ids[cam_key] = set()
        if cam_key in track_absent_frames:
            track_absent_frames[cam_key] = {}

        # Release detector to free GPU memory
        async with _ai_detector_lock:
            _ai_detectors.pop(camera_id, None)

        print(f"🧠 [AI-WS] Cleaned up resources for camera {camera_id}")
