<#
.SYNOPSIS
Starts the CALVISION environment (Backend, Frontend, and Database) on Windows.
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectRoot

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   Starting CALVISION (Windows)          " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Validate configuration
if (-not (Test-Path ".env") -and -not (Test-Path "backend\.env")) {
    Write-Host "[ERROR] .env file not found." -ForegroundColor Red
    Write-Host "Please run .\install.ps1 first."
    exit 1
}

# 2. Cleanup existing processes on ports 3000 and 8000
Write-Host "[INFO] Cleaning up existing processes on ports 3000 and 8000..." -ForegroundColor Yellow
$Ports = @(3000, 8000)
foreach ($Port in $Ports) {
    try {
        $Connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        foreach ($Conn in $Connections) {
            $PidToKill = $Conn.OwningProcess
            if ($PidToKill -ne 0) {
                Write-Host "Killing process $PidToKill on port $Port"
                Stop-Process -Id $PidToKill -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {}
}

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
    # Windows PowerShell treats native-command stderr as a terminating error
    # when ErrorActionPreference is Stop.
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
    # Try inspecting by container_name first (worker_monitor_db)
    $Health = (cmd /c "docker inspect --format {{.State.Health.Status}} worker_monitor_db 2>NUL")
    if ($Health) {
        $Health = $Health.Trim()
    }
    
    # Fallback to docker compose ps -q db if container_name inspect didn't return health
    if (-not $Health -or $Health -eq "missing") {
        $TargetId = (cmd /c "docker compose -f `"$ComposeFile`" ps -q db 2>NUL")
        if ($TargetId) {
            $TargetId = $TargetId.Trim()
            $Health = (cmd /c "docker inspect --format {{.State.Health.Status}} $TargetId 2>NUL")
            if ($Health) { $Health = $Health.Trim() }
        }
    }

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

# Compose initializes POSTGRES_PASSWORD only for a new data volume. If an old
# volume exists, synchronize the postgres role password with docker-compose.yml.
Write-Host "[INFO] Verifying PostgreSQL credentials..." -ForegroundColor Yellow
cmd /c "docker compose -f `"$ComposeFile`" exec -T db psql -U postgres -d worker_monitor -c `"ALTER USER postgres WITH PASSWORD 'password';`" 2>NUL"
if ($LASTEXITCODE -ne 0) {
    cmd /c "docker exec worker_monitor_db psql -U postgres -d worker_monitor -c `"ALTER USER postgres WITH PASSWORD 'password';`" 2>NUL"
}

# Ensure the backend uses the same database credentials as the Compose service.
$env:DATABASE_URL = "postgresql+pg8000://postgres:password@127.0.0.1:5433/worker_monitor"

# 4. Start services
Write-Host "[INFO] Starting backend and frontend in the background..." -ForegroundColor Yellow

$PythonPath = "$PWD\backend\venv\Scripts\python.exe"
if (-not (Test-Path $PythonPath)) {
    Write-Host "[ERROR] Backend virtual environment not found. Please run .\install.ps1" -ForegroundColor Red
    exit 1
}

$BackendProcess = $null
$FrontendProcess = $null
$StartupFailed = $false

try {
    $BackendProcess = Start-Process -FilePath $PythonPath -ArgumentList "-m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload" -WorkingDirectory (Join-Path $ProjectRoot "backend") -NoNewWindow -PassThru
    $FrontendProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run dev" -WorkingDirectory (Join-Path $ProjectRoot "frontend") -NoNewWindow -PassThru

    Write-Host "[INFO] Waiting for backend and frontend..." -ForegroundColor Yellow
    $ServicesReady = $false
    $ServiceDeadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $ServiceDeadline) {
        if ($BackendProcess.HasExited -or $FrontendProcess.HasExited) {
            break
        }

        $BackendReady = $false
        $FrontendReady = $false
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:8000/docs" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null
            $BackendReady = $true
        } catch {}
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:3000" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null
            $FrontendReady = $true
        } catch {}

        if ($BackendReady -and $FrontendReady) {
            $ServicesReady = $true
            break
        }
        Start-Sleep -Seconds 2
    }

    if (-not $ServicesReady) {
        $StartupFailed = $true
        if ($BackendProcess.HasExited) {
            Write-Host "[ERROR] Backend stopped during startup. Check the database credentials and backend logs." -ForegroundColor Red
        } elseif ($FrontendProcess.HasExited) {
            Write-Host "[ERROR] Frontend stopped during startup." -ForegroundColor Red
        } else {
            Write-Host "[ERROR] Backend or frontend did not become ready within 60 seconds." -ForegroundColor Red
        }
        exit 1
    }

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "[OK] System is running." -ForegroundColor Green
Write-Host "   - Frontend: http://localhost:3000"
Write-Host "   - Backend API: http://localhost:8000"
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Cyan

    # Keep script running while services are active.
    # We check network listeners and process handles, allowing a grace window for hot-reloads.
    $BackendDownCount = 0
    $FrontendDownCount = 0
    $MAX_DOWN_COUNT = 15  # Allow up to 30s for uvicorn hot-reload & model re-initialization

    while ($true) {
        Start-Sleep -Seconds 2
        
        $BackendListening = $false
        $FrontendListening = $false

        try {
            $BackendConn = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
            if ($BackendConn) { $BackendListening = $true }
        } catch {}

        try {
            $FrontendConn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
            if ($FrontendConn) { $FrontendListening = $true }
        } catch {}

        if ($BackendListening -or (-not $BackendProcess.HasExited)) {
            $BackendDownCount = 0
        } else {
            $BackendDownCount++
        }

        if ($FrontendListening -or (-not $FrontendProcess.HasExited)) {
            $FrontendDownCount = 0
        } else {
            $FrontendDownCount++
        }

        if ($BackendDownCount -ge $MAX_DOWN_COUNT -and $FrontendDownCount -ge $MAX_DOWN_COUNT) {
            $StartupFailed = $true
            Write-Host "[ERROR] CALVISION services stopped listening on ports 8000 and 3000." -ForegroundColor Red
            break
        }
    }
} finally {
    Write-Host ""
    Write-Host "[INFO] Shutting down CALVISION..." -ForegroundColor Yellow
    if ($BackendProcess -and -not $BackendProcess.HasExited) { Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($FrontendProcess -and -not $FrontendProcess.HasExited) { Stop-Process -Id $FrontendProcess.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "[OK] Shutdown complete." -ForegroundColor Green
}

if ($StartupFailed) { exit 1 }
