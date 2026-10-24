# Local full-pipeline Vercel preview

1. Connect the laptop to power, close memory-heavy applications, and use a local drone video with steady sideways translation and 60–80% frame overlap.
2. Start the API in PowerShell: `& .\scripts\start-local-demo.ps1`. Confirm `http://127.0.0.1:8000/api/v1/health` reports `pipeline_mode: heavy` and `reconstruction_engine: ready`.
3. In a second PowerShell window run `& .\scripts\start-local-demo-tunnel.ps1`. Copy its temporary `https://….trycloudflare.com` URL. Stop the tunnel with Ctrl+C when the demo ends.
4. In Vercel, configure **Preview-only** environment variables for the demo preview branch:
   - `VITE_API_BASE_URL=https://….trycloudflare.com/api/v1`
   - `VITE_UPLOAD_BASE_URL=https://….trycloudflare.com/api/v1`
   Replace the host with the current quick-tunnel URL, then redeploy the Preview. Keep Production variables and `vercel.json` pointing at Render.
5. Open the Vercel Preview and check its Network panel: API and uploads should go directly to the current tunnel hostname. A relative `/api/v1` request uses the existing Vercel rewrite to Render instead.
6. Create one mission, upload the selected clip, and wait for processing to finish. Confirm the backend reports actual stage results, then check `C:\aeromesh-data\missions\<mission-id>\reconstruction\point_cloud.ply`, `mesh.ply`, and `C:\aeromesh-data\missions\<mission-id>\detections.json`; inspect available 3D outputs in Mission Command.
7. Keep the backend and tunnel terminals open for the whole demo. Quick Tunnel URLs are temporary and change when restarted; update both Preview variables and redeploy when they change. Never add local environment files, signing secrets, tunnel URLs, model credentials, or demo output data to git.

The quick-tunnel endpoint is public to anyone who has its URL. Keep backend authentication enabled, stop the tunnel after the demo, and do not use this laptop API for production traffic.

The API's existing CORS rule accepts HTTPS `*.vercel.app` origins; a public tunnel preflight using `https://demo-preview.vercel.app` returned `200` with the matching `Access-Control-Allow-Origin`. If using a custom preview domain, restart the API with `ALLOWED_ORIGINS` set to that exact origin before opening the tunnel.
