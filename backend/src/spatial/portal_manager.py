"""Portal crossing detector. A portal event is emitted once per actual crossing."""

from __future__ import annotations

import math
from datetime import datetime

from .config_service import SpatialConfigurationService
from .models import PortalCrossing
from ..zones.polygon_eval import is_point_in_polygon


class PortalManager:
    def __init__(self, configuration: SpatialConfigurationService) -> None:
        self._configuration = configuration
        self._inside: dict[tuple[str, str], bool] = {}
        self._positions: dict[tuple[str, str], tuple[float, float]] = {}

    def observe(self, camera_id: str, track_key: str, point: tuple[float, float], timestamp: datetime,
                confidence: float, embedding: tuple[float, ...] | None) -> list[PortalCrossing]:
        events: list[PortalCrossing] = []
        for portal in self._configuration.portals_for_camera(camera_id):
            state_key = (portal.id, track_key)
            was_inside = self._inside.get(state_key, False)
            inside = is_point_in_polygon(point[0], point[1], list(portal.polygon))
            previous = self._positions.get(state_key)
            direction = self._direction(previous, point)

            # Departure crossing: this portal is the exit in at least one connection.
            if bool(self._configuration.outgoing(portal.id)) and was_inside and not inside:
                if self._direction_allowed(portal.direction, portal.min_direction_cosine, direction):
                    events.append(PortalCrossing(portal, track_key, timestamp, direction, confidence, embedding))

            # Arrival crossing: this portal is the entry in at least one connection.
            if bool(self._configuration.incoming(portal.id)) and inside and not was_inside:
                if self._direction_allowed(portal.direction, portal.min_direction_cosine, direction):
                    events.append(PortalCrossing(portal, track_key, timestamp, direction, confidence, embedding))

            self._inside[state_key], self._positions[state_key] = inside, point
        return events

    def force_exit(self, camera_id: str, track_key: str, timestamp: datetime, confidence: float,
                   embedding: tuple[float, ...] | None) -> list[PortalCrossing]:
        events = []
        for portal in self._configuration.portals_for_camera(camera_id):
            if bool(self._configuration.outgoing(portal.id)):
                key = (portal.id, track_key)
                if self._inside.pop(key, False):
                    events.append(PortalCrossing(portal, track_key, timestamp, None, confidence, embedding))
                self._positions.pop(key, None)
        # Entry-only portal state must also be released when a tracker disappears
        # so a recycled numeric tracker ID starts cleanly.
        stale = [key for key in self._inside if key[1] == track_key]
        for key in stale:
            self._inside.pop(key, None)
            self._positions.pop(key, None)
        return events


    @staticmethod
    def _direction(previous: tuple[float, float] | None, current: tuple[float, float]) -> tuple[float, float] | None:
        if previous is None:
            return None
        dx, dy = current[0] - previous[0], current[1] - previous[1]
        length = math.hypot(dx, dy)
        return (dx / length, dy / length) if length > 1e-6 else None

    @staticmethod
    def _direction_allowed(expected: tuple[float, float] | None, minimum: float, actual: tuple[float, float] | None) -> bool:
        if expected is None or minimum <= -1.0:
            return True
        if actual is None:
            return False
        length = math.hypot(*expected)
        return length > 0 and ((expected[0] * actual[0] + expected[1] * actual[1]) / length) >= minimum
