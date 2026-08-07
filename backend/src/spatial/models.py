"""Immutable records used by the spatial handoff engine."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Sequence


PortalKind = Literal["ENTRY_PORTAL", "EXIT_PORTAL"]


@dataclass(frozen=True)
class Portal:
    id: str
    camera_id: str
    kind: PortalKind
    polygon: tuple[tuple[float, float], ...]
    enabled: bool = True
    # Optional expected travel vector in normalised image coordinates.
    direction: tuple[float, float] | None = None
    min_direction_cosine: float = -1.0


@dataclass(frozen=True)
class PortalConnection:
    id: str
    exit_portal_id: str
    entry_portal_id: str
    min_transit_seconds: float
    max_transit_seconds: float
    min_similarity: float = 0.72
    min_direction_score: float = -1.0
    min_track_confidence: float = 0.0
    # Ranking weights are intentionally visible in configuration/output.
    appearance_weight: float = 0.60
    confidence_weight: float = 0.15
    direction_weight: float = 0.15
    recency_weight: float = 0.10


@dataclass(frozen=True)
class PortalCrossing:
    portal: Portal
    track_key: str
    timestamp: datetime
    direction: tuple[float, float] | None
    track_confidence: float
    embedding: tuple[float, ...] | None


@dataclass(frozen=True)
class HandoffRecord:
    record_id: str
    employee_id: str
    session_id: str
    origin_track_key: str
    origin_camera_id: str
    exit_portal_id: str
    timestamp: datetime
    embedding: tuple[float, ...]
    track_confidence: float
    motion_direction: tuple[float, float] | None
    recent_history: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class MatchResult:
    record: HandoffRecord
    connection: PortalConnection
    similarity: float
    transit_seconds: float
    direction_score: float
    score: float
