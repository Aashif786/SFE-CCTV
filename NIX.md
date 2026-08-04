# CALVISION — Native Nix Reproducible System (Zero Docker Containers)

This project uses **Nix** as a **native alternative to Docker containerization** to lock all system libraries (C++, OpenCV, CUDA runtime, FFmpeg), language environments (Python 3.10, Node.js 20), and package dependencies into a 100% reproducible bare-metal runtime on the host machine.

---

## Why Nix Instead of Docker?

| Feature | Docker Containers | Native Nix Environment (Chosen Approach) |
| :--- | :--- | :--- |
| **Execution Mode** | Virtualized container filesystem isolation | **Native bare-metal performance on host** |
| **GPU / CUDA Access** | Requires `nvidia-container-toolkit` setup | **Direct host GPU acceleration with 0 overhead** |
| **Network Discovery** | Requires `network_mode: host` workarounds | **Direct local LAN socket access for RTSP & Scanner** |
| **Dependency Lock** | Dockerfile `apt-get` / `pip` network variations | **Bit-for-bit pinned Nix store dependency graph** |
| **Development Speed** | Image rebuild overhead | **Instant hot-reloading (`npm run dev`, `uvicorn --reload`)** |

---

## Project Files & Roles

| File | Purpose |
| :--- | :--- |
| **`flake.nix`** | Master Nix Flake providing the native pinned environment, shared library paths (`LD_LIBRARY_PATH`), and native execution apps (`run-backend`, `run-frontend`). |
| **`backend/requirements.lock`** | Pinned explicit versions for all Python packages (FastAPI, PyTorch, Ultralytics, OpenCV, SQLAlchemy, etc.). |
| **`shell.nix`** | Classic `nix-shell` wrapper. |
| **`.envrc`** | `direnv` integration for automatic shell activation when navigating to the project directory. |

---

## How to Run Natively with Nix

### 1. Activate Pinned Environment
```bash
# With Nix Flakes:
nix develop

# Or with classic nix-shell:
nix-shell
```

### 2. Run Application Components Natively
```bash
# Start backend (from any directory inside nix shell):
run-backend

# Or directly via nix run:
nix run .#backend

# Start frontend (from any directory inside nix shell):
run-frontend

# Or directly via nix run:
nix run .#frontend
```
