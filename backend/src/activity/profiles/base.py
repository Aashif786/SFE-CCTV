"""
Activity Profile Base Classes.

An ActivityProfile encapsulates everything a deployment type needs:
  - The set of supported activity IDs
  - Their display metadata (name, color, icon)
  - The classification logic (classify method)

To add a new profile:
  1. Create a new file in this package (e.g. manufacturing.py)
  2. Subclass ActivityProfile
  3. Register it in the PROFILES registry at the bottom of this file
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple


@dataclass
class ActivityDefinition:
    """Metadata for a single activity within a profile."""
    id: str
    display_name: str
    color: str          # hex colour for the overlay label
    icon: str           # emoji or icon name hint for the frontend
    description: str    # human-readable description
    productive: bool    # whether this counts as productive time


@dataclass
class ClassifyContext:
    """All signals available to a profile's classify() method."""
    has_pose: bool
    confidence: float
    movement_score: float
    velocity: float
    worker_pos: Optional[Tuple[float, float]]
    zone: Tuple[float, float, float, float]     # legacy rectangular zone
    keypoints: Optional[List[Tuple[float, float]]]
    idle_seconds: float
    peer_positions: List[Tuple[float, float]]   # other detected hip-centres this frame
    # Config thresholds (passed in so profiles stay stateless)
    movement_sensitivity: float
    velocity_threshold: float
    idle_threshold_seconds: float
    net_displacement: float = 0.0
    is_seated: bool = False
    hands_off_seconds: float = 0.0


class ActivityProfile(ABC):
    """
    Abstract base for all deployment profiles.

    Subclasses MUST set:
        id           — unique slug, e.g. "software_office"
        display_name — shown in the UI settings panel
        activities   — dict[str, ActivityDefinition]
    
    Subclasses MUST implement:
        classify(context) -> str (must return one of activities.keys())
    """

    id: str
    display_name: str
    activities: Dict[str, ActivityDefinition]

    @abstractmethod
    def classify(self, ctx: ClassifyContext) -> str:
        """Classify a single person's activity. Must return a key from self.activities."""
        ...

    def get_color(self, activity_id: str) -> str:
        """Return the overlay hex colour for a given activity id."""
        defn = self.activities.get(activity_id)
        return defn.color if defn else "#6b7280"

    def get_display_name(self, activity_id: str) -> str:
        """Return the display label for a given activity id."""
        defn = self.activities.get(activity_id)
        return defn.display_name if defn else activity_id.replace("_", " ").title()

    def as_dict(self) -> Dict[str, Any]:
        """Serialise the profile metadata for the settings API."""
        return {
            "id": self.id,
            "display_name": self.display_name,
            "activities": [
                {
                    "id": a.id,
                    "display_name": a.display_name,
                    "color": a.color,
                    "icon": a.icon,
                    "description": a.description,
                    "productive": a.productive,
                }
                for a in self.activities.values()
            ],
        }

    # ── Optional helper shared across profiles ─────────────────────────────

    @staticmethod
    def _inside_zone(pos: Tuple[float, float], zone: Tuple[float, float, float, float]) -> bool:
        x, y = pos
        x_min, y_min, x_max, y_max = zone
        return x_min <= x <= x_max and y_min <= y <= y_max

    @staticmethod
    def _distance(a: Tuple[float, float], b: Tuple[float, float]) -> float:
        return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2) ** 0.5
