"""
Network Device Scanner — discovers cameras, door controllers, and other
devices on the local network that are not yet configured in CALVISION.

Uses TCP port probing on common ports:
  - Port 554  (RTSP)   → likely a camera
  - Port 80/443 (HTTP) → could be camera web UI or door controller ISAPI
  - Port 8000  (HTTP)  → some IP cameras serve on 8000

For Hikvision devices, attempts an ISAPI device info request to identify
the device type (camera vs. door controller) and extract metadata.
"""

from __future__ import annotations

import socket
import ipaddress
import threading
import time
import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Optional

import requests
from requests.auth import HTTPDigestAuth

logger = logging.getLogger("NetworkScanner")
logger.setLevel(logging.INFO)

# Ports to probe
RTSP_PORT = 554
HTTP_PORTS = [80, 443, 8000, 8080]
DOOR_ISAPI_PORTS = [80, 443]

# Timeouts
TCP_TIMEOUT = 0.8   # seconds per port probe
HTTP_TIMEOUT = 3.0  # seconds for ISAPI identification


@dataclass
class DiscoveredDevice:
    ip: str
    open_ports: list[int] = field(default_factory=list)
    device_type: str = "Unknown"          # Camera | Door Controller | Network Device
    brand: str = "Unknown"
    model: str = ""
    serial: str = ""
    firmware: str = ""
    mac: str = ""
    hostname: str = ""
    already_configured: bool = False
    configured_as: str = ""               # "camera" | "door" | ""
    configured_name: str = ""


def get_local_subnet() -> str:
    """Detect the local IP and derive a /24 subnet."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
        s.close()
        # Derive /24 subnet
        parts = local_ip.split(".")
        return f"{parts[0]}.{parts[1]}.{parts[2]}.0/24"
    except Exception:
        return "192.168.1.0/24"


def _probe_port(ip: str, port: int, timeout: float = TCP_TIMEOUT) -> bool:
    """Check if a TCP port is open on the given IP."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        result = sock.connect_ex((ip, port))
        sock.close()
        return result == 0
    except Exception:
        return False


def _identify_hikvision(ip: str, port: int = 80) -> Optional[dict]:
    """
    Try to identify a Hikvision device via ISAPI /System/deviceInfo.
    Returns device metadata dict or None.
    """
    protocol = "https" if port == 443 else "http"
    url = f"{protocol}://{ip}:{port}/ISAPI/System/deviceInfo"

    try:
        # Try unauthenticated first
        resp = requests.get(url, timeout=HTTP_TIMEOUT, verify=False)
        if resp.status_code == 401:
            # Try default credentials
            resp = requests.get(
                url,
                auth=HTTPDigestAuth("admin", ""),
                timeout=HTTP_TIMEOUT,
                verify=False,
            )

        if resp.status_code == 200:
            text = resp.text
            info = {}
            # Parse XML fields
            for tag in ["deviceName", "deviceID", "model", "serialNumber",
                        "macAddress", "firmwareVersion", "deviceType"]:
                start = text.find(f"<{tag}>")
                end = text.find(f"</{tag}>")
                if start != -1 and end != -1:
                    info[tag] = text[start + len(tag) + 2 : end]

            return info
        # Even a 401 tells us it's a Hikvision device
        if resp.status_code == 401 and "Digest" in resp.headers.get("WWW-Authenticate", ""):
            return {"deviceType": "unknown_hikvision", "auth_required": True}
    except Exception:
        pass
    return None


def _try_identify_device(ip: str, open_ports: list[int]) -> dict:
    """
    Try to identify a device by probing ISAPI endpoints.
    Returns metadata dict with device_type, brand, model, etc.
    """
    result = {"device_type": "Network Device", "brand": "Unknown", "model": "", "serial": "", "firmware": "", "mac": ""}

    # Try Hikvision ISAPI on HTTP ports
    for port in [80, 443, 8080]:
        if port in open_ports:
            hik_info = _identify_hikvision(ip, port)
            if hik_info:
                result["brand"] = "Hikvision"
                dev_type = hik_info.get("deviceType", "").lower()
                dev_name = hik_info.get("deviceName", "").lower()
                model = hik_info.get("model", "")

                # Identify by device type or model prefix
                if any(kw in dev_type for kw in ["access", "door", "acs"]):
                    result["device_type"] = "Door Controller"
                elif any(kw in dev_type for kw in ["ipc", "camera", "ipcamera", "dvr", "nvr"]):
                    result["device_type"] = "Camera"
                elif any(kw in model.upper() for kw in ["DS-K", "K1T", "K2"]):
                    # DS-K series = access control
                    result["device_type"] = "Door Controller"
                elif any(kw in model.upper() for kw in ["DS-2", "DS-2CD", "IPC"]):
                    result["device_type"] = "Camera"
                elif RTSP_PORT in open_ports:
                    result["device_type"] = "Camera"
                elif hik_info.get("auth_required"):
                    # Hikvision but can't determine type — guess by ports
                    result["device_type"] = "Camera" if RTSP_PORT in open_ports else "Door Controller"
                else:
                    result["device_type"] = "Camera" if RTSP_PORT in open_ports else "Hikvision Device"

                result["model"] = hik_info.get("model", "")
                result["serial"] = hik_info.get("serialNumber", "")
                result["firmware"] = hik_info.get("firmwareVersion", "")
                result["mac"] = hik_info.get("macAddress", "")
                return result

    # Fallback: classify by open ports
    if RTSP_PORT in open_ports:
        result["device_type"] = "Camera"
    elif 80 in open_ports or 443 in open_ports:
        result["device_type"] = "Network Device"

    return result


def scan_network(
    subnet: Optional[str] = None,
    configured_camera_ips: set[str] | None = None,
    configured_door_ips: set[str] | None = None,
    configured_camera_names: dict[str, str] | None = None,
    configured_door_names: dict[str, str] | None = None,
    progress_callback=None,
) -> list[dict]:
    """
    Scan the subnet for devices with relevant open ports.
    Cross-references with already-configured cameras and doors.
    
    Args:
        subnet: CIDR notation subnet to scan (e.g. "192.168.1.0/24")
        configured_camera_ips: set of IPs already configured as cameras
        configured_door_ips: set of IPs already configured as doors
        configured_camera_names: dict of IP -> camera name
        configured_door_names: dict of IP -> door name
        progress_callback: callable(scanned, total) for progress updates
    
    Returns:
        List of discovered device dicts
    """
    if subnet is None:
        subnet = get_local_subnet()

    configured_camera_ips = configured_camera_ips or set()
    configured_door_ips = configured_door_ips or set()
    configured_camera_names = configured_camera_names or {}
    configured_door_names = configured_door_names or {}

    try:
        network = ipaddress.ip_network(subnet, strict=False)
    except ValueError:
        logger.error(f"Invalid subnet: {subnet}")
        return []

    hosts = [str(ip) for ip in network.hosts()]
    all_ports = list(set([RTSP_PORT] + HTTP_PORTS))
    discovered = []
    scanned_count = 0

    def scan_host(ip: str) -> Optional[DiscoveredDevice]:
        nonlocal scanned_count
        open_ports = []
        for port in all_ports:
            if _probe_port(ip, port):
                open_ports.append(port)

        scanned_count += 1
        if progress_callback:
            progress_callback(scanned_count, len(hosts))

        if not open_ports:
            return None

        # Identify the device
        meta = _try_identify_device(ip, open_ports)

        device = DiscoveredDevice(
            ip=ip,
            open_ports=sorted(open_ports),
            device_type=meta["device_type"],
            brand=meta["brand"],
            model=meta["model"],
            serial=meta["serial"],
            firmware=meta["firmware"],
            mac=meta["mac"],
        )

        # Check if already configured
        if ip in configured_camera_ips:
            device.already_configured = True
            device.configured_as = "camera"
            device.configured_name = configured_camera_names.get(ip, "")
        elif ip in configured_door_ips:
            device.already_configured = True
            device.configured_as = "door"
            device.configured_name = configured_door_names.get(ip, "")

        return device

    # Scan with thread pool (high concurrency for port scanning)
    with ThreadPoolExecutor(max_workers=50) as executor:
        futures = {executor.submit(scan_host, ip): ip for ip in hosts}
        for future in as_completed(futures):
            try:
                device = future.result()
                if device:
                    discovered.append(device)
            except Exception as e:
                logger.warning(f"Error scanning {futures[future]}: {e}")

    # Sort: unconfigured first, then by IP
    discovered.sort(key=lambda d: (d.already_configured, d.ip))

    return [
        {
            "ip": d.ip,
            "open_ports": d.open_ports,
            "device_type": d.device_type,
            "brand": d.brand,
            "model": d.model,
            "serial": d.serial,
            "firmware": d.firmware,
            "mac": d.mac,
            "hostname": d.hostname,
            "already_configured": d.already_configured,
            "configured_as": d.configured_as,
            "configured_name": d.configured_name,
        }
        for d in discovered
    ]
