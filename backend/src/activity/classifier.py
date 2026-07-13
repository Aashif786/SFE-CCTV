from typing import Optional
from ..config import config

class ActivityClassifier:
    """
    Stateless rule engine. Call classify() once per frame.

    Rules (evaluated top-to-bottom, first match wins):
      1. no pose detected                                        → no_person
      2. movement_score > threshold AND inside zone              → working
      3. movement_score > threshold AND outside zone             → walking
      4. movement_score ≤ threshold (inside or out)              → idle
    """

    def classify(
        self,
        has_pose: bool,
        confidence: float,
        movement_score: float,
        velocity: float,
        worker_pos: Optional[tuple[float, float]],
        zone: tuple[float, float, float, float],
        keypoints: list[tuple[float, float]] | None = None,
    ) -> str:
        # Rule 1 — no body
        if not has_pose:
            return "no_person"

        has_movement = movement_score > config.movement_sensitivity
        inside = self._inside_zone(worker_pos, zone) if worker_pos else True

        # Rule 2 — active outside workstation or moving significantly (walking)
        if has_movement and (not inside or velocity > 0.05):
            return "walking"

        # Rule 3 — active inside workstation (working)
        if has_movement and inside:
            return "walking"

        # Rule 4 — standing / sitting still (idle)
        return "idle"

    @staticmethod
    def _inside_zone(pos: tuple[float, float], zone: tuple[float, float, float, float]) -> bool:
        x, y = pos
        x_min, y_min, x_max, y_max = zone
        return x_min <= x <= x_max and y_min <= y <= y_max

# Singleton classifier (stateless, safe to share)
classifier = ActivityClassifier()
