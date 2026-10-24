$ErrorActionPreference = "Stop"
$cloudflared = Join-Path $env:LOCALAPPDATA "Programs\AeroMeshTools\cloudflared.exe"
if (-not (Test-Path -LiteralPath $cloudflared)) { throw "cloudflared.exe not found: $cloudflared" }
& $cloudflared tunnel --url http://127.0.0.1:8000
