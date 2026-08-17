import threading
import time
import json
import requests
from requests.auth import HTTPDigestAuth
import logging
import urllib3
import traceback
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Set

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

POLL_INTERVAL_SECONDS = 3  # How often to poll each door


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
        self.door_statuses = {}  # {ip: {"name": str, "status": str, "last_error": str | None}}
        self.is_running = False
        if auto_start:
            self.start_streams()

    def receive_event(self, payload: IdentityEventCreate) -> IdentityEvent:
        """
        Processes simulated or externally pushed identity events.
        """
        from ..models import IdentityEvent
        import uuid
        
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
            logger.info(f"Started poll listener for {name} ({ip})")

    def stop_streams(self):
        if not self.is_running:
            return
        self.is_running = False
        for se in self.stop_events:
            se.set()
        for t in self.threads:
            t.join(timeout=2.0)
        self.threads = []
        self.stop_events = []
        logger.info("All Hikvision poll listeners stopped.")

    # ------------------------------------------------------------------
    # Polling listener (replaces the old _stream_listener)
    # ------------------------------------------------------------------

    def _poll_listener(self, ip: str, name: str, username: str, password: str, stop_event: threading.Event):
        """
        Periodically queries POST /ISAPI/AccessControl/AcsEvent?format=json
        for new events since the last poll. This avoids the persistent
        connection limit (deployExceedMax) entirely.
        """
        url = f"https://{ip}/ISAPI/AccessControl/AcsEvent?format=json"
        auth = HTTPDigestAuth(username, password)

        # Track the last event time we processed to avoid duplicates.
        # We use a set of (timestamp, employeeNo) tuples seen in the last poll
        # to handle the boundary condition where events share the same second.
        last_poll_time: Optional[str] = None
        seen_event_keys: Set[str] = set()

        logger.info(f"[{name}] Starting AcsEvent poller (every {POLL_INTERVAL_SECONDS}s)")

        while not stop_event.is_set():
            try:
                now = datetime.now().astimezone()
                tz_offset = now.strftime("%z")  # e.g. "+0530"
                tz_formatted = tz_offset[:3] + ":" + tz_offset[3:]  # e.g. "+05:30"
                
                if last_poll_time is None:
                    # First poll: look back 30 seconds only to avoid flooding
                    begin = (now - timedelta(seconds=30)).strftime(f"%Y-%m-%dT%H:%M:%S{tz_formatted}")
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

                resp = requests.post(
                    url, auth=auth, data=body, verify=False, timeout=10,
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

                # Success — mark connected
                self.door_statuses[ip]["status"] = "Connected"
                self.door_statuses[ip]["last_error"] = None

                data = resp.json()
                total = data.get("AcsEvent", {}).get("totalMatches", 0)
                events_list = data.get("AcsEvent", {}).get("InfoList", [])

                new_seen_keys: Set[str] = set()
                new_events_count = 0

                for ev in events_list:
                    emp_id = (ev.get("employeeNoString") or "").strip()
                    major = ev.get("major", 0)
                    minor = ev.get("minor", 0)
                    ev_time = ev.get("time", "")
                    ev_name = ev.get("name", "")

                    # Build a unique key per event to avoid duplicates
                    event_key = f"{ev_time}|{emp_id}|{major}|{minor}"
                    new_seen_keys.add(event_key)

                    # Skip if we already processed this event in the previous poll
                    if event_key in seen_event_keys:
                        continue

                    # Only process access control events (major=5) with valid employee
                    if major != 5:
                        continue
                    
                    if minor not in VALID_MINOR_EVENTS:
                        continue

                    if not emp_id:
                        continue

                    new_events_count += 1
                    self._process_poll_event(emp_id, name, ev_time, ev_name, major, minor)

                # Update state for next poll
                seen_event_keys = new_seen_keys
                last_poll_time = begin  # Keep overlapping window to catch boundary events

                if new_events_count > 0:
                    logger.info(f"[{name}] Processed {new_events_count} new event(s)")

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
                traceback.print_exc()

            # Wait for next poll interval (interruptible by stop_event)
            stop_event.wait(POLL_INTERVAL_SECONDS)

    # ------------------------------------------------------------------
    # Process a single event from the AcsEvent poll response
    # ------------------------------------------------------------------

    def _process_poll_event(self, emp_id: str, gate_name: str, ev_time: str, ev_name: str, major: int, minor: int):
        """
        Process a single access control event from the AcsEvent JSON response.
        """
        try:
            logger.info(f"[{gate_name}] ✅ Access event: employee={emp_id} ({ev_name}), major={major}, minor={minor}, time={ev_time}")

            # Determine direction from gate name or door controller event
            is_exit = "out" in gate_name.lower()
            ev_type = "EXIT" if is_exit else "ENTRY"

            # Parse the event timestamp from the door controller
            try:
                # Hikvision format: 2026-07-13T12:56:02+05:30
                event_ts = datetime.fromisoformat(ev_time)
                event_ts_utc = event_ts.astimezone(timezone.utc)
            except (ValueError, TypeError):
                event_ts_utc = datetime.now(timezone.utc)

            # Match door configuration for allowed cameras & correlation window
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
            if matched_door:
                if ev_type == "EXIT":
                    allowed_cams = [str(c) for c in (matched_door.get("check_out_cameras") or [])]
                else:
                    allowed_cams = [str(c) for c in (matched_door.get("check_in_cameras") or [])]
                corr_window = float(matched_door.get("correlation_window_seconds") or 10.0)

            import uuid

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
            )

            # Register event with the correlation engine
            self.callback_engine.register_identity_event(event)

            if is_exit:
                logger.info(f"[{gate_name}] Registered EXIT for {emp_id} ({ev_name}) [Allowed check-out cams: {allowed_cams}]")
            else:
                logger.info(f"[{gate_name}] Registered ENTRY for {emp_id} ({ev_name}) [Allowed check-in cams: {allowed_cams}]")


        except Exception as e:
            logger.error(f"[{gate_name}] Error processing poll event: {e}")
            traceback.print_exc()
