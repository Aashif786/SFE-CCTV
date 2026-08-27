# CALVISION Backend Startup Script
# Kills any orphan process holding port 8001 before starting the server.

Write-Host "Checking for processes on port 8001..." -ForegroundColor Cyan

$pids = (netstat -ano | Select-String ":8001 " | ForEach-Object {
    ($_ -split '\s+')[-1]
} | Sort-Object -Unique | Where-Object { $_ -match '^\d+$' -and $_ -ne '0' })

foreach ($p in $pids) {
    try {
        $proc = Get-Process -Id $p -ErrorAction Stop
        if ($proc.Name -match 'python|uvicorn') {
            Write-Host "  Killing orphan process: $p ($($proc.Name))" -ForegroundColor Yellow
            Stop-Process -Id $p -Force
        }
    } catch { }
}

if ($pids) { Start-Sleep -Seconds 2 }

Write-Host "Starting CALVISION backend on port 8001..." -ForegroundColor Green
& "$PSScriptRoot\venv\Scripts\python.exe" -m uvicorn src.main:app --host 0.0.0.0 --port 8001
