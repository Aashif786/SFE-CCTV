<#
.SYNOPSIS
Installs and sets up the CALVISION environment for Windows using standard Python and Node.js.
#>

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   CALVISION Windows Setup (Standard)    " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Verify Python
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Python is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Python 3.10+ to proceed."
    exit 1
}
Write-Host "[OK] Python is installed." -ForegroundColor Green

# 2. Verify Node.js
if (-not (Get-Command "npm" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js (npm) is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please install Node.js 20+ to proceed."
    exit 1
}
Write-Host "[OK] Node.js is installed." -ForegroundColor Green

# 3. Verify Docker
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Docker is not installed (required for PostgreSQL)." -ForegroundColor Red
    Write-Host "Please install Docker Desktop."
    exit 1
}
Write-Host "[OK] Docker is installed." -ForegroundColor Green

# 4. Create .env and settings.json if they don't exist
if (-not (Test-Path ".env")) {
    if (Test-Path "backend\.env.example") {
        Write-Host "[INFO] Creating .env from backend\.env.example..." -ForegroundColor Yellow
        Copy-Item "backend\.env.example" ".env"
    } else {
        Write-Host "[WARNING] Could not find backend\.env.example to create .env." -ForegroundColor Yellow
    }
} else {
    Write-Host "[OK] .env file already exists." -ForegroundColor Green
}

if (-not (Test-Path "backend\settings.json")) {
    if (Test-Path "backend\settings.example.json") {
        Write-Host "[INFO] Creating backend\settings.json from backend\settings.example.json..." -ForegroundColor Yellow
        Copy-Item "backend\settings.example.json" "backend\settings.json"
    }
} else {
    Write-Host "[OK] backend\settings.json already exists." -ForegroundColor Green
}


# 5. Setup Python Virtual Environment and GPU-Accelerated Backend Dependencies
Write-Host "[INFO] Setting up Python Virtual Environment with CUDA GPU acceleration..." -ForegroundColor Yellow
$PythonLauncher = "python"
if (Get-Command "py" -ErrorAction SilentlyContinue) {
    if (py -3.13 --version 2>$null) {
        $PythonLauncher = "py -3.13"
    } elseif (py -3.12 --version 2>$null) {
        $PythonLauncher = "py -3.12"
    }
}

if (-not (Test-Path "backend\venv")) {
    Invoke-Expression "$PythonLauncher -m venv backend\venv"
}

$PyCmd = "backend\venv\Scripts\python.exe"
if (Test-Path $PyCmd) {
    Write-Host "[INFO] Upgrading pip..." -ForegroundColor Yellow
    & $PyCmd -m pip install --upgrade pip 2>$null

    # ── GPU Detection ──────────────────────────────────────────────────
    $HasGPU = $false
    try {
        $NvidiaSmiOutput = & nvidia-smi --query-gpu=name --format=csv,noheader 2>$null
        if ($LASTEXITCODE -eq 0 -and $NvidiaSmiOutput) {
            $HasGPU = $true
            Write-Host "[INFO] NVIDIA GPU detected: $NvidiaSmiOutput" -ForegroundColor Green
        }
    } catch {}

    if ($HasGPU) {
        Write-Host "[INFO] Installing PyTorch with CUDA 12.4 & ONNX Runtime GPU..." -ForegroundColor Yellow
        & $PyCmd -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
        & $PyCmd -m pip install onnxruntime-gpu
    } else {
        Write-Host "[INFO] No NVIDIA GPU found. Installing CPU-only PyTorch..." -ForegroundColor Yellow
        & $PyCmd -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
        & $PyCmd -m pip install onnxruntime
    }

    # ── Dynamically add user site-packages to venv search path ────────
    # This allows GPU wheels installed in the user profile to be found
    $UserSite = & $PyCmd -c "import site; print(site.getusersitepackages())" 2>$null
    $SystemSite = & $PyCmd -c "import site; print(site.getsitepackages()[0])" 2>$null
    if ($UserSite) {
        $PthFile = "backend\venv\Lib\site-packages\custom_gpu_paths.pth"
        @($UserSite, $SystemSite) | Where-Object { $_ } | Out-File -FilePath $PthFile -Encoding utf8 -Force
    }

    Write-Host "[INFO] Installing remaining backend dependencies..." -ForegroundColor Yellow
    if (Test-Path "backend\requirements.txt") {
        # Filter out torch/onnxruntime — already installed above with the correct GPU build
        $filteredDeps = Get-Content "backend\requirements.txt" | Where-Object {
            $_ -notmatch '^(torch|torchvision|onnxruntime)' -and $_ -ne ''
        }
        $tmpReq = [System.IO.Path]::GetTempFileName() + ".txt"
        $filteredDeps | Out-File -FilePath $tmpReq -Encoding utf8
        & $PyCmd -m pip install -r $tmpReq
        Remove-Item $tmpReq -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "[ERROR] Virtual environment python executable not found." -ForegroundColor Red
    exit 1
}

# 6. Install frontend dependencies
Write-Host "[INFO] Installing frontend dependencies..." -ForegroundColor Yellow
Push-Location frontend
try {
    npm install
} finally {
    Pop-Location
}

# 7. Pull Docker image AND create the database container
Write-Host "[INFO] Pulling PostgreSQL Docker image..." -ForegroundColor Yellow
$ComposeFile = Join-Path (Get-Location) "docker-compose.yml"
if (-not (Test-Path $ComposeFile)) {
    Write-Host "[ERROR] docker-compose.yml not found at $ComposeFile" -ForegroundColor Red
    exit 1
}

# Verify Docker Engine is actually running before we try to use it
$DockerRunning = $false
try {
    docker info *>$null
    if ($LASTEXITCODE -eq 0) { $DockerRunning = $true }
} catch {}

if (-not $DockerRunning) {
    Write-Host "[ERROR] Docker Desktop is not running." -ForegroundColor Red
    Write-Host "Start Docker Desktop and re-run .\install.ps1" -ForegroundColor Yellow
    exit 1
}

docker compose -f $ComposeFile pull db
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARNING] Docker image pull failed (offline?). Will try with cached image." -ForegroundColor Yellow
}

# Create and start the container (idempotent — safe to run again if it already exists)
Write-Host "[INFO] Creating and starting the PostgreSQL database container..." -ForegroundColor Yellow
docker compose -f $ComposeFile up -d db
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to start the PostgreSQL container via Docker Compose." -ForegroundColor Red
    exit 1
}

# Wait for the container to pass its healthcheck before finishing install
Write-Host "[INFO] Waiting for PostgreSQL to become healthy (up to 60s)..." -ForegroundColor Yellow
$DbReady = $false
$Deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $Deadline) {
    $Health = docker inspect --format '{{.State.Health.Status}}' worker_monitor_db 2>$null
    if ($LASTEXITCODE -eq 0 -and $Health -eq "healthy") {
        $DbReady = $true
        break
    }
    if ($Health -eq "unhealthy") {
        Write-Host "[ERROR] PostgreSQL container is unhealthy." -ForegroundColor Red
        Write-Host "Run 'docker compose logs db' to see the database error." -ForegroundColor Yellow
        exit 1
    }
    Start-Sleep -Seconds 2
}

if (-not $DbReady) {
    Write-Host "[WARNING] PostgreSQL did not confirm healthy within 60s." -ForegroundColor Yellow
    Write-Host "The container is running but may still be initialising." -ForegroundColor Yellow
    Write-Host "start.ps1 will wait again — this is normal on first run." -ForegroundColor Yellow
} else {
    Write-Host "[OK] PostgreSQL container is healthy and ready." -ForegroundColor Green
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "[OK] Setup complete!" -ForegroundColor Green
Write-Host "Run .\start.ps1 to launch the application." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
