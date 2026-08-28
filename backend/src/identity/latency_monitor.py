"""
Latency Monitor Engine — Measures physical punch delivery latency down to the millisecond.

Calculates latency on the backend:
    latency_ms = (system_receipt_time_utc - device_event_time_utc) * 1000.0

Provides an async waiting mechanism (long-polling) so the frontend can
sit in "Waiting for punch..." state and immediately receive the punch the
microsecond it arrives at the backend from the physical Hikvision hardware.
"""

from __future__ import annotations

import asyncio
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
import uuid
import logging

logger = logging.getLogger("LatencyMonitor")


class LatencyMonitor:
    """Thread-safe singleton tracking punch latency and notifying async waiters."""

    def __init__(self, max_history: int = 50) -> None:
        self._lock = threading.Lock()
        self._history: deque[Dict[str, Any]] = deque(maxlen=max_history)
        self._latencies: deque[float] = deque(maxlen=100)
        self._waiting_futures: List[asyncio.Future] = []
        self._total_punches: int = 0
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def record_punch(
        self,
        device_timestamp_raw: str,
        device_timestamp_utc: datetime,
        received_at_utc: datetime,
        latency_ms: float,
        employee_id: str = "",
        employee_name: str = "",
        card_no: str = "",
        door_name: str = "",
        device_ip: str = "",
        auth_type: str = "",
        source: str = "HIKVISION_WEBHOOK",
        direction: str = "ENTRY",
        access_granted: bool = True,
        major: int = 5,
        minor: int = 1,
        is_dry_run: bool = False,
    ) -> Dict[str, Any]:
        """
        Record a punch event and compute latency.
        Awakens any async waiting listeners with zero UI-induced delay.
        """
        # Ensure UTC tzinfo consistency
        if device_timestamp_utc.tzinfo is None:
            dev_iso = device_timestamp_utc.replace(tzinfo=timezone.utc).isoformat()
        else:
            dev_iso = device_timestamp_utc.astimezone(timezone.utc).isoformat()

        if received_at_utc.tzinfo is None:
            rec_iso = received_at_utc.replace(tzinfo=timezone.utc).isoformat()
        else:
            rec_iso = received_at_utc.astimezone(timezone.utc).isoformat()

        record: Dict[str, Any] = {
            "id": uuid.uuid4().hex[:10],
            "device_timestamp_raw": device_timestamp_raw,
            "device_timestamp_iso": dev_iso,
            "system_timestamp_iso": rec_iso,
            "latency_ms": round(latency_ms, 2),
            "latency_seconds": round(latency_ms / 1000.0, 4),
            "employee_id": employee_id or "UNKNOWN",
            "employee_name": employee_name or "Unknown",
            "card_no": card_no or "N/A",
            "door_name": door_name or "Door Terminal",
            "device_ip": device_ip or "N/A",
            "auth_type": auth_type or "Access Punch",
            "source": source,
            "direction": direction,
            "access_granted": access_granted,
            "major": major,
            "minor": minor,
            "is_dry_run": is_dry_run,
            "recorded_at": datetime.now(timezone.utc).isoformat(),
        }

        with self._lock:
            self._history.appendleft(record)
            if not is_dry_run:
                self._total_punches += 1
                self._latencies.append(latency_ms)

        # Notify any async long-pollers
        self._notify_waiting(record)
        return record

    def _notify_waiting(self, record: Dict[str, Any]) -> None:
        with self._lock:
            futures_to_notify = list(self._waiting_futures)
            self._waiting_futures.clear()

        for fut in futures_to_notify:
            if not fut.done():
                try:
                    fut_loop = fut.get_loop()
                    if fut_loop.is_running():
                        fut_loop.call_soon_threadsafe(fut.set_result, record)
                    else:
                        fut.set_result(record)
                except Exception as e:
                    logger.debug(f"Error waking waiting future: {e}")

    async def wait_for_next_punch(self, timeout: float = 60.0) -> Optional[Dict[str, Any]]:
        """
        Asynchronously suspends the caller until the next punch arrives on backend.
        Returns the punch record if received before timeout, or None on timeout.
        """
        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()

        with self._lock:
            self._waiting_futures.append(fut)

        try:
            return await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            with self._lock:
                if fut in self._waiting_futures:
                    self._waiting_futures.remove(fut)
            return None
        except Exception:
            with self._lock:
                if fut in self._waiting_futures:
                    self._waiting_futures.remove(fut)
            return None

    def get_stats(self) -> Dict[str, Any]:
        """Returns aggregate statistics and recent history."""
        with self._lock:
            history_list = list(self._history)
            lat_list = list(self._latencies)

            if lat_list:
                avg_lat = round(sum(lat_list) / len(lat_list), 2)
                min_lat = round(min(lat_list), 2)
                max_lat = round(max(lat_list), 2)
            else:
                avg_lat = 0.0
                min_lat = 0.0
                max_lat = 0.0

            return {
                "total_punches": self._total_punches,
                "history_count": len(history_list),
                "avg_latency_ms": avg_lat,
                "min_latency_ms": min_lat,
                "max_latency_ms": max_lat,
                "latest_punch": history_list[0] if history_list else None,
                "history": history_list,
                "waiting_listeners": len(self._waiting_futures),
            }

    def clear(self) -> None:
        """Clears all historical latency entries and stats."""
        with self._lock:
            self._history.clear()
            self._latencies.clear()
            self._total_punches = 0


# Global singleton instance
latency_monitor = LatencyMonitor()
