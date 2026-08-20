"""
Server-side AI WebSocket — per-camera YOLO tracking pipeline.

Endpoint
--------
WS  /ws/camera/{camera_id}  — reads frames from stream_manager, runs YOLO
                               pose detection, sends detection JSON to client.
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from ..cameras.stream_manager import stream_manager
from ..config import config
from ..db.database import SessionLocal
from ..db.models import Alert, CameraZoneDB, Camera
from ..cameras.encryption import decrypt_password
from ..detectors.pose_detector import WorkerDetector
from ..activity.classifier import classifier, profile_registry
from ..identity.correlation import correlation_engine
from ..identity.session_manager import worker_session_manager
from ..identity.models import CameraEntryEvent
from ..identity.tracking_strategy import TrackingStrategyFactory
from ..spatial.engine import spatial_handoff_engine
from ..zones.polygon_eval import is_point_in_polygon, zone_cache
from ..zones.dwell_tracker import dwell_tracker, _to_utc
from ..state import (
    session_managers,
    prev_track_ids,
    track_absent_frames,
    TRACK_CLOSE_GRACE_FRAMES,
    get_track_close_grace_frames,
    track_activity_totals,
    track_last_time,
    get_zone_cached,
    SessionManager,
    get_or_create_detector,
    get_detector,
)

# Activity colours — dynamic, fetched from active profile via classifier.get_color().
# This static fallback is used only on the very first frame before profile initialises.
_FALLBACK_COLOUR: dict[str, str] = {
    "working":        "#10b981",
    "walking":        "#3b82f6",
    "idle":           "#f59e0b",
    "using_phone":    "#8b5cf6",
    "meeting":        "#06b6d4",
    "away_from_desk": "#f97316",
    "unknown":        "#6b7280",
    "no_person":      "#374151",
}

# Set of active AI WebSocket camera IDs
_active_ws_cameras: set[int] = set()

# Per-camera cancel events — set when a new connection replaces the current one
_camera_cancel_events: dict[int, asyncio.Event] = {}


def is_ai_stream_active(camera_id: int) -> bool:
    """Return True if an active AI WebSocket stream is currently running for camera_id."""
    return camera_id in _active_ws_cameras


def get_shared_detector(camera_id: int | str) -> Optional[WorkerDetector]:
    """Return in-memory WorkerDetector instance for camera_id if available."""
    return get_detector(camera_id)


# Default FPS cap — overridden at runtime by config.ai_stream_fps
_DEFAULT_AI_STREAM_FPS = 15


async def camera_ai_endpoint(websocket: WebSocket, camera_id: int):
    """Server-side AI processing WebSocket for a specific camera."""

    await websocket.accept()

    cam_key = f"ai-{camera_id}"

    # Cancel any existing loop for this camera (e.g. React StrictMode double-mount / page refresh).
    # We signal the old coroutine to stop by setting its cancel event, then replace it with a new one.
    if camera_id in _camera_cancel_events:
        _camera_cancel_events[camera_id].set()

    my_cancel = asyncio.Event()
    _camera_cancel_events[camera_id] = my_cancel
    _active_ws_cameras.add(camera_id)

    try:
        # Send initial "loading" status IMMEDIATELY so frontend shows spinner
        await websocket.send_text(json.dumps({
            "status": "loading",
            "camera_id": camera_id,
            "message": "Connecting to camera stream…",
        }))

        # Auto-start stream on demand if not already online
        if not stream_manager.is_online(camera_id):
            with SessionLocal() as db:
                try:
                    cid_int = int(camera_id)
                    cam = db.query(Camera).filter(Camera.id == cid_int).first()
                except (ValueError, TypeError):
                    cam = db.query(Camera).filter(Camera.name == str(camera_id)).first()

                if cam and cam.enabled:
                    try:
                        pwd = decrypt_password(cam.encrypted_password)
                        auth = f"{cam.username}:{pwd}@" if cam.username else ""
                        rtsp_url = f"rtsp://{auth}{cam.ip_address}:{cam.rtsp_port}{cam.stream_path}"
                        stream_manager.start_stream(cam.id, rtsp_url)
                    except Exception as e:
                        print(f"⚠️ [AI-WS] Could not auto-start stream for camera {camera_id}: {e}")

        # Wait up to 10s for camera stream to come online if starting/connecting
        stream_wait_start = time.monotonic()

        while not stream_manager.is_online(camera_id):
            if (time.monotonic() - stream_wait_start) > 10.0:
                await websocket.send_text(json.dumps({
                    "status": "offline",
                    "camera_id": camera_id,
                    "message": "Camera stream is offline",
                }))
                await websocket.close(code=1000)
                return
            await websocket.send_text(json.dumps({
                "status": "loading",
                "camera_id": camera_id,
                "message": "Connecting to camera stream…",
            }))
            await asyncio.sleep(1.0)

        print(f"🧠 [AI-WS] Connected for camera {camera_id}")

        # Helper to format loading payload with live frame if available
        def _build_loading_payload(msg: str) -> str:
            jpeg_bytes = stream_manager.get_jpeg_for_ws(camera_id)
            img_b64 = ""
            if jpeg_bytes:
                img_b64 = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("ascii")
            return json.dumps({
                "status": "loading",
                "camera_id": camera_id,
                "message": msg,
                "image": img_b64,
            })

        # ── Lazy-init detector using thread-safe state helper ──
        detector = get_detector(camera_id)
        if detector is None:
            await websocket.send_text(_build_loading_payload("Loading AI model…"))
            init_task = asyncio.create_task(asyncio.to_thread(get_or_create_detector, camera_id))
            while not init_task.done():
                try:
                    await asyncio.wait_for(asyncio.shield(init_task), timeout=1.0)
                except asyncio.TimeoutError:
                    try:
                        await websocket.send_text(_build_loading_payload("Loading AI model…"))
                    except Exception:
                        pass
            try:
                detector = await init_task
            except Exception as init_err:
                print(f"❌ [AI-WS] Detector init failed cam {camera_id}: {init_err}")
                await websocket.send_text(json.dumps({
                    "status": "error",
                    "camera_id": camera_id,
                    "message": f"Failed to load AI model: {init_err}",
                }))
                return

        # Init per-camera state objects if needed
        if cam_key not in session_managers:
            session_managers[cam_key] = SessionManager(cam_key)
        if cam_key not in prev_track_ids:
            prev_track_ids[cam_key] = set()
        if cam_key not in track_absent_frames:
            track_absent_frames[cam_key] = {}

        sm = session_managers[cam_key]
        # Last observed attributes are retained only until a track leaves the
        # frame, so an EXIT_PORTAL can fire even when the last step is stream loss.
        last_track_attributes: dict[int, tuple[float, tuple[float, ...] | None]] = {}

        frame_count = 0
        fps_measured = 0.0
        fps_window_start = time.monotonic()
        fps_window_frames = 0

        # ── Disconnect monitor ──────────────────────────────────────────────
        # We listen for client messages (e.g. "stop") in a lightweight
        # background task instead of the await asyncio.wait_for(..., 0.01)
        # anti-pattern, which wasted 15.6ms of measured overhead every frame.
        _client_stop = asyncio.Event()

        async def _listen_for_stop():
            try:
                while True:
                    msg = await websocket.receive_text()
                    try:
                        ctrl = json.loads(msg)
                        if ctrl.get("action") == "stop":
                            _client_stop.set()
                            return
                    except Exception:
                        pass
            except (WebSocketDisconnect, Exception):
                _client_stop.set()

        stop_listener = asyncio.ensure_future(_listen_for_stop())

        try:
            while not _client_stop.is_set() and not my_cancel.is_set():
                loop_start = time.monotonic()

                # Read target FPS live from config so settings changes apply immediately
                target_fps = max(1, getattr(config, "ai_stream_fps", _DEFAULT_AI_STREAM_FPS))
                frame_interval = 1.0 / target_fps

                # Grab latest frame from stream buffer
                frame = stream_manager.get_frame(camera_id)
                if frame is None:
                    if not stream_manager.is_online(camera_id):
                        await websocket.send_text(json.dumps({
                            "status": "offline",
                            "camera_id": camera_id,
                            "message": "Camera stream went offline",
                        }))
                        await asyncio.sleep(1.0)
                        continue
                    await asyncio.sleep(0.02)
                    continue

                h, w, _ = frame.shape
                frame_count += 1

                # ── Load workstation zone (legacy rectangular zone) ──────────
                zone = get_zone_cached(cam_key)

                # ── Load polygonal camera zones (cached) ────────────────────
                # This check is extremely fast on cache hit (just a dict lookup).
                # On a cold miss it runs a DB query — we do it BEFORE the
                # inference call so it doesn't add latency to the hot path.
                camera_zones = zone_cache.get_zones(str(camera_id))
                if not camera_zones:
                    def _load_zones_from_db():
                        with SessionLocal() as db:
                            db_zones = db.query(CameraZoneDB).filter(
                                CameraZoneDB.camera_id == str(camera_id),
                                CameraZoneDB.enabled == True
                            ).all()
                            zones_data = []
                            for z in db_zones:
                                try:
                                    pts = json.loads(z.points_json)
                                except Exception:
                                    pts = []
                                zones_data.append({
                                    "id": z.zone_id,
                                    "name": z.name,
                                    "color": z.color,
                                    "description": z.description,
                                    "points": pts,
                                    "enabled": z.enabled,
                                })
                            return zones_data
                    camera_zones = await asyncio.to_thread(_load_zones_from_db)
                    zone_cache.set_zones(str(camera_id), camera_zones)

                # ── Run YOLO detection + tracking ───────────────────────────
                # Offloaded to thread pool so the event loop stays free
                try:
                    poses = await asyncio.to_thread(detector.update, frame)
                except Exception as det_err:
                    print(f"⚠️  [AI-WS] Detector error cam {camera_id}: {det_err}")
                    poses = []

                current_track_ids: set[int] = {p["track_id"] for p in poses}
                current_track_ids_str: set[str] = {f"{cam_key}:{t}" for t in current_track_ids}
                previous_ids = prev_track_ids.get(cam_key, set())

                # Detect newly entered tracks → notify correlation engine
                for p in poses:
                    trk_id = p["track_id"]
                    if trk_id not in previous_ids:
                        camera_entry = CameraEntryEvent(
                            track_id=f"{cam_key}:{trk_id}",
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

                # Compute grace frames dynamically based on current FPS config
                grace_frames = get_track_close_grace_frames()

                for trk_id, frames_gone in list(absent_map.items()):
                    if frames_gone >= grace_frames:
                        absent_map.pop(trk_id, None)
                        track_key = f"{cam_key}:{trk_id}"
                        confidence, embedding = last_track_attributes.pop(trk_id, (0.0, None))
                        spatial_handoff_engine.track_disappeared(str(camera_id), track_key, datetime.now(timezone.utc).replace(tzinfo=None), confidence, embedding)
                        totals = track_activity_totals.get(track_key)
                        # A portal departure is held for constrained matching,
                        # rather than closed before its destination can arrive.
                        closed = None if spatial_handoff_engine.cache.has_origin_track(track_key) else worker_session_manager.close_session(track_key, totals)
                        if closed:
                            print(f"[AI-WS] 🚪 Session closed for employee={closed.employee_id} track={trk_id}")
                        dwell_tracker.close_track_visit(str(camera_id), track_key)
                        track_activity_totals.pop(track_key, None)
                        track_last_time.pop(track_key, None)

                track_absent_frames[cam_key] = absent_map
                prev_track_ids[cam_key] = current_track_ids

                # Build per-track detection list
                detections_out = []
                now_time = datetime.now(timezone.utc).replace(tzinfo=None)

                # Resolve tracking strategy ONCE per frame (same for all people)
                tracking_strategy = TrackingStrategyFactory.get_strategy()

                for p in poses:
                    trk_id = p["track_id"]
                    str_trk_id = f"{cam_key}:{trk_id}"
                    portal_box = p["box"]
                    portal_point = ((float(portal_box[0]) + float(portal_box[2])) / 2.0, float(portal_box[3]))
                    embedding = tuple(p["reid_embedding"]) if p.get("reid_embedding") is not None else None
                    last_track_attributes[trk_id] = (float(p["confidence"]), embedding)
                    # Process portal crossings before the optional activity filter.
                    spatial_handoff_engine.observe_track(
                        str(camera_id), str_trk_id, portal_point, now_time,
                        float(p["confidence"]), embedding,
                    )

                    # Resolve identity (single lookup — used throughout)
                    worker_session = worker_session_manager.get_by_track(str_trk_id)
                    employee_id = worker_session.employee_id if worker_session else None

                    # Apply active tracking strategy (TRACK_ALL vs TRACK_SPECIFIC)
                    if not tracking_strategy.should_track(str_trk_id, str(camera_id), person_identifier=employee_id):
                        continue

                    # Determine the ID to expose downstream
                    exposed_track_id = trk_id
                    if worker_session and worker_session.persistent_track_id:
                        pers_parts = worker_session.persistent_track_id.split(":")
                        exposed_track_id = int(pers_parts[-1]) if pers_parts[-1].isdigit() else pers_parts[-1]

                    keypoints_to_send = p.get("keypoints", [])

                    # Collect peer positions (other tracked workers this frame)
                    peer_positions = [
                        other_p["worker_pos"]
                        for other_p in poses
                        if other_p["track_id"] != trk_id and other_p["worker_pos"] is not None
                    ]

                    activity = classifier.classify(
                        has_pose=True,
                        confidence=p["confidence"],
                        movement_score=p["movement_score"],
                        velocity=p["velocity"],
                        worker_pos=p["worker_pos"],
                        zone=zone,
                        keypoints=p["keypoints"],
                        idle_seconds=p["idle_seconds"],
                        peer_positions=peer_positions,
                        net_displacement=p.get("net_displacement", 0.0),
                        is_seated=p.get("is_seated", False),
                        hands_off_seconds=p.get("hands_off_seconds", 0.0),
                    )
                    activity_colour = classifier.get_color(activity)

                    idle_sec = p["idle_seconds"]

                    # Idle alert per track
                    if activity == "idle" and idle_sec >= config.idle_threshold_seconds and not detector.alert_triggered:
                        def _insert_alert(msg):
                            with SessionLocal() as db:
                                db.add(Alert(message=msg, resolved=False))
                                db.commit()
                        asyncio.get_event_loop().run_in_executor(
                            None,
                            _insert_alert,
                            f"Worker (track {trk_id}) idle for {round(idle_sec)}s on camera {camera_id}",
                        )
                        detector.alert_triggered = True
                    elif activity in ("working", "walking", "no_person"):
                        detector.alert_triggered = False

                    # (identity already resolved above — no duplicate lookup needed)

                    # Calculate candidate points for robust zone evaluation:
                    # 1. Foot position (bottom center)
                    # 2. Bounding box center
                    # 3. Lower torso / seat position (75% height)
                    # 4. Upper torso / head position (25% height)
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

                    # Point-in-polygon zone evaluation across body points
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

                    # Process dwell tracking visit & live duration
                    zone_status, dwell_sec = dwell_tracker.update_track_zone(
                        camera_id=str(camera_id),
                        track_id=str_trk_id,
                        current_zone=matched_zone_dict,
                        person_identifier=employee_id,
                        timestamp=now_time,
                    )

                    detections_out.append({
                        "track_id": exposed_track_id,
                        "activity": activity,
                        "activity_colour": activity_colour,
                        "activity_display_name": classifier.get_display_name(activity),
                        "movement_score": round(p["movement_score"], 5),
                        "confidence": round(p["confidence"], 3),
                        "idle_seconds": round(idle_sec, 1),
                        "worker_position": list(p["worker_pos"]) if p["worker_pos"] else None,
                        "foot_position": [round(foot_x, 4), round(foot_y, 4)],
                        "zone_status": zone_status,
                        "keypoints": keypoints_to_send,
                        "box": [
                            round(float(p["box"][0]), 5),
                            round(float(float(p["box"][1])), 5),
                            round(float(p["box"][2]), 5),
                            round(float(p["box"][3]), 5),
                        ],
                        "identity": {
                            "employee_id": employee_id,
                            "session_id": worker_session.session_id if worker_session else None,
                            "correlation_delay": worker_session.correlation_delay_seconds if worker_session else None,
                        },
                    })

                    # Accumulate per-track activity time
                    if str_trk_id not in track_activity_totals:
                        # Build initial totals from the active profile's activity IDs
                        _acts = list(profile_registry.active().activities.keys())
                        track_activity_totals[str_trk_id] = {a: 0.0 for a in _acts}

                    if str_trk_id in track_last_time:
                        dt = (_to_utc(now_time) - _to_utc(track_last_time[str_trk_id])).total_seconds()
                        if dt < 2.0:
                            track_activity_totals[str_trk_id][activity] += dt

                    track_last_time[str_trk_id] = now_time

                # ── Cleanup absent tracks ──
                # Close active visits for any track on this camera that disappeared from the frame
                current_frame_track_ids = {f"{cam_key}:{p['track_id']}" for p in poses}
                dwell_tracker.cleanup_absent_tracks(
                    camera_id=str(camera_id),
                    active_track_ids=current_frame_track_ids,
                    timestamp=now_time,
                )

                # Drive session manager
                if detections_out:
                    sm.process(detections_out[0]["activity"])
                else:
                    sm.process("no_person")

                # ── Measure actual achieved FPS ────────────────────────────
                fps_window_frames += 1
                fps_elapsed = time.monotonic() - fps_window_start
                if fps_elapsed >= 2.0:
                    fps_measured = fps_window_frames / fps_elapsed
                    fps_window_frames = 0
                    fps_window_start = time.monotonic()

                # ── Get latest JPEG frame ──────────────────────────────────
                # get_jpeg_for_ws() returns a pre-encoded 640px JPEG from the
                # background grab-loop — zero encoding cost here.
                # base64 encode is 0.04ms for a 17KB JPEG — not worth a
                # thread-pool hop; do it inline on the event loop.
                jpeg_bytes = stream_manager.get_jpeg_for_ws(camera_id)
                image_b64 = ""
                if jpeg_bytes:
                    image_b64 = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("ascii")

                # ── Send response ──────────────────────────────────────────
                response = {
                    "status": "tracking",
                    "camera_id": camera_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "fps": round(fps_measured, 1),
                    "activity": detections_out[0]["activity"] if detections_out else "no_person",
                    "activity_colour": detections_out[0]["activity_colour"] if detections_out else classifier.get_color("no_person"),
                    "activity_display_name": detections_out[0]["activity_display_name"] if detections_out else "No Person",
                    "active_profile": getattr(config, "active_profile", "software_office"),
                    "idle_seconds": detections_out[0]["idle_seconds"] if detections_out else 0.0,
                    "idle_threshold_seconds": config.idle_threshold_seconds,
                    "confidence": detections_out[0]["confidence"] if detections_out else 0.0,
                    "movement_score": detections_out[0]["movement_score"] if detections_out else 0.0,
                    "zone": list(zone),
                    "zones": camera_zones,
                    "detections": detections_out,
                    "detection_count": len(detections_out),
                    "image": image_b64,
                }
                try:
                    await websocket.send_text(json.dumps(response))
                except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
                    break
                except Exception as send_err:
                    if "websocket.close" in str(send_err) or "response already completed" in str(send_err):
                        break
                    raise send_err

                # ── Throttle to target FPS ────────────────────────────────
                # Sleep only the remaining budget. If inference already took
                # longer than one frame interval, yield to the event loop
                # (asyncio.sleep(0)) so other coroutines can run, then
                # continue immediately without introducing extra latency.
                elapsed = time.monotonic() - loop_start
                sleep_time = frame_interval - elapsed
                if sleep_time > 0.001:
                    await asyncio.sleep(sleep_time)
                else:
                    await asyncio.sleep(0)  # yield to event loop

        finally:
            stop_listener.cancel()
            try:
                await stop_listener
            except (asyncio.CancelledError, Exception):
                pass

    except (WebSocketDisconnect, asyncio.CancelledError):
        print(f"🧠 [AI-WS] Client disconnected for camera {camera_id}")
    except RuntimeError as r_err:
        if "websocket.close" in str(r_err) or "response already completed" in str(r_err) or "websocket.send" in str(r_err):
            print(f"🧠 [AI-WS] Client connection closed for camera {camera_id}")
        else:
            print(f"❌ [AI-WS] RuntimeError for camera {camera_id}: {r_err}")
    except Exception as e:
        print(f"❌ [AI-WS] Fatal error for camera {camera_id}: {e}")
    finally:
        # Only clean up shared state if this coroutine is still the active owner
        # (i.e. it was NOT cancelled/replaced by a newer connection)
        is_owner = _camera_cancel_events.get(camera_id) is my_cancel
        if is_owner:
            _camera_cancel_events.pop(camera_id, None)
            if cam_key in session_managers:
                session_managers[cam_key].close_on_disconnect()

            # Close any active worker sessions for this AI camera
            for s in worker_session_manager.get_all_active():
                if s.camera_id == cam_key:
                    str_trk_id = s.current_track_id
                    totals = track_activity_totals.get(str_trk_id)
                    closed = None if spatial_handoff_engine.cache.has_origin_track(str_trk_id) else worker_session_manager.close_session(str_trk_id, totals)
                    if closed:
                        print(f"[AI-WS] 🚪 Session closed (cleanup) for employee={closed.employee_id}")
                    track_activity_totals.pop(str_trk_id, None)
                    track_last_time.pop(str_trk_id, None)

            if cam_key in prev_track_ids:
                prev_track_ids[cam_key] = set()
            if cam_key in track_absent_frames:
                track_absent_frames[cam_key] = {}

            _active_ws_cameras.discard(camera_id)

            print(f"🧠 [AI-WS] Cleaned up session state for camera {camera_id}")
