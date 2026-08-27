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
from typing import Optional, Dict, Set, Any, Union, Tuple

from .identity_provider import IdentityEventProvider
from ..models import IdentityEvent, IdentityEventCreate
from ...config import env_settings
from ...console import Console

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
VALID_MINOR_EVENTS: Set[int] = {1, 10, 38, 39, 40, 41, 49, 50, 75, 104, 105, 106}

# Comprehensive Event Code Mapping for Hikvision Access Control Terminals
HIKVISION_EVENT_MAP: Dict[Tuple[int, int], Tuple[str, bool]] = {
    (5, 1): ("Card Swipe (Authorized)", True),
    (5, 2): ("Card Swipe (Unauthorized)", False),
    (5, 21): ("Door Unlocked / Open by Switch", True),
    (5, 22): ("Door Locked / Closed", True),
    (5, 38): ("Card + Fingerprint Verify", True),
    (5, 39): ("Card + Password Verify", True),
    (5, 40): ("Fingerprint Verify", True),
    (5, 41): ("Fingerprint + Password", True),
    (5, 49): ("Card + Face Verify", True),
    (5, 50): ("Face + Fingerprint Verify", True),
    (5, 75): ("Face Recognition (Authorized)", True),
    (5, 76): ("Face Recognition (Failed)", False),
    (5, 104): ("Face Verification Success", True),
    (5, 105): ("Card Verification Success", True),
    (5, 106): ("Fingerprint Verification Success", True),
    (5, 107): ("Auth Failed (Mismatch/Invalid)", False),
    (5, 108): ("Door Contact Open", True),
    (5, 109): ("Door Contact Closed", True),
    (2, 38): ("Terminal Access Punch", True),
    (2, 1024): ("Terminal Heartbeat / Door Pulse", True),
}

# Fallback poll interval (seconds) - acts as safety net behind instant HTTP Webhook push
FALLBACK_POLL_INTERVAL_SECONDS = 10

# Maximum allowed event age (seconds) for real-time live correlation.
# Ignores device historical backlog dumps (punches from hours/days ago).
MAX_EVENT_AGE_SECONDS = 30.0


def _parse_device_timestamp(time_str: str) -> Tuple[datetime, str]:
    """
    Parses device timestamp string from Hikvision ACS.
    Returns (datetime_utc, formatted_string).
    """
    if not time_str:
        now_utc = datetime.now(timezone.utc)
        return now_utc, now_utc.strftime("%Y-%m-%d %H:%M:%S")

    clean_str = time_str.strip()
    try:
        dt = datetime.fromisoformat(clean_str)
        if dt.tzinfo is None:
            dt_utc = dt.replace(tzinfo=timezone.utc)
        else:
            dt_utc = dt.astimezone(timezone.utc)
        return dt_utc, clean_str
    except Exception:
        pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y%m%d%H%M%S"):
        try:
            dt = datetime.strptime(clean_str, fmt)
            dt_utc = dt.replace(tzinfo=timezone.utc)
            return dt_utc, clean_str
        except Exception:
            continue

    now_utc = datetime.now(timezone.utc)
    return now_utc, clean_str


def _format_event_log(
    device_time: str,
    real_time: datetime,
    emp_id: str,
    emp_name: str,
    gate_name: str,
    device_ip: str,
    direction: str,
    auth_type: str,
    major: int,
    minor: int,
    is_granted: bool,
    source: str,
    offset_s: Optional[float] = None,
    card_no: str = "",
    serial_no: str = ""
) -> str:
    """Constructs a high-visibility structured log string for Hikvision ACS punches."""
    real_time_local = real_time.astimezone().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
    offset_str = f" (Δ: {offset_s:+.2f}s)" if offset_s is not None else ""
    status_str = "✅ GRANTED" if is_granted else "❌ DENIED"
    card_str = f" | Card: {card_no}" if (card_no and card_no != emp_id and card_no != "N/A") else ""
    serial_str = f" | Seq: #{serial_no}" if serial_no else ""

    return (
        f"[HIKVISION ACS] 🕒 ACS Device Time: {device_time} | "
        f"⏱️ Real Actual Time: {real_time_local}{offset_str} | "
        f"👤 {emp_name} (ID: {emp_id}{card_str}) | "
        f"🚪 {gate_name} ({device_ip}) | "
        f"🚶 {direction} | "
        f"🔑 {auth_type} [{major}:{minor}] | "
        f"{status_str} | "
        f"📡 {source}{serial_str}"
    )


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
        now_actual = datetime.now(timezone.utc)
        event = IdentityEvent(
            event_id=str(uuid.uuid4()),
            employee_id=payload.employee_id,
            event_type=payload.event_type,
            timestamp=payload.timestamp or now_actual,
            device_event_time=payload.timestamp.isoformat() if payload.timestamp else now_actual.strftime("%Y-%m-%d %H:%M:%S"),
            received_at=now_actual,
            time_offset_seconds=0.0,
            auth_type="API Manual Scan",
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
        received_at = datetime.now(timezone.utc)
        try:
            parsed = self._extract_event_info(raw_data)
            if not parsed:
                return {"statusCode": 1, "statusString": "Ignored: Non-access event"}

            emp_id = parsed.get("employee_id", "").strip()
            emp_name = parsed.get("employee_name", "").strip() or "Unknown"
            card_no = parsed.get("card_no", "").strip()
            serial_no = parsed.get("serial_no", "").strip()
            major = parsed.get("major", 5)
            minor = parsed.get("minor", 75)
            ev_time = parsed.get("time", "")
            device_name = parsed.get("device_name", "")
            device_ip = parsed.get("ip", "") or client_ip

            # Validate access event
            if major != 5 and major != 0 and major != 2:
                return {"statusCode": 1, "statusString": "Ignored: Non-access control major code"}

            if minor and minor not in VALID_MINOR_EVENTS:
                return {"statusCode": 1, "statusString": f"Ignored: Minor event {minor} not in valid whitelist"}

            if not emp_id and not card_no:
                return {"statusCode": 1, "statusString": "Ignored: Missing employee ID"}

            effective_id = emp_id if emp_id and emp_id != "N/A" else (card_no or "UNKNOWN")

            # Parse device timestamp and compute time offset
            ev_dt_utc, ev_time_str = _parse_device_timestamp(ev_time)
            offset_seconds = (received_at - ev_dt_utc).total_seconds()

            # Check timestamp age to avoid processing historical backlogged events
            if abs(offset_seconds) > MAX_EVENT_AGE_SECONDS:
                return {"statusCode": 1, "statusString": "OK: Acknowledged historical event"}

            # Resolve matching door config and auth mode
            gate_name = self._resolve_door_name(device_ip, device_name)
            is_exit = "out" in gate_name.lower() or "exit" in gate_name.lower()
            direction = "EXIT" if is_exit else "ENTRY"

            auth_desc, is_granted = HIKVISION_EVENT_MAP.get((major, minor), (f"Access Event [{major}:{minor}]", True))

            # Output formatted ACS terminal row
            Console.acs(
                timestamp=ev_time,
                status="GRANTED" if is_granted else "DENIED",
                direction=direction,
                emp_id=effective_id,
                emp_name=emp_name,
                card_no=card_no,
                door=f"{gate_name} ({device_ip})",
                auth_type=auth_desc,
                major=major,
                minor=minor,
            )

            self._process_event(
                emp_id=effective_id,
                gate_name=gate_name,
                ev_time=ev_time_str,
                ev_name=emp_name,
                major=major,
                minor=minor,
                provider_source="HIKVISION_WEBHOOK",
                card_no=card_no,
                serial_no=serial_no,
                auth_type=auth_desc,
                received_at=received_at,
                time_offset_seconds=offset_seconds,
                access_granted=is_granted,
            )

            return {"statusCode": 1, "statusString": "OK", "employee_id": effective_id, "gate": gate_name}

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
        acs = data.get("AccessControllerEvent") or data.get("AcsEvent") or data.get("EventNotificationAlert") or data
        emp_id = str(acs.get("employeeNoString") or acs.get("employeeNo") or acs.get("cardNo") or "")
        emp_name = str(acs.get("name") or acs.get("employeeName") or acs.get("userName") or "")
        card_no = str(acs.get("cardNo") or acs.get("cardReaderNo") or "")
        major = int(acs.get("majorEventType") or acs.get("major") or data.get("majorEventType") or 5)
        minor = int(acs.get("subEventType") or acs.get("minor") or data.get("subEventType") or 0)
        ev_time = str(acs.get("time") or acs.get("dateTime") or data.get("dateTime") or "")
        device_name = str(acs.get("deviceName") or data.get("deviceName") or "")
        device_ip = str(data.get("ipAddress") or acs.get("ipAddress") or "")
        serial_no = str(acs.get("serialNo") or acs.get("eventID") or "")

        return {
            "employee_id": emp_id,
            "employee_name": emp_name,
            "card_no": card_no,
            "major": major,
            "minor": minor,
            "time": ev_time,
            "device_name": device_name,
            "ip": device_ip,
            "serial_no": serial_no,
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
        emp_name = find_text("name") or find_text("employeeName") or find_text("userName")
        card_no = find_text("cardNo")
        major_str = find_text("majorEventType") or find_text("major")
        major = int(major_str) if major_str.isdigit() else 5
        minor_str = find_text("subEventType") or find_text("minor")
        minor = int(minor_str) if minor_str.isdigit() else 0
        ev_time = find_text("time") or find_text("dateTime")
        device_name = find_text("deviceName")
        device_ip = find_text("ipAddress")
        serial_no = find_text("serialNo") or find_text("eventID")

        return {
            "employee_id": emp_id,
            "employee_name": emp_name,
            "card_no": card_no,
            "major": major,
            "minor": minor,
            "time": ev_time,
            "device_name": device_name,
            "ip": device_ip,
            "serial_no": serial_no,
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
                    poll_received_at = datetime.now(timezone.utc)

                    for ev in events_list:
                        emp_id = (ev.get("employeeNoString") or str(ev.get("employeeNo") or "")).strip()
                        card_no = str(ev.get("cardNo") or "")
                        serial_no = str(ev.get("serialNo") or "")
                        major = int(ev.get("major", 0))
                        minor = int(ev.get("minor", 0))
                        ev_time = ev.get("time", "")
                        ev_name = ev.get("name", "") or "Unknown"

                        event_key = f"{ev_time}|{emp_id}|{card_no}|{major}|{minor}|{serial_no}"
                        new_seen_keys.add(event_key)

                        if event_key in seen_event_keys:
                            continue

                        if major != 5 or minor not in VALID_MINOR_EVENTS or (not emp_id and not card_no):
                            continue

                        effective_id = emp_id if emp_id and emp_id != "N/A" else card_no

                        # Parse device timestamp and compute time offset
                        ev_dt_utc, ev_time_str = _parse_device_timestamp(ev_time)
                        offset_seconds = (poll_received_at - ev_dt_utc).total_seconds()

                        # Age check: Skip historical events
                        if abs(offset_seconds) > MAX_EVENT_AGE_SECONDS:
                            continue

                        is_exit = "out" in name.lower() or "exit" in name.lower()
                        direction = "EXIT" if is_exit else "ENTRY"
                        auth_desc, is_granted = HIKVISION_EVENT_MAP.get((major, minor), (f"Access Event [{major}:{minor}]", True))

                        Console.acs(
                            timestamp=ev_time,
                            status="GRANTED" if is_granted else "DENIED",
                            direction=direction,
                            emp_id=effective_id,
                            emp_name=ev_name,
                            card_no=card_no,
                            door=f"{name} ({ip})",
                            auth_type=auth_desc,
                            major=major,
                            minor=minor,
                        )

                        self._process_event(
                            emp_id=effective_id,
                            gate_name=name,
                            ev_time=ev_time_str,
                            ev_name=ev_name,
                            major=major,
                            minor=minor,
                            provider_source="HIKVISION_POLL",
                            card_no=card_no,
                            serial_no=serial_no,
                            auth_type=auth_desc,
                            received_at=poll_received_at,
                            time_offset_seconds=offset_seconds,
                            access_granted=is_granted,
                        )

                    seen_event_keys = new_seen_keys
                    last_poll_time = begin

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

    def _process_event(
        self,
        emp_id: str,
        gate_name: str,
        ev_time: str,
        ev_name: str,
        major: int,
        minor: int,
        provider_source: str = "HIKVISION",
        card_no: str = "",
        serial_no: str = "",
        auth_type: str = "",
        received_at: Optional[datetime] = None,
        time_offset_seconds: Optional[float] = None,
        access_granted: bool = True,
    ):
        """
        Process an access control event and dispatch directly to the correlation engine.
        """
        try:
            is_exit = "out" in gate_name.lower() or "exit" in gate_name.lower()
            ev_type = "EXIT" if is_exit else "ENTRY"

            event_ts_utc, _ = _parse_device_timestamp(ev_time)
            now_actual = received_at or datetime.now(timezone.utc)

            # Drop stale events from historical replay
            age = (now_actual - event_ts_utc).total_seconds()
            if abs(age) > MAX_EVENT_AGE_SECONDS:
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
                device_event_time=ev_time,
                received_at=now_actual,
                time_offset_seconds=time_offset_seconds if time_offset_seconds is not None else round(age, 3),
                auth_type=auth_type or "Access Verification",
                major_event=major,
                minor_event=minor,
                serial_no=serial_no,
                card_no=card_no,
                access_granted=access_granted,
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

        except Exception as e:
            logger.error(f"[{gate_name}] Error processing event: {e}")
            traceback.print_exc()
