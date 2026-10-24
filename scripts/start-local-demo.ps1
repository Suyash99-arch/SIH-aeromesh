param([switch]$AnonymousLocal)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path $repoRoot ".venv311\Scripts\python.exe"
$dataDir = "C:\aeromesh-data"
$toolsDir = Join-Path $env:LOCALAPPDATA "Programs\AeroMeshTools"
$ffmpeg = Get-ChildItem -LiteralPath (Join-Path $toolsDir "ffmpeg") -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
$colmapExe = (Get-Command colmap -ErrorAction Stop).Source

if (-not (Test-Path -LiteralPath $pythonExe)) { throw "Missing Python environment: $pythonExe" }
if (-not $ffmpeg) { throw "ffmpeg.exe was not found under $toolsDir" }
if (-not (Test-Path -LiteralPath (Join-Path $ffmpeg.Directory.FullName "ffprobe.exe"))) { throw "ffprobe.exe is missing beside ffmpeg.exe" }

New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$env:PROFILE = "ml"
$env:PIPELINE_ENABLED = "true"
$env:PIPELINE_MODE = "heavy"
$env:ENVIRONMENT = "development"
$env:ALLOW_SQLITE = "1"
$env:DATABASE_URL = "sqlite:///C:/aeromesh-data/aeromesh.db"
$env:AEROMESH_DATA_DIR = $dataDir
$env:OBJECT_STORAGE_ROOT = Join-Path $dataDir "objects"
$secretBytes = New-Object "System.Byte[]" 32
$randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($secretBytes)
$env:SECRET_KEY = ([BitConverter]::ToString($secretBytes)).Replace("-", "").ToLowerInvariant()
$randomGenerator.Dispose()
$env:AEROMESH_AUTH_OPTIONAL = if ($AnonymousLocal) { "1" } else { "0" }
$env:YOLO_MODEL_PATH = Join-Path $repoRoot "backend\models\aeromesh_yolo.pt"
$env:PORT = "8000"
$env:PYTHONUNBUFFERED = "1"
$env:PATH = "$($ffmpeg.Directory.FullName);$(Split-Path -Parent $colmapExe);$env:PATH"

Write-Host "Starting local full-profile API at http://127.0.0.1:8000"
Write-Host "PROFILE=ml; PIPELINE_ENABLED=true; PIPELINE_MODE=heavy; database=$env:DATABASE_URL"
Write-Host "Data directory: $dataDir (outside OneDrive). Temporary signing secret stays in this process."
if ($AnonymousLocal) { Write-Host "Anonymous access is enabled only for this local API process; do not expose it through a tunnel." }
Push-Location $repoRoot
try {
    & $pythonExe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
    if ($LASTEXITCODE -ne 0) { throw "Backend exited with code $LASTEXITCODE" }
} finally {
    Pop-Location
}
