"""
Pydantic schemas for the Identity Management module.

These are pure data models — no DB knowledge, no FastAPI knowledge.
All other modules import from here.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Inbound — what any provider sends us (via REST, RFID, NFC, etc.)
# ---------------------------------------------------------------------------

class IdentityEventCreate(BaseModel):
    """
    Payload received from any identity provider.
    Accepts both camelCase (JSON API) and snake_case (Python internal).
    timestamp is auto-filled by the provider if omitted.
    """
    model_config = {"populate_by_name": True}

    employee_id: str = Field(alias="employeeId")
    entry_gate: str = Field(alias="entryGate")
    timestamp: Optional[datetime] = Field(default=None)


# ---------------------------------------------------------------------------
# Internal — fully normalised, enriched event
# ---------------------------------------------------------------------------

class IdentityEvent(BaseModel):
    """
    Internal representation of an identity event.
    Created by a provider, consumed by the CorrelationEngine.
    Immutable after creation except for correlation_status.
    """
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    employee_id: str
    employee_name: Optional[str] = None
    event_type: Literal["ENTRY", "EXIT"] = "ENTRY"
    timestamp: datetime
    entry_gate: str
    provider: str           # "REST_SIMULATOR" | "RFID" | "NFC" | "MQTT" …
    correlation_status: Literal["WAITING_FOR_TRACK", "MATCHED", "EXPIRED"] = "WAITING_FOR_TRACK"
    # Populated when matched
    matched_track_id: Optional[str] = None
    matched_at: Optional[datetime] = None
    correlation_delay_seconds: Optional[float] = None


# ---------------------------------------------------------------------------
# Camera pipeline — emitted when a new track appears
# ---------------------------------------------------------------------------

class CameraEntryEvent(BaseModel):
    """
    Emitted by the camera pipeline whenever a new person / track appears.

    For single-person MediaPipe mode, track_id is a stable synthetic key
    (e.g. "mediapipe-cam-01"). When a multi-object tracker (ByteTrack, etc.)
    is plugged in later, track_id becomes the real tracker ID.
    No other module changes are required.
    """
    track_id: str
    timestamp: datetime
    camera_id: str
    first_bounding_box: list[int]   # [x1, y1, x2, y2] in pixel coords
    first_frame_number: int


# ---------------------------------------------------------------------------
# Output — resolved named worker session
# ---------------------------------------------------------------------------

class WorkerSession(BaseModel):
    """
    A resolved identity ↔ track binding.
    All downstream modules (activity logging, alerts, etc.) should use
    WorkerSession instead of raw track IDs wherever a named employee is needed.
    """
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    employee_id: str
    current_track_id: str           # updated in-place if tracker reassigns
    camera_id: str
    start_time: datetime
    end_time: Optional[datetime] = None
    status: Literal["ACTIVE", "CLOSED"] = "ACTIVE"
    correlation_delay_seconds: float
