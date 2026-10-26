# SIH AeroMesh — Demo Launcher
# Starts the backend, waits for health, then starts the frontend.
# Usage: .\scripts\run_demo.ps1

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BackendDir = Join-Path $ProjectRoot "backend"
$FrontendDir = Join-Path $ProjectRoot "frontend"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  SIH AeroMesh - Hexa Spark Demo Launcher" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Run preflight check
Write-Host "[1/4] Running preflight checks..." -ForegroundColor Yellow
$preflightScript = Join-Path $ProjectRoot "scripts\preflight.py"
$pythonExe = Join-Path $BackendDir ".venv\Scripts\python.exe"
if (-not (Test-Path $pythonExe)) {
    $pythonExe = "python"
}
& $pythonExe $preflightScript
Write-Host ""

# 2. Start backend
Write-Host "[2/4] Starting backend server..." -ForegroundColor Yellow
$backendJob = Start-Job -ScriptBlock {
    param($root, $python)
    Set-Location $root
    & $python -m backend.main 2>&1
} -ArgumentList $ProjectRoot, $pythonExe

Write-Host "  Backend started (Job ID: $($backendJob.Id))" -ForegroundColor Green

# 3. Wait for health check
Write-Host "[3/4] Waiting for backend health check..." -ForegroundColor Yellow
$maxWait = 60
$waited = 0
$healthy = $false

while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 2
    $waited += 2
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/v1/health" -UseBasicParsing -TimeoutSec 3
        if ($response.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {
        Write-Host "  Waiting... ($waited s)" -ForegroundColor DarkGray
    }
}

if (-not $healthy) {
    Write-Host "  [FAIL] Backend did not start within $maxWait seconds." -ForegroundColor Red
    Write-Host "  Check backend logs: Receive-Job $($backendJob.Id)" -ForegroundColor Red
    exit 1
}

Write-Host "  [OK] Backend is healthy!" -ForegroundColor Green
Write-Host ""

# 4. Start frontend
Write-Host "[4/4] Starting frontend dev server..." -ForegroundColor Yellow
$frontendJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    npm run dev 2>&1
} -ArgumentList $FrontendDir

Start-Sleep -Seconds 4
Write-Host "  Frontend started (Job ID: $($frontendJob.Id))" -ForegroundColor Green

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  AeroMesh Demo Running!" -ForegroundColor Green
Write-Host "  Backend:  http://127.0.0.1:8000" -ForegroundColor White
Write-Host "  Frontend: http://localhost:5173 (open with no ?mission= parameter)" -ForegroundColor White
Write-Host "" -ForegroundColor White
Write-Host "  Press Ctrl+C to stop all services." -ForegroundColor DarkGray
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Keep alive — show logs interactively
try {
    while ($true) {
        $backendOutput = Receive-Job $backendJob -ErrorAction SilentlyContinue
        if ($backendOutput) {
            $backendOutput | ForEach-Object { Write-Host "[Backend] $_" -ForegroundColor DarkCyan }
        }
        $frontendOutput = Receive-Job $frontendJob -ErrorAction SilentlyContinue
        if ($frontendOutput) {
            $frontendOutput | ForEach-Object { Write-Host "[Frontend] $_" -ForegroundColor DarkYellow }
        }
        Start-Sleep -Seconds 2
    }
} finally {
    Write-Host "`nShutting down..." -ForegroundColor Yellow
    Stop-Job $backendJob -ErrorAction SilentlyContinue
    Stop-Job $frontendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob -ErrorAction SilentlyContinue
    Remove-Job $frontendJob -ErrorAction SilentlyContinue
    Write-Host "All services stopped." -ForegroundColor Green
}
