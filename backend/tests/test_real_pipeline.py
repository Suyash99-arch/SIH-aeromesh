import os
import time
import pytest
from pathlib import Path
from fastapi.testclient import TestClient

from backend.main import app
from backend.eta_engine import estimate_pipeline_eta

@pytest.mark.slow
def test_real_pipeline_end_to_end():
    client = TestClient(app)
    
    print("\n" + "=" * 70)
    print("STARTING AUTHORITATIVE REAL PIPELINE END-TO-END VERIFICATION")
    print("=" * 70)
    
    # 1. Guest login
    t0_start = time.time()
    resp = client.post("/api/v1/auth/guest", json={})
    assert resp.status_code == 200, f"Guest login failed: {resp.text}"
    auth_data = resp.json()
    token = auth_data.get("access_token") or auth_data.get("token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    
    # 2. Create mission
    resp = client.post("/api/v1/missions", params={"name": "Authoritative E2E Test Mission"}, headers=headers)
    assert resp.status_code == 200, f"Create mission failed: {resp.text}"
    mission_res = resp.json()
    mission_id = mission_res["mission"]["id"]
    print(f"[Pipeline] Created test mission ID: {mission_id}")
    
    # 3. Locate real video
    video_path = Path("SinglePass3D/input/drone.mp4")
    if not video_path.exists():
        video_path = Path("scratch/sample_flight.mp4")
    assert video_path.exists(), f"Real video missing at {video_path}"
    video_bytes = video_path.stat().st_size
    print(f"[Pipeline] Source video: {video_path} ({video_bytes / 1024 / 1024:.2f} MB)")
    
    # 4. Upload video
    t_upload_start = time.time()
    with open(video_path, "rb") as f:
        resp = client.post(
            f"/api/v1/missions/{mission_id}/upload",
            files={"file": (video_path.name, f, "video/mp4")},
            headers=headers
        )
    assert resp.status_code == 200, f"Upload failed: {resp.text}"
    upload_res = resp.json()
    video_meta = upload_res.get("video", {})
    t_upload = time.time() - t_upload_start
    print(f"[Pipeline] Video upload completed in {t_upload:.2f}s (fps={video_meta.get('fps')}, duration={video_meta.get('duration_seconds')}s)")
    
    # 5. Compute mathematical ETA at start
    eta_meta = {
        "width": video_meta.get("width", 1920),
        "height": video_meta.get("height", 1080),
        "duration_seconds": video_meta.get("duration_seconds", 10.0),
        "frame_count": video_meta.get("frame_count", 300),
    }
    initial_eta = estimate_pipeline_eta(eta_meta)
    eta_start_seconds = initial_eta.get("eta_seconds_est", 120.0)
    formatted_eta = initial_eta.get("formatted_eta_est") or initial_eta.get("formatted_eta_range") or f"{eta_start_seconds:.0f}s"
    print(f"[Pipeline] Computed mathematical ETA at start: {formatted_eta} ({eta_start_seconds:.1f}s)")
    
    # 6. Trigger processing
    t_process_start = time.time()
    resp = client.post(f"/api/v1/missions/{mission_id}/process", headers=headers)
    assert resp.status_code == 200, f"Process failed: {resp.text}"
    
    # 7. Poll status and track stage transitions
    status = "processing"
    stage_transitions = {}
    last_stage = None
    poll_start = time.time()
    
    while status in ["queued", "processing", "video_uploaded", "PENDING", "QUEUED", "PROCESSING", "created", "RECONSTRUCTING", "DETECTING_OBJECTS", "TRACKING", "FUSING_3D"] and (time.time() - poll_start) < 240:
        time.sleep(2)
        resp = client.get(f"/api/missions/{mission_id}/processing-status", headers=headers)
        if resp.status_code != 200:
            resp = client.get(f"/api/v1/missions/{mission_id}", headers=headers)
        assert resp.status_code == 200
        status_data = resp.json()
        status = status_data.get("status")
        current_stage = status_data.get("current_stage")
        if current_stage and current_stage != last_stage:
            stage_transitions[current_stage] = round(time.time() - t_process_start, 2)
            last_stage = current_stage
        if status in ["completed", "COMPLETED", "complete"]:
            break
            
    total_pipeline_time = time.time() - t_process_start
    assert status in ["completed", "COMPLETED", "complete"], f"Pipeline failed or timed out: status={status}"
    print(f"[Pipeline] Processing finished in {total_pipeline_time:.2f}s with status: {status}")
    
    # 8. Fetch endpoints and assert matching counts
    m_resp = client.get(f"/api/v1/missions/{mission_id}", headers=headers).json()
    mission_dict = m_resp.get("mission", m_resp)
    det_resp = client.get(f"/api/v1/missions/{mission_id}/detections", headers=headers).json()
    
    # Extract detection counts
    det_dict = mission_dict.get("detections")
    if isinstance(det_dict, dict):
        det_count_m = len(det_dict.get("observations", [])) or det_dict.get("uniqueTracks", 0)
    else:
        det_count_m = len(det_dict or [])
        
    if isinstance(det_resp, dict):
        det_count_det = len(det_resp.get("observations") or det_resp.get("detections") or [])
    else:
        det_count_det = len(det_resp)
        
    print(f"[Pipeline] Detection counts: /api/v1/missions/{mission_id} = {det_count_m}, /api/v1/missions/{mission_id}/detections = {det_count_det}")
    assert det_count_m == det_count_det, f"Detection count mismatch: mission={det_count_m}, detections={det_count_det}"
    
    # 9. Extract scale label
    semantic_scene = mission_dict.get("semantic_scene") or {}
    scale_label = (
        semantic_scene.get("scale_status")
        or mission_dict.get("scale_calibration", {}).get("scale_status")
        or "RELATIVE_SCALE"
    )
    coord_system = semantic_scene.get("coordinate_system", "LOCAL_ARBITRARY")
    print(f"[Pipeline] Scale label: {scale_label} (Coordinate system: {coord_system})")
    
    # 10. Check COLMAP point cloud and mesh
    colmap_info = mission_dict.get("reconstruction") or {}
    point_count = colmap_info.get("point_count", 0) or colmap_info.get("sparse_point_count", 0)
    has_point_cloud = bool(colmap_info.get("point_cloud_url") or point_count > 0)
    
    from backend.reconstruction import get_reconstruction_mesh_path, get_reconstruction_pointcloud_path

    # Check filesystem / storage for point cloud and mesh
    recon_dir = Path("data/missions") / mission_id / "reconstruction"
    pc_file = get_reconstruction_pointcloud_path(mission_id) or (recon_dir / "point_cloud.ply")
    mesh_file = get_reconstruction_mesh_path(mission_id) or (recon_dir / "mesh.ply")
    
    pc_exists = bool(pc_file and Path(pc_file).exists() and Path(pc_file).stat().st_size > 0)
    mesh_exists = bool(mesh_file and Path(mesh_file).exists() and Path(mesh_file).stat().st_size > 0)
    
    pc_size_kb = (Path(pc_file).stat().st_size / 1024) if pc_exists else 0
    mesh_size_kb = (Path(mesh_file).stat().st_size / 1024) if mesh_exists else 0
    
    print(f"[Pipeline] Point cloud: exists={pc_exists or has_point_cloud}, points={point_count}, size={pc_size_kb:.1f} KB, path={pc_file}")
    print(f"[Pipeline] Surface mesh: exists={mesh_exists}, size={mesh_size_kb:.1f} KB, path={mesh_file}")
    
    assert has_point_cloud or pc_exists, "Point cloud was not produced"
    assert mesh_exists, "Surface mesh was not produced"
    
    # Print authoritative verification table
    print("\n" + "=" * 70)
    print("REAL PIPELINE EXECUTION SUMMARY & VERIFICATION EVIDENCE")
    print("=" * 70)
    print(f"{'Metric':<35} | {'Value'}")
    print("-" * 70)
    print(f"{'Mission ID':<35} | {mission_id}")
    print(f"{'Source Video File':<35} | {video_path.name} ({video_bytes / 1024 / 1024:.2f} MB)")
    print(f"{'Video Upload Timing':<35} | {t_upload:.2f}s")
    print(f"{'ETA At Start (Estimated)':<35} | {formatted_eta} ({eta_start_seconds:.1f}s)")
    print(f"{'Actual Pipeline Duration':<35} | {total_pipeline_time:.2f}s")
    print(f"{'Detection Count (Missions API)':<35} | {det_count_m}")
    print(f"{'Detection Count (Detections API)':<35} | {det_count_det} (MATCH: YES)")
    print(f"{'Scale Label':<35} | {scale_label}")
    print(f"{'Coordinate System':<35} | {coord_system}")
    print(f"{'Point Cloud Produced':<35} | YES ({point_count} points, {pc_size_kb:.1f} KB)")
    print(f"{'Surface Mesh Produced':<35} | YES ({mesh_size_kb:.1f} KB)")
    print("=" * 70 + "\n")
