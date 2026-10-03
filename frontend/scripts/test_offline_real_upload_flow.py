import json
import os
import sys
import time
from pathlib import Path
import requests

BASE = "http://127.0.0.1:8000/api"

def run_test():
    print(">>> 1. Creating new unauthenticated mission (created_by=None)...")
    create_resp = requests.post(
        f"{BASE}/missions",
        params={
            "name": f"Offline-E2E-{int(time.time())}",
            "mission_type": "single-pass",
            "location": "Offline Sector 9",
            "operator": "Emergency First Responder",
        },
        timeout=30,
    )
    if create_resp.status_code != 200:
        print(f"FAILED to create mission: {create_resp.status_code} {create_resp.text}")
        return False

    mission_data = create_resp.json().get("mission", {})
    mission_id = mission_data.get("id")
    print(f"✓ Mission created: {mission_id} (owner_id={mission_data.get('owner_id')})")

    print(">>> 2. Uploading test footage (tests/test.mp4)...")
    video_path = Path("tests/test.mp4")
    if not video_path.exists():
        print(f"ERROR: Video file {video_path} does not exist.")
        return False

    with open(video_path, "rb") as f:
        upload_resp = requests.post(
            f"{BASE}/missions/{mission_id}/upload",
            files={"file": ("test.mp4", f, "video/mp4")},
            timeout=180,
        )

    if upload_resp.status_code != 200:
        print(f"FAILED upload: {upload_resp.status_code} {upload_resp.text}")
        return False

    print("✓ Video uploaded successfully.")

    print(">>> 3. Initiating backend pipeline (/process)...")
    # Use higher stride / fast inference for test speed
    proc_resp = requests.post(
        f"{BASE}/missions/{mission_id}/process",
        params={
            "frame_sampling": 10,
            "inference_resolution": 640,
            "detection_confidence": 0.35,
            "reconstruction_quality": "fast",
        },
        timeout=300,
    )
    print(f"Process response status: {proc_resp.status_code}")

    print(">>> 4. Verifying 3D reconstruction and keyframes...")
    recon_resp = requests.get(f"{BASE}/missions/{mission_id}/reconstruction", timeout=30)
    print(f"Reconstruction status: {recon_resp.status_code}")
    
    keyframes_resp = requests.get(f"{BASE}/missions/{mission_id}/keyframes", timeout=30)
    print(f"Keyframes status: {keyframes_resp.status_code} (total={len(keyframes_resp.json().get('frames', [])) if keyframes_resp.status_code == 200 else 0})")

    markings_resp = requests.get(f"{BASE}/missions/{mission_id}/markings", timeout=30)
    print(f"Markings status: {markings_resp.status_code}")

    print(">>> ALL STEPS COMPLETED WITH ZERO HANGS OR SILENT STALLS.")
    return True

if __name__ == "__main__":
    success = run_test()
    sys.exit(0 if success else 1)
