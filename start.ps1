<#
.SYNOPSIS
Starts the CALVISION Backend and Database on Windows.
(Frontend can be run separately via 'npm run dev' in the frontend folder)
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   Starting CALVISION Backend (Windows)  " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Validate configuration
if (-not (Test-Path ".env") -and -not (Test-Path "backend\.env")) {
    Write-Host "[ERROR] .env file not found." -ForegroundColor Red
    Write-Host "Please run .\install.ps1 first."
    exit 1
}

# 2. Cleanup existing process on port 8000
Write-Host "[INFO] Checking port 8000..." -ForegroundColor Yellow
try {
    $Killed = $false
    $Connections = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
    foreach ($Conn in $Connections) {
        $PidToKill = $Conn.OwningProcess
        if ($PidToKill -ne 0) {
            Write-Host "Killing process $PidToKill on port 8000..."
            & taskkill /F /T /PID $PidToKill 2>$null
            $Killed = $true
        }
    }
    if ($Killed) {
        Start-Sleep -Seconds 2
    }
} catch {}



# 3. Start PostgreSQL
if (-not (Get-Command "docker" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Docker is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Checking Docker Engine..." -ForegroundColor Yellow
$DockerEngineAvailable = $true
try {
    docker info *> $null
    if ($LASTEXITCODE -ne 0) {
        $DockerEngineAvailable = $false
    }
} catch {
    $DockerEngineAvailable = $false
}
if (-not $DockerEngineAvailable) {
    Write-Host "[ERROR] Docker Desktop is not running or the Docker Engine is unavailable." -ForegroundColor Red
    Write-Host "Start Docker Desktop, wait until it is ready, and run .\start.ps1 again." -ForegroundColor Yellow
    exit 1
}

$ComposeFile = Join-Path $ProjectRoot "docker-compose.yml"
if (-not (Test-Path $ComposeFile)) {
    Write-Host "[ERROR] docker-compose.yml was not found." -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Starting database..." -ForegroundColor Yellow
docker compose -f $ComposeFile up -d db
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] PostgreSQL could not be started by Docker Compose." -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Waiting for PostgreSQL to become healthy..." -ForegroundColor Yellow
$DatabaseReady = $false
$DatabaseDeadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $DatabaseDeadline) {
    $Health = ""
    try {
        $Health = (docker inspect --format "{{.State.Health.Status}}" worker_monitor_db 2>$null)
        if ($Health) {
            $Health = $Health.Trim()
        }
        
        if (-not $Health -or $Health -eq "missing") {
            $TargetId = (docker compose -f "$ComposeFile" ps -q db 2>$null)
            if ($TargetId) {
                $TargetId = $TargetId.Trim()
                $Health = (docker inspect --format "{{.State.Health.Status}}" $TargetId 2>$null)
                if ($Health) { $Health = $Health.Trim() }
            }
        }
    } catch {}

    if ($Health -eq "healthy") {
        $DatabaseReady = $true
        break
    }
    if ($Health -eq "unhealthy") {
        break
    }
    Start-Sleep -Seconds 2
}

if (-not $DatabaseReady) {
    Write-Host "[ERROR] PostgreSQL did not become healthy within 60 seconds." -ForegroundColor Red
    Write-Host "Run 'docker compose logs db' to inspect the database container." -ForegroundColor Yellow
    exit 1
}

# Synchronize postgres role password
Write-Host "[INFO] Verifying PostgreSQL credentials..." -ForegroundColor Yellow
try {
    docker compose -f "$ComposeFile" exec -T db psql -U postgres -d worker_monitor -c "ALTER USER postgres WITH PASSWORD 'password';" 2>$null
    if ($LASTEXITCODE -ne 0) {
        docker exec worker_monitor_db psql -U postgres -d worker_monitor -c "ALTER USER postgres WITH PASSWORD 'password';" 2>$null
    }
} catch {}

# Ensure the backend uses the correct database URL
$env:DATABASE_URL = "postgresql+pg8000://postgres:password@127.0.0.1:5433/worker_monitor"

# 4. Start Backend Service
Write-Host "[INFO] Starting CALVISION backend on port 8000..." -ForegroundColor Yellow

$PythonPath = "$PWD\backend\venv\Scripts\python.exe"
if (-not (Test-Path $PythonPath)) {
    Write-Host "[ERROR] Backend virtual environment not found. Please run .\install.ps1" -ForegroundColor Red
    exit 1
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "[OK] CALVISION Backend is running!" -ForegroundColor Green
Write-Host "   - Backend API: http://localhost:8000"
Write-Host "   - API Docs:    http://localhost:8000/docs"
Write-Host "   - Frontend:    Run 'npm run dev' in the frontend\ folder" -ForegroundColor Yellow
Write-Host "Press Ctrl+C to stop the backend." -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Cyan

Push-Location (Join-Path $ProjectRoot "backend")
try {
    & $PythonPath -m uvicorn src.main:app --host 0.0.0.0 --port 8000
} finally {
    Pop-Location
    Write-Host ""
    Write-Host "[INFO] CALVISION backend stopped." -ForegroundColor Yellow
}

