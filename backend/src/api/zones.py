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
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db.database import get_db
from ..db.models import CameraZoneDB, WorkstationZone, ZoneVisitDB
from ..state import invalidate_zone_cache
from ..zones.dwell_tracker import format_dwell_time
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
    """
    query = db.query(ZoneVisitDB)

    if camera_id:
        query = query.filter(ZoneVisitDB.camera_id == str(camera_id))
    if zone_id:
        query = query.filter(ZoneVisitDB.zone_id == str(zone_id))
    if person_identifier:
        query = query.filter(ZoneVisitDB.person_identifier == str(person_identifier))

    if start_date:
        try:
            dt_start = datetime.fromisoformat(start_date)
            query = query.filter(ZoneVisitDB.entry_time >= dt_start)
        except Exception:
            pass

    if end_date:
        try:
            dt_end = datetime.fromisoformat(end_date)
            query = query.filter(ZoneVisitDB.entry_time <= dt_end)
        except Exception:
            pass

    total_visits = query.count()

    # Calculate total duration seconds
    dur_query = query.filter(ZoneVisitDB.duration_seconds.isnot(None))
    total_occupancy_sec = dur_query.with_entities(func.sum(ZoneVisitDB.duration_seconds)).scalar() or 0.0
    avg_dwell_sec = (total_occupancy_sec / total_visits) if total_visits > 0 else 0.0

    # Fetch all configured zones from CameraZoneDB for this camera (or all cameras)
    zone_q = db.query(CameraZoneDB)
    if camera_id:
        zone_q = zone_q.filter(CameraZoneDB.camera_id == str(camera_id))
    all_configured_zones = zone_q.all()

    # Per Zone visit grouping from ZoneVisitDB
    zone_grouping = db.query(
        ZoneVisitDB.zone_id,
        func.count(ZoneVisitDB.id).label("visit_count"),
        func.sum(ZoneVisitDB.duration_seconds).label("total_duration"),
        func.avg(ZoneVisitDB.duration_seconds).label("avg_duration"),
    )
    if camera_id:
        zone_grouping = zone_grouping.filter(ZoneVisitDB.camera_id == str(camera_id))
    zone_grouping = zone_grouping.group_by(ZoneVisitDB.zone_id).all()

    visit_stats_map = {}
    for row in zone_grouping:
        visit_stats_map[row.zone_id] = {
            "visit_count": row.visit_count,
            "total_duration": row.total_duration or 0.0,
            "avg_duration": row.avg_duration or 0.0,
        }

    per_zone_metrics = []
    seen_zone_ids = set()

    # 1. Include all configured zones from CameraZoneDB
    for cz in all_configured_zones:
        seen_zone_ids.add(cz.zone_id)
        stats = visit_stats_map.get(cz.zone_id, {"visit_count": 0, "total_duration": 0.0, "avg_duration": 0.0})
        tot_dur = stats["total_duration"]
        avg_dur = stats["avg_duration"]
        per_zone_metrics.append({
            "zone_id": cz.zone_id,
            "zone_name": cz.name,
            "zone_color": cz.color,
            "visit_count": stats["visit_count"],
            "total_occupancy_seconds": round(tot_dur, 1),
            "formatted_total_occupancy": format_dwell_time(tot_dur),
            "average_dwell_seconds": round(avg_dur, 1),
            "formatted_average_dwell": format_dwell_time(avg_dur),
        })

    # 2. Include any historical zones from visits that might no longer be in CameraZoneDB
    for row in zone_grouping:
        if row.zone_id not in seen_zone_ids:
            tot_dur = row.total_duration or 0.0
            avg_dur = row.avg_duration or 0.0
            per_zone_metrics.append({
                "zone_id": row.zone_id,
                "zone_name": row.zone_id,
                "zone_color": "#3B82F6",
                "visit_count": row.visit_count,
                "total_occupancy_seconds": round(tot_dur, 1),
                "formatted_total_occupancy": format_dwell_time(tot_dur),
                "average_dwell_seconds": round(avg_dur, 1),
                "formatted_average_dwell": format_dwell_time(avg_dur),
            })

    # Per Person / Track breakdown for selected camera and zone
    person_label_expr = func.coalesce(
        ZoneVisitDB.person_identifier,
        'Track #' + ZoneVisitDB.tracking_id
    )

    person_grouping = db.query(
        person_label_expr.label("person_label"),
        ZoneVisitDB.tracking_id,
        ZoneVisitDB.person_identifier,
        func.count(ZoneVisitDB.id).label("visit_count"),
        func.sum(ZoneVisitDB.duration_seconds).label("total_duration"),
        func.avg(ZoneVisitDB.duration_seconds).label("avg_duration"),
        func.max(ZoneVisitDB.entry_time).label("last_entry"),
    )

    if camera_id:
        person_grouping = person_grouping.filter(ZoneVisitDB.camera_id == str(camera_id))
    if zone_id:
        person_grouping = person_grouping.filter(ZoneVisitDB.zone_id == str(zone_id))
    if start_date:
        try:
            dt_start = datetime.fromisoformat(start_date)
            person_grouping = person_grouping.filter(ZoneVisitDB.entry_time >= dt_start)
        except Exception:
            pass
    if end_date:
        try:
            dt_end = datetime.fromisoformat(end_date)
            person_grouping = person_grouping.filter(ZoneVisitDB.entry_time <= dt_end)
        except Exception:
            pass

    person_rows = person_grouping.group_by(
        person_label_expr,
        ZoneVisitDB.tracking_id,
        ZoneVisitDB.person_identifier,
    ).order_by(func.count(ZoneVisitDB.id).desc()).all()

    per_person_metrics = []
    for row in person_rows:
        tot_dur = row.total_duration or 0.0
        avg_dur = row.avg_duration or 0.0

        # Check if currently inside zone (open visit)
        active_check = db.query(ZoneVisitDB).filter(
            ZoneVisitDB.tracking_id == row.tracking_id,
            ZoneVisitDB.exit_time.is_(None),
        )
        if camera_id:
            active_check = active_check.filter(ZoneVisitDB.camera_id == str(camera_id))
        if zone_id:
            active_check = active_check.filter(ZoneVisitDB.zone_id == str(zone_id))

        is_inside = active_check.first() is not None

        per_person_metrics.append({
            "person_identifier": row.person_label,
            "raw_person_id": row.person_identifier,
            "tracking_id": row.tracking_id,
            "visit_count": row.visit_count,
            "total_occupancy_seconds": round(tot_dur, 1),
            "formatted_total_occupancy": format_dwell_time(tot_dur),
            "average_dwell_seconds": round(avg_dur, 1),
            "formatted_average_dwell": format_dwell_time(avg_dur),
            "last_entry": row.last_entry.isoformat() if row.last_entry else None,
            "is_inside": is_inside,
        })

    return {
        "summary": {
            "total_visits": total_visits,
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
