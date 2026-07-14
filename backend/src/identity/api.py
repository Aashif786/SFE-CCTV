"""
FastAPI router for the Identity Management module.

Endpoints
---------
POST /api/identity/entry        — Simulate an RFID/NFC/QR scan (REST provider)
GET  /api/identity/sessions     — Active WorkerSessions (named employees on-camera)
GET  /api/identity/pending      — Unmatched IdentityEvents (waiting for a track)
GET  /api/identity/history      — All matched + expired identity events

To swap to a real hardware provider, replace RESTSimulatorProvider with
your new provider class. No other change is needed.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.orm import Session

from .models import IdentityEventCreate, IdentityEvent, WorkerSession
from .provider.rest_provider import RESTSimulatorProvider
from .provider.hikvision_provider import HikvisionProvider
from .correlation import correlation_engine
from .session_manager import worker_session_manager
from ..db.database import get_db
from ..db.models import EmployeeDailySummary
from ..config import env_settings

router = APIRouter(prefix="/api/identity", tags=["identity"])

# Active provider — swap this line to use RFID, NFC, MQTT, etc.
# _provider = RESTSimulatorProvider()
_provider = HikvisionProvider(callback_engine=correlation_engine, auto_start=False)

@router.on_event("startup")
def startup_provider():
    if hasattr(_provider, "start_streams"):
        _provider.start_streams()

@router.on_event("shutdown")
def shutdown_provider():
    if hasattr(_provider, "stop_streams"):
        _provider.stop_streams()



# ---------------------------------------------------------------------------
# POST /api/identity/entry — simulate an identity scan
# ---------------------------------------------------------------------------

@router.post("/entry", summary="Register a worker entry scan")
async def register_entry(payload: IdentityEventCreate):
    """
    Simulate a physical identity scan (RFID, NFC, QR, etc.).

    The `timestamp` field is optional — if omitted the server UTC time is used.

    Example body:
    ```json
    {
      "employeeId": "EMP001",
      "entryGate": "Gate-A"
    }
    ```

    The event is queued for correlation with the next camera detection.
    """
    event: IdentityEvent = _provider.receive_event(payload)
    correlation_engine.register_identity_event(event)
    return {
        "status": "queued",
        "event_id": event.event_id,
        "employee_id": event.employee_id,
        "entry_gate": event.entry_gate,
        "timestamp": event.timestamp.isoformat(),
        "provider": event.provider,
        "correlation_status": event.correlation_status,
    }


# ---------------------------------------------------------------------------
# GET /api/identity/sessions — active named sessions
# ---------------------------------------------------------------------------

@router.get("/sessions", summary="Active worker sessions")
async def get_active_sessions():
    """
    Returns all currently ACTIVE WorkerSessions.
    Each entry maps a named employee to their current camera track.
    """
    sessions = worker_session_manager.get_all_active()
    return [_session_to_dict(s) for s in sessions]


# ---------------------------------------------------------------------------
# GET /api/identity/pending — unmatched events
# ---------------------------------------------------------------------------

@router.get("/pending", summary="Unmatched identity events")
async def get_pending_events():
    """
    Returns identity events that have been received but not yet matched
    to a camera track. These are awaiting a new person to appear in frame.
    """
    events = correlation_engine.get_pending()
    return [_event_to_dict(e) for e in events]


# ---------------------------------------------------------------------------
# GET /api/identity/history — matched + expired events
# ---------------------------------------------------------------------------

@router.get("/history", summary="Identity event history")
async def get_identity_history():
    """
    Returns all identity events that have been resolved (MATCHED or EXPIRED)
    during the current server session.
    """
    events = correlation_engine.get_history()
    return [_event_to_dict(e) for e in events]


# ---------------------------------------------------------------------------
# GET /api/identity/sessions/history — closed worker sessions
# ---------------------------------------------------------------------------

@router.get("/sessions/history", summary="Closed worker sessions")
async def get_session_history():
    """
    Returns WorkerSessions that have been closed (person left the frame).
    """
    sessions = worker_session_manager.get_history()
    return [_session_to_dict(s) for s in sessions]


# ---------------------------------------------------------------------------
# GET /api/identity/employees/daily — daily summary per employee
# ---------------------------------------------------------------------------

@router.get("/employees/daily", summary="Employee daily summary")
async def get_employee_daily_summary(db: Session = Depends(get_db), date: Optional[str] = None):
    """
    Returns aggregated daily time tracking (working, idle, walking, mobile)
    and check-in metadata per employee for the specified date (defaults to today).
    """
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        target_date = datetime.utcnow().date()
        
    summaries = db.query(EmployeeDailySummary).filter(EmployeeDailySummary.date == target_date).all()
    
    return [
        {
            "employee_id": s.employee_id,
            "date": s.date.isoformat(),
            "working_seconds": s.working_seconds,
            "idle_seconds": s.idle_seconds,
            "walking_seconds": s.walking_seconds,
            "total_seconds": s.total_seconds,
            "check_in_count": s.check_in_count,
            "first_seen": s.first_seen.isoformat() if s.first_seen else None,
            "last_seen": s.last_seen.isoformat() if s.last_seen else None,
        }
        for s in summaries
    ]

# ---------------------------------------------------------------------------
# DELETE /api/identity/employees/daily — delete daily summary for an employee on a date
# ---------------------------------------------------------------------------

@router.delete("/employees/daily", summary="Delete employee daily summary")
async def delete_employee_daily_summary(
    employee_id: str,
    date: str,
    db: Session = Depends(get_db)
):
    """
    Deletes the aggregated daily summary for a specific employee on a specific date.
    """
    try:
        target_date = datetime.strptime(date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
        
    summary = db.query(EmployeeDailySummary).filter(
        EmployeeDailySummary.employee_id == employee_id,
        EmployeeDailySummary.date == target_date
    ).first()
    
    if not summary:
        raise HTTPException(status_code=404, detail="Summary not found")
        
    db.delete(summary)
    db.commit()
    return {"status": "deleted", "employee_id": employee_id, "date": date}


# ---------------------------------------------------------------------------
# Serialisation helpers
# ---------------------------------------------------------------------------

def _event_to_dict(e: IdentityEvent) -> dict:
    return {
        "event_id": e.event_id,
        "employee_id": e.employee_id,
        "employee_name": e.employee_name,
        "event_type": e.event_type,
        "timestamp": e.timestamp.isoformat(),
        "entry_gate": e.entry_gate,
        "provider": e.provider,
        "correlation_status": e.correlation_status,
        "matched_track_id": e.matched_track_id,
        "matched_at": e.matched_at.isoformat() if e.matched_at else None,
        "correlation_delay_seconds": e.correlation_delay_seconds,
    }


def _session_to_dict(s: WorkerSession) -> dict:
    return {
        "session_id": s.session_id,
        "employee_id": s.employee_id,
        "current_track_id": s.current_track_id,
        "camera_id": s.camera_id,
        "start_time": s.start_time.isoformat(),
        "end_time": s.end_time.isoformat() if s.end_time else None,
        "status": s.status,
        "correlation_delay_seconds": s.correlation_delay_seconds,
    }


@router.get("/doors", summary="Get door controller connection statuses")
async def get_doors():
    """
    Returns the list of configured doors and their live stream connection statuses.
    """
    if hasattr(_provider, "door_statuses"):
        return [
            {"ip": ip, "name": info["name"], "status": info["status"], "last_error": info["last_error"]}
            for ip, info in _provider.door_statuses.items()
        ]
    return []


import os
import json
from pydantic import BaseModel, Field
from typing import List

class DoorConfigItem(BaseModel):
    ip: str
    name: str
    username: str = "admin"
    password: str = ""

@router.get("/doors/config", summary="Get doors configurations")
async def get_doors_config():
    """
    Returns the list of configured doors (including credentials).
    """
    return env_settings.hikvision_doors

@router.post("/doors/config", summary="Save doors configurations")
async def save_doors_config(payload: List[DoorConfigItem]):
    """
    Saves a new list of doors configurations to doors.json, reloads the environment configuration,
    and restarts the provider streams to apply the changes immediately.
    """
    doors_list = [item.dict() for item in payload]
    doors_file = os.path.join(os.path.dirname(__file__), "..", "..", "doors.json")
    try:
        with open(doors_file, "w", encoding="utf-8") as f:
            json.dump(doors_list, f, indent=2)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write doors.json: {e}")

    # Reload the configuration in memory
    env_settings.reload_doors()

    # Restart streams to apply changes
    if hasattr(_provider, "stop_streams") and hasattr(_provider, "start_streams"):
        try:
            _provider.stop_streams()
            _provider.start_streams()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error restarting streams: {e}")

    return {"status": "success", "doors": env_settings.hikvision_doors}


