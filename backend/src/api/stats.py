"""
Stats, Alerts, History, Activity Sessions, and Test Clips API.

Endpoints
---------
GET  /                            — root health check
GET  /api/stats                   — dashboard stats
GET  /api/alerts                  — recent alerts
PUT  /api/alerts/{alert_id}/resolve — resolve an alert
GET  /api/history                 — activity log history
GET  /api/sessions                — today's closed sessions
GET  /api/sessions/current        — currently open sessions
GET  /api/test_clips              — list test video clips
GET  /test_clips/{filename}       — serve a test video clip
"""

from __future__ import annotations

import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..db.database import get_db
from ..db.models import ActivityLog, Alert, ActivitySession
from ..config import config
from ..state import session_managers

router = APIRouter(tags=["stats"])

# Path to test_clips directory
clips_dir = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "test_clips",
)


# ---------------------------------------------------------------------------
# Root
# ---------------------------------------------------------------------------

@router.get("/")
async def root():
    return {"message": "Worker Monitoring API v2", "status": "running"}


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/api/stats")
async def get_stats(db: Session = Depends(get_db)):
    # Active workers = cameras currently showing "working" or "walking"
    active_workers = sum(
        1 for sm in session_managers.values()
        if sm._open_activity in ("working", "walking")
    )
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    idle_alerts = db.query(Alert).filter(Alert.timestamp >= today_start).count()
    total_logs = db.query(ActivityLog).filter(ActivityLog.timestamp >= today_start).count()
    active_logs = db.query(ActivityLog).filter(
        ActivityLog.timestamp >= today_start,
        ActivityLog.activity.in_(["working", "walking"]),
    ).count()

    avg_productivity = int((active_logs / total_logs) * 100) if total_logs > 0 else 100

    return {
        "active_workers": active_workers,
        "idle_alerts": idle_alerts,
        "avg_productivity": avg_productivity,
        "system_status": "Healthy",
        "idle_threshold_seconds": config.idle_threshold_seconds,
    }


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

@router.get("/api/alerts")
async def get_alerts(db: Session = Depends(get_db)):
    alerts = db.query(Alert).order_by(Alert.timestamp.desc()).limit(50).all()
    return [
        {"id": a.id, "timestamp": a.timestamp.isoformat(), "message": a.message, "resolved": a.resolved}
        for a in alerts
    ]


@router.put("/api/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if alert:
        alert.resolved = True
        db.commit()
    return {"status": "success"}


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

@router.get("/api/history")
async def get_history(db: Session = Depends(get_db)):
    logs = db.query(ActivityLog).order_by(ActivityLog.timestamp.desc()).limit(50).all()
    return [
        {
            "id": l.id,
            "timestamp": l.timestamp.isoformat(),
            "status": l.status,
            "activity": l.activity,
            "idle_seconds": l.idle_seconds,
            "movement_score": l.movement_score,
            "confidence": l.confidence,
        }
        for l in logs
    ]


# ---------------------------------------------------------------------------
# Activity Sessions
# ---------------------------------------------------------------------------

@router.get("/api/sessions/current")
async def get_current_sessions():
    return [
        info for sm in session_managers.values()
        if (info := sm.current_session_info()) is not None
    ]


@router.get("/api/sessions")
async def get_sessions(db: Session = Depends(get_db)):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sessions = (
        db.query(ActivitySession)
        .filter(ActivitySession.start_time >= today_start, ActivitySession.end_time.isnot(None))
        .order_by(ActivitySession.start_time.asc())
        .all()
    )
    return [
        {
            "id": s.id, "camera_id": s.camera_id, "activity": s.activity,
            "start_time": s.start_time.isoformat(),
            "end_time": s.end_time.isoformat() if s.end_time else None,
            "duration_seconds": s.duration_seconds,
            "is_open": False,
        }
        for s in sessions
    ]


# ---------------------------------------------------------------------------
# Test Clips
# ---------------------------------------------------------------------------

@router.get("/test_clips/{filename}")
async def get_test_clip(filename: str):
    filepath = os.path.join(clips_dir, filename)
    filepath = os.path.abspath(filepath)
    if not filepath.startswith(os.path.abspath(clips_dir)):
        raise HTTPException(status_code=403, detail="Access denied")
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
    }
    return FileResponse(filepath, headers=headers)


@router.get("/api/test_clips")
async def list_test_clips():
    if not os.path.exists(clips_dir):
        return []
    try:
        files = [f for f in os.listdir(clips_dir) if f.lower().endswith(('.mp4', '.webm', '.avi', '.mov'))]
        files.sort()
        return files
    except Exception as e:
        print(f"Error listing test clips: {e}")
        return []
