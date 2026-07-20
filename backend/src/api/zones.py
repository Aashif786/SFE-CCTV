"""
Workstation Zone API — per-camera zone CRUD with cache invalidation.

Endpoints
---------
GET    /api/zones/{camera_id}   — read zone (defaults to full frame)
POST   /api/zones/{camera_id}   — create/update zone
DELETE /api/zones/{camera_id}   — reset zone to default
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db.database import get_db
from ..db.models import WorkstationZone
from ..state import invalidate_zone_cache

router = APIRouter(tags=["zones"])


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
    invalidate_zone_cache(camera_id)  # so next frame picks up new zone
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
