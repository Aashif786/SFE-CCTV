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

# 4. Create .env if it doesn't exist
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

# 7. Pull Docker images
Write-Host "[INFO] Pulling Docker images..." -ForegroundColor Yellow
if (Test-Path "docker-compose.yml") {
    docker compose pull db
} elseif (Test-Path "backend\docker-compose.yml") {
    Push-Location backend
    try {
        docker compose pull db
    } finally {
        Pop-Location
    }
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "[OK] Setup complete!" -ForegroundColor Green
Write-Host "Run .\start.ps1 to launch the application." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
