"""
Software Office Activity Profile.

Seven activities, evaluated top-to-bottom (first match wins):

  1. no_person       — no pose detected
  2. walking         — high velocity movement
  3. using_phone     — wrist near face while not at desk
  4. meeting         — multiple people in close proximity
  5. working         — at desk zone with detectable activity
  6. away_from_desk  — outside zone, low velocity
  7. idle            — in zone but no movement for idle_threshold
  8. unknown         — fallback / low confidence
"""

from __future__ import annotations

from typing import List, Tuple, Optional

from .base import ActivityDefinition, ActivityProfile, ClassifyContext


# ── MediaPipe keypoint indices used for phone-detection heuristic ─────────
_NOSE   = 0
_L_EAR  = 7
_R_EAR  = 8
_L_WRIST = 15
_R_WRIST = 16


def _wrist_near_face(
    keypoints: Optional[List[Tuple[float, float]]],
    threshold: float = 0.08,
) -> bool:
    """Return True if either wrist keypoint is within *threshold* of nose/ears."""
    if not keypoints or len(keypoints) < 17:
        return False
    face_pts = [keypoints[i] for i in (_NOSE, _L_EAR, _R_EAR) if keypoints[i][0] > 0.01]
    wrist_pts = [keypoints[i] for i in (_L_WRIST, _R_WRIST) if keypoints[i][0] > 0.01]
    if not face_pts or not wrist_pts:
        return False
    for wp in wrist_pts:
        for fp in face_pts:
            d = ((wp[0] - fp[0]) ** 2 + (wp[1] - fp[1]) ** 2) ** 0.5
            if d < threshold:
                return True
    return False


def _nearby_peers(
    worker_pos: Optional[Tuple[float, float]],
    peer_positions: List[Tuple[float, float]],
    threshold: float = 0.25,
) -> int:
    """Count how many other tracked people are within *threshold* of worker_pos."""
    if not worker_pos or not peer_positions:
        return 0
    return sum(
        1 for pp in peer_positions
        if ((worker_pos[0] - pp[0]) ** 2 + (worker_pos[1] - pp[1]) ** 2) ** 0.5 < threshold
    )


class SoftwareOfficeProfile(ActivityProfile):
    id = "software_office"
    display_name = "Software Office"

    activities = {
        "working": ActivityDefinition(
            id="working",
            display_name="Working",
            color="#10b981",   # emerald
            icon="💻",
            description="Seated at workstation, actively using PC/laptop.",
            productive=True,
        ),
        "walking": ActivityDefinition(
            id="walking",
            display_name="Walking",
            color="#3b82f6",   # blue
            icon="🚶",
            description="Moving between locations within the office.",
            productive=False,
        ),
        "idle": ActivityDefinition(
            id="idle",
            display_name="Idle",
            color="#f59e0b",   # amber
            icon="⏸️",
            description="Present but not interacting with the workstation.",
            productive=False,
        ),
        "using_phone": ActivityDefinition(
            id="using_phone",
            display_name="Using Phone",
            color="#8b5cf6",   # violet
            icon="📱",
            description="Actively using a mobile phone away from workstation.",
            productive=False,
        ),
        "meeting": ActivityDefinition(
            id="meeting",
            display_name="Meeting / Discussion",
            color="#06b6d4",   # cyan
            icon="🤝",
            description="Standing or sitting while interacting with colleagues.",
            productive=True,
        ),
        "away_from_desk": ActivityDefinition(
            id="away_from_desk",
            display_name="Away From Desk",
            color="#f97316",   # orange
            icon="🚪",
            description="Has left assigned workstation area.",
            productive=False,
        ),
        "unknown": ActivityDefinition(
            id="unknown",
            display_name="Unknown",
            color="#6b7280",   # gray
            icon="❓",
            description="Activity cannot be confidently determined.",
            productive=False,
        ),
        "no_person": ActivityDefinition(
            id="no_person",
            display_name="No Person",
            color="#374151",   # dark gray
            icon="🚫",
            description="No person detected in frame.",
            productive=False,
        ),
    }

    def classify(self, ctx: ClassifyContext) -> str:
        # Rule 0: no body
        if not ctx.has_pose:
            return "no_person"

        # Low confidence → unknown
        if ctx.confidence < 0.15:
            return "unknown"

        has_movement = ctx.movement_score > ctx.movement_sensitivity
        inside = self._inside_zone(ctx.worker_pos, ctx.zone) if ctx.worker_pos else True

        # Rule 1: fast locomotion → walking
        if ctx.velocity > ctx.velocity_threshold:
            return "walking"

        # Rule 2: phone use (wrist near face, not sitting at desk with normal movement)
        if not inside and _wrist_near_face(ctx.keypoints):
            return "using_phone"

        # Rule 3: meeting (multiple people in close proximity, low velocity)
        nearby = _nearby_peers(ctx.worker_pos, ctx.peer_positions)
        if nearby >= 1 and not inside and ctx.velocity <= ctx.velocity_threshold:
            return "meeting"

        # Rule 4: active at workstation → working
        if has_movement and inside:
            return "working"

        # Rule 5: outside zone, no significant movement → away from desk
        if not inside and not has_movement:
            return "away_from_desk"

        # Rule 6: in zone but idle past threshold → idle
        if inside and ctx.idle_seconds >= ctx.idle_threshold_seconds:
            return "idle"

        # Rule 7: in zone, minor movement below threshold → idle
        if inside and not has_movement:
            return "idle"

        return "unknown"


# Module-level singleton
software_office_profile = SoftwareOfficeProfile()
