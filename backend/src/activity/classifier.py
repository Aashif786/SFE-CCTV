"""
Profile-aware Activity Classifier.

Replaces the old flat ActivityClassifier with a thin dispatcher that
delegates classify() calls to whichever ActivityProfile is currently active.

Usage (unchanged from callers' perspective):
    from ..activity.classifier import classifier, profile_registry
    activity = classifier.classify(...)
    profiles_list = profile_registry.list_profiles()
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from ..config import config
from .profiles.base import ActivityProfile, ClassifyContext
from .profiles.software_office import software_office_profile


# ── Registry ────────────────────────────────────────────────────────────────
class ProfileRegistry:
    """Holds all registered ActivityProfile instances."""

    def __init__(self) -> None:
        self._profiles: Dict[str, ActivityProfile] = {}

    def register(self, profile: ActivityProfile) -> None:
        self._profiles[profile.id] = profile

    def get(self, profile_id: str) -> Optional[ActivityProfile]:
        return self._profiles.get(profile_id)

    def list_profiles(self) -> List[Dict]:
        return [p.as_dict() for p in self._profiles.values()]

    def active(self) -> ActivityProfile:
        """Return the currently configured active profile, falling back to software_office."""
        pid = getattr(config, "active_profile", "software_office")
        return self._profiles.get(pid, software_office_profile)


# Singleton registry — import this wherever you need the full list
profile_registry = ProfileRegistry()
profile_registry.register(software_office_profile)


# ── Dispatcher ──────────────────────────────────────────────────────────────
class ActivityClassifier:
    """
    Profile-aware dispatcher.

    Call classify() with the same signature as before — the implementation
    delegates to the active ActivityProfile so callers don't need to change.
    """

    def classify(
        self,
        has_pose: bool,
        confidence: float,
        movement_score: float,
        velocity: float,
        worker_pos: Optional[Tuple[float, float]],
        zone: Tuple[float, float, float, float],
        keypoints: Optional[List[Tuple[float, float]]] = None,
        idle_seconds: float = 0.0,
        peer_positions: Optional[List[Tuple[float, float]]] = None,
        net_displacement: float = 0.0,
        is_seated: bool = False,
        hands_off_seconds: float = 0.0,
    ) -> str:
        ctx = ClassifyContext(
            has_pose=has_pose,
            confidence=confidence,
            movement_score=movement_score,
            velocity=velocity,
            worker_pos=worker_pos,
            zone=zone,
            keypoints=keypoints,
            idle_seconds=idle_seconds,
            peer_positions=peer_positions or [],
            movement_sensitivity=getattr(config, "movement_sensitivity", 0.05),
            velocity_threshold=getattr(config, "classifier_velocity_threshold", 0.05),
            idle_threshold_seconds=getattr(config, "idle_threshold_seconds", 10.0),
            net_displacement=net_displacement,
            is_seated=is_seated,
            hands_off_seconds=hands_off_seconds,
        )
        return profile_registry.active().classify(ctx)

    def get_color(self, activity: str) -> str:
        return profile_registry.active().get_color(activity)

    def get_display_name(self, activity: str) -> str:
        return profile_registry.active().get_display_name(activity)


# Singleton classifier — safe to import and share across threads (stateless)
classifier = ActivityClassifier()
