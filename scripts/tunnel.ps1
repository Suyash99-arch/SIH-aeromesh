# ==============================================================================
# AEROMESH - BACKEND & NGROK TUNNEL RUNNER
# ==============================================================================
# Starts:
#  1. FastAPI backend on 127.0.0.1:8000 (uvicorn, demo mode without --reload)
#  2. ngrok tunnel with traffic policy to skip browser warning
# ==============================================================================

param(
    [switch]$Reload
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "AEROMESH BACKEND & NGROK TUNNEL LAUNCHER" -ForegroundColor Cyan
Write-Host "================================================================================" -ForegroundColor Cyan

# 1. Locate Python Environment (.venv311 or .venv)
$PythonExe = Join-Path $RepoRoot ".venv311\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    $PythonExe = Join-Path $RepoRoot ".venv\Scripts\python.exe"
}
if (-not (Test-Path $PythonExe)) {
    Write-Host "[ERROR] Neither .venv311 nor .venv found in $RepoRoot" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Using Python environment: $PythonExe" -ForegroundColor Green

# 2. Check Policy File
$PolicyFile = Join-Path $RepoRoot "ngrok-policy.yml"
if (-not (Test-Path $PolicyFile)) {
    Write-Host "[ERROR] Traffic policy file missing: $PolicyFile" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] ngrok Traffic Policy file located." -ForegroundColor Green

# 3. Check ngrok availability
$NgrokPath = (Get-Command ngrok -ErrorAction SilentlyContinue)
if (-not $NgrokPath) {
    Write-Host "[ERROR] ngrok is not found in PATH." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] ngrok binary found." -ForegroundColor Green

# 4. Port 8000 Pre-flight Check
$BackendAlreadyRunning = $false
try {
    $existingConns = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if ($existingConns) {
        $busyPid = $existingConns[0].OwningProcess
        Write-Host "[INFO] Port 8000 is occupied by process PID $busyPid. Testing health..." -ForegroundColor Yellow
        try {
            $h = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -Method Get -TimeoutSec 2 -ErrorAction Stop
            if ($h.status -eq "healthy" -or $h.status -eq "ok") {
                Write-Host "[OK] Existing backend process is healthy on port 8000. Reusing running instance." -ForegroundColor Green
                $BackendAlreadyRunning = $true
            } else {
                Write-Host "[ERROR] Port 8000 is occupied by PID $busyPid but not healthy. Please terminate it: Stop-Process -Id $busyPid -Force" -ForegroundColor Red
                exit 1
            }
        } catch {
            Write-Host "[ERROR] Port 8000 is occupied by PID $busyPid and unresponsive. Terminate it: Stop-Process -Id $busyPid -Force" -ForegroundColor Red
            exit 1
        }
    }
} catch {
    # If network query fails, proceed
}

# 5. Start Backend if not already running
if (-not $BackendAlreadyRunning) {
    $ReloadArgs = ""
    if ($Reload) {
        Write-Host "[Backend] Opt-in live reload ENABLED." -ForegroundColor Yellow
        $ReloadArgs = "--reload --reload-dir backend"
    } else {
        Write-Host "[Backend] Running in STABLE demo mode (no --reload)." -ForegroundColor Green
    }
    
    Write-Host "[Backend] Launching FastAPI backend server on http://127.0.0.1:8000..." -ForegroundColor Cyan
    $BackendCmd = "cd '$RepoRoot'; Write-Host 'AeroMesh Backend Process' -ForegroundColor Cyan; & '$PythonExe' -m uvicorn backend.main:app $ReloadArgs --host 127.0.0.1 --port 8000"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $BackendCmd -WorkingDirectory $RepoRoot

    # Wait for Health Check
    Write-Host "[Health] Awaiting backend readiness at http://127.0.0.1:8000/api/v1/health..." -ForegroundColor Yellow
    $BackendReady = $false
    $Attempts = 0
    $MaxAttempts = 30

    while (-not $BackendReady -and ($Attempts -lt $MaxAttempts)) {
        Start-Sleep -Milliseconds 1000
        $Attempts++
        try {
            $HealthResp = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/v1/health" -Method Get -TimeoutSec 3 -ErrorAction SilentlyContinue
            if ($HealthResp.status -eq "healthy" -or $HealthResp.status -eq "ok") {
                $BackendReady = $true
                Write-Host "[OK] Backend is healthy and ready!" -ForegroundColor Green
            }
        } catch {
            Write-Host -NoNewline "."
        }
    }

    if (-not $BackendReady) {
        Write-Host "`n[ERROR] Backend failed to become healthy within $MaxAttempts seconds." -ForegroundColor Red
        exit 1
    }
}

# 6. Launch ngrok tunnel
Write-Host "`n[Tunnel] Launching ngrok tunnel for closable-ducky-unsuited.ngrok-free.dev..." -ForegroundColor Cyan
$NgrokCmd = "cd '$RepoRoot'; Write-Host 'ngrok Tunnel Process' -ForegroundColor Cyan; ngrok http 127.0.0.1:8000 --url=closable-ducky-unsuited.ngrok-free.dev --traffic-policy-file ngrok-policy.yml"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $NgrokCmd -WorkingDirectory $RepoRoot

Write-Host "`n================================================================================" -ForegroundColor Cyan
Write-Host "AEROMESH BACKEND & NGROK TUNNEL ACTIVE" -ForegroundColor Cyan
Write-Host "Local Backend : http://127.0.0.1:8000" -ForegroundColor White
Write-Host "Ngrok Tunnel  : https://closable-ducky-unsuited.ngrok-free.dev" -ForegroundColor White
Write-Host "Vercel Web App: https://sih-aeromesh-blond.vercel.app" -ForegroundColor White
Write-Host "================================================================================`n" -ForegroundColor Cyan
