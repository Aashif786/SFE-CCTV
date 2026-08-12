"""Facility layout configuration loading, validation, and atomic replacement."""

from __future__ import annotations

import json
import shutil
import threading
from pathlib import Path
from typing import Any

from .models import Portal, PortalConnection


class SpatialConfigurationError(ValueError):
    pass


class SpatialConfigurationService:
    """Owns a complete facility layout; connections live at the top level."""

    def __init__(self, path: Path | None = None) -> None:
        backend_dir = Path(__file__).resolve().parents[2]
        self._path = path or backend_dir / "spatial_handoff.json"
        self._example_path = backend_dir / "spatial_handoff.example.json"
        self._lock = threading.RLock()
        self._raw: dict[str, Any] = {"facilities": [], "connections": []}
        self._portals: dict[str, Portal] = {}
        self._connections: dict[str, PortalConnection] = {}
        self.reload()

    @property
    def path(self) -> Path:
        return self._path

    def reload(self) -> None:
        with self._lock:
            if not self._path.exists() and self._example_path.exists():
                shutil.copyfile(self._example_path, self._path)
            if not self._path.exists():
                self._replace({"facilities": [], "connections": []})
                return
            try:
                self._replace(json.loads(self._path.read_text(encoding="utf-8")))
            except json.JSONDecodeError as exc:
                raise SpatialConfigurationError(f"Invalid spatial_handoff.json: {exc}") from exc

    def replace(self, raw: dict[str, Any], persist: bool = True) -> None:
        with self._lock:
            self._replace(raw)  # Validate before altering the on-disk source of truth.
            if persist:
                self._path.write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self._raw))

    def portal(self, portal_id: str) -> Portal | None:
        with self._lock:
            return self._portals.get(portal_id)

    def portals_for_camera(self, camera_id: str) -> tuple[Portal, ...]:
        with self._lock:
            requested = str(camera_id)
            direct = tuple(p for p in self._portals.values() if p.camera_id == requested and p.enabled)
            if direct:
                return direct
            # Legacy streams supply only a DB camera ID. Permit that only when
            # it resolves to one facility; ambiguity must never yield a match.
            matches = tuple(p for p in self._portals.values() if p.camera_id.rsplit(":", 1)[-1] == requested and p.enabled)
            facilities = {p.camera_id.rsplit(":", 1)[0] for p in matches}
            return matches if len(facilities) <= 1 else ()

    def outgoing(self, exit_portal_id: str) -> tuple[PortalConnection, ...]:
        with self._lock:
            return tuple(c for c in self._connections.values() if c.exit_portal_id == exit_portal_id)

    def incoming(self, entry_portal_id: str) -> tuple[PortalConnection, ...]:
        with self._lock:
            return tuple(c for c in self._connections.values() if c.entry_portal_id == entry_portal_id)

    def _replace(self, raw: dict[str, Any]) -> None:
        if not isinstance(raw, dict):
            raise SpatialConfigurationError("Configuration must be a JSON object")
        if not isinstance(raw.get("facilities", []), list):
            raise SpatialConfigurationError("Configuration must contain a facilities array")

        portals: dict[str, Portal] = {}

        for facility in raw.get("facilities", []):
            facility_id = str(facility.get("id") or "").strip()
            if not facility_id:
                raise SpatialConfigurationError("Every facility requires an id")
            for camera in facility.get("cameras", []):
                camera_id = str(camera.get("id") or "").strip()
                if not camera_id:
                    raise SpatialConfigurationError(f"Facility {facility_id}: camera requires an id")
                for item in camera.get("portals", []):
                    local_id = str(item.get("id") or "").strip()
                    portal_id = f"{facility_id}:{camera_id}:{local_id}"
                    points = item.get("polygon")
                    if not isinstance(points, list) or len(points) < 3:
                        raise SpatialConfigurationError(f"Portal {portal_id} must have a polygon with at least 3 points")
                    try:
                        polygon = tuple((float(p[0]), float(p[1])) for p in points)
                    except (TypeError, ValueError, IndexError) as exc:
                        raise SpatialConfigurationError(f"Portal {portal_id} contains an invalid polygon point") from exc
                    if portal_id in portals:
                        raise SpatialConfigurationError(f"Duplicate portal id {portal_id}")
                    direction = item.get("direction")
                    portals[portal_id] = Portal(
                        id=portal_id, camera_id=f"{facility_id}:{camera_id}", polygon=polygon,
                        enabled=bool(item.get("enabled", True)),
                        direction=tuple(map(float, direction)) if isinstance(direction, list) and len(direction) == 2 else None,
                        min_direction_cosine=float(item.get("minDirectionCosine", -1.0)),
                    )

        raw_conns = list(raw.get("connections", []))
        for facility in raw.get("facilities", []):
            facility_id = str(facility.get("id") or "").strip()
            for item in facility.get("connections", []):
                local_id = str(item.get("id") or "").strip()
                exit_p = str(item.get("exitPortal") or "").strip()
                entry_p = str(item.get("entryPortal") or "").strip()
                if not exit_p.startswith(f"{facility_id}:"):
                    exit_p = f"{facility_id}:{exit_p}"
                if not entry_p.startswith(f"{facility_id}:"):
                    entry_p = f"{facility_id}:{entry_p}"
                raw_conns.append({
                    "id": f"{facility_id}:{local_id}" if not local_id.startswith(f"{facility_id}:") else local_id,
                    "exitPortal": exit_p,
                    "entryPortal": entry_p,
                    "minTransitSeconds": item.get("minTransitSeconds", 3),
                    "maxTransitSeconds": item.get("maxTransitSeconds", 20),
                    "minSimilarity": item.get("minSimilarity", 0.72)
                })

        connections: dict[str, PortalConnection] = {}

        for item in raw_conns:
            local_id = str(item.get("id") or "").strip()
            if not local_id:
                raise SpatialConfigurationError("Every connection requires an id")
            exit_id = str(item.get("exitPortal") or "").strip()
            entry_id = str(item.get("entryPortal") or "").strip()
            try:
                minimum, maximum = float(item["minTransitSeconds"]), float(item["maxTransitSeconds"])
            except (KeyError, TypeError, ValueError) as exc:
                raise SpatialConfigurationError(f"Connection {local_id} requires transit windows") from exc
            if minimum < 0 or maximum < minimum:
                raise SpatialConfigurationError(f"Connection {local_id} has invalid transit windows")
            connections[local_id] = PortalConnection(
                id=local_id, exit_portal_id=exit_id, entry_portal_id=entry_id,
                min_transit_seconds=minimum, max_transit_seconds=maximum,
                min_similarity=float(item.get("minSimilarity", 0.72)),
                min_direction_score=float(item.get("minDirectionScore", -1.0)),
                min_track_confidence=float(item.get("minTrackConfidence", 0.0)),
                appearance_weight=float(item.get("appearanceWeight", 0.60)),
                confidence_weight=float(item.get("confidenceWeight", 0.15)),
                direction_weight=float(item.get("directionWeight", 0.15)),
                recency_weight=float(item.get("recencyWeight", 0.10)),
            )

        for c in connections.values():
            if c.exit_portal_id not in portals:
                raise SpatialConfigurationError(f"Connection {c.id} references an unknown exit portal '{c.exit_portal_id}'")
            if c.entry_portal_id not in portals:
                raise SpatialConfigurationError(f"Connection {c.id} references an unknown entry portal '{c.entry_portal_id}'")

        self._raw, self._portals, self._connections = raw, portals, connections

