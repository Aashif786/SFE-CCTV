"""
REST Simulator provider.

Simulates what a real hardware device (RFID reader, NFC tap, QR scanner, etc.)
would do: receive a raw scan and produce a normalised IdentityEvent.

To swap to a real RFID reader tomorrow:
  - Create rfid_provider.py, extend IdentityEventProvider, set PROVIDER_NAME = "RFID"
  - Replace RESTSimulatorProvider with RFIDProvider in api.py
  - Done. Nothing else changes.
"""

import uuid
from datetime import datetime, timezone

from ..models import IdentityEvent, IdentityEventCreate
from .identity_provider import IdentityEventProvider


class RESTSimulatorProvider(IdentityEventProvider):
    """
    Accepts a POST body from the API and converts it into a normalised
    IdentityEvent, exactly as a physical RFID/NFC reader would.

    The `timestamp` field is optional — if omitted, the server UTC time
    at the moment of the request is used (closest approximation to
    the real-world scan time).
    """

    PROVIDER_NAME: str = "REST_SIMULATOR"

    def receive_event(self, payload: IdentityEventCreate) -> IdentityEvent:
        allowed = [str(c) for c in payload.allowed_cameras] if payload.allowed_cameras else []
        return IdentityEvent(
            event_id=str(uuid.uuid4()),
            employee_id=payload.employee_id,
            event_type=payload.event_type or "ENTRY",
            timestamp=payload.timestamp or datetime.now(timezone.utc),
            entry_gate=payload.entry_gate,
            provider=self.PROVIDER_NAME,
            correlation_status="WAITING_FOR_TRACK",
            allowed_cameras=allowed,
            correlation_window_seconds=payload.correlation_window_seconds,
        )

