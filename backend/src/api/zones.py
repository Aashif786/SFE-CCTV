"""
Zone Configuration & Analytics API.

Endpoints
---------
Workstation Zone (Legacy):
GET    /api/zones/{camera_id}             — read single rectangular zone
POST   /api/zones/{camera_id}             — set single rectangular zone
DELETE /api/zones/{camera_id}             — reset rectangular zone

Polygonal Camera Zones (Option 2 JSON Upload / Management):
GET    /api/camera-zones/{camera_id}        — list all polygonal zones for camera
POST   /api/camera-zones/{camera_id}/upload — upload/replace JSON configuration file or JSON body
GET    /api/camera-zones/{camera_id}/export — export JSON configuration file download
DELETE /api/camera-zones/{camera_id}        — delete all zones for camera
DELETE /api/camera-zones/{camera_id}/zone/{zone_id} — delete a specific zone

Zone Analytics & Reports:
GET    /api/zone-analytics/summary        — summary stats (total visits, avg dwell time, zone/person breakdowns)
GET    /api/zone-analytics/visits         — paginated historical visit logs with filtering
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.database import get_db
from ..db.models import CameraZoneDB, WorkstationZone, ZoneVisitDB
from ..state import invalidate_zone_cache
from ..zones.dwell_tracker import dwell_tracker, format_dwell_time
from ..zones.polygon_eval import validate_zone_config, zone_cache

router = APIRouter(tags=["zones"])


# ── Legacy Workstation Zone Models & Handlers ─────────────────────────────

class ZonePayload(BaseModel):
    x_min: float = Field(ge=0.0, le=1.0)
    y_min: float = Field(ge=0.0, le=1.0)
    x_max: float = Field(ge=0.0, le=1.0)
    y_max: float = Field(ge=0.0, le=1.0)


@router.get("/api/zones/{camera_id}")
async def get_zone(camera_id: str, db: Session = Depends(get_db)):
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if not row:
        return {"camera_id": camera_id, "x_min": 0.0, "y_min": 0.0, "x_max": 1.0, "y_max": 1.0, "is_default": True}
    return {"camera_id": row.camera_id, "x_min": row.x_min, "y_min": row.y_min, "x_max": row.x_max, "y_max": row.y_max, "is_default": False}


@router.post("/api/zones/{camera_id}")
async def set_zone(camera_id: str, payload: ZonePayload, db: Session = Depends(get_db)):
    if payload.x_min >= payload.x_max or payload.y_min >= payload.y_max:
        raise HTTPException(status_code=400, detail="x_min must be < x_max and y_min must be < y_max")
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if row:
        row.x_min, row.y_min, row.x_max, row.y_max = payload.x_min, payload.y_min, payload.x_max, payload.y_max
    else:
        row = WorkstationZone(camera_id=camera_id, x_min=payload.x_min, y_min=payload.y_min, x_max=payload.x_max, y_max=payload.y_max)
        db.add(row)
    db.commit()
    invalidate_zone_cache(camera_id)
    print(f"🗺️  Zone updated for {camera_id}: ({payload.x_min},{payload.y_min}) → ({payload.x_max},{payload.y_max})")
    return {"status": "saved", "camera_id": camera_id, "x_min": payload.x_min, "y_min": payload.y_min, "x_max": payload.x_max, "y_max": payload.y_max}


@router.delete("/api/zones/{camera_id}")
async def delete_zone(camera_id: str, db: Session = Depends(get_db)):
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if row:
        db.delete(row)
        db.commit()
    invalidate_zone_cache(camera_id)
    return {"status": "deleted", "camera_id": camera_id}


# ── Polygonal Camera Zone Endpoints ────────────────────────────────────────

def _get_camera_zones_from_db(camera_id: str, db: Session) -> List[Dict[str, Any]]:
    rows = db.query(CameraZoneDB).filter(CameraZoneDB.camera_id == str(camera_id)).all()
    zones = []
    for r in rows:
        try:
            pts = json.loads(r.points_json)
        except Exception:
            pts = []
        zones.append({
            "id": r.zone_id,
            "name": r.name,
            "color": r.color,
            "description": r.description,
            "points": pts,
            "enabled": r.enabled,
        })
    return zones


@router.get("/api/camera-zones/{camera_id}")
async def get_camera_zones(camera_id: str, db: Session = Depends(get_db)):
    """Fetch all polygonal zones configured for a camera."""
    zones = _get_camera_zones_from_db(camera_id, db)
    return {
        "camera_id": camera_id,
        "zones": zones,
        "count": len(zones),
    }


@router.post("/api/camera-zones/{camera_id}/upload")
async def upload_camera_zones(
    camera_id: str,
    request: Request,
    file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """
    Upload and validate a JSON zone configuration file or JSON body for a camera.
    Replaces existing zones with the newly validated payload.
    """
    raw_content = None

    if file:
        try:
            raw_bytes = await file.read()
            raw_content = raw_bytes.decode("utf-8")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to read uploaded file: {str(e)}")
    else:
        try:
            body = await request.body()
            if body:
                raw_content = body.decode("utf-8")
        except Exception:
            pass

    if not raw_content:
        raise HTTPException(status_code=400, detail="Please upload a JSON file or provide a valid JSON body")

    is_valid, err_msg, validated_zones = validate_zone_config(raw_content)
    if not is_valid:
        raise HTTPException(status_code=422, detail=f"Validation failed: {err_msg}")

    # Delete existing zones for camera & insert new ones
    db.query(CameraZoneDB).filter(CameraZoneDB.camera_id == str(camera_id)).delete()

    for z in validated_zones:
        db_zone = CameraZoneDB(
            camera_id=str(camera_id),
            zone_id=z["id"],
            name=z["name"],
            color=z["color"],
            description=z.get("description"),
            points_json=json.dumps(z["points"]),
            enabled=z.get("enabled", True),
        )
        db.add(db_zone)

    db.commit()

    # Invalidate in-memory zone cache
    zone_cache.invalidate(str(camera_id))
    zone_cache.invalidate(f"ai-{camera_id}")

    print(f"🗺️  [ZonesAPI] Successfully updated {len(validated_zones)} zones for camera {camera_id}")

    return {
        "status": "success",
        "message": f"Successfully configured {len(validated_zones)} zones for camera {camera_id}",
        "camera_id": camera_id,
        "zones": validated_zones,
    }


@router.get("/api/camera-zones/{camera_id}/export")
async def export_camera_zones(camera_id: str, db: Session = Depends(get_db)):
    """Export camera zones as a downloadable JSON file."""
    zones = _get_camera_zones_from_db(camera_id, db)
    export_payload = {
        "cameraId": str(camera_id),
        "exportedAt": datetime.utcnow().isoformat(),
        "zones": zones,
    }
    json_str = json.dumps(export_payload, indent=2)
    filename = f"camera_{camera_id}_zones.json"
    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Content-Type": "application/json",
    }
    return Response(content=json_str, headers=headers)


@router.delete("/api/camera-zones/{camera_id}")
async def clear_camera_zones(camera_id: str, db: Session = Depends(get_db)):
    """Delete all configured zones for a camera."""
    count = db.query(CameraZoneDB).filter(CameraZoneDB.camera_id == str(camera_id)).delete()
    db.commit()
    zone_cache.invalidate(str(camera_id))
    zone_cache.invalidate(f"ai-{camera_id}")
    return {
        "status": "deleted",
        "camera_id": camera_id,
        "deleted_count": count,
    }


@router.delete("/api/camera-zones/{camera_id}/zone/{zone_id}")
async def delete_single_camera_zone(camera_id: str, zone_id: str, db: Session = Depends(get_db)):
    """Delete a specific zone from a camera."""
    row = db.query(CameraZoneDB).filter(
        CameraZoneDB.camera_id == str(camera_id),
        CameraZoneDB.zone_id == str(zone_id),
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail=f"Zone '{zone_id}' not found for camera {camera_id}")

    db.delete(row)
    db.commit()
    zone_cache.invalidate(str(camera_id))
    zone_cache.invalidate(f"ai-{camera_id}")
    return {
        "status": "deleted",
        "camera_id": camera_id,
        "zone_id": zone_id,
    }


# ── Single Zone Upsert (used by the Polygon Zone Editor GUI) ────────────────

class SingleZonePayload(BaseModel):
    zone_id: str = Field(..., description="Unique zone ID within this camera")
    name: str = Field(..., description="Display name for the zone")
    color: str = Field(default="#3B82F6", description="Hex colour for the zone overlay")
    description: Optional[str] = Field(default=None)
    zone_type: str = Field(default="general", description="workstation|meeting_room|walkway|restricted|general")
    points: List[List[float]] = Field(..., description="List of [x, y] vertex coordinates")
    enabled: bool = Field(default=True)


@router.post("/api/camera-zones/{camera_id}/zone")
async def upsert_camera_zone(
    camera_id: str,
    payload: SingleZonePayload,
    db: Session = Depends(get_db),
):
    """
    Create or update a single polygonal zone for a camera.
    Uses zone_id as the natural key — if it already exists, it is replaced.
    """
    if len(payload.points) < 3:
        raise HTTPException(status_code=400, detail="A polygon must have at least 3 vertices")

    # Validate all points are numeric 2-tuples
    for i, pt in enumerate(payload.points):
        if len(pt) < 2:
            raise HTTPException(status_code=400, detail=f"Point {i} must have x and y coordinates")
        try:
            float(pt[0]), float(pt[1])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail=f"Point {i} has non-numeric coordinates")

    existing = db.query(CameraZoneDB).filter(
        CameraZoneDB.camera_id == str(camera_id),
        CameraZoneDB.zone_id == str(payload.zone_id),
    ).first()

    points_json = json.dumps([[float(pt[0]), float(pt[1])] for pt in payload.points])

    if existing:
        existing.name = payload.name
        existing.color = payload.color
        existing.description = payload.description
        existing.points_json = points_json
        existing.enabled = payload.enabled
    else:
        db_zone = CameraZoneDB(
            camera_id=str(camera_id),
            zone_id=str(payload.zone_id),
            name=payload.name,
            color=payload.color,
            description=payload.description,
            points_json=points_json,
            enabled=payload.enabled,
        )
        db.add(db_zone)

    db.commit()
    zone_cache.invalidate(str(camera_id))
    zone_cache.invalidate(f"ai-{camera_id}")

    return {
        "status": "saved",
        "camera_id": camera_id,
        "zone_id": payload.zone_id,
        "name": payload.name,
    }


# ── Zone Analytics & Reporting Endpoints ───────────────────────────────────

@router.get("/api/zone-analytics/summary")
async def get_zone_analytics_summary(
    camera_id: Optional[str] = Query(None),
    zone_id: Optional[str] = Query(None),
    person_identifier: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Get aggregated zone dwell metrics and visit counts.
    Supports filtering by camera_id, zone_id, person_identifier, and date range.
    Includes active open visits with real-time live dwell duration.
    """
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    # 0. Auto-close orphan DB visits that are no longer active in live memory
    open_db_visits = db.query(ZoneVisitDB).filter(ZoneVisitDB.exit_time.is_(None)).all()
    closed_stale = False
    for ov in open_db_visits:
        if not dwell_tracker.is_visit_active_in_mem(ov.id):
            ov.exit_time = ov.entry_time or now
            ov.duration_seconds = 0.0
            closed_stale = True
    if closed_stale:
        try:
            db.commit()
            db.expire_all()
        except Exception:
            db.rollback()

    query = db.query(ZoneVisitDB)

    if camera_id:
        query = query.filter(ZoneVisitDB.camera_id == str(camera_id))
    if zone_id:
        query = query.filter(ZoneVisitDB.zone_id == str(zone_id))
    if person_identifier:
        query = query.filter(ZoneVisitDB.person_identifier == str(person_identifier))

    if start_date:
        try:
            clean_str = start_date.replace("Z", "+00:00")
            dt_start = datetime.fromisoformat(clean_str)
            if dt_start.tzinfo is not None:
                dt_start = dt_start.astimezone(timezone.utc).replace(tzinfo=None)
            query = query.filter(
                (ZoneVisitDB.entry_time >= dt_start) | (ZoneVisitDB.exit_time.is_(None))
            )
        except Exception:
            pass

    if end_date:
        try:
            clean_str = end_date.replace("Z", "+00:00")
            dt_end = datetime.fromisoformat(clean_str)
            if dt_end.tzinfo is not None:
                dt_end = dt_end.astimezone(timezone.utc).replace(tzinfo=None)
            query = query.filter(ZoneVisitDB.entry_time <= dt_end)
        except Exception:
            pass

    all_visits = query.all()
    total_visits = len(all_visits)
    total_occupancy_sec = 0.0

    # Map for zone stats & person stats
    zone_stats: Dict[str, Dict[str, Any]] = {}
    person_stats: Dict[str, Dict[str, Any]] = {}

    for v in all_visits:
        is_active = (v.exit_time is None) and dwell_tracker.is_visit_active_in_mem(v.id)
        if is_active:
            dur = max(0.0, (now - v.entry_time).total_seconds())
        else:
            dur = v.duration_seconds or 0.0

        total_occupancy_sec += dur

        # Accumulate per zone
        zid = v.zone_id
        if zid not in zone_stats:
            zone_stats[zid] = {"visit_count": 0, "total_duration": 0.0}
        zone_stats[zid]["visit_count"] += 1
        zone_stats[zid]["total_duration"] += dur

        # Accumulate per person
        plabel = v.person_identifier or f"Track #{v.tracking_id}"
        if plabel not in person_stats:
            person_stats[plabel] = {
                "person_identifier": plabel,
                "raw_person_id": v.person_identifier,
                "tracking_id": v.tracking_id,
                "visit_count": 0,
                "total_occupancy_seconds": 0.0,
                "last_entry": v.entry_time,
                "is_inside": False,
            }
        ps = person_stats[plabel]
        ps["visit_count"] += 1
        ps["total_occupancy_seconds"] += dur
        if v.entry_time and (ps["last_entry"] is None or v.entry_time > ps["last_entry"]):
            ps["last_entry"] = v.entry_time
        if is_active:
            ps["is_inside"] = True

    # Synchronize active occupants count strictly with live in-memory dwell tracker
    active_occupants_count = dwell_tracker.get_active_visits_count(camera_id=camera_id, zone_id=zone_id)

    avg_dwell_sec = (total_occupancy_sec / total_visits) if total_visits > 0 else 0.0

    # Fetch all configured zones from CameraZoneDB for this camera (or all cameras)
    zone_q = db.query(CameraZoneDB)
    if camera_id:
        zone_q = zone_q.filter(CameraZoneDB.camera_id == str(camera_id))
    all_configured_zones = zone_q.all()

    per_zone_metrics = []
    seen_zone_ids = set()

    # 1. Include all configured zones from CameraZoneDB
    for cz in all_configured_zones:
        seen_zone_ids.add(cz.zone_id)
        stats = zone_stats.get(cz.zone_id, {"visit_count": 0, "total_duration": 0.0})
        tot_dur = stats["total_duration"]
        v_count = stats["visit_count"]
        avg_dur = (tot_dur / v_count) if v_count > 0 else 0.0
        per_zone_metrics.append({
            "zone_id": cz.zone_id,
            "zone_name": cz.name,
            "zone_color": cz.color,
            "visit_count": v_count,
            "total_occupancy_seconds": round(tot_dur, 1),
            "formatted_total_occupancy": format_dwell_time(tot_dur),
            "average_dwell_seconds": round(avg_dur, 1),
            "formatted_average_dwell": format_dwell_time(avg_dur),
        })

    # 2. Include any historical zones from visits that might no longer be in CameraZoneDB
    for zid, stats in zone_stats.items():
        if zid not in seen_zone_ids:
            tot_dur = stats["total_duration"]
            v_count = stats["visit_count"]
            avg_dur = (tot_dur / v_count) if v_count > 0 else 0.0
            per_zone_metrics.append({
                "zone_id": zid,
                "zone_name": zid,
                "zone_color": "#3B82F6",
                "visit_count": v_count,
                "total_occupancy_seconds": round(tot_dur, 1),
                "formatted_total_occupancy": format_dwell_time(tot_dur),
                "average_dwell_seconds": round(avg_dur, 1),
                "formatted_average_dwell": format_dwell_time(avg_dur),
            })

    # Convert person_stats map to list sorted by visit count
    per_person_metrics = []
    for ps in sorted(person_stats.values(), key=lambda x: x["visit_count"], reverse=True):
        tot_dur = ps["total_occupancy_seconds"]
        v_count = ps["visit_count"]
        avg_dur = (tot_dur / v_count) if v_count > 0 else 0.0
        per_person_metrics.append({
            "person_identifier": ps["person_identifier"],
            "raw_person_id": ps["raw_person_id"],
            "tracking_id": ps["tracking_id"],
            "visit_count": v_count,
            "total_occupancy_seconds": round(tot_dur, 1),
            "formatted_total_occupancy": format_dwell_time(tot_dur),
            "average_dwell_seconds": round(avg_dur, 1),
            "formatted_average_dwell": format_dwell_time(avg_dur),
            "last_entry": ps["last_entry"].isoformat() if ps["last_entry"] else None,
            "is_inside": ps["is_inside"],
        })

    return {
        "summary": {
            "total_visits": total_visits,
            "active_occupants": active_occupants_count,
            "total_occupancy_seconds": round(total_occupancy_sec, 1),
            "formatted_total_occupancy": format_dwell_time(total_occupancy_sec),
            "average_dwell_seconds": round(avg_dwell_sec, 1),
            "formatted_average_dwell": format_dwell_time(avg_dwell_sec),
        },
        "per_zone": per_zone_metrics,
        "per_person": per_person_metrics,
    }


@router.get("/api/zone-analytics/visits")
async def get_zone_visits(
    camera_id: Optional[str] = Query(None),
    zone_id: Optional[str] = Query(None),
    person_identifier: Optional[str] = Query(None),
    tracking_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    """Fetch paginated historical zone visit logs."""
    query = db.query(ZoneVisitDB)

    if camera_id:
        query = query.filter(ZoneVisitDB.camera_id == str(camera_id))
    if zone_id:
        query = query.filter(ZoneVisitDB.zone_id == str(zone_id))
    if person_identifier:
        query = query.filter(ZoneVisitDB.person_identifier == str(person_identifier))
    if tracking_id:
        query = query.filter(ZoneVisitDB.tracking_id == str(tracking_id))

    total_count = query.count()
    rows = query.order_by(ZoneVisitDB.entry_time.desc()).offset(offset).limit(limit).all()

    # Zone metadata map
    zone_meta = {}
    zone_rows = db.query(CameraZoneDB).all()
    for zr in zone_rows:
        zone_meta[zr.zone_id] = {"name": zr.name, "color": zr.color}

    visits = []
    for r in rows:
        meta = zone_meta.get(r.zone_id, {"name": r.zone_id, "color": "#3B82F6"})
        dur = r.duration_seconds or (
            (datetime.utcnow() - r.entry_time).total_seconds() if not r.exit_time else 0.0
        )
        visits.append({
            "id": r.id,
            "camera_id": r.camera_id,
            "zone_id": r.zone_id,
            "zone_name": meta["name"],
            "zone_color": meta["color"],
            "tracking_id": r.tracking_id,
            "person_identifier": r.person_identifier,
            "entry_time": r.entry_time.isoformat() if r.entry_time else None,
            "exit_time": r.exit_time.isoformat() if r.exit_time else None,
            "duration_seconds": round(dur, 1) if dur else 0.0,
            "formatted_duration": format_dwell_time(dur) if dur else "00:00",
            "is_active": r.exit_time is None,
        })

    return {
        "total": total_count,
        "limit": limit,
        "offset": offset,
        "visits": visits,
    }
