"""Ranks only topology-valid handoff candidates; it never performs global Re-ID."""

from __future__ import annotations

import math
from datetime import datetime

from .cache import HandoffCache, _utc
from .config_service import SpatialConfigurationService
from .models import MatchResult, PortalCrossing


class ReIDMatchingEngine:
    def __init__(self, configuration: SpatialConfigurationService, cache: HandoffCache) -> None:
        self._configuration, self._cache = configuration, cache

    def match_entry(self, crossing: PortalCrossing) -> MatchResult | None:
        if crossing.embedding is None:
            return None  # Appearance is a required validation, not a global fallback.
        ranked: list[MatchResult] = []
        for route in self._configuration.incoming(crossing.portal.id):
            for record in self._cache.candidates(route, crossing.timestamp):
                similarity = self.cosine_similarity(record.embedding, crossing.embedding)
                direction_score = self.direction_similarity(record.motion_direction, crossing.direction)
                confidence = (record.track_confidence + crossing.track_confidence) / 2.0
                if (similarity < route.min_similarity or confidence < route.min_track_confidence or
                        direction_score < route.min_direction_score):
                    continue
                transit = (_utc(crossing.timestamp) - _utc(record.timestamp)).total_seconds()
                recency = 1.0 - ((transit - route.min_transit_seconds) / max(route.max_transit_seconds - route.min_transit_seconds, 1e-6))
                # A record's immediately preceding portal is part of its recent
                # path history. It protects future route extensions from treating
                # cached appearance alone as sufficient evidence.
                history_score = 1.0 if record.recent_history and record.recent_history[-1] == route.exit_portal_id else 0.0
                temporal_history_score = (max(0.0, min(1.0, recency)) + history_score) / 2.0
                score = (route.appearance_weight * similarity + route.confidence_weight * confidence +
                         route.direction_weight * max(0.0, direction_score) + route.recency_weight * temporal_history_score)
                ranked.append(MatchResult(record, route, similarity, transit, direction_score, score))
        return max(ranked, key=lambda m: m.score) if ranked else None

    @staticmethod
    def cosine_similarity(left: tuple[float, ...], right: tuple[float, ...]) -> float:
        if len(left) != len(right) or not left:
            return -1.0
        dot = sum(a * b for a, b in zip(left, right))
        norm_left = math.sqrt(sum(a * a for a in left))
        norm_right = math.sqrt(sum(b * b for b in right))
        denom = norm_left * norm_right
        return dot / denom if denom else -1.0

    @staticmethod
    def direction_similarity(left: tuple[float, float] | None, right: tuple[float, float] | None) -> float:
        if left is None or right is None:
            return 0.0
        denom = math.hypot(*left) * math.hypot(*right)
        return ((left[0] * right[0]) + (left[1] * right[1])) / denom if denom else 0.0
