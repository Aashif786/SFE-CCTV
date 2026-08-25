import threading
import time
import json
import xml.etree.ElementTree as ET
import requests
from requests.auth import HTTPDigestAuth
import logging
import urllib3
import traceback
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Set, Any, Union

from .identity_provider import IdentityEventProvider
from ..models import IdentityEvent, IdentityEventCreate
from ...config import env_settings

# Suppress insecure request warnings for self-signed certs
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

logger = logging.getLogger("HikvisionProvider")
logger.setLevel(logging.INFO)
if not logger.handlers:
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    logger.addHandler(ch)

# Valid minor event codes that represent a successful access
# 1 = Card swipe success, 75 = Face recognition success, 104 = Face+Card combined
VALID_MINOR_EVENTS: Set[int] = {1, 10, 38, 39, 40, 41, 49, 50, 75, 104}

# Fallback poll interval (seconds) - acts as safety net behind instant HTTP Webhook push
FALLBACK_POLL_INTERVAL_SECONDS = 10

# Maximum allowed event age (seconds) for real-time live correlation.
# Ignores device historical backlog dumps (punches from hours/days ago).
MAX_EVENT_AGE_SECONDS = 30.0


class HikvisionProvider(IdentityEventProvider):
    PROVIDER_NAME = "HIKVISION_ISAPI"

    def __init__(self, callback_engine, auto_start=True):
        """
        callback_engine must have a register_identity_event(event) method.
        Usually this is correlation_engine.
        """
        self.callback_engine = callback_engine
        self.threads = []
        self.stop_events = []
        self.sessions = []
        self.door_statuses = {}  # {ip: {"name": str, "status": str, "last_error": str | None}}
        self.is_running = False
        if auto_start:
            self.start_streams()

    def receive_event(self, payload: IdentityEventCreate) -> IdentityEvent:
        """
        Processes simulated or externally pushed identity events.
        """
        allowed = [str(c) for c in payload.allowed_cameras] if payload.allowed_cameras else []
        event = IdentityEvent(
            event_id=str(uuid.uuid4()),
            employee_id=payload.employee_id,
            event_type=payload.event_type,
            timestamp=payload.timestamp or datetime.now(timezone.utc).replace(tzinfo=None),
            entry_gate=payload.entry_gate,
            provider=self.PROVIDER_NAME,
            correlation_status="WAITING_FOR_TRACK",
            allowed_cameras=allowed,
            correlation_window_seconds=payload.correlation_window_seconds,
        )
        return event

    def start_streams(self):
        if self.is_running:
            logger.info("Hikvision poll listeners are already running. Skipping duplicate start.")
            return

        doors = env_settings.hikvision_doors
        if not doors:
            logger.warning("No Hikvision doors configured in HIKVISION_DOORS")
            return

        self.is_running = True
        self.door_statuses = {}
        for door_cfg in doors:
            ip = door_cfg.get("ip")
            name = door_cfg.get("name", f"Door-{ip}")
            username = door_cfg.get("username") or env_settings.hikvision_username
            password = door_cfg.get("password") or env_settings.hikvision_password

            self.door_statuses[ip] = {
                "name": name,
                "status": "Disconnected",
                "last_error": None
            }

            stop_event = threading.Event()
            self.stop_events.append(stop_event)

            t = threading.Thread(
                target=self._poll_listener,
                args=(ip, name, username, password, stop_event),
                daemon=True,
                name=f"HikvisionPoll-{name}"
            )
            t.start()
            self.threads.append(t)
            logger.info(f"Started safety-net poll listener for {name} ({ip})")

    def stop_streams(self):
        if not self.is_running:
            return
        self.is_running = False
        for se in self.stop_events:
            se.set()
        for t in self.threads:
            t.join(timeout=2.0)
        for s in self.sessions:
            try:
                s.close()
            except Exception:
                pass
        self.threads = []
        self.stop_events = []
        self.sessions = []
        logger.info("All Hikvision listeners stopped.")

    # ------------------------------------------------------------------
    # HTTP Webhook Push Handler (Instant <20ms execution)
    # ------------------------------------------------------------------

    def process_webhook_payload(self, raw_data: Union[dict, str, bytes], client_ip: str = "") -> dict:
        """
        Parses incoming real-time HTTP Push events from Hikvision terminals
        (JSON, XML, or multipart form fields) and registers them with correlation_engine immediately.
        """
        try:
            parsed = self._extract_event_info(raw_data)
            if not parsed:
                return {"statusCode": 1, "statusString": "Ignored: Non-access event"}

            emp_id = parsed.get("employee_id", "").strip()
            emp_name = parsed.get("employee_name", "").strip()
            major = parsed.get("major", 5)
            minor = parsed.get("minor", 0)
            ev_time = parsed.get("time", "")
            device_name = parsed.get("device_name", "")
            device_ip = parsed.get("ip", "") or client_ip

            # Validate access event
            if major != 5 and major != 0:
                return {"statusCode": 1, "statusString": "Ignored: Non-access control major code"}

            if minor and minor not in VALID_MINOR_EVENTS:
                return {"statusCode": 1, "statusString": f"Ignored: Minor event {minor} not in valid whitelist"}

            if not emp_id:
                return {"statusCode": 1, "statusString": "Ignored: Missing employee ID"}

            # Check timestamp age to avoid processing historical backlogged events
            if ev_time:
                try:
                    ev_dt = datetime.fromisoformat(ev_time)
                    ev_dt_utc = ev_dt.astimezone(timezone.utc)
                    age = (datetime.now(timezone.utc) - ev_dt_utc).total_seconds()
                    if age > MAX_EVENT_AGE_SECONDS:
                        # Acknowledge without queuing or printing logs
                        return {"statusCode": 1, "statusString": "OK: Acknowledged historical event"}
                except Exception:
                    pass

            # Resolve matching door config
            gate_name = self._resolve_door_name(device_ip, device_name)
            logger.info(f"[WEBHOOK PUSH] Instant Punch received from {gate_name} ({device_ip}): Employee {emp_id} ({emp_name})")

            self._process_event(emp_id, gate_name, ev_time, emp_name, major, minor, provider_source="HIKVISION_WEBHOOK")

            return {"statusCode": 1, "statusString": "OK", "employee_id": emp_id, "gate": gate_name}

        except Exception as e:
            logger.error(f"[WEBHOOK PUSH] Error processing webhook payload: {e}")
            traceback.print_exc()
            return {"statusCode": 0, "statusString": f"Error: {str(e)}"}

    def _extract_event_info(self, raw_data: Union[dict, str, bytes]) -> Optional[dict]:
        """Extract employee_id, name, major, minor, time, and device name from raw data."""
        if isinstance(raw_data, bytes):
            raw_data = raw_data.decode("utf-8", errors="ignore")

        # Handle Dict directly
        if isinstance(raw_data, dict):
            return self._parse_json_dict(raw_data)

        if isinstance(raw_data, str):
            trimmed = raw_data.strip()
            if trimmed.startswith("{") or trimmed.startswith("["):
                try:
                    data = json.loads(trimmed)
                    return self._parse_json_dict(data)
                except Exception:
                    pass

            if trimmed.startswith("<"):
                try:
                    return self._parse_xml_string(trimmed)
                except Exception:
                    pass

        return None

    def _parse_json_dict(self, data: dict) -> dict:
        acs = data.get("AccessControllerEvent") or data.get("AcsEvent") or data
        emp_id = str(acs.get("employeeNoString") or acs.get("employeeNo") or acs.get("cardNo") or "")
        emp_name = str(acs.get("name") or acs.get("employeeName") or "")
        major = int(acs.get("majorEventType") or acs.get("major") or data.get("majorEventType") or 5)
        minor = int(acs.get("subEventType") or acs.get("minor") or data.get("subEventType") or 0)
        ev_time = str(acs.get("time") or acs.get("dateTime") or data.get("dateTime") or "")
        device_name = str(acs.get("deviceName") or data.get("deviceName") or "")
        device_ip = str(data.get("ipAddress") or "")

        return {
            "employee_id": emp_id,
            "employee_name": emp_name,
            "major": major,
            "minor": minor,
            "time": ev_time,
            "device_name": device_name,
            "ip": device_ip,
        }

    def _parse_xml_string(self, xml_text: str) -> dict:
        root = ET.fromstring(xml_text)
        
        def find_text(tag_name):
            for el in root.iter():
                if el.tag.split("}")[-1].lower() == tag_name.lower():
                    if el.text and el.text.strip():
                        return el.text.strip()
            return ""

        emp_id = find_text("employeeNoString") or find_text("employeeNo") or find_text("cardNo")
        emp_name = find_text("name") or find_text("employeeName")
        major_str = find_text("majorEventType") or find_text("major")
        major = int(major_str) if major_str.isdigit() else 5
        minor_str = find_text("subEventType") or find_text("minor")
        minor = int(minor_str) if minor_str.isdigit() else 0
        ev_time = find_text("time") or find_text("dateTime")
        device_name = find_text("deviceName")
        device_ip = find_text("ipAddress")

        return {
            "employee_id": emp_id,
            "employee_name": emp_name,
            "major": major,
            "minor": minor,
            "time": ev_time,
            "device_name": device_name,
            "ip": device_ip,
        }

    def _resolve_door_name(self, ip: str, name: str) -> str:
        ip_clean = (ip or "").strip()
        name_clean = (name or "").lower().strip()
        for d in env_settings.hikvision_doors:
            d_ip = (d.get("ip") or "").strip()
            d_name = (d.get("name") or "").lower().strip()
            if (ip_clean and ip_clean == d_ip) or (name_clean and (name_clean == d_name or d_name in name_clean)):
                return d.get("name") or f"Door-{d_ip}"
        return name or (f"Door-{ip_clean}" if ip_clean else "Door-Unknown")

    # ------------------------------------------------------------------
    # Persistent Session Polling listener (Safety-net fallback)
    # ------------------------------------------------------------------

    def _poll_listener(self, ip: str, name: str, username: str, password: str, stop_event: threading.Event):
        """
        Periodically queries POST /ISAPI/AccessControl/AcsEvent?format=json
        using a persistent requests.Session() with HTTP keep-alive.
        Acts as a safety-net background fallback behind instant HTTP push.
        """
        url = f"https://{ip}/ISAPI/AccessControl/AcsEvent?format=json"
        
        session = requests.Session()
        session.auth = HTTPDigestAuth(username, password)
        session.verify = False
        self.sessions.append(session)

        last_poll_time: Optional[str] = None
        seen_event_keys: Set[str] = set()

        logger.info(f"[{name}] Safety-net AcsEvent poller started (every {FALLBACK_POLL_INTERVAL_SECONDS}s)")

        try:
            while not stop_event.is_set():
                try:
                    now = datetime.now().astimezone()
                    tz_offset = now.strftime("%z")
                    tz_formatted = tz_offset[:3] + ":" + tz_offset[3:]
                    
                    if last_poll_time is None:
                        begin = (now - timedelta(seconds=20)).strftime(f"%Y-%m-%dT%H:%M:%S{tz_formatted}")
                    else:
                        begin = last_poll_time

                    end = now.strftime(f"%Y-%m-%dT%H:%M:%S{tz_formatted}")

                    body = json.dumps({
                        "AcsEventCond": {
                            "searchID": "1",
                            "searchResultPosition": 0,
                            "maxResults": 50,
                            "major": 0,
                            "minor": 0,
                            "startTime": begin,
                            "endTime": end
                        }
                    })

                    resp = session.post(
                        url, data=body, timeout=8,
                        headers={"Content-Type": "application/json"}
                    )

                    if resp.status_code == 401:
                        err_msg = "Unauthorized (Invalid Credentials)"
                        logger.error(f"[{name}] {err_msg}")
                        self.door_statuses[ip]["status"] = "Error"
                        self.door_statuses[ip]["last_error"] = err_msg
                        stop_event.wait(15)
                        continue

                    if resp.status_code != 200:
                        err_msg = f"HTTP {resp.status_code}"
                        logger.error(f"[{name}] Poll failed: {err_msg}")
                        self.door_statuses[ip]["status"] = "Error"
                        self.door_statuses[ip]["last_error"] = err_msg
                        stop_event.wait(5)
                        continue

                    self.door_statuses[ip]["status"] = "Connected"
                    self.door_statuses[ip]["last_error"] = None

                    data = resp.json()
                    events_list = data.get("AcsEvent", {}).get("InfoList", [])

                    new_seen_keys: Set[str] = set()
                    new_events_count = 0

                    for ev in events_list:
                        emp_id = (ev.get("employeeNoString") or str(ev.get("employeeNo") or "")).strip()
                        major = ev.get("major", 0)
                        minor = ev.get("minor", 0)
                        ev_time = ev.get("time", "")
                        ev_name = ev.get("name", "")

                        event_key = f"{ev_time}|{emp_id}|{major}|{minor}"
                        new_seen_keys.add(event_key)

                        if event_key in seen_event_keys:
                            continue

                        if major != 5 or minor not in VALID_MINOR_EVENTS or not emp_id:
                            continue

                        # Age check: Skip historical events
                        if ev_time:
                            try:
                                ev_dt = datetime.fromisoformat(ev_time)
                                ev_dt_utc = ev_dt.astimezone(timezone.utc)
                                if (datetime.now(timezone.utc) - ev_dt_utc).total_seconds() > MAX_EVENT_AGE_SECONDS:
                                    continue
                            except Exception:
                                pass

                        new_events_count += 1
                        self._process_event(emp_id, name, ev_time, ev_name, major, minor, provider_source="HIKVISION_POLL")

                    seen_event_keys = new_seen_keys
                    last_poll_time = begin

                    if new_events_count > 0:
                        logger.info(f"[{name}] Safety-net poller processed {new_events_count} event(s)")

                except requests.exceptions.ConnectionError as e:
                    err_msg = f"Connection refused ({ip})"
                    logger.warning(f"[{name}] {err_msg}")
                    self.door_statuses[ip]["status"] = "Error"
                    self.door_statuses[ip]["last_error"] = err_msg
                except requests.exceptions.Timeout:
                    err_msg = "Request timeout"
                    logger.warning(f"[{name}] {err_msg}")
                    self.door_statuses[ip]["status"] = "Error"
                    self.door_statuses[ip]["last_error"] = err_msg
                except Exception as e:
                    err_msg = str(e)
                    logger.error(f"[{name}] Unexpected poll error: {err_msg}")
                    self.door_statuses[ip]["status"] = "Error"
                    self.door_statuses[ip]["last_error"] = err_msg

                stop_event.wait(FALLBACK_POLL_INTERVAL_SECONDS)
        finally:
            session.close()

    # ------------------------------------------------------------------
    # Unified Event Processor (for both Webhook and Polling)
    # ------------------------------------------------------------------

    def _process_event(self, emp_id: str, gate_name: str, ev_time: str, ev_name: str, major: int, minor: int, provider_source: str = "HIKVISION"):
        """
        Process an access control event and dispatch directly to the correlation engine.
        """
        try:
            is_exit = "out" in gate_name.lower()
            ev_type = "EXIT" if is_exit else "ENTRY"

            try:
                event_ts = datetime.fromisoformat(ev_time)
                event_ts_utc = event_ts.astimezone(timezone.utc)
            except (ValueError, TypeError):
                event_ts_utc = datetime.now(timezone.utc)

            # Drop stale events from historical replay
            age = (datetime.now(timezone.utc) - event_ts_utc).total_seconds()
            if age > MAX_EVENT_AGE_SECONDS:
                return

            matched_door = None
            gate_clean = gate_name.lower().strip()
            for d in env_settings.hikvision_doors:
                d_name = (d.get("name") or "").lower().strip()
                d_ip = (d.get("ip") or "").lower().strip()
                if gate_clean == d_name or gate_clean == d_ip or d_name in gate_clean:
                    matched_door = d
                    break

            allowed_cams = []
            corr_window = 10.0
            portal_id = ""
            portal_role = "AUTO"
            if matched_door:
                allowed_cams = [str(c) for c in (matched_door.get("cameras") or [])]
                corr_window = float(matched_door.get("correlation_window_seconds") or 10.0)
                portal_id = matched_door.get("portal_id") or ""
                portal_role = matched_door.get("portal_role") or "AUTO"

            event = IdentityEvent(
                event_id=str(uuid.uuid4()),
                employee_id=emp_id,
                employee_name=ev_name,
                event_type=ev_type,
                timestamp=event_ts_utc,
                entry_gate=gate_name,
                provider=self.PROVIDER_NAME,
                correlation_status="WAITING_FOR_TRACK",
                allowed_cameras=allowed_cams,
                correlation_window_seconds=corr_window,
                portal_id=portal_id,
                portal_role=portal_role,
            )

            # Instantly register event with the correlation engine
            self.callback_engine.register_identity_event(event)

            direction = "EXIT" if is_exit else "ENTRY"
            logger.info(f"[{gate_name}] Registered {direction} for {emp_id} ({ev_name}) via {provider_source}")

        except Exception as e:
            logger.error(f"[{gate_name}] Error processing event: {e}")
            traceback.print_exc()
