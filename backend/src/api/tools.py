"""
Network Scanner API — discover unconfigured devices on the local network.

Endpoints
---------
POST /api/tools/scan           — start a network scan (async)
GET  /api/tools/scan/status    — poll scan progress
GET  /api/tools/scan/results   — get discovered devices
GET  /api/tools/subnet         — get auto-detected subnet
"""

from __future__ import annotations

import threading
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db.database import get_db
from ..db.models import Camera
from ..config import env_settings
from ..network_scanner import scan_network, get_local_subnet

router = APIRouter(tags=["tools"])

# Module-level scan state
_scan_in_progress = False
_scan_results: list[dict] = []
_scan_progress: dict = {"scanned": 0, "total": 0, "status": "idle"}


@router.post("/api/tools/scan", summary="Scan network for devices")
async def start_network_scan(
    subnet: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    Trigger a network scan to discover cameras, door controllers, and other
    devices on the local subnet. Cross-references with already-configured
    devices to highlight unconfigured ones.
    """
    global _scan_in_progress, _scan_results, _scan_progress

    if _scan_in_progress:
        return {"status": "already_running", "progress": _scan_progress}

    # Gather already-configured IPs
    cameras = db.query(Camera).all()
    camera_ips = {c.ip_address for c in cameras}
    camera_names = {c.ip_address: c.name for c in cameras}

    door_configs = env_settings.hikvision_doors or []
    door_ips = {d["ip"] for d in door_configs}
    door_names = {d["ip"]: d["name"] for d in door_configs}

    target_subnet = subnet or get_local_subnet()
    _scan_progress = {"scanned": 0, "total": 0, "status": "scanning", "subnet": target_subnet}
    _scan_in_progress = True
    _scan_results = []

    def progress_cb(scanned: int, total: int) -> None:
        _scan_progress["scanned"] = scanned
        _scan_progress["total"] = total

    def run_scan() -> None:
        global _scan_in_progress, _scan_results, _scan_progress
        try:
            results = scan_network(
                subnet=target_subnet,
                configured_camera_ips=camera_ips,
                configured_door_ips=door_ips,
                configured_camera_names=camera_names,
                configured_door_names=door_names,
                progress_callback=progress_cb,
            )
            _scan_results = results
            _scan_progress["status"] = "complete"
        except Exception as e:
            _scan_progress["status"] = f"error: {str(e)}"
        finally:
            _scan_in_progress = False

    t = threading.Thread(target=run_scan, daemon=True, name="NetworkScanner")
    t.start()

    return {"status": "started", "subnet": target_subnet}


@router.get("/api/tools/scan/status", summary="Get scan progress")
async def get_scan_status():
    """Returns the current scan progress and status."""
    return {
        "in_progress": _scan_in_progress,
        "progress": _scan_progress,
    }


@router.get("/api/tools/scan/results", summary="Get scan results")
async def get_scan_results():
    """Returns the results of the last network scan."""
    return {
        "in_progress": _scan_in_progress,
        "progress": _scan_progress,
        "devices": _scan_results,
    }


@router.get("/api/tools/subnet", summary="Get detected subnet")
async def get_subnet():
    """Returns the auto-detected local subnet."""
    return {"subnet": get_local_subnet()}
