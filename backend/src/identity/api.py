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
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .models import IdentityEventCreate, IdentityEvent, WorkerSession
from .provider.rest_provider import RESTSimulatorProvider
from .provider.hikvision_provider import HikvisionProvider
from .correlation import correlation_engine
from .session_manager import worker_session_manager
from ..db.database import get_db
from ..db.models import EmployeeDailySummary
from ..config import env_settings, config

router = APIRouter(prefix="/api/identity", tags=["identity"])

class DynamicProviderProxy:
    def __init__(self):
        self._current_provider = None
        self._provider_name = None
        self._is_started = False
        self.reload_provider()

    def reload_provider(self):
        target_name = getattr(config, "identity_provider", "REST_SIMULATOR")
        if self._provider_name == target_name and self._current_provider is not None:
            return

        print(f"[DynamicProviderProxy] Swapping provider: {self._provider_name} -> {target_name}")

        was_started = self._is_started
        if was_started:
            self.stop_streams()

        self._provider_name = target_name
        if target_name == "HIKVISION_ISAPI":
            self._current_provider = HikvisionProvider(callback_engine=correlation_engine, auto_start=False)
        else:
            self._current_provider = RESTSimulatorProvider()

        if was_started:
            self.start_streams()

    @property
    def door_statuses(self):
        if hasattr(self._current_provider, "door_statuses"):
            return self._current_provider.door_statuses
        return {}

    def start_streams(self):
        self._is_started = True
        if hasattr(self._current_provider, "start_streams"):
            self._current_provider.start_streams()

    def stop_streams(self):
        self._is_started = False
        if hasattr(self._current_provider, "stop_streams"):
            self._current_provider.stop_streams()

    def receive_event(self, payload):
        return self._current_provider.receive_event(payload)

_provider = DynamicProviderProxy()

@router.on_event("startup")
def startup_provider():
    _provider.start_streams()

@router.on_event("shutdown")
def shutdown_provider():
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


from ..zones.dwell_tracker import dwell_tracker, format_dwell_time

class ManualCorrelatePayload(BaseModel):
    track_id: str
    camera_id: str
    employee_id: str

def get_active_ai_camera_ids(db: Session) -> set[str]:
    """
    Returns set of camera IDs (as strings) that are active AI monitoring CCTV feeds.
    A camera feed is active if:
    1. Its RTSP stream in StreamManager is in ONLINE, STARTING, or RECONNECTING state, OR
    2. An active AI WebSocket stream is currently running for it (_active_ws_cameras).
    3. Fallback: Enabled cameras in Camera table if StreamManager has no streams initialized yet.
    """
    from ..cameras.stream_manager import stream_manager, StreamState
    from ..ws.ai_stream import _active_ws_cameras
    from ..db.models import Camera

    active_cids = set()

    # 1. Active RTSP streams in StreamManager
    for cid, cs in list(stream_manager._streams.items()):
        if cs.state in (StreamState.ONLINE, StreamState.STARTING, StreamState.RECONNECTING):
            active_cids.add(str(cid))

    # 2. Active AI WebSocket streams
    for cid in list(_active_ws_cameras):
        active_cids.add(str(cid))

    # 3. Fallback if no streams are active in StreamManager
    if not active_cids:
        enabled_cams = db.query(Camera).filter(Camera.enabled == True).all()
        for c in enabled_cams:
            active_cids.add(str(c.id))

    return active_cids


@router.get("/sessions", summary="Active worker sessions & live camera tracks")
async def get_active_sessions(db: Session = Depends(get_db)):
    """
    Returns all currently ACTIVE WorkerSessions AND all active live camera tracks
    strictly from active AI monitoring CCTV feeds.
    """
    active_cids = get_active_ai_camera_ids(db)

    # Filter active sessions to only include active AI monitoring CCTV feeds
    all_sessions = worker_session_manager.get_all_active()
    active_sessions = [s for s in all_sessions if str(s.camera_id) in active_cids]

    session_map = {s.current_track_id: s for s in active_sessions}

    # Fetch employee names from EmployeeDB
    emp_db_map = {}
    rows = db.query(EmployeeDB).all()
    for r in rows:
        emp_db_map[r.employee_id] = r.name

    # Fetch active zone visits across all cameras and filter strictly by active AI monitoring CCTV feeds
    all_visits = dwell_tracker.get_all_active_visits_detail(max_stale_seconds=15.0)
    active_visits = [v for v in all_visits if str(v["camera_id"]) in active_cids]

    out = []
    seen_track_keys = set()

    # 1. Process active zone visits
    for v in active_visits:
        cam_id = str(v["camera_id"])
        trk_id = str(v["track_id"])
        track_key = f"{cam_id}:{trk_id}"
        seen_track_keys.add(track_key)

        emp_id = v.get("person_identifier")
        session = session_map.get(trk_id)
        if not emp_id and session:
            emp_id = session.employee_id

        emp_name = emp_db_map.get(emp_id) if emp_id else None

        out.append({
            "session_id": session.session_id if session else f"track_{cam_id}_{trk_id}",
            "current_track_id": trk_id,
            "camera_id": cam_id,
            "employee_id": emp_id,
            "employee_name": emp_name,
            "is_correlated": bool(emp_id),
            "zone_id": v["zone_id"],
            "zone_name": v["zone_name"],
            "zone_color": v["zone_color"],
            "start_time": v["entry_time"],
            "dwell_seconds": v["dwell_seconds"],
            "formatted_dwell": v["formatted_dwell"],
            "correlation_delay_seconds": session.correlation_delay_seconds if session else 0.0,
            "status": "ACTIVE",
        })

    # 2. Process any active WorkerSession that wasn't in active_visits list
    for s in active_sessions:
        track_key = f"{s.camera_id}:{s.current_track_id}"
        if track_key not in seen_track_keys:
            seen_track_keys.add(track_key)
            emp_name = emp_db_map.get(s.employee_id)
            dwell_sec = max(0.0, (datetime.utcnow() - s.start_time).total_seconds())
            out.append({
                "session_id": s.session_id,
                "current_track_id": s.current_track_id,
                "camera_id": s.camera_id,
                "employee_id": s.employee_id,
                "employee_name": emp_name,
                "is_correlated": True,
                "zone_id": "outside",
                "zone_name": "On Camera",
                "zone_color": "#3B82F6",
                "start_time": s.start_time.isoformat(),
                "dwell_seconds": round(dwell_sec, 1),
                "formatted_dwell": format_dwell_time(dwell_sec),
                "correlation_delay_seconds": s.correlation_delay_seconds,
                "status": "ACTIVE",
            })

    return out

@router.post("/manual-correlate", summary="Manually correlate track ID to employee")
async def manual_correlate(payload: ManualCorrelatePayload, db: Session = Depends(get_db)):
    emp_id = payload.employee_id.strip()
    trk_id = str(payload.track_id).strip()
    cam_id = str(payload.camera_id).strip()

    if not emp_id or not trk_id:
        raise HTTPException(status_code=400, detail="employee_id and track_id are required")

    emp = db.query(EmployeeDB).filter(EmployeeDB.employee_id == emp_id).first()
    if not emp:
        emp = EmployeeDB(
            employee_id=emp_id,
            name=f"Employee {emp_id}",
            department="Operations",
            designation="Staff Specialist",
            is_tracked=True,
        )
        db.add(emp)
    else:
        emp.is_tracked = True
    db.commit()

    if emp_id not in config.tracked_employee_ids:
        config.tracked_employee_ids.append(emp_id)

    session = worker_session_manager.create_session(
        employee_id=emp_id,
        track_id=trk_id,
        camera_id=cam_id,
        correlation_delay=0.0
    )

    with dwell_tracker._lock:
        if cam_id in dwell_tracker._active_visits:
            if trk_id in dwell_tracker._active_visits[cam_id]:
                visit = dwell_tracker._active_visits[cam_id][trk_id]
                visit.person_identifier = emp_id
                dwell_tracker._update_person_identifier_in_db(visit.db_visit_id, emp_id)

    try:
        import uuid
        event = IdentityEvent(
            event_id=str(uuid.uuid4()),
            employee_id=emp_id,
            employee_name=emp.name,
            event_type="MANUAL_ENTRY",
            timestamp=datetime.utcnow(),
            entry_gate=f"Manual Check-in (Cam {cam_id})",
            provider="MANUAL_ASSIGNMENT",
            correlation_status="MATCHED",
            matched_track_id=trk_id,
            matched_at=datetime.utcnow(),
            correlation_delay_seconds=0.0
        )
        correlation_engine.register_identity_event(event)
    except Exception as e:
        print(f"⚠️ Error logging manual correlation event: {e}")

    return {
        "status": "success",
        "session_id": session.session_id if session else f"manual_{emp_id}_{trk_id}",
        "employee_id": emp_id,
        "employee_name": emp.name,
        "track_id": trk_id,
        "camera_id": cam_id,
    }


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
    Automatically switches to HIKVISION_ISAPI provider when doors are configured.
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

    # Auto-switch provider to HIKVISION_ISAPI when doors are configured,
    # and back to REST_SIMULATOR when all doors are removed.
    target_provider = "HIKVISION_ISAPI" if len(doors_list) > 0 else "REST_SIMULATOR"
    if config.identity_provider != target_provider:
        config.identity_provider = target_provider
        # Persist the provider change to settings.json
        settings_file = os.path.join(os.path.dirname(__file__), "..", "..", "settings.json")
        try:
            existing = {}
            if os.path.exists(settings_file):
                with open(settings_file, "r", encoding="utf-8") as f:
                    existing = json.load(f)
            existing["identity_provider"] = target_provider
            with open(settings_file, "w", encoding="utf-8") as f:
                json.dump(existing, f, indent=4)
        except Exception as e:
            print(f"[doors/config] Warning: failed to persist identity_provider to settings.json: {e}")

    # Reload provider (swaps to Hikvision if needed) and restart streams
    try:
        _provider.reload_provider()
        _provider.stop_streams()
        _provider.start_streams()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error restarting streams: {e}")

    return {"status": "success", "doors": env_settings.hikvision_doors}


# ---------------------------------------------------------------------------
# Employee Designated Work Zone Management & Productivity Endpoints
# ---------------------------------------------------------------------------

from ..db.models import EmployeeZoneDB

class EmployeeZoneAssignPayload(BaseModel):
    camera_id: str
    zone_id: str
    zone_name: Optional[str] = None
    is_designated: bool = True

@router.get("/employees/{employee_id}/zones", summary="Get designated work zones for an employee")
async def get_employee_zones(employee_id: str, db: Session = Depends(get_db)):
    rows = db.query(EmployeeZoneDB).filter(EmployeeZoneDB.employee_id == employee_id).all()
    return [
        {
            "id": r.id,
            "employee_id": r.employee_id,
            "camera_id": r.camera_id,
            "zone_id": r.zone_id,
            "zone_name": r.zone_name,
            "is_designated": r.is_designated,
        }
        for r in rows
    ]

@router.post("/employees/{employee_id}/zones", summary="Assign designated work zones to an employee")
async def assign_employee_zones(employee_id: str, payload: List[EmployeeZoneAssignPayload], db: Session = Depends(get_db)):
    # Clear existing assignments for this employee
    db.query(EmployeeZoneDB).filter(EmployeeZoneDB.employee_id == employee_id).delete()
    db.commit()

    new_rows = []
    for item in payload:
        r = EmployeeZoneDB(
            employee_id=employee_id,
            camera_id=item.camera_id,
            zone_id=item.zone_id,
            zone_name=item.zone_name,
            is_designated=item.is_designated,
        )
        db.add(r)
        new_rows.append(r)
    
    db.commit()
    return {"status": "success", "assigned_count": len(new_rows)}

@router.get("/productivity", summary="Get employee zone productivity metrics")
async def get_productivity_metrics(date: Optional[str] = None, db: Session = Depends(get_db)):
    query = db.query(EmployeeDailySummary)
    if date:
        try:
            target_date = datetime.strptime(date, "%Y-%m-%d").date()
            query = query.filter(EmployeeDailySummary.date == target_date)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")

    summaries = query.all()
    results = []
    for s in summaries:
        tot = s.total_seconds if s.total_seconds > 0 else 1.0
        # Calculate zone productivity score: (productive designated time / total time) * 100
        score = round((s.designated_zone_seconds / tot) * 100, 1) if s.designated_zone_seconds > 0 else (
            round((s.working_seconds / tot) * 100, 1) if s.working_seconds > 0 else 0.0
        )
        results.append({
            "employee_id": s.employee_id,
            "date": s.date.isoformat(),
            "working_seconds": s.working_seconds,
            "idle_seconds": s.idle_seconds,
            "walking_seconds": s.walking_seconds,
            "designated_zone_seconds": s.designated_zone_seconds,
            "outside_zone_seconds": s.outside_zone_seconds,
            "common_area_seconds": s.common_area_seconds,
            "break_seconds": s.break_seconds,
            "total_seconds": s.total_seconds,
            "productivity_score": score,
            "first_seen": s.first_seen.isoformat() if s.first_seen else None,
            "last_seen": s.last_seen.isoformat() if s.last_seen else None,
        })
    return results


# ---------------------------------------------------------------------------
# Employee Management & Tracking Endpoints (Hikvision Integration)
# ---------------------------------------------------------------------------

import os
import hmac
import base64
import hashlib
import requests
from requests.auth import HTTPDigestAuth
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

from ..db.models import EmployeeDB
from ..config import env_settings

class EmployeeCreatePayload(BaseModel):
    employee_id: str
    name: str
    department: Optional[str] = "Engineering"
    designation: Optional[str] = "Software Engineer"
    is_tracked: bool = True

class EmployeeTrackingTogglePayload(BaseModel):
    is_tracked: bool

def fetch_hikvision_employees_live() -> list[dict]:
    """
    Fetches real registered personnel from:
    1. Hikvision Door Controllers (ISAPI /ISAPI/AccessControl/UserInfo/Search)
    2. Hikvision Artemis OpenAPI Gateway (HIK_HOST/artemis HMAC-SHA256 AK/SK)
    """
    fetched_map = {}

    # 1. Query configured Hikvision Door Controllers via ISAPI
    doors = getattr(env_settings, "hikvision_doors", []) or [
        {"ip": "192.168.1.231", "name": "main Door"},
        {"ip": "192.168.1.232", "name": "Door 01 out"},
        {"ip": "192.168.1.233", "name": "Door 01 IN"},
        {"ip": "192.168.1.234", "name": "Door Exit IN"},
        {"ip": "192.168.1.235", "name": "Door Exit OUT"},
    ]
    username = getattr(env_settings, "hikvision_username", "admin")
    password = getattr(env_settings, "hikvision_password", "Caldim@2025")

    for door_cfg in doors:
        ip = door_cfg.get("ip")
        if not ip:
            continue

        position = 0
        while True:
            url = f"http://{ip}/ISAPI/AccessControl/UserInfo/Search?format=json"
            body = {
                "UserInfoSearchCond": {
                    "searchID": "1",
                    "searchResultPosition": position,
                    "maxResults": 100
                }
            }
            try:
                resp = requests.post(url, auth=HTTPDigestAuth(username, password), json=body, verify=False, timeout=1.5)
                if resp.status_code == 200:
                    data = resp.json().get("UserInfoSearch", {})
                    users = data.get("UserInfo", [])
                    if not users:
                        break
                    for u in users:
                        emp_no = (u.get("employeeNo") or "").strip()
                        name = (u.get("name") or "").strip()
                        if emp_no:
                            dept = "Engineering" if ("IT" in name.upper() or "CDE" in emp_no) else "Operations"
                            desig = "Technical Specialist" if "IT" in name.upper() else "Staff Specialist"
                            fetched_map[emp_no] = {
                                "employee_id": emp_no,
                                "name": name or f"Employee {emp_no}",
                                "department": dept,
                                "designation": desig
                            }
                    position += len(users)
                    if position >= data.get("totalMatches", 0):
                        break
                else:
                    break
            except Exception:
                break

        if len(fetched_map) > 0:
            break

    # 2. Query Hikvision Artemis OpenAPI Gateway if configured
    artemis_host = os.environ.get("HIK_HOST", "192.168.1.131")
    artemis_key = os.environ.get("HIK_KEY", "22619572")
    artemis_secret = os.environ.get("HIK_SECRET", "8FMcXfPPC8sgc3DqIhzi")

    if artemis_host and artemis_key and artemis_secret:
        uri = "/artemis/api/resource/v1/person/personList"
        sign_str = f"POST\n*/*\napplication/json\nx-ca-key:{artemis_key}\n{uri}"
        sig = base64.b64encode(hmac.new(artemis_secret.encode("utf-8"), sign_str.encode("utf-8"), hashlib.sha256).digest()).decode("utf-8")
        headers = {
            "Accept": "*/*",
            "Content-Type": "application/json",
            "x-ca-key": artemis_key,
            "x-ca-signature": sig,
            "x-ca-signature-headers": "x-ca-key"
        }
        url = f"https://{artemis_host}{uri}"
        try:
            r = requests.post(url, headers=headers, json={"pageNo": 1, "pageSize": 500}, verify=False, timeout=3)
            if r.status_code == 200 and r.json().get("code") == "0":
                persons = r.json().get("data", {}).get("list", [])
                for p in persons:
                    emp_no = (p.get("personId") or p.get("jobNo") or "").strip()
                    p_name = (p.get("personName") or "").strip()
                    dept_name = p.get("orgPath", "").split("/")[-1] or "Operations"
                    if emp_no:
                        fetched_map[emp_no] = {
                            "employee_id": emp_no,
                            "name": p_name or f"Employee {emp_no}",
                            "department": dept_name,
                            "designation": "Staff Specialist"
                        }
        except Exception:
            pass

    return list(fetched_map.values())


@router.get("/employees", summary="Get all managed employees")
async def get_all_employees(db: Session = Depends(get_db)):
    employees = db.query(EmployeeDB).all()

    # Auto-sync real Hikvision employees if DB contains no records or default seeds
    is_mock_only = not employees or any(e.employee_id in ["EMP001", "EMP002"] for e in employees)
    if is_mock_only:
        live_list = fetch_hikvision_employees_live()
        if live_list:
            db.query(EmployeeDB).filter(EmployeeDB.employee_id.in_(["EMP001", "EMP002", "EMP003", "EMP004", "EMP005", "EMP006", "EMP007", "EMP008"])).delete(synchronize_session=False)
            db.commit()

            for item in live_list:
                emp = db.query(EmployeeDB).filter(EmployeeDB.employee_id == item["employee_id"]).first()
                if not emp:
                    emp = EmployeeDB(
                        employee_id=item["employee_id"],
                        name=item["name"],
                        department=item["department"],
                        designation=item["designation"],
                        is_tracked=True,
                    )
                    db.add(emp)
                else:
                    emp.name = item["name"]
            db.commit()
            employees = db.query(EmployeeDB).all()

    # Get active sessions to check live status
    active_sessions = {s.employee_id: s for s in worker_session_manager.get_all_active()}

    # Get today's summaries
    today = datetime.utcnow().date()
    today_summaries = {s.employee_id for s in db.query(EmployeeDailySummary).filter(EmployeeDailySummary.date == today).all()}

    # Get assigned zones per employee
    all_zones = db.query(EmployeeZoneDB).all()
    zones_by_emp = {}
    for z in all_zones:
        zones_by_emp.setdefault(z.employee_id, []).append({
            "id": z.id,
            "camera_id": z.camera_id,
            "zone_id": z.zone_id,
            "zone_name": z.zone_name or z.zone_id,
        })

    out = []
    for e in employees:
        if e.employee_id in active_sessions:
            status = "ACTIVE"
        elif e.employee_id in today_summaries:
            status = "CHECKED_IN"
        else:
            status = "OFFLINE"

        assigned_z = zones_by_emp.get(e.employee_id, [])
        assigned_cams = list(dict.fromkeys(z["camera_id"] for z in assigned_z))

        out.append({
            "id": e.id,
            "employee_id": e.employee_id,
            "name": e.name,
            "department": e.department or "General",
            "designation": e.designation or "Staff",
            "is_tracked": e.is_tracked,
            "status": status,
            "assigned_zones": assigned_z,
            "assigned_cameras": assigned_cams,
        })
    return out

@router.post("/employees/sync", summary="Trigger live sync from Hikvision ACS")
async def sync_employees_from_hikvision(db: Session = Depends(get_db)):
    live_list = fetch_hikvision_employees_live()
    if not live_list:
        raise HTTPException(status_code=500, detail="Could not reach Hikvision door controllers or Artemis gateway")

    # Remove mock seeds
    db.query(EmployeeDB).filter(EmployeeDB.employee_id.in_(["EMP001", "EMP002", "EMP003", "EMP004", "EMP005", "EMP006", "EMP007", "EMP008"])).delete(synchronize_session=False)

    synced_count = 0
    for item in live_list:
        emp = db.query(EmployeeDB).filter(EmployeeDB.employee_id == item["employee_id"]).first()
        if not emp:
            emp = EmployeeDB(
                employee_id=item["employee_id"],
                name=item["name"],
                department=item["department"],
                designation=item["designation"],
                is_tracked=True,
            )
            db.add(emp)
        else:
            emp.name = item["name"]
        synced_count += 1

    db.commit()
    return {"status": "success", "synced_count": synced_count}

@router.post("/employees", summary="Create new employee")
async def create_employee(payload: EmployeeCreatePayload, db: Session = Depends(get_db)):
    existing = db.query(EmployeeDB).filter(EmployeeDB.employee_id == payload.employee_id).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Employee ID '{payload.employee_id}' already exists")

    emp = EmployeeDB(
        employee_id=payload.employee_id,
        name=payload.name,
        department=payload.department,
        designation=payload.designation,
        is_tracked=payload.is_tracked,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)

    if emp.is_tracked and emp.employee_id not in config.tracked_employee_ids:
        config.tracked_employee_ids.append(emp.employee_id)

    return {"status": "success", "employee": {
        "id": emp.id,
        "employee_id": emp.employee_id,
        "name": emp.name,
        "department": emp.department,
        "designation": emp.designation,
        "is_tracked": emp.is_tracked,
    }}

@router.put("/employees/{employee_id}/tracking", summary="Toggle tracking for employee")
async def toggle_employee_tracking(employee_id: str, payload: EmployeeTrackingTogglePayload, db: Session = Depends(get_db)):
    emp = db.query(EmployeeDB).filter(EmployeeDB.employee_id == employee_id).first()
    if not emp:
        emp = EmployeeDB(employee_id=employee_id, name=f"Employee {employee_id}", is_tracked=payload.is_tracked)
        db.add(emp)
    else:
        emp.is_tracked = payload.is_tracked

    db.commit()

    if payload.is_tracked:
        if employee_id not in config.tracked_employee_ids:
            config.tracked_employee_ids.append(employee_id)
    else:
        if employee_id in config.tracked_employee_ids:
            config.tracked_employee_ids.remove(employee_id)

    return {"status": "success", "employee_id": employee_id, "is_tracked": emp.is_tracked}

@router.delete("/employees/{employee_id}", summary="Delete employee")
async def delete_employee(employee_id: str, db: Session = Depends(get_db)):
    emp = db.query(EmployeeDB).filter(EmployeeDB.employee_id == employee_id).first()
    if emp:
        db.delete(emp)
    db.query(EmployeeZoneDB).filter(EmployeeZoneDB.employee_id == employee_id).delete()
    db.commit()

    if employee_id in config.tracked_employee_ids:
        config.tracked_employee_ids.remove(employee_id)

    return {"status": "success", "employee_id": employee_id}



