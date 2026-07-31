import re

with open('backend/src/ws/ai_stream.py', 'r', encoding='utf-8') as f:
    content = f.read()

# We want to replace the try block starting at `try:` down to the end of the `finally:` block before `except WebSocketDisconnect:`
pattern = re.compile(r'    try:\n        frame_count = 0\n.*?    except WebSocketDisconnect:', re.DOTALL)

replacement = """    try:
        frame_count = 0
        fps_measured = 0.0
        fps_window_start = time.monotonic()
        fps_window_frames = 0

        # ── Disconnect monitor ──────────────────────────────────────────────
        # We listen for client messages (e.g. "stop") in a lightweight
        # background task instead of blocking each iteration with
        # asyncio.wait_for(..., timeout=0.01), which adds >=10ms overhead
        # per frame and creates/destroys a Task every iteration.
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
            while not _client_stop.is_set():
                loop_start = time.monotonic()

                # Read target FPS live from config so settings changes apply immediately
                target_fps = max(1.0, min(30.0, getattr(config, "tracking_fps", 5.0)))
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
                    await asyncio.sleep(frame_interval)
                    continue

                h, w, _ = frame.shape
                frame_count += 1

                # Run YOLO detection + tracking (offloaded to thread pool)
                try:
                    poses = await asyncio.to_thread(detector.update, frame)
                except Exception as det_err:
                    print(f"⚠️  [AI-WS] Detector error cam {camera_id}: {det_err}")
                    poses = []

                # Load workstation zone
                zone = get_zone_cached(cam_key)

                current_track_ids = {p["track_id"] for p in poses}
                current_track_ids_str = {str(t) for t in current_track_ids}
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

                # ── Measure actual FPS ─────────────────────────────────────────
                fps_window_frames += 1
                fps_elapsed = time.monotonic() - fps_window_start
                if fps_elapsed >= 2.0:
                    fps_measured = fps_window_frames / fps_elapsed
                    fps_window_frames = 0
                    fps_window_start = time.monotonic()

                # ── Get latest JPEG frame ──────────────────────────────────────
                jpeg_bytes = stream_manager.get_jpeg(camera_id)
                image_b64 = ""
                if jpeg_bytes:
                    image_b64 = "data:image/jpeg;base64," + base64.b64encode(jpeg_bytes).decode("utf-8")

                # ── Send response ──────────────────────────────────────────────
                response = {
                    "status": "tracking",
                    "camera_id": camera_id,
                    "timestamp": datetime.utcnow().isoformat(),
                    "fps": round(fps_measured, 1),
                    "activity": detections_out[0]["activity"] if detections_out else "no_person",
                    "activity_colour": detections_out[0]["activity_colour"] if detections_out else "#6b7280",
                    "idle_seconds": detections_out[0]["idle_seconds"] if detections_out else 0.0,
                    "idle_threshold_seconds": config.idle_threshold_seconds,
                    "confidence": detections_out[0]["confidence"] if detections_out else 0.0,
                    "movement_score": detections_out[0]["movement_score"] if detections_out else 0.0,
                    "zone": list(zone),
                    "detections": detections_out,
                    "detection_count": len(detections_out),
                    "image": image_b64,
                }
                await websocket.send_text(json.dumps(response))

                # ── Throttle to target FPS ─────────────────────────────────────
                elapsed = time.monotonic() - loop_start
                sleep_time = frame_interval - elapsed
                if sleep_time > 0.001:
                    await asyncio.sleep(sleep_time)
                else:
                    await asyncio.sleep(0)

        finally:
            stop_listener.cancel()
            try:
                await stop_listener
            except (asyncio.CancelledError, Exception):
                pass

    except WebSocketDisconnect:"""

new_content = pattern.sub(replacement, content)
with open('backend/src/ws/ai_stream.py', 'w', encoding='utf-8') as f:
    f.write(new_content)
