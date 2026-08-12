"""
FastAPI router for Camera Management and Live Streaming.

Endpoints
---------
CRUD
    GET    /api/cameras            — list all cameras (no credentials)
    GET    /api/cameras/{id}       — single camera detail
    POST   /api/cameras            — create camera
    PUT    /api/cameras/{id}       — update camera
    DELETE /api/cameras/{id}       — delete camera + stop stream

Operations
    POST   /api/cameras/{id}/test      — test RTSP connection
    POST   /api/cameras/{id}/restart   — restart stream

Live
    GET    /api/cameras/live           — all enabled cameras with live status
    GET    /api/streams/{id}           — MJPEG stream
    GET    /api/cameras/{id}/snapshot  — single JPEG snapshot
"""

from __future__ import annotations

import urllib.parse
from datetime import datetime, timezone
from typing import Optional, List

import cv2
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db.database import get_db, SessionLocal
from ..db.models import Camera
from .encryption import encrypt_password, decrypt_password
from .stream_manager import stream_manager, StreamState

router = APIRouter(tags=["cameras"])


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class CameraCreate(BaseModel):
    name: str
    description: Optional[str] = None
    location: Optional[str] = None
    building: Optional[str] = None
    floor: Optional[str] = None
    zone: Optional[str] = None
    door_name: Optional[str] = None
    ip_address: str
    rtsp_port: int = 554
    stream_path: str = "/Streaming/Channels/101"
    username: str = "admin"
    password: str                     # plaintext — encrypted before storage
    camera_brand: Optional[str] = "Hikvision"
    stream_type: str = "Main"
    enabled: bool = True
    recording_enabled: bool = False


class CameraUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    building: Optional[str] = None
    floor: Optional[str] = None
    zone: Optional[str] = None
    door_name: Optional[str] = None
    ip_address: Optional[str] = None
    rtsp_port: Optional[int] = None
    stream_path: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None    # if provided, re-encrypt
    camera_brand: Optional[str] = None
    stream_type: Optional[str] = None
    enabled: Optional[bool] = None
    recording_enabled: Optional[bool] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _camera_to_dict(cam: Camera, include_admin: bool = False) -> dict:
    """Serialise a Camera row. Never exposes credentials."""
    d = {
        "id": cam.id,
        "name": cam.name,
        "description": cam.description,
        "location": cam.location,
        "building": cam.building,
        "floor": cam.floor,
        "zone": cam.zone,
        "door_name": cam.door_name,
        "ip_address": cam.ip_address,
        "rtsp_port": cam.rtsp_port,
        "stream_path": cam.stream_path,
        "username": cam.username,
        "camera_brand": cam.camera_brand,
        "stream_type": cam.stream_type,
        "enabled": cam.enabled,
        "recording_enabled": cam.recording_enabled,
        "created_at": cam.created_at.isoformat() if cam.created_at else None,
        "updated_at": cam.updated_at.isoformat() if cam.updated_at else None,
    }
    # Never include password or RTSP URL
    return d


def _build_rtsp_url(cam: Camera) -> str:
    pwd = decrypt_password(cam.encrypted_password)
    encoded_pwd = urllib.parse.quote(pwd, safe="")
    return (
        f"rtsp://{cam.username}:{encoded_pwd}"
        f"@{cam.ip_address}:{cam.rtsp_port}{cam.stream_path}"
    )


def _camera_live_dict(cam: Camera) -> dict:
    """For the live dashboard — includes stream status but no credentials."""
    status_info = stream_manager.get_status(cam.id)
    return {
        "id": cam.id,
        "name": cam.name,
        "description": cam.description,
        "location": cam.location,
        "building": cam.building,
        "floor": cam.floor,
        "zone": cam.zone,
        "door_name": cam.door_name,
        "camera_brand": cam.camera_brand,
        "stream_type": cam.stream_type,
        "enabled": cam.enabled,
        "status": status_info["state"],
        "fps": status_info["fps"],
        "last_frame_time": status_info["last_frame_time"],
        "error_message": status_info.get("error_message", ""),
        "reconnect_count": status_info.get("reconnect_count", 0),
        "stream": f"/api/streams/{cam.id}",
    }


# ---------------------------------------------------------------------------
# CRUD endpoints
# ---------------------------------------------------------------------------

@router.get("/api/cameras", summary="List all cameras")
async def list_cameras(db: Session = Depends(get_db)):
    cameras = db.query(Camera).order_by(Camera.id).all()
    return [_camera_to_dict(c) for c in cameras]


@router.get("/api/cameras/live", summary="Live camera statuses")
async def list_live_cameras(db: Session = Depends(get_db)):
    """Returns all enabled cameras with their live stream status."""
    cameras = db.query(Camera).filter(Camera.enabled == True).order_by(Camera.id).all()
    return [_camera_live_dict(c) for c in cameras]


@router.get("/api/cameras/{camera_id}", summary="Get camera by ID")
async def get_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return _camera_to_dict(cam)


@router.post("/api/cameras", summary="Create camera", status_code=201)
async def create_camera(payload: CameraCreate, db: Session = Depends(get_db)):
    cam = Camera(
        name=payload.name,
        description=payload.description,
        location=payload.location,
        building=payload.building,
        floor=payload.floor,
        zone=payload.zone,
        door_name=payload.door_name,
        ip_address=payload.ip_address,
        rtsp_port=payload.rtsp_port,
        stream_path=payload.stream_path,
        username=payload.username,
        encrypted_password=encrypt_password(payload.password),
        camera_brand=payload.camera_brand,
        stream_type=payload.stream_type,
        enabled=payload.enabled,
        recording_enabled=payload.recording_enabled,
    )
    db.add(cam)
    db.commit()
    db.refresh(cam)
    print(f"[Cameras] ➕ Created camera {cam.id}: {cam.name} ({cam.ip_address})")

    # Auto-start stream if enabled
    if cam.enabled:
        try:
            rtsp_url = _build_rtsp_url(cam)
            stream_manager.start_stream(cam.id, rtsp_url)
        except Exception as e:
            print(f"[Cameras] ⚠ Failed to auto-start stream for {cam.id}: {e}")

    return _camera_to_dict(cam)


@router.put("/api/cameras/{camera_id}", summary="Update camera")
async def update_camera(camera_id: int, payload: CameraUpdate, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Track if stream-affecting fields changed
    stream_changed = False
    was_enabled = cam.enabled

    for field_name, value in payload.dict(exclude_unset=True).items():
        if field_name == "password":
            if value is not None:
                cam.encrypted_password = encrypt_password(value)
                stream_changed = True
        elif hasattr(cam, field_name):
            old_val = getattr(cam, field_name)
            setattr(cam, field_name, value)
            if field_name in ("ip_address", "rtsp_port", "stream_path", "username"):
                stream_changed = True

    cam.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    db.refresh(cam)
    print(f"[Cameras] ✏️ Updated camera {cam.id}: {cam.name}")

    # Handle stream state changes
    if cam.enabled and (stream_changed or not was_enabled):
        try:
            rtsp_url = _build_rtsp_url(cam)
            stream_manager.restart_stream(cam.id, rtsp_url)
        except Exception as e:
            print(f"[Cameras] ⚠ Failed to restart stream for {cam.id}: {e}")
    elif not cam.enabled and was_enabled:
        stream_manager.stop_stream(cam.id)

    return _camera_to_dict(cam)


@router.delete("/api/cameras/{camera_id}", summary="Delete camera")
async def delete_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    stream_manager.stop_stream(camera_id)
    db.delete(cam)
    db.commit()
    print(f"[Cameras] 🗑 Deleted camera {camera_id}")
    return {"status": "deleted", "camera_id": camera_id}


# ---------------------------------------------------------------------------
# Operations
# ---------------------------------------------------------------------------

@router.post("/api/cameras/{camera_id}/test", summary="Test camera connection")
async def test_camera(camera_id: int, db: Session = Depends(get_db)):
    """Attempt to open the RTSP stream and grab a single frame."""
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    rtsp_url = _build_rtsp_url(cam)
    cap = None
    try:
        import os as _os
        _os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|loglevel;quiet"
        _os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "8"
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 10_000)
        cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 10_000)

        if not cap.isOpened():
            return {"status": "failed", "message": "Could not open RTSP stream. Check IP address, port, and stream path."}

        ret, frame = cap.read()
        if not ret or frame is None:
            return {"status": "failed", "message": "Stream opened but could not read a frame. The camera may be busy or the stream path may be incorrect."}

        h, w = frame.shape[:2]
        return {
            "status": "success",
            "message": f"Connection successful! Resolution: {w}×{h}",
            "resolution": {"width": w, "height": h},
        }
    except Exception as e:
        err = str(e)
        if "401" in err or "auth" in err.lower():
            return {"status": "failed", "message": "Authentication failed. Check username and password."}
        return {"status": "failed", "message": f"Connection error: {err}"}
    finally:
        if cap is not None:
            cap.release()


@router.post("/api/cameras/{camera_id}/restart", summary="Restart camera stream")
async def restart_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    if not cam.enabled:
        raise HTTPException(status_code=400, detail="Camera is disabled")

    rtsp_url = _build_rtsp_url(cam)
    stream_manager.restart_stream(cam.id, rtsp_url)
    return {"status": "restarting", "camera_id": camera_id}


# ---------------------------------------------------------------------------
# Streaming endpoints
# ---------------------------------------------------------------------------

@router.get("/api/streams/{camera_id}", summary="MJPEG live stream")
async def mjpeg_stream(camera_id: int):
    """
    Returns a multipart MJPEG stream suitable for ``<img src="…">``.
    The stream is read from the shared frame buffer — no new RTSP connection.
    """
    if not stream_manager.is_online(camera_id):
        # Check if stream exists but is not online yet
        status = stream_manager.get_status(camera_id)
        if status["state"] == StreamState.STOPPED.value:
            raise HTTPException(status_code=404, detail="Stream not active for this camera")

    return StreamingResponse(
        stream_manager.mjpeg_generator(camera_id, fps_limit=15.0),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/api/cameras/{camera_id}/snapshot", summary="Camera snapshot")
async def camera_snapshot(camera_id: int, format: str = "jpeg"):
    """
    Return the latest frame from a camera.

    Query params:
      ?format=jpeg  (default) — returns raw JPEG image/jpeg
      ?format=json  — returns {"camera_id": ..., "image": "data:image/jpeg;base64,..."}
                      used by the Polygon Zone Editor so it can load the frame as a
                      canvas background without a separate endpoint.
    """
    import base64 as _b64
    jpeg = stream_manager.get_jpeg(camera_id, quality=90)
    if jpeg is None:
        if format == "json":
            raise HTTPException(status_code=404, detail=f"No frame available for camera {camera_id}. Is the stream online?")
        raise HTTPException(status_code=404, detail="No frame available")

    if format == "json":
        b64 = "data:image/jpeg;base64," + _b64.b64encode(jpeg).decode("ascii")
        return {"camera_id": camera_id, "image": b64}

    return Response(content=jpeg, media_type="image/jpeg")


# ---------------------------------------------------------------------------
# Seed data (runs once on first import if table is empty)
# ---------------------------------------------------------------------------

def seed_cameras() -> None:
    """Populate the cameras table with Caldim Hikvision cameras if empty."""
    from ..db.database import SessionLocal

    SEED = [
        {"ip": "192.168.1.202", "name": "Reception 01"},
        {"ip": "192.168.1.203", "name": "DAS Workspace (Main)"},
        {"ip": "192.168.1.204", "name": "Server Room"},
        {"ip": "192.168.1.206", "name": "Reception 02"},
        {"ip": "192.168.1.207", "name": "Entrance 02"},
        {"ip": "192.168.1.208", "name": "PM Cabins"},
        {"ip": "192.168.1.209", "name": "SDS Workspace"},
        {"ip": "192.168.1.210", "name": "Parking 01 (Backside)"},
        {"ip": "192.168.1.211", "name": "Parking 02 (Backside)"},
        {"ip": "192.168.1.212", "name": "Exit Way"},
        {"ip": "192.168.1.213", "name": "Tekla Workspace"},
        {"ip": "192.168.1.214", "name": "Pantry Rooftop"},
        {"ip": "192.168.1.215", "name": "Entrance 01"},
    ]

    with SessionLocal() as db:
        count = db.query(Camera).count()
        if count > 0:
            return  # already seeded

        default_password = "Caldim@2025"
        for entry in SEED:
            cam = Camera(
                name=entry["name"],
                description=entry["name"],
                location="Block A",
                building="Caldim Office",
                ip_address=entry["ip"],
                rtsp_port=554,
                stream_path="/Streaming/Channels/101",
                username="admin",
                encrypted_password=encrypt_password(default_password),
                camera_brand="Hikvision",
                stream_type="Main",
                enabled=True,
                recording_enabled=False,
            )
            db.add(cam)

        db.commit()
        print(f"[Cameras] 🌱 Seeded {len(SEED)} Hikvision cameras")
