# Local full reconstruction demo runbook

Use a Vercel **Preview deployment** for the tunnel demo. Keep the `main` deployment and production environment pointed at the stable Render API.

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

## Vercel Preview tunnel setup

1. Start and verify the local API first.
2. In a separate PowerShell window, run:

   ```powershell
   $cloudflared = (Get-Command cloudflared.exe -ErrorAction Stop).Source
   & $cloudflared tunnel --url http://127.0.0.1:8000
   ```

3. Copy the HTTPS `https://<random>.trycloudflare.com` URL printed by `cloudflared`. Quick-tunnel URLs change on every restart.
4. In Vercel Project Settings → Environment Variables, set **Preview only**:

   ```text
   VITE_API_BASE_URL=https://<random>.trycloudflare.com/api/v1
   VITE_UPLOAD_BASE_URL=https://<random>.trycloudflare.com/api/v1
   ```

5. Redeploy the intended preview branch so Vite bakes in the new values. Do not set these values for Production and do not change the `/api` rewrite in `vercel.json`; the explicit Vite API base directs this preview build to the tunnel.
6. The backend allows Vercel preview origins (`*.vercel.app`). If using a custom preview domain, restart the API with `ALLOWED_ORIGINS` containing that exact HTTPS origin before opening the tunnel.
7. Test health and a read-only mission page on the preview before sharing it. Keep the API process and tunnel window running for the whole demo.

## Pre-demo checklist

- Laptop is plugged in, awake, and has enough free disk space in `C:\aeromesh-data`.
- `.venv311`, native COLMAP, FFmpeg/ffprobe, model weights, and frontend dependencies are available.
- Local `/health` reports the full profile and heavy pipeline mode; confirm the database and data paths are local.
- Start the API before the tunnel; verify the tunnel reaches local `/health`.
- Confirm the Preview deployment has the current quick-tunnel URL in both Vite variables; Production remains on Render.
- Prefer a pre-processed demo mission for evaluators. For an optional live run, enable 24-frame fast mode, use a short clip with good lateral baseline and overlap, and allow at least 10–12 minutes end to end on this laptop. Include upload, validation, detection, and report handling in the schedule.
- Use video with real lateral/orbital baseline and substantial frame overlap. The upload motion heuristic can be conservative; inspect quality and reconstruction results rather than promising success from its score alone.
- Avoid real accounts, sensitive footage, or unnecessary uploads. The quick tunnel exposes the local API publicly while it runs.
- Keep screenshots or exported reports for a no-network backup.

## If the tunnel or laptop fails

- If the quick tunnel disconnects, restart `cloudflared`, copy the newly generated URL, update both **Preview-only** Vercel variables, and redeploy the preview. Existing URLs do not persist across restarts.
- If the laptop, API, or reconstruction stack fails, stop the tunnel. Switch to the pre-processed demo mission on the stable Render-backed production site if that demo data is already available; otherwise present the saved screenshots and report exports. Do not repoint Production to a laptop tunnel.
- Resume a live reconstruction only after the local health check and tunnel check both pass. Keep the failed mission/error logs for diagnosis rather than silently substituting synthetic output.
