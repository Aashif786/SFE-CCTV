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


@router.get("/portals")
async def get_portals():
    """Return all portals configured in spatial layout with their pathway topology roles."""
    config = spatial_handoff_engine.configuration
    raw = config.snapshot()
    portals_list = []
    for facility in raw.get("facilities", []):
        fac_id = facility.get("id", "")
        for cam in facility.get("cameras", []):
            cam_id = str(cam.get("id", ""))
            for p in cam.get("portals", []):
                local_id = str(p.get("id", ""))
                portal_id = f"{fac_id}:{cam_id}:{local_id}"
                has_out = bool(config.outgoing(portal_id))
                has_in = bool(config.incoming(portal_id))
                role = "TRANSIT" if (has_out and has_in) else ("START" if has_out else ("END" if has_in else "STANDALONE"))
                portals_list.append({
                    "id": portal_id,
                    "facility_id": fac_id,
                    "camera_id": cam_id,
                    "local_id": local_id,
                    "role": role,
                    "has_outgoing": has_out,
                    "has_incoming": has_in,
                })
    return portals_list
