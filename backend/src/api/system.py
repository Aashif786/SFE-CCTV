"""
System Configuration Backup, Export & Import API.

Provides unified endpoints to export and import:
- Full system bundle (everything in one JSON file)
- Cameras configuration (with credentials re-encryption support)
- Door / Portal Access Control configurations (doors.json)
- Spatial Handoff / Portal Flow Layouts (spatial_handoff.json)
- Camera ROI & Workstation Zones (camera_zones)
- AI Detection & Tracker Settings (settings.json)
- Employee registry & designated work zone assignments
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from ..config import (
    SETTINGS_FILE,
    config,
    env_settings,
    sync_tracker_config,
    _update_env_file,
)
from ..db.database import get_db, SessionLocal
from ..db.models import (
    Camera,
    CameraZoneDB,
    EmployeeDB,
    EmployeeZoneDB,
    WorkstationZone,
)
from ..cameras.encryption import encrypt_password, decrypt_password
from ..cameras.stream_manager import stream_manager
from ..spatial.engine import spatial_handoff_engine
from ..spatial.config_service import SpatialConfigurationError
from ..state import invalidate_zone_cache
from ..zones.polygon_eval import zone_cache

router = APIRouter(prefix="/api/system", tags=["system-backup"])


def _get_cameras_export(db: Session) -> List[Dict[str, Any]]:
    cameras = db.query(Camera).all()
    out = []
    for c in cameras:
        plain_pass = decrypt_password(c.encrypted_password) if c.encrypted_password else ""
        out.append({
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "location": c.location,
            "building": c.building,
            "floor": c.floor,
            "zone": c.zone,
            "door_name": c.door_name,
            "ip_address": c.ip_address,
            "rtsp_port": c.rtsp_port or 554,
            "stream_path": c.stream_path or "/Streaming/Channels/101",
            "username": c.username or "admin",
            "password": plain_pass,
            "camera_brand": c.camera_brand or "Hikvision",
            "stream_type": c.stream_type or "Main",
            "enabled": c.enabled if c.enabled is not None else True,
            "recording_enabled": c.recording_enabled if c.recording_enabled is not None else False,
        })
    return out


def _get_doors_export() -> List[Dict[str, Any]]:
    doors_file = os.path.join(os.path.dirname(__file__), "..", "..", "doors.json")
    if os.path.exists(doors_file):
        try:
            with open(doors_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return getattr(env_settings, "hikvision_doors", []) or []


def _get_spatial_export() -> Dict[str, Any]:
    return spatial_handoff_engine.configuration.snapshot()


def _get_camera_zones_export(db: Session) -> Dict[str, Any]:
    zones_rows = db.query(CameraZoneDB).all()
    workstation_rows = db.query(WorkstationZone).all()

    camera_zones = []
    for r in zones_rows:
        try:
            pts = json.loads(r.points_json)
        except Exception:
            pts = []
        camera_zones.append({
            "camera_id": r.camera_id,
            "zone_id": r.zone_id,
            "name": r.name,
            "color": r.color,
            "description": r.description,
            "points": pts,
            "enabled": r.enabled,
        })

    workstation_zones = []
    for w in workstation_rows:
        workstation_zones.append({
            "camera_id": w.camera_id,
            "x_min": w.x_min,
            "y_min": w.y_min,
            "x_max": w.x_max,
            "y_max": w.y_max,
        })

    return {
        "camera_zones": camera_zones,
        "workstation_zones": workstation_zones,
    }


def _get_settings_export() -> Dict[str, Any]:
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {
        "idle_threshold_seconds": getattr(config, "idle_threshold_seconds", 10.0),
        "movement_sensitivity": getattr(config, "movement_sensitivity", 0.05),
        "confidence_threshold": getattr(config, "confidence_threshold", 0.50),
        "correlation_window_seconds": getattr(config, "correlation_window_seconds", 5.0),
        "identity_provider": getattr(config, "identity_provider", "REST_SIMULATOR"),
        "tracking_mode": getattr(config, "tracking_mode", "TRACK_ALL"),
        "tracked_employee_ids": getattr(config, "tracked_employee_ids", []),
        "yolo_model": getattr(config, "yolo_model", "yolo11m-pose.pt"),
        "yolo_conf": getattr(config, "yolo_conf", 0.30),
        "yolo_iou": getattr(config, "yolo_iou", 0.90),
        "yolo_imgsz": getattr(config, "yolo_imgsz", 960),
        "ema_alpha": getattr(config, "ema_alpha", 0.80),
        "max_tracked_people": getattr(config, "max_tracked_people", 10),
        "ai_stream_fps": getattr(config, "ai_stream_fps", 15),
        "tracker_track_high_thresh": getattr(config, "tracker_track_high_thresh", 0.30),
        "tracker_track_low_thresh": getattr(config, "tracker_track_low_thresh", 0.10),
        "tracker_new_track_thresh": getattr(config, "tracker_new_track_thresh", 0.50),
        "tracker_track_buffer": getattr(config, "tracker_track_buffer", 120),
        "tracker_match_thresh": getattr(config, "tracker_match_thresh", 0.80),
        "tracker_fuse_score": getattr(config, "tracker_fuse_score", True),
        "tracker_gmc_method": getattr(config, "tracker_gmc_method", "none"),
        "tracker_with_reid": getattr(config, "tracker_with_reid", True),
        "tracker_proximity_thresh": getattr(config, "tracker_proximity_thresh", 0.0),
        "tracker_appearance_thresh": getattr(config, "tracker_appearance_thresh", 0.75),
        "classifier_velocity_threshold": getattr(config, "classifier_velocity_threshold", 0.05),
        "active_profile": getattr(config, "active_profile", "software_office"),
        "default_rtsp_port": getattr(env_settings, "default_rtsp_port", 554),
        "stream_reconnect_interval": getattr(env_settings, "stream_reconnect_interval", 5),
        "stream_timeout": getattr(env_settings, "stream_timeout", 30),
        "frame_buffer_size": getattr(env_settings, "frame_buffer_size", 5),
        "max_cameras": getattr(env_settings, "max_cameras", 50),
        "default_stream_transport": getattr(env_settings, "default_stream_transport", "tcp"),
        "hikvision_username": getattr(env_settings, "hikvision_username", "admin"),
        "hikvision_password": getattr(env_settings, "hikvision_password", ""),
    }


def _get_employees_export(db: Session) -> Dict[str, Any]:
    employees = db.query(EmployeeDB).all()
    employee_zones = db.query(EmployeeZoneDB).all()

    emp_list = [
        {
            "employee_id": e.employee_id,
            "name": e.name,
            "department": e.department,
            "designation": e.designation,
            "is_tracked": e.is_tracked,
        }
        for e in employees
    ]

    zones_list = [
        {
            "employee_id": ez.employee_id,
            "camera_id": ez.camera_id,
            "zone_id": ez.zone_id,
            "zone_name": ez.zone_name,
            "is_designated": ez.is_designated,
        }
        for ez in employee_zones
    ]

    return {
        "employees": emp_list,
        "employee_zones": zones_list,
    }


# ── Import Handlers ────────────────────────────────────────────────────────

def _import_cameras(data: Any, db: Session, mode: str = "merge") -> dict:
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="Cameras payload must be a JSON array of camera objects")

    if mode == "replace":
        db.query(Camera).delete()
        db.commit()

    updated = 0
    created = 0

    for item in data:
        ip = item.get("ip_address") or item.get("ip")
        if not ip:
            continue

        name = item.get("name") or f"Camera {ip}"
        raw_password = item.get("password") or item.get("encrypted_password") or "Caldim@2025"
        # If it's already an encrypted string or plaintext
        enc_pass = encrypt_password(raw_password)

        existing = db.query(Camera).filter(Camera.ip_address == ip).first()
        if existing:
            existing.name = name
            existing.description = item.get("description", existing.description)
            existing.location = item.get("location", existing.location)
            existing.building = item.get("building", existing.building)
            existing.floor = item.get("floor", existing.floor)
            existing.zone = item.get("zone", existing.zone)
            existing.door_name = item.get("door_name", existing.door_name)
            existing.rtsp_port = int(item.get("rtsp_port", existing.rtsp_port or 554))
            existing.stream_path = item.get("stream_path", existing.stream_path or "/Streaming/Channels/101")
            existing.username = item.get("username", existing.username or "admin")
            if item.get("password"):
                existing.encrypted_password = enc_pass
            existing.camera_brand = item.get("camera_brand", existing.camera_brand or "Hikvision")
            existing.stream_type = item.get("stream_type", existing.stream_type or "Main")
            if "enabled" in item:
                existing.enabled = bool(item["enabled"])
            if "recording_enabled" in item:
                existing.recording_enabled = bool(item["recording_enabled"])
            updated += 1
        else:
            cam = Camera(
                name=name,
                description=item.get("description", name),
                location=item.get("location", "Office"),
                building=item.get("building", "Main Building"),
                floor=item.get("floor", ""),
                zone=item.get("zone", ""),
                door_name=item.get("door_name", ""),
                ip_address=ip,
                rtsp_port=int(item.get("rtsp_port", 554)),
                stream_path=item.get("stream_path", "/Streaming/Channels/101"),
                username=item.get("username", "admin"),
                encrypted_password=enc_pass,
                camera_brand=item.get("camera_brand", "Hikvision"),
                stream_type=item.get("stream_type", "Main"),
                enabled=bool(item.get("enabled", True)),
                recording_enabled=bool(item.get("recording_enabled", False)),
            )
            db.add(cam)
            created += 1

    db.commit()
    # Restart streams to apply new configurations
    try:
        stream_manager.restart_all_active()
    except Exception as e:
        print(f"[Import] Warning restarting streams: {e}")

    return {"status": "success", "created": created, "updated": updated, "total": created + updated}


def _import_doors(data: Any) -> dict:
    if not isinstance(data, list):
        raise HTTPException(status_code=400, detail="Doors payload must be a JSON array of door objects")

    doors_file = os.path.join(os.path.dirname(__file__), "..", "..", "doors.json")
    try:
        with open(doors_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write doors.json: {e}")

    env_settings.reload_doors()
    return {"status": "success", "doors_count": len(data)}


def _import_spatial(data: Any) -> dict:
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Spatial handoff payload must be a JSON object")

    try:
        spatial_handoff_engine.configuration.replace(data)
    except SpatialConfigurationError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid spatial layout: {exc}") from exc

    return {"status": "success", "facilities_count": len(data.get("facilities", []))}


def _import_camera_zones(data: Any, db: Session, mode: str = "merge") -> dict:
    if not isinstance(data, dict) and not isinstance(data, list):
        raise HTTPException(status_code=400, detail="Camera zones payload must be a JSON object or array")

    zones_list = data if isinstance(data, list) else data.get("camera_zones", data.get("zones", []))
    workstations_list = data.get("workstation_zones", []) if isinstance(data, dict) else []

    if mode == "replace":
        db.query(CameraZoneDB).delete()
        db.query(WorkstationZone).delete()
        db.commit()

    zones_count = 0
    cams_affected = set()

    for z in zones_list:
        cam_id = str(z.get("camera_id") or z.get("cameraId") or "").strip()
        zone_id = str(z.get("zone_id") or z.get("id") or "").strip()
        if not cam_id or not zone_id:
            continue

        cams_affected.add(cam_id)
        pts = z.get("points") or []
        pts_json = json.dumps(pts) if isinstance(pts, list) else str(pts)

        existing = db.query(CameraZoneDB).filter(
            CameraZoneDB.camera_id == cam_id,
            CameraZoneDB.zone_id == zone_id,
        ).first()

        if existing:
            existing.name = z.get("name", existing.name)
            existing.color = z.get("color", existing.color)
            existing.description = z.get("description", existing.description)
            existing.points_json = pts_json
            if "enabled" in z:
                existing.enabled = bool(z["enabled"])
        else:
            row = CameraZoneDB(
                camera_id=cam_id,
                zone_id=zone_id,
                name=z.get("name", f"Zone {zone_id}"),
                color=z.get("color", "#3B82F6"),
                description=z.get("description"),
                points_json=pts_json,
                enabled=bool(z.get("enabled", True)),
            )
            db.add(row)
        zones_count += 1

    for w in workstations_list:
        cam_id = str(w.get("camera_id") or "").strip()
        if not cam_id:
            continue
        cams_affected.add(cam_id)
        existing_w = db.query(WorkstationZone).filter(WorkstationZone.camera_id == cam_id).first()
        if existing_w:
            existing_w.x_min = float(w.get("x_min", 0.0))
            existing_w.y_min = float(w.get("y_min", 0.0))
            existing_w.x_max = float(w.get("x_max", 1.0))
            existing_w.y_max = float(w.get("y_max", 1.0))
        else:
            w_row = WorkstationZone(
                camera_id=cam_id,
                x_min=float(w.get("x_min", 0.0)),
                y_min=float(w.get("y_min", 0.0)),
                x_max=float(w.get("x_max", 1.0)),
                y_max=float(w.get("y_max", 1.0)),
            )
            db.add(w_row)

    db.commit()

    for cid in cams_affected:
        invalidate_zone_cache(cid)
        zone_cache.invalidate(str(cid))
        zone_cache.invalidate(f"ai-{cid}")

    return {"status": "success", "zones_count": zones_count, "workstations_count": len(workstations_list)}


def _import_settings(data: Any) -> dict:
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Settings payload must be a JSON object")

    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write settings.json: {e}")

    # Apply to in-memory config object
    for k, v in data.items():
        if hasattr(config, k):
            setattr(config, k, v)

    if data.get("hikvision_username"):
        _update_env_file("HIKVISION_USERNAME", data["hikvision_username"])
    if data.get("hikvision_password"):
        _update_env_file("HIKVISION_PASSWORD", data["hikvision_password"])

    env_settings.reload_doors()
    sync_tracker_config()
    return {"status": "success", "message": "Settings imported and applied successfully"}


def _import_employees(data: Any, db: Session, mode: str = "merge") -> dict:
    if not isinstance(data, dict) and not isinstance(data, list):
        raise HTTPException(status_code=400, detail="Employees payload must be a JSON object or array")

    emp_list = data if isinstance(data, list) else data.get("employees", [])
    zones_list = data.get("employee_zones", []) if isinstance(data, dict) else []

    if mode == "replace":
        db.query(EmployeeZoneDB).delete()
        db.query(EmployeeDB).delete()
        db.commit()

    emp_count = 0
    for e in emp_list:
        emp_id = str(e.get("employee_id") or "").strip()
        if not emp_id:
            continue
        existing = db.query(EmployeeDB).filter(EmployeeDB.employee_id == emp_id).first()
        if existing:
            existing.name = e.get("name", existing.name)
            existing.department = e.get("department", existing.department)
            existing.designation = e.get("designation", existing.designation)
            if "is_tracked" in e:
                existing.is_tracked = bool(e["is_tracked"])
        else:
            new_emp = EmployeeDB(
                employee_id=emp_id,
                name=e.get("name", f"Employee {emp_id}"),
                department=e.get("department", "Engineering"),
                designation=e.get("designation", "Software Engineer"),
                is_tracked=bool(e.get("is_tracked", True)),
            )
            db.add(new_emp)
        emp_count += 1

    zone_assign_count = 0
    for ez in zones_list:
        emp_id = str(ez.get("employee_id") or "").strip()
        cam_id = str(ez.get("camera_id") or "").strip()
        zone_id = str(ez.get("zone_id") or "").strip()
        if not emp_id or not cam_id or not zone_id:
            continue

        existing_ez = db.query(EmployeeZoneDB).filter(
            EmployeeZoneDB.employee_id == emp_id,
            EmployeeZoneDB.camera_id == cam_id,
            EmployeeZoneDB.zone_id == zone_id,
        ).first()

        if existing_ez:
            existing_ez.zone_name = ez.get("zone_name", existing_ez.zone_name)
            if "is_designated" in ez:
                existing_ez.is_designated = bool(ez["is_designated"])
        else:
            row = EmployeeZoneDB(
                employee_id=emp_id,
                camera_id=cam_id,
                zone_id=zone_id,
                zone_name=ez.get("zone_name"),
                is_designated=bool(ez.get("is_designated", True)),
            )
            db.add(row)
        zone_assign_count += 1

    db.commit()
    return {"status": "success", "employees_count": emp_count, "zone_assignments_count": zone_assign_count}


# ── System Export Endpoints ───────────────────────────────────────────────

@router.get("/export/all", summary="Export all system configs as a master bundle")
async def export_all_configs(db: Session = Depends(get_db)):
    """
    Exports a comprehensive bundle containing:
    - AI & Detection Settings (settings.json)
    - Cameras & RTSP configurations
    - Door & Access Control units (doors.json)
    - Spatial Layout & Portal Handoff flows (spatial_handoff.json)
    - Camera ROI & Workstation Zones
    - Employees & Zone assignments
    """
    bundle = {
        "version": "2.0",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "settings": _get_settings_export(),
        "cameras": _get_cameras_export(db),
        "doors": _get_doors_export(),
        "spatial_handoff": _get_spatial_export(),
        "camera_zones": _get_camera_zones_export(db),
        "employees": _get_employees_export(db),
    }

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    filename = f"calvision_config_bundle_{timestamp}.json"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": "application/json",
    }
    return Response(content=json.dumps(bundle, indent=2), headers=headers)


@router.get("/export/{config_type}", summary="Export specific configuration JSON")
async def export_specific_config(config_type: str, db: Session = Depends(get_db)):
    """
    Export a specific configuration JSON file:
    - 'cameras': Camera configurations
    - 'doors': Door & Portal ACS configuration (doors.json)
    - 'spatial_handoff' | 'spatial' | 'portals': Spatial Handoff & Layout (spatial_handoff.json)
    - 'camera_zones' | 'zones': All polygonal & workstation zones
    - 'settings': AI & Tracker settings (settings.json)
    - 'employees': Employee registry & zone assignments
    """
    ct = config_type.lower().strip()

    if ct == "cameras":
        data = _get_cameras_export(db)
        filename = "cameras.json"
    elif ct in ("doors", "acs"):
        data = _get_doors_export()
        filename = "doors.json"
    elif ct in ("spatial_handoff", "spatial", "portal_flow", "portals"):
        data = _get_spatial_export()
        filename = "spatial_handoff.json"
    elif ct in ("camera_zones", "zones"):
        data = _get_camera_zones_export(db)
        filename = "camera_zones.json"
    elif ct in ("settings", "config"):
        data = _get_settings_export()
        filename = "settings.json"
    elif ct == "employees":
        data = _get_employees_export(db)
        filename = "employees.json"
    else:
        raise HTTPException(status_code=400, detail=f"Unknown configuration type '{config_type}'. Supported: all, cameras, doors, spatial_handoff, camera_zones, settings, employees")

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": "application/json",
    }
    return Response(content=json.dumps(data, indent=2), headers=headers)


# ── System Import Endpoints ───────────────────────────────────────────────

async def _parse_request_data(request: Request, file: Optional[UploadFile]) -> Any:
    raw_content = None
    if file:
        try:
            raw_bytes = await file.read()
            raw_content = raw_bytes.decode("utf-8")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {e}")
    else:
        try:
            body = await request.body()
            if body:
                raw_content = body.decode("utf-8")
        except Exception:
            pass

    if not raw_content:
        raise HTTPException(status_code=400, detail="Please upload a JSON file or provide a valid JSON body")

    try:
        return json.loads(raw_content)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON format: {e}")


@router.post("/import/all", summary="Import master configuration bundle")
async def import_all_configs(
    request: Request,
    file: Optional[UploadFile] = File(None),
    mode: str = "merge",
    db: Session = Depends(get_db),
):
    """
    Restore an entire system configuration bundle from a single JSON file.
    Imports: settings, cameras, doors, spatial_handoff, camera_zones, employees.
    """
    bundle = await _parse_request_data(request, file)
    if not isinstance(bundle, dict):
        raise HTTPException(status_code=400, detail="Bundle must be a JSON object")

    report = {}

    # 1. Settings
    if "settings" in bundle:
        try:
            report["settings"] = _import_settings(bundle["settings"])
        except Exception as e:
            report["settings"] = {"status": "error", "message": str(e)}

    # 2. Cameras
    if "cameras" in bundle:
        try:
            report["cameras"] = _import_cameras(bundle["cameras"], db, mode=mode)
        except Exception as e:
            report["cameras"] = {"status": "error", "message": str(e)}

    # 3. Doors
    if "doors" in bundle:
        try:
            report["doors"] = _import_doors(bundle["doors"])
        except Exception as e:
            report["doors"] = {"status": "error", "message": str(e)}

    # 4. Spatial Handoff
    if "spatial_handoff" in bundle:
        try:
            report["spatial_handoff"] = _import_spatial(bundle["spatial_handoff"])
        except Exception as e:
            report["spatial_handoff"] = {"status": "error", "message": str(e)}

    # 5. Camera Zones
    if "camera_zones" in bundle:
        try:
            report["camera_zones"] = _import_camera_zones(bundle["camera_zones"], db, mode=mode)
        except Exception as e:
            report["camera_zones"] = {"status": "error", "message": str(e)}

    # 6. Employees
    if "employees" in bundle:
        try:
            report["employees"] = _import_employees(bundle["employees"], db, mode=mode)
        except Exception as e:
            report["employees"] = {"status": "error", "message": str(e)}

    return {
        "status": "success",
        "message": "Master configuration bundle imported successfully",
        "report": report,
    }


@router.post("/import/{config_type}", summary="Import specific configuration JSON")
async def import_specific_config(
    config_type: str,
    request: Request,
    file: Optional[UploadFile] = File(None),
    mode: str = "merge",
    db: Session = Depends(get_db),
):
    """
    Import a specific configuration JSON:
    - 'cameras': Camera configurations
    - 'doors': Door & Portal ACS configuration (doors.json)
    - 'spatial_handoff' | 'spatial' | 'portals': Spatial Handoff & Layout (spatial_handoff.json)
    - 'camera_zones' | 'zones': Polygonal & workstation zones
    - 'settings': AI & Tracker settings (settings.json)
    - 'employees': Employee registry & zone assignments
    """
    data = await _parse_request_data(request, file)
    ct = config_type.lower().strip()

    if ct == "cameras":
        return _import_cameras(data, db, mode=mode)
    elif ct in ("doors", "acs"):
        return _import_doors(data)
    elif ct in ("spatial_handoff", "spatial", "portal_flow", "portals"):
        return _import_spatial(data)
    elif ct in ("camera_zones", "zones"):
        return _import_camera_zones(data, db, mode=mode)
    elif ct in ("settings", "config"):
        return _import_settings(data)
    elif ct == "employees":
        return _import_employees(data, db, mode=mode)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown configuration type '{config_type}'")
