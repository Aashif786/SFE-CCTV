"""Administrative configuration and operational observability endpoints."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .config_service import SpatialConfigurationError
from .engine import spatial_handoff_engine

router = APIRouter(prefix="/api/spatial-handoff", tags=["spatial-handoff"])


class LayoutPayload(BaseModel):
    facilities: list[dict[str, Any]]
    connections: list[dict[str, Any]] = []
    canvasPositions: dict[str, Any] = {}


@router.get("/configuration")
async def get_configuration():
    return spatial_handoff_engine.configuration.snapshot()


@router.put("/configuration")
async def put_configuration(payload: LayoutPayload):
    try:
        spatial_handoff_engine.configuration.replace(payload.model_dump() if hasattr(payload, "model_dump") else payload.dict())
    except SpatialConfigurationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return spatial_handoff_engine.configuration.snapshot()


@router.post("/configuration/reload")
async def reload_configuration():
    try:
        spatial_handoff_engine.configuration.reload()
    except SpatialConfigurationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"status": "reloaded", "configuration": spatial_handoff_engine.configuration.snapshot()}


@router.get("/status")
async def status():
    return {
        "cache_size": len(spatial_handoff_engine.cache.snapshot()),
        "pending_handoffs": [
            {"employee_id": r.employee_id, "origin_camera_id": r.origin_camera_id, "exit_portal_id": r.exit_portal_id,
             "timestamp": r.timestamp.isoformat()} for r in spatial_handoff_engine.cache.snapshot()
        ],
        "recent_events": spatial_handoff_engine.events[-50:],
    }
