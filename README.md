# CALVISION — Worker Activity & CCTV Monitoring System

> **Real-time AI-powered worker activity & identity monitoring system. Features YOLO11 pose estimation, BoT-SORT multi-person tracking, Hikvision ISAPI door access integration, RTSP live streaming, automated idle alerts, network device scanning, and a Nix-locked reproducible runtime.**

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [System Architecture](#system-architecture)
- [Project Structure](#project-structure)
- [Key Features](#key-features)
- [How It Works — Full Pipeline](#how-it-works--full-pipeline)
- [Nix Reproducible Runtime](#nix-reproducible-runtime)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Frontend Navigation](#frontend-navigation)
- [Configuration & Settings](#configuration--settings)
- [Running the System](#running-the-system)
- [Environment Variables](#environment-variables)

---

## Overview

CALVISION is a **production-grade worker activity monitoring and attendance verification system** designed for factories, assembly lines, and high-security facilities. It connects directly to local CCTV IP cameras (RTSP) and Hikvision Access Control door terminals (ISAPI) to:

1. **Detect Human Poses in Real-Time** using `Ultralytics YOLO11m-pose`.
2. **Track Workers Across Frames** using `BoT-SORT` with deep appearance (Re-ID) embeddings and Kalman filtering to prevent identity swaps during occlusions or path crossings.
3. **Correlate Access Scans with AI Camera Tracks** within a dynamic time window to map physical door check-in events to tracked visual bounding boxes.
4. **Classify Worker Activity States** (`working`, `idle`, `walking`, `no_person`) based on pose movement velocity, keypoint displacement, and workstation zone boundaries.
5. **Scan & Discover Unconfigured Devices** on local private subnets (`192.168.1.0/24`), automatically discovering RTSP cameras and Hikvision door controllers.
6. **Guarantee 100% Environment Reproducibility** via Nix (`flake.nix`, `backend/requirements.lock`, `.envrc`) on bare-metal host hardware without Docker containerization overhead.

---

## Tech Stack

### Backend
| Technology | Version / Tool | Role |
|---|---|---|
| **Python** | 3.10+ | Primary backend runtime |
| **FastAPI** | 0.138+ | High-performance modular REST API & WebSocket server |
| **Uvicorn** | 0.49+ | ASGI web server |
| **Ultralytics YOLO11** | `yolo11m-pose.pt` | Multi-person pose estimation & 17 keypoint detection |
| **BoT-SORT** | `custom_tracker.yaml` | Multi-object tracking with Re-ID embeddings |
| **OpenCV** | 4.13+ | RTSP stream decoding & frame buffer processing |
| **SQLAlchemy** | 2.0+ | Relational ORM for PostgreSQL |
| **Hikvision ISAPI** | REST / Digest Auth | Physical door controller event polling |
| **Nix Flakes** | `flake.nix` | Pinned host environment & library locking |

### Frontend
| Technology | Version / Tool | Role |
|---|---|---|
| **Next.js** | 14 App Router | Full-stack React framework |
| **TypeScript** | 5.3+ | Type-safe UI & API models |
| **Tailwind CSS** | 3.4+ | Modern dark/light theme responsive dashboard |
| **Recharts** | 2.12+ | Interactive productivity charts & activity analytics |
| **Lucide React** | 0.366+ | Iconography system |
| **Canvas API** | Browser Native | Ultra-fast keypoint skeleton & bounding box overlay |

### Infrastructure
| Technology | Role |
|---|---|
| **PostgreSQL 15** | Primary relational database (`worker_monitor_db`) |
| **Nix (`flake.nix` & `.envrc`)** | Native bare-metal system dependency locking |
| **Docker Compose** | Isolated database service management |

---

## System Architecture

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                FRONTEND (Next.js 14)                                    │
│                                                                                         │
│  ┌─────────────────────────┐     WebSocket (/ws)     ┌──────────────────────────────┐   │
│  │   Live Camera / Feed    │◄─── base64 frames ─────►│       FastAPI Backend        │   │
│  │   Canvas Skeleton HUD   │◄─── AI detections ──────│  (Decomposed Modular Server)  │   │
│  └─────────────────────────┘                         └──────────────┬───────────────┘   │
│  ┌─────────────────────────┐     HTTP REST           ┌──────────────┴───────────────┐   │
│  │ Dashboard / Summary     │◄─── GET /api/stats ────►│  • state.py (Shared State)   │   │
│  │ Door Config / Scanner   │◄─── POST /api/tools ───►│  • ws/handler.py (AI WS)     │   │
│  └─────────────────────────┘                         │  • api/ (Settings/Zones/Tools│   │
└──────────────────────────────────────────────────────┴──────────────┬───────────────┴───┘
                                                                      │
                ┌─────────────────────────────────────────────────────┼────────────────────────────────────────────────────┐
                │                                                     │                                                    │
                ▼                                                     ▼                                                    ▼
┌───────────────────────────────┐                   ┌───────────────────────────────────┐                ┌───────────────────────────────────┐
│   PostgreSQL 15 Database      │                   │   RTSP Camera Streams             │                │   Hikvision Door Controllers      │
│ (logs, alerts, sessions, zones)│                   │  (192.168.1.201 - 215)            │                │  (192.168.1.231 - 235 ISAPI)      │
└───────────────────────────────┘                   └───────────────────────────────────┘                └───────────────────────────────────┘
```

---

## Project Structure

```text
SFE-CCTV/
├── flake.nix                   # Master Nix Flake for native reproducible runtime
├── shell.nix                   # Classic nix-shell wrapper
├── default.nix                 # Nix build derivation
├── .envrc                      # direnv auto-activation configuration
├── docker-compose.yml          # PostgreSQL 15 database service
├── custom_tracker.yaml         # BoT-SORT Re-ID tracker parameters
├── NIX.md                      # Complete Nix system documentation
│
├── backend/
│   ├── requirements.txt        # High-level Python dependencies
│   ├── requirements.lock       # Pinned exact package versions
│   └── src/
│       ├── main.py             # Thin orchestrator (~80 lines)
│       ├── state.py            # Centralised in-memory state & zone cache
│       ├── network_scanner.py  # Multi-threaded TCP & ISAPI subnet device discovery
│       ├── config.py           # Settings singleton & tracker sync logic
│       ├── api/                # Modular REST route handlers
│       │   ├── settings.py     # Configuration GET/POST
│       │   ├── zones.py        # Workstation zone CRUD
│       │   ├── stats.py        # Dashboard stats, alerts, history & sessions
│       │   └── tools.py        # Network scanner endpoints
│       ├── ws/
│       │   └── handler.py      # Real-time WebSocket detection & tracking pipeline
│       ├── cameras/            # RTSP stream manager & stream CRUD
│       ├── detectors/          # YOLO11 pose detector & keypoint normaliser
│       ├── activity/           # Movement & zone activity classifier
│       ├── identity/           # Hikvision ISAPI door provider & correlation engine
│       └── db/                 # SQLAlchemy engine, session factory & ORM models
│
└── frontend/
    ├── package.json
    ├── tailwind.config.js
    └── src/
        ├── app/
        │   ├── layout.tsx              # Sidebar navigation & theme context provider
        │   ├── page.tsx                # Dashboard with metrics & live feeds
        │   ├── live-cameras/           # Multi-camera RTSP streaming grid
        │   ├── camera-management/      # Camera CRUD & connection testing
        │   ├── live-checkins/          # Real-time door entry logs
        │   ├── doors/                  # Hikvision ISAPI Door Controllers config
        │   ├── history/                # Analytics & activity history
        │   ├── alerts/                 # Idle/mobile alerts table
        │   ├── sessions/               # Worker session tracking monitor
        │   ├── summary/                # Daily employee productivity summaries
        │   ├── settings/               # Thresholds & YOLO tracker tuning
        │   └── tools/                  # Network Device Scanner (Miscellaneous)
        └── components/
            ├── SidebarLayout.tsx       # Navigation sidebar with Miscellaneous section
            ├── CameraWidget.tsx        # WebSocket canvas overlay player
            └── cameras/
                └── CameraFormModal.tsx # In-place Add/Edit Camera modal
```

---

## Key Features

- 🎯 **Multi-Person Pose Estimation**: Detects up to 17 human pose keypoints per person simultaneously via `YOLO11m-pose`.
- 🔍 **Re-ID Deep Feature Tracking**: `BoT-SORT` uses visual appearance embeddings to prevent track swapping when workers cross paths or work closely together.
- 🚪 **Hikvision ISAPI Door Integration**: Automatically captures RFID/NFC door card scans from physical door terminals and correlates them with camera track IDs within a configurable time window (default: 5.0s).
- 📡 **Network Device Scanner**: Probes local `/24` subnets (ports 554, 80, 443, 8000) to discover unconfigured cameras and door controllers, with an in-place prefilled **Add Camera** modal.
- 🛠️ **Refactored Modular Architecture**: Cleanly separated FastAPI backend into specialized sub-routers (`api/settings.py`, `api/zones.py`, `api/stats.py`, `api/tools.py`, `state.py`, `ws/handler.py`).
- ❄️ **Nix Bare-Metal Reproducibility**: Uses Nix Flakes to lock system dependencies (CUDA, C++, Python 3.10, Node 20, OpenCV) for 100% reproducible execution without Docker containerization overhead.

---

## How It Works — Full Pipeline

### 1. Frame Streaming & RTSP Ingestion
Frames are captured either directly from RTSP streams via `StreamManager` or sent via base64 encoded WebSocket frames from `CameraWidget.tsx`.

### 2. Pose Detection & BoT-SORT Tracking
- The `WorkerDetector` runs `yolo11m-pose.pt` at `conf=0.3` to detect bounding boxes and 17 keypoints.
- Bounding boxes and feature maps are passed to `custom_tracker.yaml` (BoT-SORT with `track_buffer: 120` and `with_reid: True`).

### 3. Identity Correlation
- Physical door entry events are registered in `CorrelationEngine`.
- When a new track ID appears on a camera, the engine pairs the track with the earliest unmatched door scan within `correlation_window_seconds`.
- An active `WorkerSession` is created in memory and saved to PostgreSQL.

### 4. Activity Classification
`ActivityClassifier` evaluates pose metrics per frame:
- **`working`**: Movement score is above sensitivity and keypoints are inside the workstation zone.
- **`walking`**: Movement score is above sensitivity but keypoints are outside the zone.
- **`idle`**: Movement score remains below threshold. If idle duration exceeds `idle_threshold_seconds`, an `Alert` is created.
- **`no_person`**: No detection in frame.

---

## Nix Reproducible Runtime

This project uses **Nix** as a native bare-metal alternative to Docker containerization. All system libraries (`libGL`, `glib`, `FFmpeg`, `CUDA` tooling) and language environments are locked in `flake.nix` and `backend/requirements.lock`.

### Activating the Environment:
```bash
# Enter the pinned native shell environment:
nix develop
# or: nix-shell
```

### Native Helper Commands:
```bash
run-backend   # Starts FastAPI backend with live reload
run-frontend  # Starts Next.js frontend
```

---

## Database Schema

- **`activity_logs`**: Periodic snapshots (every 25 frames) of camera track activities.
- **`alerts`**: AI-triggered idle and violation alerts.
- **`worker_sessions`**: Active and closed worker presence sessions linked to real-world `employee_id`s.
- **`identity_events`**: Door check-in event audit trail from Hikvision controllers.
- **`employee_daily_summary`**: Aggregated daily working, walking, and idle durations per employee.
- **`cameras`**: Configured RTSP camera credentials, stream parameters, and door pairings.
- **`workstation_zones`**: Per-camera normalized boundary coordinates (`x_min`, `y_min`, `x_max`, `y_max`).

---

## API Reference

### WebSocket
- `WS /ws` — Real-time camera frame processing & tracking result stream.

### REST Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | API health status |
| `GET` | `/api/stats` | System metrics & productivity stats |
| `GET` | `/api/alerts` | Recent alerts list |
| `PUT` | `/api/alerts/{id}/resolve` | Resolve an alert |
| `GET` | `/api/settings` | Get all configuration parameters |
| `POST` | `/api/settings` | Save settings & update live pipeline |
| `GET` | `/api/zones/{camera_id}` | Read workstation zone |
| `POST` | `/api/zones/{camera_id}` | Set workstation zone |
| `GET` | `/api/cameras` | List configured cameras |
| `POST` | `/api/cameras` | Create new camera configuration |
| `POST` | `/api/cameras/{id}/test` | Test RTSP camera connection |
| `POST` | `/api/tools/scan` | Trigger background network scan |
| `GET` | `/api/tools/scan/results` | Get discovered unconfigured devices |
| `GET` | `/api/tools/subnet` | Get local auto-detected subnet |
| `GET` | `/api/identity/doors/config` | Read Hikvision door controller list |
| `POST` | `/api/identity/doors/config` | Update door controllers & trigger proxy reload |

---

## Frontend Navigation

- **Dashboard (`/`)**: Live metric cards, active alerts counter, productivity score, and camera feed player.
- **Live Cameras (`/live-cameras`)**: Multi-camera grid view for RTSP streams.
- **Camera Management (`/camera-management`)**: Add, edit, test, or remove cameras.
- **Live Check-ins (`/live-checkins`)**: Real-time stream of door access events.
- **Door Configs (`/doors`)**: Configure Hikvision ISAPI door IPs and auto-switch identity provider.
- **Session Monitor (`/sessions`)**: Track active worker sessions and track ID assignments.
- **Activity Summary (`/summary`)**: Daily productivity breakdown per employee.
- **Settings (`/settings`)**: Adjust YOLO confidence, idle thresholds, tracker parameters, and streaming transport.
- **Network Scanner (`/tools`)**: Discover unconfigured devices on local subnets under the **Miscellaneous** sidebar section.

---

## Running the System

### Prerequisites
- Docker (for PostgreSQL only)
- *NVIDIA GPU with CUDA support (Recommended for YOLO inference)*
- **Linux:** [Nix](https://nixos.org/download/) package manager
- **Windows:** Python 3.10+ and Node.js 20+

### Setup and Start (Linux)
The Linux environment relies natively on Nix for 100% reproducible execution.
```bash
# 1. Clone the repository and run setup (installs dependencies)
./install.sh

# 2. Start the database, backend API, and frontend
./start.sh
```

### Setup and Start (Windows)
The Windows environment uses standard Python `venv` and `npm`.
```powershell
# 1. Clone the repository and run setup (installs dependencies)
.\install.ps1

# 2. Start the database, backend API, and frontend
.\start.ps1
```

### Accessing the Dashboard
Navigate to **`http://localhost:3000`** in your web browser.

---

## Environment Variables

Backend environment configuration (`backend/.env`):
```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/worker_monitor
DEFAULT_RTSP_PORT=554
STREAM_RECONNECT_INTERVAL=5
FRAME_BUFFER_SIZE=5
```

## Network path : \\DESKTOP-900004F\Aashif