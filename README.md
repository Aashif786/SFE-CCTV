# SFE-CCTV — Worker Activity Monitoring System

> **Real-time AI-powered worker monitoring via webcam, with live pose estimation, idle detection, automated alerting, and a full analytics dashboard.**

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [How It Works — Full Workflow](#how-it-works--full-workflow)
- [AI Detection Pipeline](#ai-detection-pipeline)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Frontend Pages](#frontend-pages)
- [Configuration & Settings](#configuration--settings)
- [Running the System](#running-the-system)
- [Environment Variables](#environment-variables)

---

## Overview

SFE-CCTV is a **factory/assembly-line worker monitoring system** that uses a standard webcam as a CCTV input. It streams live video to an AI backend that:

1. **Detects human poses** in real-time using Google MediaPipe.
2. **Classifies each worker** into specific activities (`working`, `idle`, `walking`, `using_mobile`, `no_person`) by combining joint movement, workstation zone tracking, and mobile device detection heuristics.
3. **Persists activity logs, sessions, and fires alerts** automatically when a worker has been idle or using a mobile device beyond configured thresholds.
4. **Serves a live dashboard** to supervisors showing real-time camera feeds with skeleton overlays, stats, alert history, workstation zones, and productivity charts.

---

## Tech Stack

### Backend

| Technology | Version | Role |
|---|---|---|
| **Python** | 3.12+ | Runtime |
| **FastAPI** | 0.138+ | REST API + WebSocket server |
| **Uvicorn** | 0.49+ | ASGI web server |
| **MediaPipe** | 0.10.35 | Pose Landmarker (33-point skeleton) |
| **OpenCV** | 4.13 | Frame decoding (JPEG to numpy array) |
| **NumPy** | 2.5 | Array processing |
| **SQLAlchemy** | 2.0 | ORM for database access |
| **Alembic** | 1.18 | Database migrations |
| **Pydantic** | 2.x | Request validation & settings |
| **pg8000** | 1.31 | Pure-Python PostgreSQL driver |

### Frontend

| Technology | Version | Role |
|---|---|---|
| **Next.js** | 14 (App Router) | React framework |
| **TypeScript** | 5.x | Type-safe UI logic |
| **Tailwind CSS** | 3.x | Utility-first styling |
| **Recharts** | 2.x | Activity/productivity charts |
| **Lucide React** | — | Icon set |
| **WebSocket API** | Browser native | Real-time camera streaming |
| **Canvas API** | Browser native | Skeleton & bounding box overlay |

### Infrastructure

| Technology | Role |
|---|---|
| **PostgreSQL 15** | Persistent storage for activity logs and alerts |
| **Docker / Docker Compose** | Local database container |

---

## Architecture

```
+-------------------------------------------------------------+
|                         Browser                              |
|                                                             |
|  +--------------+      WebSocket (ws://)     +-----------+ |
|  | CameraWidget | ---- frames (base64 JPEG)-►|           | |
|  |  (Canvas +   | ◄--- AI results (JSON) ----|  FastAPI  | |
|  |   Video)     |                            |  Backend  | |
|  +--------------+                            |           | |
|                                              |  +------+ | |
|  +--------------+     HTTP REST (5s poll)    |  |Media | | |
|  |  Dashboard   | ---- GET /api/stats ------►|  | Pipe | | |
|  |  Alerts      | ---- GET /api/alerts -----►|  | Pose | | |
|  |  History     | ---- GET /api/history ----►|  | Land | | |
|  |  Settings    | ---- POST /api/settings --►|  |maker | | |
|  +--------------+                            |  +------+ | |
|                                              +-----+-----+ |
+---------------------------------------------------- | ------+
                                                     | SQLAlchemy
                                              +------v------+
                                              | PostgreSQL   |
                                              | (Docker)     |
                                              |              |
                                              | activity_logs|
                                              | alerts       |
                                              +-------------+
```

---

## Project Structure

```
SFE-CCTV/
├── docker-compose.yml          # PostgreSQL container
│
├── backend/
│   ├── requirements.txt        # Python dependencies
│   ├── Dockerfile              # Backend container image
│   ├── models/
│   │   └── pose_landmarker.task   # MediaPipe TFLite model (downloaded at setup)
│   └── src/
│       ├── main.py             # Core: FastAPI app, WorkerDetector, all API routes
│       └── db/
│           ├── database.py     # SQLAlchemy engine + session factory
│           └── models.py       # ORM models: ActivityLog, Alert
│
└── frontend/
    ├── package.json
    ├── tailwind.config.js
    ├── tsconfig.json
    └── src/
        ├── app/
        │   ├── layout.tsx      # Root layout: sidebar nav + header
        │   ├── page.tsx        # Dashboard page (stats + camera grid)
        │   ├── alerts/
        │   │   └── page.tsx    # Alerts table with Resolve button
        │   ├── history/
        │   │   └── page.tsx    # Bar + Line charts from activity logs
        │   └── settings/
        │       └── page.tsx    # Detection configuration form
        └── components/
            └── CameraWidget.tsx  # Core: webcam capture + WebSocket + canvas overlay
```

---

## How It Works — Full Workflow

### 1. Browser Captures Camera
`CameraWidget.tsx` uses the **`getUserMedia` API** to capture the user's webcam at 640x480. A frame is extracted every **200ms (5 fps)** via a hidden `<canvas>` element.

### 2. Frame Streamed to Backend
Each frame is encoded as a **base64 JPEG** (quality 0.7) and sent to the backend over a **WebSocket connection** at `ws://localhost:8000/ws`:
```json
{ "image": "<base64>", "camera_id": "cam-01" }
```

### 3. AI Pose Detection (Backend)
The `WorkerDetector` class in `main.py` processes each frame:

```
Frame (BGR)
    |  cv2.cvtColor -> RGB
    |  mp.Image wrapper
    |  PoseLandmarker.detect()
    |  33 landmark (x, y, z) positions
    |  EMA Smoothing (alpha=0.4)  <-- eliminates jitter noise
    |  Bounding box calculation
    |  Movement Score (5 key joints)
    v  Active / Idle / No Person classification
```

### 4. Result Sent Back to Frontend
The backend responds on the same WebSocket:
```json
{
  "timestamp": "2026-07-01T10:30:00",
  "status": "idle",
  "idle_seconds": 12.4,
  "keypoints": [[0.45, 0.32], ...],
  "boxes": [[120, 40, 480, 600]]
}
```

### 5. Canvas Overlay Rendered
`CameraWidget.tsx` draws on a `<canvas>` stacked over the `<video>` element:
- **Bounding box** — green when active, red when idle, with idle duration label
- **Skeleton** — 11 joint connections drawn between the 33 pose landmarks

### 6. Activity Logged to Database
Every **25 frames** (~5 seconds), the backend writes an `ActivityLog` row to PostgreSQL with the current `status` and `idle_seconds`.

### 7. Alert Triggered Automatically
If `idle_seconds >= idle_threshold` (default: **10s**) and no alert is already open for this camera, a new `Alert` row is inserted. The alert flag resets once the worker becomes active again.

### 8. Dashboard Polls for Live Stats
The dashboard polls `GET /api/stats` **every 5 seconds** to show:
- Active workers count (live in-memory detector state)
- Idle alerts triggered today (DB count)
- Average productivity % (active logs / total logs × 100)

---

## AI Detection Pipeline

### MediaPipe PoseLandmarker (Tasks API v0.10+)

The system uses the **lite** model (`pose_landmarker_lite.task`, ~5.5 MB) which outputs **33 body landmarks** at real-time speed on CPU.

```
Key landmark indices:
  0  -> Nose
  11 -> Left Shoulder    12 -> Right Shoulder
  13 -> Left Elbow       14 -> Right Elbow
  15 -> Left Wrist       16 -> Right Wrist
  23 -> Left Hip         24 -> Right Hip
  25 -> Left Knee        26 -> Right Knee
  27 -> Left Ankle       28 -> Right Ankle
```

### Activity Classification

The system utilizes an `ActivityClassifier` rule engine that classifies frames into one of the following states (evaluated top-to-bottom):

1. **`no_person`**: No pose landmarks detected in the frame.
2. **`using_mobile`**: Triggered when hand keypoints (wrist, pinky, index, or thumb) are raised close to head/ear level, and overall body movement is low (still).
3. **`working`**: Overall movement score is above the sensitivity threshold, and the worker is inside the defined **Workstation Zone**.
4. **`walking`**: Overall movement score is above the sensitivity threshold, but the worker is outside the **Workstation Zone**.
5. **`idle`**: Overall movement score is below the sensitivity threshold (regardless of zone).

---

### Movement Detection

Only **5 joints** are tracked for movement to reduce noise sensitivity (ignores minor head sway and breathing):
- Nose (0), Left Wrist (15), Right Wrist (16), Left Ankle (27), Right Ankle (28)

**Movement Score** = sum of euclidean distances of each tracked joint vs its previous smoothed position.

### EMA Jitter Filtering

MediaPipe has ~0.01–0.03 units of natural floating-point noise per frame. Without smoothing, this causes false "active" readings on a completely still person.

**Exponential Moving Average** (alpha = 0.4) applied to every landmark each frame:
```
smoothed[t] = 0.4 * raw[t] + 0.6 * smoothed[t-1]
```
This cancels high-frequency noise while remaining responsive to real sustained movement. The smoothed coordinates are also returned to the frontend, making the skeleton overlay visually stable.

---

## Database Schema

### `activity_logs`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `timestamp` | DATETIME | UTC time of log entry |
| `status` | VARCHAR | `"active"`, `"idle"`, or `"no_person"` (legacy status field) |
| `activity` | VARCHAR | Classified activity: `"working"`, `"idle"`, `"walking"`, `"using_mobile"`, `"no_person"` |
| `idle_seconds` | FLOAT | Accumulated idle time at the moment of logging |
| `movement_score` | FLOAT | Calculated joint movement score |
| `confidence` | FLOAT | Average pose detection confidence score |

### `alerts`

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `timestamp` | DATETIME | UTC time alert was created |
| `message` | VARCHAR | e.g. `"Worker idle for 15s on cam-01"` |
| `resolved` | BOOLEAN | `false` = active, `true` = manually resolved |

### `activity_sessions`

Stores continuous blocks of the same activity per camera.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `camera_id` | VARCHAR | Associated camera identifier |
| `activity` | VARCHAR | Active activity classification |
| `start_time` | DATETIME | Session start time (UTC) |
| `end_time` | DATETIME | Session end time (UTC), null if still open |
| `duration_seconds`| FLOAT | Total session duration, null if still open |

### `workstation_zones`

Stores coordinates of workstation zones per camera.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `camera_id` | VARCHAR | Associated camera identifier |
| `x_min` | FLOAT | Normalised minimum X coordinate (0.0 to 1.0) |
| `y_min` | FLOAT | Normalised minimum Y coordinate (0.0 to 1.0) |
| `x_max` | FLOAT | Normalised maximum X coordinate (0.0 to 1.0) |
| `y_max` | FLOAT | Normalised maximum Y coordinate (0.0 to 1.0) |

---

## API Reference

### WebSocket

| Endpoint | Description |
|---|---|
| `ws://localhost:8000/ws` | Main real-time channel — send frames, receive AI results |

**Send (client → server):**
```json
{ "image": "<base64-jpeg>", "camera_id": "cam-01" }
```
**Receive (server → client):**
```json
{
  "timestamp": "2026-07-01T10:30:00",
  "status": "active",
  "idle_seconds": 0.0,
  "keypoints": [[0.45, 0.32], ...],
  "boxes": [[x1, y1, x2, y2]]
}
```

### REST Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `GET` | `/api/stats` | Live dashboard metrics |
| `GET` | `/api/alerts` | All alerts, newest first (limit 50) |
| `PUT` | `/api/alerts/{id}/resolve` | Mark an alert as resolved |
| `GET` | `/api/history` | Last 50 activity log entries |
| `GET` | `/api/settings` | Current detection configuration |
| `POST` | `/api/settings` | Update detection configuration (live, no restart) |
| `GET` | `/api/zones/{camera_id}` | Retrieve workstation zone coordinates for a camera |
| `POST` | `/api/zones/{camera_id}` | Define workstation zone coordinates for a camera |
| `DELETE` | `/api/zones/{camera_id}` | Reset workstation zone coordinates to defaults |
| `GET` | `/api/sessions/current` | Get currently active sessions across cameras |
| `GET` | `/api/sessions` | Get list of historical activity sessions |

**`GET /api/stats` response:**
```json
{
  "active_workers": 1,
  "idle_alerts": 3,
  "avg_productivity": 87,
  "system_status": "Healthy"
}
```

**`POST /api/settings` body:**
```json
{
  "idle_threshold_seconds": 10.0,
  "movement_sensitivity": 0.05
}
```

---

## Frontend Pages

### `/` — Dashboard
- 4 live metric cards: Active Workers, Idle Alerts Today, Avg Productivity, System Status
- Camera grid with live AI skeleton overlay and bounding boxes
- Metrics auto-poll `/api/stats` every 5 seconds

### `/alerts` — Alerts
- Table of all AI-triggered idle alerts with timestamp, message, and status
- Resolve button calls `PUT /api/alerts/{id}/resolve` and instantly refreshes the list
- Auto-refreshes every 5 seconds

### `/history` — Activity History
- Stacked bar chart: Active vs Idle event counts grouped by hour
- Line chart: Active productivity trend over time
- Data fetched from `/api/history`, refreshes every 10 seconds

### `/settings` — Detection Configuration
- **Idle Time Threshold** (seconds): how long a worker must be still before an alert fires
- **Movement Sensitivity** (0–100%): maps to the internal landmark movement threshold
- Changes apply immediately at runtime — no server restart required

---

## Configuration & Settings

Settings are stored as an **in-memory singleton** (`DetectionConfig`) and updated live via `/api/settings`.

| Parameter | Default | Description |
|---|---|---|
| `idle_threshold_seconds` | `10.0` | Seconds of stillness before alert fires |
| `movement_sensitivity` | `0.05` | Landmark movement threshold (normalised coords) |
| `EMA_ALPHA` | `0.4` | Smoothing factor (code constant, not settable via UI) |
| Frame rate | `5 fps` | Frames sent per second from browser |
| DB write interval | Every 25 frames | ~5 seconds between `ActivityLog` writes |

> **Note:** Settings reset to defaults on server restart. Persistent settings (DB-backed) is a planned future enhancement.

---

## Running the System

### Prerequisites

- Python 3.12+
- Node.js 18+
- Docker & Docker Compose

### 1. Start the Database

```bash
docker-compose up -d
```

Starts a PostgreSQL 15 container on port `5432`. Tables are auto-created on first backend startup.

### 2. Start the Backend

You can start or restart the backend cleanly using the provided startup script:

```bash
./backend/start.sh
```

Alternatively, to start it manually:

```bash
cd backend
source venv/bin/activate
uvicorn src.main:app --reload --port 8000
```

First-time setup:
```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Download the MediaPipe pose model
mkdir -p models
curl -L -o models/pose_landmarker.task \
  https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task
```

Backend runs at: `http://localhost:8000`

### 3. Start the Frontend

```bash
cd frontend
npm install      # first time only
npm run dev
```

Frontend runs at: `http://localhost:3000`

### 4. Open the Dashboard

Navigate to **http://localhost:3000** and allow webcam access when prompted.

---

## Environment Variables

The backend reads `DATABASE_URL` from the environment. Default:

```env
DATABASE_URL=postgresql+pg8000://postgres:password@localhost:5432/worker_monitor
```

Create a `.env` file in `backend/` to override:

```env
DATABASE_URL=postgresql+pg8000://<user>:<password>@<host>:<port>/<dbname>
```
