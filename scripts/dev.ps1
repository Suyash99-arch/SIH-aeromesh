# ==============================================================================
# HEXA SPARK / AEROMESH - ONE-COMMAND LOCAL DEVELOPMENT RUNNER
# ==============================================================================
# This script:
#  1. Verifies Python 3.11 (.venv311)
#  2. Verifies FFmpeg and FFprobe binary availability
#  3. Verifies a single OpenCV package (opencv-python-headless, no conflicts)
#  4. Automatically initializes .env from .env.example if missing
#  5. Launches backend (uvicorn) and frontend (Vite) in dedicated terminal windows
#  6. Polls /api/v1/health until backend is ready
#  7. Opens browser at frontend URL (proxied to backend on 127.0.0.1:8000)
# ==============================================================================

param(
    [switch]$Reload
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "HEXA SPARK / AEROMESH LOCAL DEVELOPMENT RUNNER" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# 1. Check Python 3.11 Canonical Environment
$PythonExe = Join-Path $RepoRoot ".venv311\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    Write-Host "[ERROR] Canonical virtual environment .venv311 not found at: $PythonExe" -ForegroundColor Red
    Write-Host "Please create Python 3.11 environment: py -3.11 -m venv .venv311" -ForegroundColor Yellow
    exit 1
}

$PyVer = & $PythonExe -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"
if (-not ($PyVer -like "3.11*")) {
    Write-Host "[ERROR] Python version $PyVer is not 3.11. Canonical requirement is Python 3.11." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Python 3.11 Environment Verified: $PyVer ($PythonExe)" -ForegroundColor Green

# 2. Check FFmpeg / FFprobe
try {
    $FfmpegCheck = & $PythonExe -c "from backend.env_check import check_ffmpeg_environment; res = check_ffmpeg_environment(strict=True); print(res.get('ffmpeg_path', ''))"
    Write-Host "[OK] FFmpeg / FFprobe Verified: $FfmpegCheck" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] FFmpeg environment check failed: $_" -ForegroundColor Red
    exit 1
}

# 3. Check OpenCV Environment (Single Package Check)
try {
    $CvCheck = & $PythonExe -c "from backend.env_check import check_opencv_environment; res = check_opencv_environment(strict=True); pkg = res['packages'][0] if res.get('packages') else 'opencv'; ver = res.get('version', ''); print(f'{pkg} v{ver}')"
    Write-Host "[OK] OpenCV Environment Verified: $CvCheck (Conflict-Free)" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] OpenCV environment check failed: $_" -ForegroundColor Red
    exit 1
}

# 4. Check or Create .env from .env.example
$EnvFile = Join-Path $RepoRoot ".env"
$EnvExample = Join-Path $RepoRoot ".env.example"
if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExample) {
        Copy-Item $EnvExample $EnvFile
        Write-Host "[Setup] Created .env configuration from .env.example" -ForegroundColor Yellow
    } else {
        Write-Host "[WARNING] Neither .env nor .env.example found. Proceeding with defaults." -ForegroundColor Yellow
    }
} else {
    Write-Host "[OK] Local configuration .env present." -ForegroundColor Green
}

# Pre-flight check: Refuse to start if port 8000 is already in use
try {
    $existingConns = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if ($existingConns) {
        $busyPid = $existingConns[0].OwningProcess
        Write-Host "[ERROR] Port 8000 is already in use by process PID $busyPid. Refusing to start duplicate backend instance." -ForegroundColor Red
        Write-Host "Please terminate the existing backend instance before launching a new one: Stop-Process -Id $busyPid -Force" -ForegroundColor Yellow
        exit 1
    }
} catch {
    # If Get-NetTCPConnection is unavailable, continue
}

# 5. Launch Backend in Separate Terminal Window
$ReloadArgs = ""
if ($Reload) {
    Write-Host "`n[Backend] Opt-in live reload ENABLED for backend/ directory only." -ForegroundColor Yellow
    $ReloadArgs = "--reload --reload-dir backend"
} else {
    Write-Host "`n[Backend] Running in STABLE mode (no --reload, immune to data/ file writes)." -ForegroundColor Green
}
Write-Host "[Backend] Launching FastAPI backend server on http://127.0.0.1:8000..." -ForegroundColor Cyan
$BackendCmd = "cd '$RepoRoot'; Write-Host 'Starting Hexa Spark Backend...' -ForegroundColor Cyan; & '$PythonExe' -m uvicorn backend.main:app $ReloadArgs --host 127.0.0.1 --port 8000"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $BackendCmd -WorkingDirectory $RepoRoot

# 6. Wait for Backend Health Check
Write-Host "[Health] Awaiting backend readiness at http://127.0.0.1:8000/api/v1/health..." -ForegroundColor Yellow
$BackendReady = $false
$Attempts = 0
$MaxAttempts = 30

while (-not $BackendReady -and ($Attempts -lt $MaxAttempts)) {
    Start-Sleep -Milliseconds 1000
    $Attempts++
    try {
        $HealthResp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
        if ($HealthResp.status -eq "healthy") {
            $BackendReady = $true
            Write-Host "[OK] Backend Healthy! DB Backend: $($HealthResp.db), Pipeline: $($HealthResp.pipeline_enabled)" -ForegroundColor Green
        }
    } catch {
        Write-Host -NoNewline "."
    }
}

if (-not $BackendReady) {
    Write-Host "`n[ERROR] Backend failed to become healthy within $MaxAttempts seconds." -ForegroundColor Red
    Write-Host "Please check the Backend console window for startup exceptions." -ForegroundColor Yellow
    exit 1
}

# 7. Launch Frontend in Separate Terminal Window
Write-Host "`n[Frontend] Launching Vite development server..." -ForegroundColor Cyan
$FrontendDir = Join-Path $RepoRoot "frontend"
$FrontendCmd = "cd '$FrontendDir'; Write-Host 'Starting Hexa Spark Frontend (Vite)...' -ForegroundColor Cyan; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $FrontendCmd -WorkingDirectory $FrontendDir

# 8. Open Browser
Start-Sleep -Seconds 2
$FrontendUrl = "http://localhost:5173"
Write-Host "`n[Browser] Opening application at $FrontendUrl (API proxied via Vite to 127.0.0.1:8000)..." -ForegroundColor Green
Start-Process $FrontendUrl

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "HEXA SPARK / AEROMESH DEV SERVERS ARE LIVE!" -ForegroundColor Cyan
Write-Host "Backend URL  : http://127.0.0.1:8000 (Swagger docs at /docs)" -ForegroundColor White
Write-Host "Frontend URL : $FrontendUrl (Proxied same-origin API)" -ForegroundColor White
Write-Host "To shut down : Close the spawned backend and frontend PowerShell windows." -ForegroundColor White
Write-Host "================================================================================`n" -ForegroundColor Cyan
