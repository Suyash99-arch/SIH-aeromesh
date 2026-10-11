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
- Use a previously processed demo mission for a live presentation when possible. A 10-second 4K reconstruction took about **24 minutes** on this laptop. A shorter 1080p clip is a better live-run choice; allow extra time for upload, detection, and report generation.
- Use video with real lateral/orbital baseline and substantial frame overlap. The upload motion heuristic can be conservative; inspect quality and reconstruction results rather than promising success from its score alone.
- Avoid real accounts, sensitive footage, or unnecessary uploads. The quick tunnel exposes the local API publicly while it runs.
- Keep screenshots or exported reports for a no-network backup.

## If the tunnel or laptop fails

- If the quick tunnel disconnects, restart `cloudflared`, copy the newly generated URL, update both **Preview-only** Vercel variables, and redeploy the preview. Existing URLs do not persist across restarts.
- If the laptop, API, or reconstruction stack fails, stop the tunnel. Switch to the pre-processed demo mission on the stable Render-backed production site if that demo data is already available; otherwise present the saved screenshots and report exports. Do not repoint Production to a laptop tunnel.
- Resume a live reconstruction only after the local health check and tunnel check both pass. Keep the failed mission/error logs for diagnosis rather than silently substituting synthetic output.
