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

# 5. Setup Python Virtual Environment and Backend Dependencies
Write-Host "[INFO] Setting up Python Virtual Environment..." -ForegroundColor Yellow
if (-not (Test-Path "backend\venv")) {
    python -m venv backend\venv
}

$PipCmd = "backend\venv\Scripts\pip.exe"
if (Test-Path $PipCmd) {
    Write-Host "[INFO] Installing backend dependencies..." -ForegroundColor Yellow
    if (Test-Path "backend\requirements.lock") {
        & $PipCmd install -r backend\requirements.lock
    } elseif (Test-Path "backend\requirements.txt") {
        & $PipCmd install -r backend\requirements.txt
    } else {
        Write-Host "[WARNING] Could not find requirements.lock or requirements.txt in the backend folder." -ForegroundColor Yellow
    }
} else {
    Write-Host "[ERROR] Virtual environment pip not found." -ForegroundColor Red
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
