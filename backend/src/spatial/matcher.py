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
            print(f"[HANDOFF] ⚠️ Entry crossing at {crossing.portal.id} for {crossing.track_key} skipped: no embedding vector")
            return None  # Appearance is a required validation, not a global fallback.
        ranked: list[MatchResult] = []
        for route in self._configuration.incoming(crossing.portal.id):
            candidates = self._cache.candidates(route, crossing.timestamp)
            if not candidates:
                all_records = self._cache.snapshot()
                if all_records:
                    print(f"[HANDOFF] 🔍 Checking route {route.id} ({route.exit_portal_id} -> {route.entry_portal_id}) for arrival {crossing.track_key}: 0 candidates in window ({len(all_records)} total in cache)")
                    for rec in all_records:
                        dt = (_utc(crossing.timestamp) - _utc(rec.timestamp)).total_seconds()
                        print(f"[HANDOFF]    Cached: emp={rec.employee_id} exit={rec.exit_portal_id} transit={dt:.2f}s [configured: {route.min_transit_seconds}s-{route.max_transit_seconds}s]")
            else:
                for record in candidates:
                    similarity = self.cosine_similarity(record.embedding, crossing.embedding)
                    direction_score = self.direction_similarity(record.motion_direction, crossing.direction)
                    confidence = (record.track_confidence + crossing.track_confidence) / 2.0
                    transit = (_utc(crossing.timestamp) - _utc(record.timestamp)).total_seconds()
                    emp_label = f"Employee {record.employee_id}" if record.employee_id else f"Anonymous ({record.origin_track_key})"

                    print(f"[HANDOFF] 🎯 Candidate evaluated: {emp_label} origin={record.origin_track_key} -> dest={crossing.track_key} | sim={similarity:.3f} (min {route.min_similarity}) | conf={confidence:.2f} | transit={transit:.2f}s [{route.min_transit_seconds}s-{route.max_transit_seconds}s]")

                    if (similarity < route.min_similarity or confidence < route.min_track_confidence or
                            direction_score < route.min_direction_score):
                        print(f"[HANDOFF] ❌ Candidate {emp_label} rejected on threshold (sim {similarity:.3f} < {route.min_similarity})")
                        continue
                    recency = 1.0 - ((transit - route.min_transit_seconds) / max(route.max_transit_seconds - route.min_transit_seconds, 1e-6))
                    # A record's immediately preceding portal is part of its recent
                    # path history. It protects future route extensions from treating
                    # cached appearance alone as sufficient evidence.
                    history_score = 1.0 if record.recent_history and record.recent_history[-1] == route.exit_portal_id else 0.0
                    temporal_history_score = (max(0.0, min(1.0, recency)) + history_score) / 2.0
                    score = (route.appearance_weight * similarity + route.confidence_weight * confidence +
                             route.direction_weight * max(0.0, direction_score) + route.recency_weight * temporal_history_score)
                    ranked.append(MatchResult(record, route, similarity, transit, direction_score, score))
        best = max(ranked, key=lambda m: m.score) if ranked else None
        if best:
            print(f"[HANDOFF] ✅ Best match selected: Employee {best.record.employee_id} for track {crossing.track_key} with score={best.score:.3f}, similarity={best.similarity:.3f}")
        return best

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
