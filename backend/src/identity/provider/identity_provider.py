"""
Abstract base class for all identity event providers.

DESIGN CONTRACT
===============
To add a new provider (RFID reader, NFC tap, QR scan, MQTT device,
turnstile controller, attendance software …):

  1. Create a new Python file in this directory (e.g. rfid_provider.py).
  2. Subclass IdentityEventProvider and set PROVIDER_NAME.
  3. Implement receive_event() to parse the raw payload and return an IdentityEvent.
  4. Swap the provider used in api.py.

That is the ONLY change required. The CorrelationEngine, WorkerSessionManager,
and the rest of the application are completely unaware of the provider type.
"""

from abc import ABC, abstractmethod

from ..models import IdentityEvent, IdentityEventCreate


class IdentityEventProvider(ABC):
    """
    Abstract interface for identity event sources.

    All providers must produce a normalised IdentityEvent regardless of
    the underlying transport (REST, RFID, MQTT, etc.).
    """

    #: Override in each concrete provider — used for audit / logging.
    PROVIDER_NAME: str = "UNKNOWN"

    @abstractmethod
    def receive_event(self, payload: IdentityEventCreate) -> IdentityEvent:
        """
        Parse a raw payload and return a fully-populated, normalised IdentityEvent.

        The returned event MUST have:
          - event_id        (UUID, unique)
          - employee_id     (from payload)
          - event_type      ("ENTRY" for now)
          - timestamp       (from payload or auto-generated UTC)
          - entry_gate      (from payload)
          - provider        (self.PROVIDER_NAME)
          - correlation_status = "WAITING_FOR_TRACK"

        :param payload: Validated IdentityEventCreate from any source.
        :returns: Normalised IdentityEvent ready for the CorrelationEngine.
        """
        ...
