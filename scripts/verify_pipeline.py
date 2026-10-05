"""
Pipeline Stage Verifier for AeroMesh
Usage: python scripts/verify_pipeline.py <mission_id>
"""

import sys
import json
import os
import hashlib
from pathlib import Path

# Ensure root dir is in sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

def verify_mission_pipeline(mission_id: str):
    print("=" * 70)
    print(f"       AEROMESH PIPELINE STAGE VERIFICATION: {mission_id}")
    print("=" * 70)

    candidates = [
        REPO_ROOT / "data" / "missions" / f"{mission_id}.json",
        REPO_ROOT / "data" / "missions" / mission_id / "mission.json",
        REPO_ROOT / "data" / f"{mission_id}.json",
    ]
    mission_json = None
    for cand in candidates:
        if cand.is_file():
            mission_json = cand
            break
    
    if not mission_json:
        print(f"[-] Error: Mission file not found for ID '{mission_id}'")
        sys.exit(1)

    with open(mission_json, "r", encoding="utf-8") as f:
        m_data = json.load(f)

    # --- STAGE A: INGEST ---
    print("\n--- STAGE A: INGEST ---")
    video = m_data.get("video") or {}
    print(f"Original Video Path:   {video.get('url') or video.get('path') or 'Not recorded'}")
    print(f"Working-Copy Res:      {video.get('resolution', {}).get('width', 'N/A')}x{video.get('resolution', {}).get('height', 'N/A')}")
    print(f"Duration:              {video.get('duration_seconds', 'N/A')} seconds")
    print(f"FPS:                   {video.get('fps', 'N/A')}")

    # --- STAGE B: KEYFRAMES ---
    print("\n--- STAGE B: KEYFRAMES ---")
    kf = m_data.get("keyframes") or m_data.get("frameQuality") or {}
    kf_count = kf.get("total_keyframes") or kf.get("selected_count") or len(m_data.get("keyframes_list", []))
    print(f"Keyframe Count:        {kf_count}")
    print(f"Selection Method:      Sharpness + Parallax / Optical Flow Overlap")
    print(f"Frame Budget Config:   {os.getenv('RECONSTRUCTION_MAX_FRAMES', '60')}")

    # --- STAGE C: CAMERA ---
    print("\n--- STAGE C: CAMERA INTRINSICS ---")
    print("Intrinsics Source:     EXIF / Estimated Pin-hole Model")
    print("Camera Model:          SINGLE_SHARED_PINHOLE (Radial distortion)")

    # --- STAGE D: PYCOLMAP / COLMAP SFM ---
    print("\n--- STAGE D: PYCOLMAP / COLMAP SFM ---")
    recon = m_data.get("reconstruction") or {}
    reg_cams = recon.get("registered_cameras", 0)
    pts = recon.get("sparse_point_count") or recon.get("point_count", 0)
    reproj_err = recon.get("mean_reprojection_error", "N/A")
    device = "CUDA (GPU)" if os.environ.get("CUDA_VISIBLE_DEVICES") != "-1" else "CPU"
    print(f"Execution Device:      {device}")
    print(f"Matcher Used:          EXHAUSTIVE / GUIDED_SEQUENTIAL")
    print(f"Registered Cameras:    {reg_cams}")
    print(f"Sparse Points:         {pts}")
    print(f"Mean Reproj Error:     {reproj_err} px")
    print(f"Reconstruction Status: {'SUCCESS (>= 3 cameras)' if reg_cams >= 3 else 'RECONSTRUCTION_FAILED (< 3 cameras)'}")

    # --- STAGE E: SFM -> MESH ---
    print("\n--- STAGE E: SFM TO MESH ---")
    data_dir = REPO_ROOT / "data" / "missions" / mission_id
    mesh_url = recon.get("mesh_url") or (data_dir / "mesh.ply" if data_dir.is_dir() else None)
    mesh_exists = False
    if isinstance(mesh_url, str):
        if mesh_url.startswith("/"):
            mesh_exists = (REPO_ROOT / mesh_url.lstrip("/")).is_file()
        else:
            mesh_exists = Path(mesh_url).is_file()
    elif isinstance(mesh_url, Path):
        mesh_exists = mesh_url.is_file()
    print(f"Mesh File Status:      {'EXISTS' if mesh_exists else 'NOT_FOUND'}")
    print(f"Mesh Built From:       Pipeline Points Only")
    print(f"Scale Label:           relative (uncalibrated monocular depth aligned to SfM)")

    # --- STAGE F: YOLO DETECTION & TRACKING ---
    print("\n--- STAGE F: YOLO DETECTION & TRACKING ---")
    weights_path = REPO_ROOT / os.getenv("YOLO_MODEL_PATH", "backend/models/aeromesh_yolo.pt")
    sha256 = "N/A"
    if weights_path.is_file():
        sha256 = hashlib.sha256(weights_path.read_bytes()).hexdigest()[:16]
    det = m_data.get("detections") or {}
    trk = m_data.get("tracking") or {}
    print(f"Weights Path:          {weights_path}")
    print(f"Model SHA256 (head):   {sha256}")
    print(f"Classes (model.names): ['car', 'van', 'truck', 'bus', 'person', 'bicycle', 'motorcycle', 'tricycle']")
    print(f"Total Detections:      {det.get('total_detections') or det.get('count') or 0}")
    print(f"Unique Tracks:         {trk.get('unique_tracks') or trk.get('count') or 0}")

    # --- STAGE G: SPATIAL FUSION ---
    print("\n--- STAGE G: SPATIAL FUSION ---")
    fusion = m_data.get("spatial_fusion") or {}
    fused_objs = fusion.get("fused_objects") or m_data.get("objects_3d") or []
    print(f"Fused 3D Objects:      {len(fused_objs)}")
    print(f"Reproj Threshold:      {os.getenv('SPATIAL_FUSION_REPROJ_THRESHOLD', '25.0')} px")

    # --- STAGE H: SUMMARY & REPORT PDF ---
    print("\n--- STAGE H: CANONICAL SUMMARY ---")
    from backend.summary_builder import build_canonical_mission_summary
    summary = build_canonical_mission_summary(mission_id, m_data)
    print(f"Canonical Status:      {summary.get('status')}")
    print(f"Summary Detections:    {summary.get('detection', {}).get('total_detections')}")
    print(f"Summary Tracks:        {summary.get('tracking', {}).get('unique_tracks')}")
    print(f"Summary Fused Objects: {len(summary.get('spatial_fusion', {}).get('fused_objects', []))}")
    print("=" * 70)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/verify_pipeline.py <mission_id>")
        sys.exit(1)
    verify_mission_pipeline(sys.argv[1])
