"""
CALVISION — Worker Monitoring API Server Entry Point.

Thin orchestrator module that creates the FastAPI application, mounts CORS
middleware, registers database tables & startup handlers, includes all sub-routers,
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

# Sub-routers
from .identity.api import router as identity_router
from .cameras.api import router as cameras_router, seed_cameras
from .cameras.stream_manager import stream_manager
from .api.settings import router as settings_router
from .api.zones import router as zones_router
from .api.stats import router as stats_router
from .api.tools import router as tools_router
from .api.resources import router as resources_router

# WebSocket handlers
from .ws.handler import websocket_endpoint
from .ws.ai_stream import camera_ai_endpoint

# ---------------------------------------------------------------------------
# Create / migrate tables on startup
Base.metadata.create_all(bind=engine)

# Ensure new columns exist on employee_daily_summary table
try:
    from sqlalchemy import text
    with engine.connect() as conn:
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS designated_zone_seconds FLOAT DEFAULT 0.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS outside_zone_seconds FLOAT DEFAULT 0.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS common_area_seconds FLOAT DEFAULT 0.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS break_seconds FLOAT DEFAULT 0.0 NOT NULL;'))
        conn.execute(text('ALTER TABLE employee_daily_summary ADD COLUMN IF NOT EXISTS productivity_score FLOAT DEFAULT 100.0 NOT NULL;'))
        conn.commit()
except Exception as _mig_err:
    print(f"[Startup] Table migration check warning: {_mig_err}")

# Close any stale active worker sessions left over from previous runs
with SessionLocal() as db:
    stale_sessions = db.query(WorkerSessionDB).filter(WorkerSessionDB.status == "ACTIVE").all()
    if stale_sessions:
        print(f"[Startup] Found {len(stale_sessions)} stale active sessions. Closing them...")
        for s in stale_sessions:
            s.status = "CLOSED"
            s.end_time = datetime.now(timezone.utc).replace(tzinfo=None)
        db.commit()


# ---------------------------------------------------------------------------
# Application Initialization & Routers
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
app.include_router(resources_router)

# Register WebSocket endpoints
app.websocket("/ws")(websocket_endpoint)
app.websocket("/ws/camera/{camera_id}")(camera_ai_endpoint)


from .zones.background_tracker import background_tracker


# ---------------------------------------------------------------------------
# Lifecycle Events
# ---------------------------------------------------------------------------
@app.on_event("startup")
def startup_cameras():
    """Seed demo cameras on first run, then start all enabled streams and background tracker."""
    seed_cameras()
    stream_manager.start_all_enabled()
    background_tracker.start()


@app.on_event("shutdown")
def shutdown_cameras():
    """Stop all camera streams and background tracker on server shutdown."""
    background_tracker.stop()
    stream_manager.stop_all()