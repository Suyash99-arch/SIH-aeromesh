# Local full reconstruction demo runbook

Use the stable Render API for online demos. Do not repoint Production at a laptop or tunnel. Render's local filesystem is ephemeral; files uploaded to the hosted service may disappear after a restart or redeploy.

## Wake and verify the online backend

Render may spin down its free instance. Wake it before opening the frontend and wait for the health response to report `status: healthy`:

```powershell
curl.exe --fail --show-error --silent https://sih-aeromesh.onrender.com/api/v1/health
```

The Vercel Production environment should leave `VITE_API_BASE_URL` and `VITE_UPLOAD_BASE_URL` empty, or set both to `https://sih-aeromesh.onrender.com/api/v1`. Preview deployments should use the same values unless a separately approved backend is intended. Never put credentials or a temporary tunnel URL in these variables.

For live E2E account access, keep credentials in the ignored `frontend/.env.e2e` file or environment variables; do not paste them into commands, screenshots, logs, or this runbook. The test runner recognizes `E2E_INDIVIDUAL_EMAIL`, `E2E_INDIVIDUAL_PASSWORD`, `E2E_GOV_EMAIL`, `E2E_GOV_PASSWORD`, and `E2E_GOV_INVITE_CODE`.

## Start the local API

From the repository root, in PowerShell:

```powershell
$dataDir = 'C:\aeromesh-data'
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
$ffmpegDir = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Gyan.FFmpeg*" -Filter ffmpeg.exe -Recurse | Select-Object -First 1).Directory.FullName
$env:PATH = "$ffmpegDir;$env:PATH"
$env:PROFILE = 'ml'
$env:PIPELINE_ENABLED = 'true'
$env:PIPELINE_MODE = 'heavy'
$env:ENVIRONMENT = 'development'
$env:ALLOW_SQLITE = '1'
$env:DATABASE_URL = 'sqlite:///C:/aeromesh-data/aeromesh.db'
$env:AEROMESH_DATA_DIR = $dataDir
$env:OBJECT_STORAGE_ROOT = "$dataDir\objects"
$env:SECRET_KEY = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
$env:AEROMESH_AUTH_OPTIONAL = '1'
$env:YOLO_MODEL_PATH = "$PWD\backend\models\aeromesh_yolo.pt"
$env:DISABLE_DETECTION_CACHE = '1'
$env:PORT = '8000'
$env:PYTHONUNBUFFERED = '1'
.\.venv311\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --workers 1
```

This starts the full local profile on `http://127.0.0.1:8000`, with SQLite and mission data under `C:\aeromesh-data`. Anonymous access is for local demo use only. Confirm `http://127.0.0.1:8000/health` before opening any tunnel.

## Reconstruction speed options

For evaluator demos, use a **pre-processed demo mission** whenever possible. It avoids making the audience wait for CPU reconstruction and avoids creating fresh demo data during the presentation.

For an optional live run, enable the measured 24-frame fast mode before starting the API:

```powershell
$env:RECON_MAX_FRAMES = '24'
```

This caps the reconstruction frame selection at 24 across pipeline entry points. Leave it unset to retain the existing per-caller limits. The existing processing request option `reconstruction_quality=preview` also applies a 24-frame cap for that run; it does not add an API field. If both are set, the lower cap wins. Clear the environment override after the demo with `Remove-Item Env:RECON_MAX_FRAMES`.

The benchmark used a locally recreated 20-second slow-motion derivative of `tests/test.mp4` because the earlier rehearsal file had been deleted. It selected 37 frames at a 38-frame cap. Sequential matching with 37 selected frames took **853 s SfM / 901 s reconstruction wall** and produced 13,979 sparse points, 0.262 px mean reprojection error, and a 39,420-vertex mesh. Sequential matching with 24 frames took **398 s SfM / 441 s reconstruction wall**, registered 24/24 frames, and produced 10,098 sparse points, 0.250 px mean reprojection error, and a 27,444-vertex mesh. The fast result has fewer sparse points and mesh vertices; use it when shorter wait time matters more than model density. These are reconstruction-stage measurements, not a full end-to-end rerun.

For context, the earlier full-pipeline rehearsal took about **1,348 s (22.5 min)** total: validation 18 s, quality/keyframe analysis 6 s, detection 20 s, trajectory 2 s, SfM and meshing about 1,293 s, measurement under 0.01 s, spatial fusion under 1 s, with report generation recorded as 0 s in that run. The 24-frame setting is expected to bring a similar end-to-end run to roughly **8–9 minutes**, including validation, detection, and report handling; that total is an estimate from the reconstruction benchmark plus the measured non-SfM stages, not a new full-pipeline measurement. Allow 10–12 minutes for machine and footage variation.

Video defaults to sequential matching with overlap 10 and loop detection off. That is a good fit for ordered forward flight. Orbit footage that revisits the same area can need loop-closure pairs; consider `COLMAP_MATCHER=exhaustive` for a small orbit (up to 40 selected frames). The current safety rule still forces sequential matching above 40 frames, even if exhaustive is configured. Unordered image sets need exhaustive matching because neighboring file order does not represent neighboring camera positions. Exhaustive matching grows quadratically, so use it with a bounded frame set.

To run the frontend locally instead, in another PowerShell window:

```powershell
Set-Location .\frontend
@'
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
VITE_UPLOAD_BASE_URL=http://127.0.0.1:8000/api/v1
'@ | Set-Content -Encoding ascii .env.local
npm run dev
```

Remove `frontend/.env.local` after local development; it is gitignored.

## Local frontend and API

When `VITE_API_BASE_URL` is empty, Vite proxies `/api` requests to the stable Render API. To use a local API instead, set both `VITE_API_BASE_URL` and `VITE_UPLOAD_BASE_URL` to that API's `/api/v1` URL in the ignored `frontend/.env.local` file, then restart Vite. Keep local-only API settings out of Vercel Production.

## Pre-demo checklist

- Laptop is plugged in, awake, and has enough free disk space in `C:\aeromesh-data`.
- `.venv311`, native COLMAP, FFmpeg/ffprobe, model weights, and frontend dependencies are available.
- Local `/health` reports the full profile and heavy pipeline mode; confirm the database and data paths are local.
- Wake Render and verify `/api/v1/health` before opening the frontend.
- Confirm Vercel Production uses the stable Render API (or empty Vite API variables, allowing the `/api` rewrite).
- Treat Render-hosted uploads as ephemeral; keep any required demo assets backed up locally and do not promise persistence across service restarts.
- Prefer a pre-processed demo mission for evaluators. For an optional live run, enable 24-frame fast mode, use a short clip with good lateral baseline and overlap, and allow at least 10–12 minutes end to end on this laptop. Include upload, validation, detection, and report handling in the schedule.
- Use video with real lateral/orbital baseline and substantial frame overlap. The upload motion heuristic can be conservative; inspect quality and reconstruction results rather than promising success from its score alone.
- Avoid real accounts, sensitive footage, or unnecessary uploads. The quick tunnel exposes the local API publicly while it runs.
- Keep screenshots or exported reports for a no-network backup.

## If Render or the laptop fails

- If Render is waking, allow its health endpoint time to become healthy before retrying the frontend.
- If the local reconstruction stack fails, keep its logs and switch to a pre-processed demo mission or saved report exports. Do not create replacement data on Production or expose the laptop API through a tunnel.
- Resume a local reconstruction only after local health and its required model, FFmpeg, and COLMAP checks pass.
