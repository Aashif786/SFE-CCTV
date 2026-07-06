import cv2
import numpy as np
import base64
import json
import math
import os
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime, timezone
from typing import Optional

# --- MediaPipe Tasks API (v0.10+) ---
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python.vision import (
    PoseLandmarker,
    PoseLandmarkerOptions,
    RunningMode,
)

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from .db.database import engine, Base, get_db, SessionLocal
from .db.models import ActivityLog, Alert, ActivitySession, WorkstationZone

# ---------------------------------------------------------------------------
# Create / migrate tables on startup
# ---------------------------------------------------------------------------
Base.metadata.create_all(bind=engine)

MODEL_PATH = os.path.join(os.path.dirname(__file__), "..", "models", "pose_landmarker.task")


# ---------------------------------------------------------------------------
# Live Detection Configuration
# ---------------------------------------------------------------------------
class DetectionConfig:
    idle_threshold_seconds: float = 10.0
    movement_sensitivity: float = 0.05      # "has movement" threshold
    confidence_threshold: float = 0.50      # min avg landmark visibility → unknown

config = DetectionConfig()

class SettingsPayload(BaseModel):
    idle_threshold_seconds: float
    movement_sensitivity: float
    confidence_threshold: float = Field(default=0.50)

class ZonePayload(BaseModel):
    x_min: float = Field(ge=0.0, le=1.0)
    y_min: float = Field(ge=0.0, le=1.0)
    x_max: float = Field(ge=0.0, le=1.0)
    y_max: float = Field(ge=0.0, le=1.0)


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# ActivityClassifier — rule-based engine
# ---------------------------------------------------------------------------
# Worker position is derived from the hip-centre landmark (midpoint of 23 & 24).
# This is the most stable landmark for position tracking (doesn't wave around).
HIP_L, HIP_R = 23, 24

# Joints tracked for movement score: Nose, L-Wrist, R-Wrist, L-Ankle, R-Ankle
TRACKED_JOINTS = [0, 15, 16, 27, 28]

# Joints used for confidence (visibility): shoulders, hips, wrists
VISIBILITY_JOINTS = [11, 12, 23, 24, 15, 16]

# ---------------------------------------------------------------------------
# Phone-use gesture thresholds (in normalised frame coordinates, 0–1)
# ---------------------------------------------------------------------------
# Wrist-to-ear Euclidean distance below this → phone-call pose
PHONE_EAR_DIST      = 0.22
# Vertical distance of wrist from nose below this → wrist raised to face
PHONE_FACE_Y_MARGIN = 0.22
# Horizontal distance of wrist from nose below this → wrist near face, not extended
PHONE_FACE_X_MARGIN = 0.25
# Phone heuristic only fires when movement is below this multiplier × sensitivity
# (avoids false positives when hands pass face during active work)
PHONE_MOVEMENT_MULT = 3.0

# Landmark indices for phone detection
NOSE = 0
L_EAR, R_EAR     = 7,  8
L_WRIST, R_WRIST = 15, 16
L_PINKY, R_PINKY = 17, 18
L_INDEX, R_INDEX = 19, 20
L_THUMB, R_THUMB = 21, 22


class ActivityClassifier:
    """
    Stateless rule engine.  Call classify() once per frame.

    Rules (evaluated top-to-bottom, first match wins):
      1. no pose detected                                         → no_person
      2. wrist near face/ear AND low movement                    → using_mobile  ← NEW
      3. movement_score > threshold AND inside zone              → working
      4. movement_score > threshold AND outside zone             → walking
      5. movement_score ≤ threshold (inside or out)              → idle
    """

    def classify(
        self,
        has_pose: bool,
        confidence: float,
        movement_score: float,
        worker_pos: Optional[tuple[float, float]],
        zone: tuple[float, float, float, float],
        keypoints: list[tuple[float, float]] | None = None,
    ) -> str:
        # Rule 1 — no body
        if not has_pose:
            return "no_person"

        # Rule 2 — phone use (checked before movement-based rules)
        if keypoints and self._detect_phone(keypoints, movement_score):
            return "using_mobile"

        has_movement = movement_score > config.movement_sensitivity
        inside = self._inside_zone(worker_pos, zone) if worker_pos else True

        # Rule 3 — active inside workstation
        if has_movement and inside:
            return "working"

        # Rule 4 — active outside workstation
        if has_movement and not inside:
            return "walking"

        # Rule 5 — standing / sitting still
        return "idle"

    @staticmethod
    def _detect_phone(
        kp: list[tuple[float, float]],
        movement_score: float,
    ) -> bool:
        """
        Heuristic: at least one hand landmark (wrist/fingers) is raised to face/ear level AND
        the overall movement is low (the worker is relatively still).

        Phone-call pose:   hand close to the ear on the same side.
        Screen-view pose:  hand raised near nose height, not extended sideways.
        """
        if len(kp) <= max(NOSE, L_EAR, R_EAR, L_WRIST, R_WRIST, L_PINKY, R_PINKY, L_INDEX, R_INDEX, L_THUMB, R_THUMB):
            return False

        # Phone only triggers when the person is fairly still
        phone_movement_limit = config.movement_sensitivity * PHONE_MOVEMENT_MULT
        if movement_score > phone_movement_limit:
            return False

        nose   = kp[NOSE]
        l_ear  = kp[L_EAR]
        r_ear  = kp[R_EAR]

        # Use wrist, pinky, index, and thumb points
        l_hand_pts = [kp[L_WRIST], kp[L_PINKY], kp[L_INDEX], kp[L_THUMB]]
        r_hand_pts = [kp[R_WRIST], kp[R_PINKY], kp[R_INDEX], kp[R_THUMB]]

        def dist(a: tuple, b: tuple) -> float:
            return math.sqrt((a[0]-b[0])**2 + (a[1]-b[1])**2)

        # --- Phone-call pose: any hand point near same-side ear ---
        for pt in l_hand_pts:
            if dist(pt, l_ear) < PHONE_EAR_DIST:
                return True
        for pt in r_hand_pts:
            if dist(pt, r_ear) < PHONE_EAR_DIST:
                return True

        # --- Screen-view pose: any hand point near nose level, not too wide ---
        for pt in l_hand_pts + r_hand_pts:
            dy = abs(pt[1] - nose[1])
            dx = abs(pt[0] - nose[0])
            if dy < PHONE_FACE_Y_MARGIN and dx < PHONE_FACE_X_MARGIN:
                return True

        return False

    @staticmethod
    def _inside_zone(pos: tuple[float, float], zone: tuple[float, float, float, float]) -> bool:
        x, y = pos
        x_min, y_min, x_max, y_max = zone
        return x_min <= x <= x_max and y_min <= y <= y_max


# Singleton classifier (stateless, safe to share)
classifier = ActivityClassifier()


def _get_zone_for_camera(camera_id: str) -> tuple[float, float, float, float]:
    """Fetch workstation zone from DB; return full-frame default if not set."""
    with SessionLocal() as db:
        row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
        if row:
            return (row.x_min, row.y_min, row.x_max, row.y_max)
    return (0.0, 0.0, 1.0, 1.0)  # full-frame default


# ---------------------------------------------------------------------------
# WorkerDetector — MediaPipe pose estimation + EMA smoothing
# ---------------------------------------------------------------------------
class WorkerDetector:
    """Detects worker pose using MediaPipe Tasks PoseLandmarker (v0.10+)."""

    CONNECTIONS = [
        (11, 12), (11, 13), (13, 15), (12, 14), (14, 16),
        (11, 23), (12, 24), (23, 25), (25, 27), (24, 26), (26, 28),
    ]

    def __init__(self):
        options = PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=RunningMode.IMAGE,
            num_poses=1,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.landmarker = PoseLandmarker.create_from_options(options)
        self.idle_seconds: float = 0.0
        self.smoothed: list[list[float]] | None = None
        self.prev_smoothed: list[list[float]] | None = None
        self.EMA_ALPHA: float = 0.15
        self.frame_count: int = 0
        self.alert_triggered: bool = False

    @staticmethod
    def _dist_xy(a: list[float], b: list[float]) -> float:
        return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)

    def update(self, frame: np.ndarray):
        """
        Process one BGR frame.

        Returns:
            has_pose      (bool)
            movement_score (float)   — EMA-smoothed joint displacement sum
            confidence    (float)    — avg visibility of key landmarks [0–1]
            worker_pos    (tuple|None) — normalised (x, y) of hip centre
            idle_seconds  (float)
            keypoints     (list)     — 33 normalised (x, y) pairs
            boxes         (list)     — [[x1, y1, x2, y2]] pixel coords
        """
        self.frame_count += 1
        h, w, _ = frame.shape

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        result = self.landmarker.detect(mp_image)

        # ── No person ────────────────────────────────────────────────────────
        if not result.pose_landmarks or len(result.pose_landmarks) == 0:
            self.idle_seconds = 0.0
            self.smoothed = None
            self.prev_smoothed = None
            return False, 0.0, 0.0, None, 0.0, [], []

        landmarks = result.pose_landmarks[0]
        raw = [[lm.x, lm.y] for lm in landmarks]

        # ── Confidence: average visibility of key joints ─────────────────────
        vis_scores = [
            landmarks[i].visibility
            for i in VISIBILITY_JOINTS
            if i < len(landmarks) and landmarks[i].visibility is not None
        ]
        confidence = float(np.mean(vis_scores)) if vis_scores else 0.0

        # ── EMA smoothing ────────────────────────────────────────────────────
        if self.smoothed is None:
            self.smoothed = [pt[:] for pt in raw]
        else:
            a = self.EMA_ALPHA
            self.smoothed = [
                [a * r[0] + (1 - a) * s[0],
                 a * r[1] + (1 - a) * s[1]]
                for r, s in zip(raw, self.smoothed)
            ]
        smoothed = self.smoothed

        # ── Movement score ───────────────────────────────────────────────────
        if self.prev_smoothed is not None:
            movement_score = 0.0
            for i in TRACKED_JOINTS:
                if i < len(smoothed) and i < len(self.prev_smoothed):
                    d = self._dist_xy(smoothed[i], self.prev_smoothed[i])
                    # Ignore minor jitter below 0.008 normalized coordinates
                    if d > 0.008:
                        movement_score += d
        else:
            movement_score = 0.0

        # ── Idle accumulator ─────────────────────────────────────────────────
        if movement_score > config.movement_sensitivity:
            self.idle_seconds = 0.0
        else:
            self.idle_seconds += 0.2  # ~0.2 s per frame at 5 fps

        self.prev_smoothed = smoothed

        # ── Derived outputs ──────────────────────────────────────────────────
        keypoints = [(s[0], s[1]) for s in smoothed]

        xs = [s[0] for s in smoothed]
        ys = [s[1] for s in smoothed]
        box = [
            max(0, int(min(xs) * w) - 20),
            max(0, int(min(ys) * h) - 20),
            min(w, int(max(xs) * w) + 20),
            min(h, int(max(ys) * h) + 20),
        ]

        # Hip centre (landmark 23 + 24) in normalised coords
        if HIP_L < len(smoothed) and HIP_R < len(smoothed):
            worker_pos: Optional[tuple[float, float]] = (
                (smoothed[HIP_L][0] + smoothed[HIP_R][0]) / 2,
                (smoothed[HIP_L][1] + smoothed[HIP_R][1]) / 2,
            )
        else:
            worker_pos = None

        return True, movement_score, confidence, worker_pos, self.idle_seconds, keypoints, [box]


# ---------------------------------------------------------------------------
# Per-camera state (in-memory, reset on server restart)
# ---------------------------------------------------------------------------
detectors: dict[str, WorkerDetector] = {}
session_managers: dict[str, "SessionManager"] = {}


# ---------------------------------------------------------------------------
# SessionManager
# ---------------------------------------------------------------------------
class SessionManager:
    def __init__(self, camera_id: str):
        self.camera_id = camera_id
        self._open_id: Optional[int] = None
        self._open_activity: Optional[str] = None
        self._open_start: Optional[datetime] = None
        self._flush_frames: int = 0
        self._FLUSH_EVERY: int = 10  # ~2 s at 5 fps

    def _utcnow(self) -> datetime:
        return datetime.now(timezone.utc).replace(tzinfo=None)

    def process(self, activity: str) -> None:
        self._flush_frames += 1
        if activity != self._open_activity:
            self._close_session()
            self._open_session(activity)
        elif self._flush_frames % self._FLUSH_EVERY == 0:
            self._flush_open_session()

    def _open_session(self, activity: str) -> None:
        now = self._utcnow()
        with SessionLocal() as db:
            s = ActivitySession(camera_id=self.camera_id, activity=activity, start_time=now)
            db.add(s)
            db.commit()
            db.refresh(s)
            self._open_id = s.id
        self._open_activity = activity
        self._open_start = now
        print(f"📂 Session [{self._open_id}] → {activity}")

    def _close_session(self) -> None:
        if self._open_id is None:
            return
        now = self._utcnow()
        dur = (now - self._open_start).total_seconds() if self._open_start else 0.0
        with SessionLocal() as db:
            s = db.get(ActivitySession, self._open_id)
            if s:
                s.end_time = now
                s.duration_seconds = round(dur, 2)
                db.commit()
        print(f"📁 Session [{self._open_id}] closed ({round(dur, 1)}s)")
        self._open_id = self._open_activity = self._open_start = None

    def _flush_open_session(self) -> None:
        if self._open_id is None:
            return
        now = self._utcnow()
        dur = (now - self._open_start).total_seconds() if self._open_start else 0.0
        with SessionLocal() as db:
            s = db.get(ActivitySession, self._open_id)
            if s:
                s.end_time = now
                s.duration_seconds = round(dur, 2)
                db.commit()

    def current_session_info(self) -> Optional[dict]:
        if self._open_id is None:
            return None
        now = self._utcnow()
        dur = (now - self._open_start).total_seconds() if self._open_start else 0.0
        return {
            "id": self._open_id,
            "camera_id": self.camera_id,
            "activity": self._open_activity,
            "start_time": self._open_start.isoformat() if self._open_start else None,
            "end_time": None,
            "duration_seconds": round(dur, 2),
            "is_open": True,
        }

    def close_on_disconnect(self) -> None:
        self._close_session()


# ---------------------------------------------------------------------------
# API — Root & Settings
# ---------------------------------------------------------------------------

@app.get("/")
async def root():
    return {"message": "Worker Monitoring API v2", "status": "running"}


@app.get("/api/settings")
async def get_settings():
    return {
        "idle_threshold_seconds": config.idle_threshold_seconds,
        "movement_sensitivity": config.movement_sensitivity,
        "confidence_threshold": config.confidence_threshold,
    }


@app.post("/api/settings")
async def save_settings(payload: SettingsPayload):
    config.idle_threshold_seconds = payload.idle_threshold_seconds
    config.movement_sensitivity = payload.movement_sensitivity
    config.confidence_threshold = payload.confidence_threshold
    print(f"⚙️  Settings: idle={config.idle_threshold_seconds}s  sens={config.movement_sensitivity}  conf={config.confidence_threshold}")
    return {
        "status": "saved",
        "idle_threshold_seconds": config.idle_threshold_seconds,
        "movement_sensitivity": config.movement_sensitivity,
        "confidence_threshold": config.confidence_threshold,
    }


# ---------------------------------------------------------------------------
# API — Workstation Zone (per-camera)
# ---------------------------------------------------------------------------

@app.get("/api/zones/{camera_id}")
async def get_zone(camera_id: str, db: Session = Depends(get_db)):
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if not row:
        return {"camera_id": camera_id, "x_min": 0.0, "y_min": 0.0, "x_max": 1.0, "y_max": 1.0, "is_default": True}
    return {"camera_id": row.camera_id, "x_min": row.x_min, "y_min": row.y_min, "x_max": row.x_max, "y_max": row.y_max, "is_default": False}


@app.post("/api/zones/{camera_id}")
async def set_zone(camera_id: str, payload: ZonePayload, db: Session = Depends(get_db)):
    if payload.x_min >= payload.x_max or payload.y_min >= payload.y_max:
        raise HTTPException(status_code=400, detail="x_min must be < x_max and y_min must be < y_max")
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if row:
        row.x_min, row.y_min, row.x_max, row.y_max = payload.x_min, payload.y_min, payload.x_max, payload.y_max
    else:
        row = WorkstationZone(camera_id=camera_id, x_min=payload.x_min, y_min=payload.y_min, x_max=payload.x_max, y_max=payload.y_max)
        db.add(row)
    db.commit()
    print(f"🗺️  Zone updated for {camera_id}: ({payload.x_min},{payload.y_min}) → ({payload.x_max},{payload.y_max})")
    return {"status": "saved", "camera_id": camera_id, "x_min": payload.x_min, "y_min": payload.y_min, "x_max": payload.x_max, "y_max": payload.y_max}


@app.delete("/api/zones/{camera_id}")
async def delete_zone(camera_id: str, db: Session = Depends(get_db)):
    row = db.query(WorkstationZone).filter(WorkstationZone.camera_id == camera_id).first()
    if row:
        db.delete(row)
        db.commit()
    return {"status": "deleted", "camera_id": camera_id}


# ---------------------------------------------------------------------------
# API — Stats, Alerts, History
# ---------------------------------------------------------------------------

@app.get("/api/stats")
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


@app.get("/api/alerts")
async def get_alerts(db: Session = Depends(get_db)):
    alerts = db.query(Alert).order_by(Alert.timestamp.desc()).limit(50).all()
    return [
        {"id": a.id, "timestamp": a.timestamp.isoformat(), "message": a.message, "resolved": a.resolved}
        for a in alerts
    ]


@app.put("/api/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: int, db: Session = Depends(get_db)):
    alert = db.query(Alert).filter(Alert.id == alert_id).first()
    if alert:
        alert.resolved = True
        db.commit()
    return {"status": "success"}


@app.get("/api/history")
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
# API — Activity Sessions
# ---------------------------------------------------------------------------

@app.get("/api/sessions/current")
async def get_current_sessions():
    return [
        info for sm in session_managers.values()
        if (info := sm.current_session_info()) is not None
    ]


@app.get("/api/sessions")
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
# WebSocket — camera stream + AI + classification
# ---------------------------------------------------------------------------

# Colour per activity for the overlay label sent in WS response
ACTIVITY_COLOUR: dict[str, str] = {
    "working":   "#10b981",   # emerald
    "walking":   "#3b82f6",   # blue
    "idle":      "#f59e0b",   # amber
    "no_person": "#6b7280",   # gray
    "using_mobile": "#ec4899",  # pink
}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ WebSocket connected")
    camera_id: Optional[str] = None

    try:
        while True:
            data = await websocket.receive_text()
            payload = json.loads(data)
            image_b64 = payload["image"]
            camera_id = payload.get("camera_id", "default")

            # Lazy-init per-camera objects
            if camera_id not in detectors:
                detectors[camera_id] = WorkerDetector()
            if camera_id not in session_managers:
                session_managers[camera_id] = SessionManager(camera_id)

            detector = detectors[camera_id]
            sm = session_managers[camera_id]

            # Decode frame
            image_bytes = base64.b64decode(image_b64)
            np_arr = np.frombuffer(image_bytes, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is None:
                continue

            # Run pose detection
            try:
                has_pose, movement_score, confidence, worker_pos, idle_sec, keypoints, boxes = detector.update(frame)
            except Exception as det_err:
                print(f"⚠️  Detector error: {det_err}")
                has_pose, movement_score, confidence, worker_pos, idle_sec, keypoints, boxes = False, 0.0, 0.0, None, 0.0, [], []

            # Load workstation zone (cheap — uses in-process SessionLocal)
            zone = _get_zone_for_camera(camera_id)

            # Classify activity using the rule engine (pass keypoints for phone detection)
            activity = classifier.classify(has_pose, confidence, movement_score, worker_pos, zone, keypoints)

            # Update session engine
            sm.process(activity)

            # Persist ActivityLog snapshot every 25 frames (~5 s at 5 fps)
            if detector.frame_count % 25 == 0:
                # Map back to a legacy "status" string for backwards compat
                legacy_status = {
                    "working":      "active",
                    "walking":      "active",
                    "using_mobile": "idle",     # treat phone as idle for legacy compat
                    "idle":         "idle",
                    "no_person":    "no_person",
                }.get(activity, "unknown")

                with SessionLocal() as db:
                    db.add(ActivityLog(
                        status=legacy_status,
                        activity=activity,
                        idle_seconds=idle_sec,
                        movement_score=round(movement_score, 5),
                        confidence=round(confidence, 3),
                    ))
                    db.commit()

            # Idle alert (fires when worker has been idle/unknown long enough)
            if activity == "idle" and idle_sec >= config.idle_threshold_seconds and not detector.alert_triggered:
                with SessionLocal() as db:
                    db.add(Alert(
                        message=f"Worker idle for {round(idle_sec)}s on {camera_id}",
                        resolved=False,
                    ))
                    db.commit()
                detector.alert_triggered = True
            elif activity in ("working", "walking", "no_person"):
                detector.alert_triggered = False

            response = {
                "timestamp": datetime.utcnow().isoformat(),
                # Legacy field — kept so existing frontend still works
                "status": activity,
                # New rich fields
                "activity": activity,
                "activity_colour": ACTIVITY_COLOUR.get(activity, "#6b7280"),
                "movement_score": round(movement_score, 5),
                "confidence": round(confidence, 3),
                "idle_seconds": round(idle_sec, 1),
                "idle_threshold_seconds": config.idle_threshold_seconds,
                "worker_position": list(worker_pos) if worker_pos else None,
                "zone": list(zone),
                "keypoints": keypoints,
                "boxes": boxes,
                "session": sm.current_session_info(),
            }
            await websocket.send_text(json.dumps(response))

    except WebSocketDisconnect:
        print("❌ WebSocket disconnected")
        if camera_id and camera_id in session_managers:
            session_managers[camera_id].close_on_disconnect()
    except Exception as e:
        print(f"❌ Fatal WS error: {e}")
        if camera_id and camera_id in session_managers:
            session_managers[camera_id].close_on_disconnect()