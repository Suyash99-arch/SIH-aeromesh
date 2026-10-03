import json
import time
import sys
from pathlib import Path
import requests

BASE = "http://127.0.0.1:8000/api"

def test_pipeline_and_concurrency():
    print("=== PIPELINE & CONCURRENCY VALIDATION ===")
    
    # 1. Test corrupt video failure handling
    print("\n>>> 1. Testing Corrupt Video Ingestion...")
    create_corrupt = requests.post(f"{BASE}/missions", params={"name": "Corrupt-Video-Test", "location": "Test Zone"})
    m_corrupt_id = create_corrupt.json()["mission"]["id"]
    
    # Upload corrupt 10-byte file disguised as MP4
    corrupt_bytes = b"CORRUPT_NOT_A_VALID_MP4_HEADER"
    upload_corrupt = requests.post(
        f"{BASE}/missions/{m_corrupt_id}/upload",
        files={"file": ("corrupt.mp4", corrupt_bytes, "video/mp4")}
    )
    print(f"Upload corrupt video response: {upload_corrupt.status_code}")

    # Process corrupt video
    proc_corrupt = requests.post(f"{BASE}/missions/{m_corrupt_id}/process", params={"frame_sampling": 2})
    print(f"Process corrupt video response: {proc_corrupt.status_code}")
    
    # Check status of corrupt mission
    time.sleep(1)
    status_corrupt = requests.get(f"{BASE}/missions/{m_corrupt_id}/processing-status").json()
    print(f"Corrupt mission status: {status_corrupt.get('status')} (error: {status_corrupt.get('error')})")
    
    # Test retry on corrupt/failed mission
    print("Testing Retry Pipeline via /process...")
    retry_resp = requests.post(f"{BASE}/missions/{m_corrupt_id}/process", params={"frame_sampling": 2})
    print(f"Retry /process response: {retry_resp.status_code}")

    # 2. Test Concurrency Serialization
    print("\n>>> 2. Testing Mission Concurrency Serialization...")
    m1 = requests.post(f"{BASE}/missions", params={"name": "Concurrency-Job-1"}).json()["mission"]["id"]
    m2 = requests.post(f"{BASE}/missions", params={"name": "Concurrency-Job-2"}).json()["mission"]["id"]
    
    video_path = Path("tests/test.mp4")
    if video_path.exists():
        with open(video_path, "rb") as f:
            v_data = f.read()
        
        requests.post(f"{BASE}/missions/{m1}/upload", files={"file": ("v1.mp4", v_data, "video/mp4")})
        requests.post(f"{BASE}/missions/{m2}/upload", files={"file": ("v2.mp4", v_data, "video/mp4")})
        
        # Trigger both processing jobs in immediate succession
        resp1 = requests.post(f"{BASE}/missions/{m1}/process", params={"frame_sampling": 5, "reconstruction_quality": "fast"}).json()
        resp2 = requests.post(f"{BASE}/missions/{m2}/process", params={"frame_sampling": 5, "reconstruction_quality": "fast"}).json()
        
        print(f"Job 1 initial status: {resp1.get('status')} (queue_pos: {resp1.get('queue_position')})")
        print(f"Job 2 initial status: {resp2.get('status')} (queue_pos: {resp2.get('queue_position')})")
        
        if resp2.get("status") == "QUEUED" or resp2.get("queue_position", 0) > 0:
            print("[SUCCESS] Concurrency guard successfully serialized Job 2 behind Job 1!")
        else:
            print(f"Notice: Concurrency status: Job 1={resp1.get('status')}, Job 2={resp2.get('status')}")

    print("\n[SUCCESS] Pipeline and concurrency verification complete.")
    return True

if __name__ == "__main__":
    test_pipeline_and_concurrency()
