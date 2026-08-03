"""
RTSP Stream Manager — shared frame buffer & pre-encoded JPEG architecture.

Opens each RTSP stream **once** in a dedicated background thread and keeps
the latest N frames in a ``collections.deque`` alongside pre-encoded JPEG bytes.
All consumers read from the shared buffer with zero CPU re-encoding overhead.
"""

from __future__ import annotations

import collections
import threading
import time
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

import cv2
import numpy as np

from ..config import env_settings, config

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class StreamState(str, Enum):
    STARTING = "STARTING"
    ONLINE = "ONLINE"
    OFFLINE = "OFFLINE"
    RECONNECTING = "RECONNECTING"
    ERROR = "ERROR"
    STOPPED = "STOPPED"
    AUTH_FAILED = "AUTH_FAILED"


# ---------------------------------------------------------------------------
# Per-camera stream handle
# ---------------------------------------------------------------------------

@dataclass
class CameraStream:
    camera_id: int
    rtsp_url: str
    state: StreamState = StreamState.STOPPED
    error_message: str = ""
    fps: float = 0.0
    last_frame_time: Optional[datetime] = None
    reconnect_count: int = 0
    _latest_jpeg: Optional[bytes] = field(default=None, repr=False)
    _latest_jpeg_ws: Optional[bytes] = field(default=None, repr=False)  # Smaller, for WebSocket
    # Internal
    _thread: Optional[threading.Thread] = field(default=None, repr=False)
    _stop_event: threading.Event = field(default_factory=threading.Event, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    _buffer: collections.deque = field(default_factory=lambda: collections.deque(maxlen=5), repr=False)
    _frame_times: collections.deque = field(default_factory=lambda: collections.deque(maxlen=30), repr=False)

    def set_buffer_size(self, size: int) -> None:
        with self._lock:
            old = list(self._buffer)
            self._buffer = collections.deque(old[-size:], maxlen=size)


# ---------------------------------------------------------------------------
# Stream Manager singleton
# ---------------------------------------------------------------------------

class StreamManager:
    """Manages all active RTSP camera streams."""

    def __init__(self) -> None:
        self._streams: dict[int, CameraStream] = {}
        self._global_lock = threading.Lock()

    # -- lifecycle -----------------------------------------------------------

    def start_stream(self, camera_id: int, rtsp_url: str) -> None:
        """Open an RTSP stream for *camera_id* (idempotent)."""
        with self._global_lock:
            if camera_id in self._streams:
                cs = self._streams[camera_id]
                if cs.state in (StreamState.ONLINE, StreamState.STARTING, StreamState.RECONNECTING):
                    return  # already running
                # Clean up stale handle
                self._do_stop(cs)

            buf_size = getattr(env_settings, "frame_buffer_size", 5)
            cs = CameraStream(camera_id=camera_id, rtsp_url=rtsp_url)
            cs._buffer = collections.deque(maxlen=buf_size)
            cs.state = StreamState.STARTING
            self._streams[camera_id] = cs

            t = threading.Thread(
                target=self._grab_loop,
                args=(cs,),
                name=f"cam-stream-{camera_id}",
                daemon=True,
            )
            cs._thread = t
            t.start()
            print(f"[StreamManager] ▶ Started stream for camera {camera_id}")

    def stop_stream(self, camera_id: int) -> None:
        with self._global_lock:
            cs = self._streams.pop(camera_id, None)
            if cs:
                self._do_stop(cs)
                print(f"[StreamManager] ⏹ Stopped stream for camera {camera_id}")

    def restart_stream(self, camera_id: int, rtsp_url: str) -> None:
        self.stop_stream(camera_id)
        time.sleep(0.2)
        self.start_stream(camera_id, rtsp_url)

    def start_all_enabled(self) -> None:
        """Called on app startup — starts streams for all enabled cameras."""
        from ..db.database import SessionLocal
        from ..db.models import Camera
        from .encryption import decrypt_password
        import urllib.parse

        with SessionLocal() as db:
            cameras = db.query(Camera).filter(Camera.enabled == True).all()
            for cam in cameras:
                try:
                    pwd = decrypt_password(cam.encrypted_password)
                    encoded_pwd = urllib.parse.quote(pwd, safe="")
                    rtsp_url = (
                        f"rtsp://{cam.username}:{encoded_pwd}"
                        f"@{cam.ip_address}:{cam.rtsp_port}{cam.stream_path}"
                    )
                    self.start_stream(cam.id, rtsp_url)
                except Exception as e:
                    print(f"[StreamManager] ❌ Failed to start camera {cam.id} ({cam.name}): {e}")

        print(f"[StreamManager] 🟢 Started {len(self._streams)} camera stream(s)")

    def stop_all(self) -> None:
        with self._global_lock:
            for cs in list(self._streams.values()):
                self._do_stop(cs)
            self._streams.clear()
        print("[StreamManager] ⏹ All streams stopped")

    def restart_all_active(self) -> None:
        """Restarts all active streams to apply new global settings immediately."""
        with self._global_lock:
            active_ids = list(self._streams.keys())
        
        if not active_ids:
            return

        print(f"[StreamManager] Restarting {len(active_ids)} active stream(s)...")
        for cid in active_ids:
            cs = self._streams.get(cid)
            if cs:
                rtsp_url = cs.rtsp_url
                self.stop_stream(cid)
                time.sleep(0.1)
                self.start_stream(cid, rtsp_url)

    # -- frame access --------------------------------------------------------

    def get_frame(self, camera_id: int) -> Optional[np.ndarray]:
        """Return the latest frame (numpy BGR) or ``None``."""
        cs = self._streams.get(camera_id)
        if not cs:
            return None
        with cs._lock:
            if cs._buffer:
                return cs._buffer[-1]
        return None

    def get_jpeg(self, camera_id: int, quality: int = 85) -> Optional[bytes]:
        """Return pre-encoded JPEG bytes with high visual quality."""
        cs = self._streams.get(camera_id)
        if not cs:
            return None
        with cs._lock:
            if cs._latest_jpeg_ws:
                return cs._latest_jpeg_ws
            if cs._buffer:
                frame = cs._buffer[-1]
                ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
                return buf.tobytes() if ok else None
        return None

    def get_jpeg_for_ws(self, camera_id: int) -> Optional[bytes]:
        """Return a small, downscaled JPEG for WebSocket base64 delivery.

        Downscales to max 640px wide and uses quality 40 to minimise
        the base64 string size and reduce heap allocation pressure on
        memory-constrained systems.
        """
        cs = self._streams.get(camera_id)
        if not cs:
            return None
        with cs._lock:
            if cs._latest_jpeg_ws:
                return cs._latest_jpeg_ws
        return None

    async def mjpeg_generator(self, camera_id: int, fps_limit: float = 15.0):
        """
        Yields MJPEG multipart chunks with zero CPU re-encoding overhead.
        """
        interval = 1.0 / fps_limit if fps_limit > 0 else 0.066
        while True:
            jpeg = self.get_jpeg(camera_id)
            if jpeg:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n"
                )
            else:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + _BLACK_JPEG + b"\r\n"
                )
            await asyncio.sleep(interval)

    # -- status --------------------------------------------------------------

    def get_status(self, camera_id: int) -> dict:
        cs = self._streams.get(camera_id)
        if not cs:
            return {"camera_id": camera_id, "state": StreamState.STOPPED.value, "fps": 0, "last_frame_time": None}
        return {
            "camera_id": camera_id,
            "state": cs.state.value,
            "fps": round(cs.fps, 1),
            "last_frame_time": cs.last_frame_time.isoformat() if cs.last_frame_time else None,
            "error_message": cs.error_message,
            "reconnect_count": cs.reconnect_count,
        }

    def get_all_statuses(self) -> list[dict]:
        return [self.get_status(cid) for cid in self._streams]

    def is_online(self, camera_id: int) -> bool:
        cs = self._streams.get(camera_id)
        return cs is not None and cs.state == StreamState.ONLINE

    # -- internal ------------------------------------------------------------

    @staticmethod
    def _do_stop(cs: CameraStream) -> None:
        cs._stop_event.set()
        cs.state = StreamState.STOPPED
        if cs._thread and cs._thread.is_alive():
            cs._thread.join(timeout=3)

    def _grab_loop(self, cs: CameraStream) -> None:
        """Background thread: open RTSP, grab frames, encode JPEG once, auto-reconnect."""
        while not cs._stop_event.is_set():
            reconnect_interval = getattr(env_settings, "stream_reconnect_interval", 5)
            timeout = getattr(env_settings, "stream_timeout", 30)
            transport = getattr(env_settings, "default_stream_transport", "tcp")
            
            cap = None
            try:
                cs.state = StreamState.STARTING if cs.reconnect_count == 0 else StreamState.RECONNECTING
                cs.error_message = ""

                cap = cv2.VideoCapture(cs.rtsp_url, cv2.CAP_FFMPEG)
                cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout * 1000)
                cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout * 1000)
                # Attempt GPU hardware decoding (NVDEC/VAAPI) to offload video decoding from CPU
                try:
                    cap.set(cv2.CAP_PROP_HW_ACCELERATION, cv2.VIDEO_ACCELERATION_ANY)
                except Exception:
                    pass
                if transport == "tcp":
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"H264"))

                if not cap.isOpened():
                    raise ConnectionError("Failed to open RTSP stream")

                cs.state = StreamState.ONLINE
                cs.error_message = ""
                print(f"[StreamManager] 🟢 Camera {cs.camera_id} ONLINE")

                consecutive_failures = 0
                last_jpeg_time = 0.0
                # Encode WS JPEGs slightly faster than the AI stream FPS cap so
                # the AI loop never picks up a stale frame.  E.g. if ai_stream_fps
                # is 20, encode at 25 FPS = 40ms interval.  Clamped to 5-30 FPS.
                from ..config import config as _cfg
                _ai_fps = max(5, min(30, getattr(_cfg, 'ai_stream_fps', 15)))
                jpeg_interval = 1.0 / (_ai_fps * 1.25)  # 25% faster than AI loop

                while not cs._stop_event.is_set():
                    ret, frame = cap.read()
                    if not ret or frame is None:
                        consecutive_failures += 1
                        if consecutive_failures > 30:
                            raise ConnectionError("Too many consecutive read failures")
                        time.sleep(0.01)
                        continue

                    consecutive_failures = 0
                    now = time.monotonic()

                    # Always update the raw frame buffer (needed for AI inference)
                    with cs._lock:
                        cs._buffer.append(frame)
                        cs._frame_times.append(now)

                    cs.last_frame_time = datetime.now(timezone.utc)

                    # Only encode JPEGs at a throttled rate to save CPU.
                    # The RTSP stream runs at 25+ FPS but the AI stream and
                    # MJPEG viewers only need ~10 FPS of encoded images.
                    if (now - last_jpeg_time) >= jpeg_interval:
                        last_jpeg_time = now

                        # Encode high-resolution JPEG for WebSocket delivery and live viewing.
                        # Respect target resolution from yolo_imgsz (defaulting to 1280+ HD resolution)
                        target_max_w = max(1280, getattr(config, "yolo_imgsz", 1280))
                        h_f, w_f = frame.shape[:2]
                        if w_f > target_max_w:
                            scale = float(target_max_w) / w_f
                            disp_frame = cv2.resize(frame, (target_max_w, int(h_f * scale)), interpolation=cv2.INTER_AREA)
                        else:
                            disp_frame = frame

                        # Encode crisp, high-quality JPEG (Quality 85)
                        ok_ws, buf_ws = cv2.imencode(".jpg", disp_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])

                        with cs._lock:
                            if ok_ws:
                                cs._latest_jpeg_ws = buf_ws.tobytes()
                            # Clear full-size cache so get_jpeg() re-encodes on next call
                            cs._latest_jpeg = None

                    if len(cs._frame_times) >= 2:
                        dt = cs._frame_times[-1] - cs._frame_times[0]
                        if dt > 0:
                            cs.fps = (len(cs._frame_times) - 1) / dt

            except Exception as e:
                err_str = str(e)
                cs.error_message = err_str
                if "401" in err_str or "Unauthorized" in err_str.lower() or "auth" in err_str.lower():
                    cs.state = StreamState.AUTH_FAILED
                    print(f"[StreamManager] 🔐 Camera {cs.camera_id} AUTH_FAILED: {err_str}")
                else:
                    cs.state = StreamState.OFFLINE
                    print(f"[StreamManager] 🔴 Camera {cs.camera_id} OFFLINE: {err_str}")
                cs.fps = 0.0

            finally:
                if cap is not None:
                    cap.release()

            if not cs._stop_event.is_set():
                cs.reconnect_count += 1
                cs._stop_event.wait(timeout=reconnect_interval)


# ---------------------------------------------------------------------------
# Module-level singleton
# ---------------------------------------------------------------------------
stream_manager = StreamManager()

# Placeholder black frame
_BLACK_JPEG: bytes = cv2.imencode(".jpg", np.zeros((1, 1, 3), dtype=np.uint8))[1].tobytes()
