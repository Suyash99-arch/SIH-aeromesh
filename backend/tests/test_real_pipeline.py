import os
import time
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from backend.main import app

@pytest.mark.slow
def test_real_pipeline_end_to_end():
    client = TestClient(app)
    
    # 1. Guest login
    resp = client.post("/api/v1/auth/guest", json={})
    assert resp.status_code == 200, f"Guest login failed: {resp.text}"
    auth_data = resp.json()
    token = auth_data.get("access_token") or auth_data.get("token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    
    # 2. Create mission
    resp = client.post("/api/v1/missions", params={"name": "Slow E2E Test Mission"}, headers=headers)
    assert resp.status_code == 200, f"Create mission failed: {resp.text}"
    mission_res = resp.json()
    mission_id = mission_res["mission"]["id"]
    
    # 3. Locate real video
    video_path = Path("SinglePass3D/input/drone.mp4")
    if not video_path.exists():
        video_path = Path("scratch/sample_flight.mp4")
    assert video_path.exists(), f"Real video missing at {video_path}"
    
    # 4. Upload video
    with open(video_path, "rb") as f:
        resp = client.post(
            f"/api/v1/missions/{mission_id}/upload",
            files={"file": (video_path.name, f, "video/mp4")},
            headers=headers
        )
    assert resp.status_code == 200, f"Upload failed: {resp.text}"
    upload_res = resp.json()
    assert "video" in upload_res
    
    # 5. Process mission
    resp = client.post(f"/api/v1/missions/{mission_id}/process", headers=headers)
    assert resp.status_code == 200, f"Process failed: {resp.text}"
    
    # 6. Poll status
    status = "processing"
    t0 = time.time()
    while status in ["queued", "processing", "video_uploaded", "PENDING", "QUEUED", "PROCESSING", "created"] and (time.time() - t0) < 180:
        time.sleep(2)
        resp = client.get(f"/api/missions/{mission_id}/processing-status", headers=headers)
        if resp.status_code != 200:
            resp = client.get(f"/api/v1/missions/{mission_id}", headers=headers)
        assert resp.status_code == 200
        status_data = resp.json()
        status = status_data.get("status")
        if status in ["completed", "COMPLETED", "complete"]:
            break
            
    assert status in ["completed", "COMPLETED", "complete"], f"Pipeline failed or timed out: status={status}"
    
    # 7. Fetch endpoints and assert matching counts
    m_resp = client.get(f"/api/v1/missions/{mission_id}", headers=headers).json()
    mission_dict = m_resp.get("mission", m_resp)
    det_resp = client.get(f"/api/v1/missions/{mission_id}/detections", headers=headers).json()
    
    det_dict = mission_dict.get("detections")
    if isinstance(det_dict, dict):
        det_count_m = len(det_dict.get("observations", [])) or det_dict.get("uniqueTracks", 0)
    else:
        det_count_m = len(det_dict or [])
        
    if isinstance(det_resp, dict):
        det_count_det = len(det_resp.get("observations") or det_resp.get("detections") or [])
    else:
        det_count_det = len(det_resp)
        
    assert det_count_m == det_count_det, f"Detection count mismatch: mission={det_count_m}, detections={det_count_det}"
    
    colmap_info = mission_dict.get("reconstruction") or {}
    has_point_cloud = bool(colmap_info.get("point_cloud_url") or colmap_info.get("point_count", 0) > 0)
    assert has_point_cloud, "Point cloud was not produced"
