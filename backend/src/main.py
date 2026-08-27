"""
CALVISION - Worker Monitoring API Server Entry Point.

Thin orchestrator module that creates the FastAPI application, mounts CORS
middleware, registers database tables and startup handlers, includes all sub-routers,
and registers the WebSocket endpoint.
"""

from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import cv2
import torch
# Limit worker thread pools to prevent CPU saturation across multi-stream processing
cv2.setNumThreads(2)
torch.set_num_threads(2)

# Database setup
from .db.database import engine, Base, SessionLocal
from .db.models import WorkerSessionDB, EmployeeDB, EmployeeZoneDB, EmployeeDailySummary

# Sub-routers and managers
from .identity.api import router as identity_router, _provider
from .cameras.api import router as cameras_router, seed_cameras
from .cameras.stream_manager import stream_manager
from .api.settings import router as settings_router
from .api.zones import router as zones_router
from .api.stats import router as stats_router
from .api.tools import router as tools_router
from .api.resources import router as resources_router
from .api.system import router as system_router
from .spatial.api import router as spatial_handoff_router

# WebSocket handlers
from .ws.handler import websocket_endpoint
from .ws.ai_stream import camera_ai_endpoint

import threading
from contextlib import asynccontextmanager
from .zones.background_tracker import background_tracker
from .state import preload_model_cache

import logging

# Filter out high-frequency polling & webhook access logs from uvicorn
class QuietAccessLogFilter(logging.Filter):
    IGNORED_PATHS = (
        "/api/identity/hikvision/webhook",
        "/webhook",
        "/api/system/resources",
        "/api/resources",
        "/api/cameras/live",
    )

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(path in msg for path in self.IGNORED_PATHS)

logging.getLogger("uvicorn.access").addFilter(QuietAccessLogFilter())

# ---------------------------------------------------------------------------
# Create / migrate tables on startup
Base.metadata.create_all(bind=engine)

# Ensure new columns exist on tables
from .console import Console

# Initialize sticky status bar console
Console.start_status_bar()

try:
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS designated_zone_seconds FLOAT DEFAULT 0.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS outside_zone_seconds FLOAT DEFAULT 0.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS common_area_seconds FLOAT DEFAULT 0.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS break_seconds FLOAT DEFAULT 0.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS productivity_score FLOAT DEFAULT 100.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE identity_events ADD COLUMN IF NOT EXISTS allowed_cameras TEXT;'))
        conn.execute(text('ALTER TABLE identity_events ADD COLUMN IF NOT EXISTS matched_camera_id TEXT;'))
        conn.execute(text('ALTER TABLE identity_events ADD COLUMN IF NOT EXISTS device_event_time TEXT;'))
        conn.execute(text('ALTER TABLE identity_events ADD COLUMN IF NOT EXISTS received_at TIMESTAMP;'))
        conn.execute(text('ALTER TABLE identity_events ADD COLUMN IF NOT EXISTS time_offset_seconds FLOAT;'))
        conn.execute(text('ALTER TABLE identity_events ADD COLUMN IF NOT EXISTS auth_type TEXT;'))
        conn.execute(text('ALTER TABLE identity_events ADD COLUMN IF NOT EXISTS card_no TEXT;'))
        conn.execute(text('ALTER TABLE identity_events ADD COLUMN IF NOT EXISTS access_granted BOOLEAN DEFAULT TRUE;'))
        conn.execute(text('ALTER TABLE worker_sessions ADD COLUMN IF NOT EXISTS persistent_track_id VARCHAR;'))
        conn.commit()
    Console.system("DATABASE", "PostgreSQL database schema synchronized")

except Exception as _mig_err:
    Console.error("DATABASE", f"Table migration warning: {_mig_err}")

# Close any stale active worker sessions left over from previous runs
with SessionLocal() as db:
    stale_sessions = db.query(WorkerSessionDB).filter(WorkerSessionDB.status == "ACTIVE").all()
    if stale_sessions:
        Console.system("STARTUP", f"Closing {len(stale_sessions)} stale session(s) from previous run")
        for s in stale_sessions:
            s.status = "CLOSED"
            s.end_time = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()


# ---------------------------------------------------------------------------
# Direct Service Initialization (Guaranteed Startup)
# ---------------------------------------------------------------------------
Console.system("STARTUP", "Initializing CALVISION core services...")
seed_cameras()
stream_manager.start_all_enabled()
background_tracker.start()
_provider.start_streams()
threading.Thread(target=preload_model_cache, name="model-prewarm", daemon=True).start()





# ---------------------------------------------------------------------------
# Application Initialization and Routers
# ---------------------------------------------------------------------------
app = FastAPI(title="CALVISION Worker Monitoring API", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(identity_router)
app.include_router(cameras_router)
app.include_router(settings_router)
app.include_router(zones_router)
app.include_router(stats_router)
app.include_router(tools_router)
app.include_router(system_router)
app.include_router(resources_router)
app.include_router(spatial_handoff_router)

# Register WebSocket endpoints
app.websocket("/ws")(websocket_endpoint)
app.websocket("/ws/camera/{camera_id}")(camera_ai_endpoint)