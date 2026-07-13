# SFE-CCTV — Worker Activity Monitoring System

> **Real-time AI-powered worker monitoring via webcam, featuring YOLO-based multi-person pose estimation, Re-ID tracking, idle detection, automated alerting, and a full analytics dashboard.**

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

SFE-CCTV is a **factory/assembly-line worker monitoring system** designed to run using standard webcams as CCTV input. It streams live video to an advanced AI backend that:

1. **Detects human poses** in real-time using `Ultralytics YOLO11m-pose`.
2. **Tracks individuals across frames** using the `BoT-SORT` tracker, leveraging deep appearance (Re-ID) features and Kalman filtering to maintain identity even during occlusions or visual collisions (e.g., people crossing paths or shaking hands).
3. **Classifies each worker** into specific activities (`working`, `idle`, `walking`, `no_person`) based on joint movement and workstation zone boundaries.
4. **Persists activity logs, sessions, and fires alerts** automatically when a worker is idle or using a mobile device beyond configured thresholds.
5. **Serves a live dashboard** to supervisors showing real-time camera feeds with tightly aligned bounding boxes, dynamic skeletons, stats, alert history, and productivity charts.

---

## Tech Stack

### Backend

| Technology | Role |
|---|---|
| **Python** (3.12+) | Primary backend runtime |
| **FastAPI** | High-performance REST API and WebSocket server |
| **Uvicorn** | ASGI web server for running FastAPI |
| **Ultralytics YOLO11** | Core AI model (`yolo11m-pose.pt`) for detecting humans and 17 pose keypoints |
| **BoT-SORT** | Multi-object tracking algorithm (replaces simple IoU/SortTracker) |
| **OpenCV** | Frame decoding (JPEG to numpy array) |
| **NumPy** | High-speed array processing |
| **SQLAlchemy** (2.0) | ORM for relational database access |
| **Alembic** | Database migrations |
| **Pydantic** | Data validation and settings management |
| **pg8000** | Pure-Python PostgreSQL driver |

### Frontend

| Technology | Role |
|---|---|
| **Next.js** (14 App Router) | Full-stack React framework |
| **TypeScript** | Type-safe UI component logic |
| **Tailwind CSS** | Utility-first styling for the dashboard |
| **Recharts** | Activity and productivity data visualisation |
| **Lucide React** | Consistent UI iconography |
| **WebSocket API** | Browser native real-time bidirectional streaming |
| **Canvas API** | Browser native high-performance skeleton and bounding box rendering |

### Infrastructure

| Technology | Role |
|---|---|
| **PostgreSQL 15** | Persistent storage for activity logs, employee identities, and alerts |
| **Docker / Docker Compose** | Local isolated database containerization |

---

## Architecture

```text
+-------------------------------------------------------------+
|                         Browser                             |
|                                                             |
|  +--------------+      WebSocket (ws://)     +-----------+  |
|  | CameraWidget | ---- frames (base64 JPEG)-►|           |  |
|  |  (Canvas +   | ◄--- AI results (JSON) ----|  FastAPI  |  |
|  |   Video)     |                            |  Backend  |  |
|  +--------------+                            |           |  |
|                                              |  +------+ |  |
|  +--------------+     HTTP REST (5s poll)    |  | YOLO | |  |
|  |  Dashboard   | ---- GET /api/stats ------►|  | 11m  | |  |
|  |  Alerts      | ---- GET /api/alerts -----►|  | Pose | |  |
|  |  History     | ---- GET /api/history ----►|  | BoT- | |  |
|  |  Settings    | ---- POST /api/settings --►|  | SORT | |  |
|  +--------------+                            |  +------+ |  |
|                                              +-----+-----+  |
+---------------------------------------------------- | ------+
                                                      | SQLAlchemy
                                               +------v------+
                                               | PostgreSQL  |
                                               | (Docker)    |
                                               |             |
                                               | logs, alerts|
                                               | sessions    |
                                               +-------------+
```

---

## Project Structure

```text
SFE-CCTV/
├── docker-compose.yml          # PostgreSQL container definition
│
├── backend/
│   ├── requirements.txt        # Python dependencies
│   ├── custom_tracker.yaml     # BoT-SORT Re-ID tracker configuration
│   ├── start.sh                # Smart startup and DB cleanup script
│   └── src/
│       ├── main.py             # Core: FastAPI app, YOLO WorkerDetector, WS routes
│       ├── db/
│       │   ├── database.py     # SQLAlchemy engine + session factory
│       │   └── models.py       # ORM models (ActivityLog, Alert, WorkerSessionDB, etc.)
│       └── identity/           # Multi-camera identity and correlation engine
│
└── frontend/
    ├── package.json
    ├── tailwind.config.js
    └── src/
        ├── app/
        │   ├── layout.tsx      # Root layout: sidebar nav + header
        │   ├── page.tsx        # Dashboard page (stats + camera grid)
        │   ├── alerts/         # Alerts management
        │   ├── history/        # Analytics charts
        │   ├── identity/       # Identity correlation management
        │   ├── summary/        # Daily employee summaries
        │   └── settings/       # Detection configuration form
        └── components/
            └── CameraWidget.tsx  # Core: webcam capture + WS + canvas overlays
```

---

## How It Works — Full Workflow

### 1. Browser Captures Camera
`CameraWidget.tsx` uses the **`getUserMedia` API** to capture the user's webcam at 640x480. A frame is extracted every **200ms (5 fps)** via a hidden `<canvas>` element.

### 2. Frame Streamed to Backend
Each frame is encoded as a **base64 JPEG** and sent to the backend over a WebSocket connection (dynamic host routing prevents `localhost` lock-in):
```json
{ "image": "<base64>", "camera_id": "cam-01" }
```

### 3. AI Pose Detection & Tracking (Backend)
The `WorkerDetector` class in `main.py` runs the frame through the YOLO pipeline:
1. **YOLO Inference**: Frame is evaluated using `yolo11m-pose.pt` at `conf=0.35` and `imgsz=1280` to successfully detect small/distant individuals.
2. **BoT-SORT Tracking**: Detected boxes and features are passed to the `custom_tracker.yaml` pipeline. It uses a Kalman filter to project movement during occlusions and native YOLO backbone features (`model: auto`) as Re-ID appearance embeddings to securely link IDs across visual collisions (handshakes, crossing paths).
3. **Keypoint Mapping**: YOLO's 17 keypoints are mapped back to the legacy 33-point MediaPipe structure to maintain frontend compatibility.
4. **Bounding Box Realignment**: To counteract scale-shifting caused by high-res inference padding, bounding boxes are calculated strictly from the normalized keypoints (`xyn`).
5. **Heuristic Classification**: Movement score and workstation zones determine if the worker is `working`, `idle`, or `walking`.

### 4. Result Sent Back to Frontend
The backend responds with multi-person tracking data:
```json
{
  "camera_id": "cam-01",
  "detection_count": 2,
  "detections": [
    {
      "track_id": 1,
      "activity": "working",
      "idle_seconds": 0.0,
      "keypoints": [[0.45, 0.32], ...],
      "box": [120, 40, 240, 300],
      "identity": { "employee_id": "EMP001" }
    }
  ]
}
```

### 5. Canvas Overlay Rendered
`CameraWidget.tsx` dynamically renders over the `<video>` element:
- Tightly-aligned **Bounding boxes** matching activity colors (green=working, blue=walking, red=idle).
- **Dynamic Skeletons** where stroke weights scale relative to the person's distance from the camera.
- Tracking ID and Employee ID flags floating above the bounding box.

### 6. Activity Logged to Database
Every **25 frames** (~5 seconds), the backend aggregates and writes an `ActivityLog` to PostgreSQL to persist the tracking data over time.

### 7. Alerts Triggered Automatically
If `idle_seconds >= idle_threshold` (default: **10s**) and no alert is already open for this camera/track, a new `Alert` row is inserted.

---

## AI Detection Pipeline

### Model & Tracking Configuration
We utilize **YOLO11m-pose** coupled with the **BoT-SORT** multi-object tracker.
The tracker is highly tuned via `backend/custom_tracker.yaml`:
- **`track_buffer: 120`**: Maintains memory of lost tracks for ~4 seconds, ensuring IDs are recovered after heavy occlusions.
- **`with_reid: True`**: Uses the YOLO backbone features to visually recognize individuals rather than relying purely on Intersection-over-Union (IoU), fundamentally solving track-swapping during close physical proximity.
- **`gmc_method: none`**: Disabled global motion compensation to conserve GPU resources, as CCTV cameras are statically mounted.

### Activity Classification Rules
The `ActivityClassifier` evaluates frames into states top-to-bottom:

1. **`no_person`**: No people detected in the frame.
2. **`working`**: Overall movement score is above the sensitivity threshold, and the worker is inside the defined **Workstation Zone**.
3. **`walking`**: Overall movement score is above the sensitivity threshold, but the worker is outside the zone.
4. **`idle`**: Overall movement score is below the sensitivity threshold.

### EMA Jitter Filtering
To prevent natural AI keypoint jitter from registering as "movement" when a worker is perfectly still, we apply an **Exponential Moving Average** (alpha = 0.4) to every landmark each frame:
```python
smoothed[t] = 0.4 * raw[t] + 0.6 * smoothed[t-1]
```

---

## Database Schema

### `activity_logs`
Logs periodic snapshots of a worker's activity.
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `timestamp` | DATETIME | UTC time of log entry |
| `camera_id` | VARCHAR | Source camera |
| `track_id` | VARCHAR | YOLO tracker ID |
| `activity` | VARCHAR | Classified activity |
| `idle_seconds` | FLOAT | Accumulated idle time |

### `alerts`
| Column | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `timestamp` | DATETIME | UTC time alert was created |
| `message` | VARCHAR | e.g. `"Worker (track 2) idle for 15s"` |
| `resolved` | BOOLEAN | Manually resolved flag |

### `worker_sessions`
Stores continuous blocks of presence for a specific tracked individual.
| Column | Type | Description |
|---|---|---|
| `session_id` | VARCHAR PK | UUID for the session |
| `track_id` | VARCHAR | The AI assigned tracker ID |
| `employee_id` | VARCHAR | The matched real-world employee |

*(Additional tables include `identity_events`, `employee_daily_summary`, and `workstation_zones`)*

---

## API Reference

### WebSocket
| Endpoint | Description |
|---|---|
| `ws://<host>:8000/ws` | Main real-time channel — send frames, receive multi-person AI tracking results |

### REST Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats` | Live dashboard metrics |
| `GET` | `/api/alerts` | AI-triggered alerts |
| `PUT` | `/api/alerts/{id}/resolve` | Mark an alert as resolved |
| `GET` | `/api/settings` | Current detection config |
| `POST` | `/api/settings` | Live-update detection thresholds |
| `GET` | `/api/zones/{camera_id}` | Retrieve workstation zone coordinates |
| `POST` | `/api/zones/{camera_id}` | Define workstation zone coordinates |
| `GET` | `/api/identity/events/pending` | Check-in queue |
| `DELETE`| `/api/identity/employees/daily` | Clear activity summary data |

---

## Frontend Pages

- **`/` (Dashboard)**: Live metrics auto-polling `/api/stats`, camera grid with live AI overlays.
- **`/summary`**: Daily summary of identified workers, their total logged hours, and productivity (with a Trash feature).
- **`/identity`**: Queue for employee check-ins to map real-world IDs to new camera tracks.
- **`/alerts`**: Table of AI-triggered idle/mobile alerts.
- **`/history`**: Stacked bar and line charts reflecting activity logs over time.
- **`/settings`**: Live detection configuration form (Idle Threshold, Movement Sensitivity).

---

## Configuration & Settings

Settings are stored as an in-memory singleton (`DetectionConfig`) and updated live via `/api/settings`.

| Parameter | Default | Description |
|---|---|---|
| `idle_threshold_seconds` | `10.0` | Seconds of stillness before alert fires |
| `movement_sensitivity` | `0.05` | Landmark movement threshold (normalised coords) |
| `correlation_window_seconds`| `5.0` | Window to map a check-in event to a newly spawned track |

---

## Running the System

### Prerequisites
- Python 3.12+
- Node.js 18+
- Docker & Docker Compose
- *CUDA-enabled GPU (Highly Recommended for YOLO11m)*

### 1. Start the Database
Starts a PostgreSQL 15 container on port `5432`. Tables auto-create on first backend startup.
```bash
docker-compose up -d
```

### 2. Start the Backend
The startup script automatically handles environment variables and performs DB session cleanups for stranded sessions.
```bash
./backend/start.sh
```

*(First-time setup)*:
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```
*Note: The YOLO model (`yolo11m-pose.pt`) is automatically downloaded by the `ultralytics` package upon first run.*

Backend runs at: `http://localhost:8000`

### 3. Start the Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend runs at: `http://localhost:3000`

### 4. Open the Dashboard
Navigate to **http://localhost:3000** and allow webcam access when prompted.

---

## Environment Variables

Create a `.env` file in `backend/` to override the default database connection:
```env
DATABASE_URL=postgresql+pg8000://<user>:<password>@<host>:<port>/<dbname>
```
