<#
.SYNOPSIS
Starts the CALVISION environment (Backend, Frontend, and Database) on Windows.
#>

$ErrorActionPreference = "Stop"

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   Starting CALVISION (Windows)          " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Validate configuration
if (-not (Test-Path ".env") -and -not (Test-Path "backend\.env")) {
    Write-Host "❌ Error: .env file not found." -ForegroundColor Red
    Write-Host "Please run .\install.ps1 first."
    exit 1
}

# 2. Cleanup existing processes on ports 3000 and 8000
Write-Host "🧹 Cleaning up existing processes on ports 3000 and 8000..." -ForegroundColor Yellow
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
    Write-Host "⚠️  Warning: Docker not found. Assuming database is managed externally." -ForegroundColor Yellow
} else {
    Write-Host "🐳 Starting database..." -ForegroundColor Yellow
    $ExistingContainer = docker ps -a --format '{{.Names}}' | Select-String -Pattern "^worker_monitor_db$"
    if ($ExistingContainer) {
        Write-Host "🐳 Starting existing worker_monitor_db container..." -ForegroundColor Yellow
        docker start worker_monitor_db
    } else {
        if (Test-Path "docker-compose.yml") {
            docker compose up -d db
        } elseif (Test-Path "backend\docker-compose.yml") {
            Push-Location backend
            try {
                docker compose up -d db
            } finally {
                Pop-Location
            }
        }
    }
}

# 4. Start services
Write-Host "🚀 Starting backend and frontend in the background..." -ForegroundColor Yellow

$UvicornPath = "$PWD\backend\venv\Scripts\uvicorn.exe"
if (-not (Test-Path $UvicornPath)) {
    Write-Host "❌ Error: Backend virtual environment not found. Please run .\install.ps1" -ForegroundColor Red
    exit 1
}

$BackendProcess = Start-Process -FilePath $UvicornPath -ArgumentList "src.main:app --host 0.0.0.0 --port 8000 --reload" -WorkingDirectory "backend" -NoNewWindow -PassThru
$FrontendProcess = Start-Process -FilePath "npm.cmd" -ArgumentList "run dev" -WorkingDirectory "frontend" -NoNewWindow -PassThru

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "✅ System is running." -ForegroundColor Green
Write-Host "   - Frontend: http://localhost:3000"
Write-Host "   - Backend API: http://localhost:8000"
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host "=========================================" -ForegroundColor Cyan

# Setup Ctrl+C handler and wait
try {
    # Keep script running to allow Ctrl+C to be caught in the console
    while (-not $BackendProcess.HasExited -and -not $FrontendProcess.HasExited) {
        Start-Sleep -Seconds 1
    }
} finally {
    Write-Host ""
    Write-Host "🛑 Shutting down CALVISION..." -ForegroundColor Yellow
    if (-not $BackendProcess.HasExited) { Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue }
    if (-not $FrontendProcess.HasExited) { Stop-Process -Id $FrontendProcess.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "✅ Shutdown complete." -ForegroundColor Green
}
