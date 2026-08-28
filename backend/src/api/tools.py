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


# ---------------------------------------------------------------------------
# Punch Latency Benchmark Endpoints (Zero-UI error, computed on backend)
# ---------------------------------------------------------------------------

from pydantic import BaseModel


class LatencyDryRunRequest(BaseModel):
    simulated_latency_ms: Optional[float] = 145.0
    door_name: Optional[str] = "Front Turnstile (Test Dry-Run)"
    device_ip: Optional[str] = "192.168.1.231"
    employee_id: Optional[str] = "TEST_USER"
    employee_name: Optional[str] = "Test Employee"


@router.get("/api/tools/latency/status", summary="Get punch latency stats and latest punches")
async def get_latency_status():
    """
    Returns punch latency benchmark stats, latest monitored punch, and recent punch history.
    Calculated with microsecond precision directly on the backend.
    """
    from ..identity.latency_monitor import latency_monitor
    return latency_monitor.get_stats()


@router.get("/api/tools/latency/wait", summary="Wait for the next live punch on backend")
async def wait_for_punch(timeout: float = 60.0):
    """
    Asynchronously suspends the connection until a live punch is received from an ACS device.
    Calculates latency on backend arrival time:
        latency_ms = (system_receipt_time - device_timestamp) * 1000.0
    Zero UI latency overhead.
    """
    from ..identity.latency_monitor import latency_monitor
    punch = await latency_monitor.wait_for_next_punch(timeout=max(1.0, min(timeout, 300.0)))
    if punch is None:
        return {
            "status": "timeout",
            "message": f"No punch received within {timeout}s. Still listening.",
            "data": None,
        }
    return {
        "status": "success",
        "message": "Punch captured!",
        "data": punch,
    }


@router.post("/api/tools/latency/test", summary="Dry-run latency test without database writes")
async def test_punch_latency(payload: Optional[LatencyDryRunRequest] = None):
    """
    Performs a safe zero-DB dry-run latency test to verify UI and benchmark metrics
    WITHOUT inserting any rows into SQLite DB or creating worker sessions.
    """
    from datetime import datetime, timezone, timedelta
    from ..identity.latency_monitor import latency_monitor

    req = payload or LatencyDryRunRequest()
    sim_ms = float(req.simulated_latency_ms if req.simulated_latency_ms is not None else 145.0)
    now_actual = datetime.now(timezone.utc)
    dev_ts = now_actual - timedelta(milliseconds=sim_ms)

    record = latency_monitor.record_punch(
        device_timestamp_raw=dev_ts.strftime("%Y-%m-%d %H:%M:%S"),
        device_timestamp_utc=dev_ts,
        received_at_utc=now_actual,
        latency_ms=sim_ms,
        employee_id=req.employee_id or "TEST_USER",
        employee_name=req.employee_name or "Test Employee",
        card_no="99998888",
        door_name=req.door_name or "Test Reader (Zero-DB)",
        device_ip=req.device_ip or "192.168.1.231",
        auth_type="Simulated Card Swipe",
        source="DRY_RUN_TEST",
        direction="ENTRY",
        access_granted=True,
        major=5,
        minor=1,
        is_dry_run=True,
    )
    return {
        "status": "success",
        "message": "Dry-run test recorded. Zero DB impact.",
        "data": record,
    }


@router.post("/api/tools/latency/clear", summary="Clear punch latency history")
async def clear_latency_history():
    """Clears the in-memory latency history and counters."""
    from ..identity.latency_monitor import latency_monitor
    latency_monitor.clear()
    return {"status": "success", "message": "Latency history cleared"}
