"""
Polygon Evaluation & Validation Module.

Provides:
1. Point-in-polygon evaluation using Ray-Casting algorithm.
2. JSON configuration structure and coordinate validation.
3. Thread-safe cached polygon lookup per camera.
"""

from __future__ import annotations

import json
import re
import threading
from typing import Any, Dict, List, Optional, Tuple


def is_point_in_polygon(
    px: float,
    py: float,
    polygon: List[Tuple[float, float]],
    frame_width: Optional[int] = None,
    frame_height: Optional[int] = None,
) -> bool:
    """
    Ray-Casting algorithm to evaluate if point (px, py) lies inside polygon.

    Supports both normalized [0.0 - 1.0] and pixel-space coordinates.
    If polygon coordinates exceed 1.0 and frame dimensions (frame_width, frame_height)
    are provided, normalized (px, py) will be scaled accordingly.
    """
    if not polygon or len(polygon) < 3:
        return False

    # Check if polygon is in pixel coordinates
    max_poly_x = max(pt[0] for pt in polygon)
    max_poly_y = max(pt[1] for pt in polygon)
    is_pixel_poly = max_poly_x > 1.0 or max_poly_y > 1.0

    target_x = px
    target_y = py

    if is_pixel_poly:
        if px <= 1.0 and frame_width and frame_width > 0:
            target_x = px * frame_width
        if py <= 1.0 and frame_height and frame_height > 0:
            target_y = py * frame_height

    n = len(polygon)
    inside = False
    p1x, p1y = polygon[0]

    for i in range(n + 1):
        p2x, p2y = polygon[i % n]
        if target_y > min(p1y, p2y):
            if target_y <= max(p1y, p2y):
                if target_x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (target_y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    else:
                        xinters = p1x
                    if p1x == p2x or target_x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y

    return inside


def normalize_polygon_points(
    points: List[List[float]],
    frame_width: Optional[int] = None,
    frame_height: Optional[int] = None,
) -> List[Tuple[float, float]]:
    """Convert raw point list into a list of float tuples."""
    return [(float(pt[0]), float(pt[1])) for pt in points]


HEX_COLOR_REGEX = re.compile(r"^#(?:[0-9a-fA-F]{3}){1,2}$")


def validate_zone_config(raw_data: Any) -> Tuple[bool, str, List[Dict[str, Any]]]:
    """
    Validate zone configuration payload/JSON file.

    Returns:
        (is_valid: bool, error_message: str, parsed_zones: list[dict])
    """
    data = raw_data
    if isinstance(raw_data, (str, bytes)):
        try:
            data = json.loads(raw_data)
        except Exception as e:
            return False, f"Invalid JSON format: {str(e)}", []

    zones_list: List[Any] = []
    if isinstance(data, dict):
        if "zones" in data and isinstance(data["zones"], list):
            zones_list = data["zones"]
        elif "id" in data or "zone_id" in data:
            zones_list = [data]
        else:
            return False, "JSON object must contain a 'zones' array or camera zone object", []
    elif isinstance(data, list):
        zones_list = data
    else:
        return False, "Root JSON element must be an object or a list of zones", []

    if not zones_list:
        return False, "Zone configuration contains no zones", []

    seen_ids = set()
    validated_zones: List[Dict[str, Any]] = []

    for idx, raw_zone in enumerate(zones_list):
        if not isinstance(raw_zone, dict):
            return False, f"Zone entry at index {idx} must be a JSON object", []

        zone_id = str(raw_zone.get("id") or raw_zone.get("zone_id") or "").strip()
        if not zone_id:
            return False, f"Zone entry at index {idx} is missing required 'id' or 'zone_id'", []

        if zone_id in seen_ids:
            return False, f"Duplicate zone ID '{zone_id}' found in configuration", []
        seen_ids.add(zone_id)

        name = str(raw_zone.get("name") or f"Zone {zone_id}").strip()
        color = str(raw_zone.get("color") or "#3B82F6").strip()
        if not HEX_COLOR_REGEX.match(color):
            color = "#3B82F6"

        description = raw_zone.get("description")
        enabled = bool(raw_zone.get("enabled", True))

        points = raw_zone.get("points")
        if not points or not isinstance(points, list):
            return False, f"Zone '{zone_id}' must have a 'points' array", []

        if len(points) < 3:
            return False, f"Zone '{zone_id}' polygon must contain at least 3 points (found {len(points)})", []

        validated_points: List[List[float]] = []
        for pt_idx, pt in enumerate(points):
            if not isinstance(pt, (list, tuple)) or len(pt) < 2:
                return False, f"Point at index {pt_idx} in zone '{zone_id}' must contain 2 numeric coordinates [x, y]", []
            try:
                x = float(pt[0])
                y = float(pt[1])
                validated_points.append([x, y])
            except (ValueError, TypeError):
                return False, f"Point at index {pt_idx} in zone '{zone_id}' has invalid non-numeric coordinates", []

        validated_zones.append({
            "id": zone_id,
            "name": name,
            "color": color,
            "description": str(description) if description is not None else None,
            "points": validated_points,
            "enabled": enabled,
        })

    return True, "", validated_zones


class ZoneCache:
    """Thread-safe in-memory cache for camera zones."""

    def __init__(self) -> None:
        self._cache: Dict[str, List[Dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def get_zones(self, camera_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            return self._cache.get(str(camera_id), [])

    def set_zones(self, camera_id: str, zones: List[Dict[str, Any]]) -> None:
        with self._lock:
            self._cache[str(camera_id)] = zones

    def invalidate(self, camera_id: str) -> None:
        with self._lock:
            self._cache.pop(str(camera_id), None)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()


zone_cache = ZoneCache()
