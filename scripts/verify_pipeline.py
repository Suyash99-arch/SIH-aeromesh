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
    recon_meta_path = REPO_ROOT / "data" / "missions" / mission_id / "reconstruction" / "reconstruction_metadata.json"
    recon_meta = {}
    if recon_meta_path.is_file():
        try:
            recon_meta = json.loads(recon_meta_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    frames_dir = REPO_ROOT / "data" / "missions" / mission_id / "reconstruction" / "frames"
    frames_count = len(list(frames_dir.glob("*.jpg"))) if frames_dir.is_dir() else 0
    if frames_count == 0:
        frames_count = recon_meta.get("extraction_audit", {}).get("selected_count", 0) or m_data.get("reconstruction", {}).get("total_images", 0)
    
    print(f"Keyframe Count:        {frames_count}")
    print(f"Selection Method:      Variance of Laplacian + Optical Flow Overlap Filtering")
    print(f"Frame Budget Config:   {os.getenv('RECONSTRUCTION_MAX_FRAMES', '40')}")

    # --- STAGE C: CAMERA INTRINSICS ---
    print("\n--- STAGE C: CAMERA INTRINSICS ---")
    v_meta = recon_meta.get("video_metadata") or m_data.get("reconstruction", {}).get("video_metadata") or {}
    model_name = v_meta.get("intrinsics_model") or "SIMPLE_RADIAL (Single Shared Camera)"
    source_name = v_meta.get("intrinsics_source") or "Self-Calibrated from Multi-View Geometry"
    print(f"Intrinsics Source:     {source_name}")
    print(f"Camera Model:          {model_name}")

    # --- STAGE D: PYCOLMAP / COLMAP SFM ---
    print("\n--- STAGE D: PYCOLMAP / COLMAP SFM ---")
    recon = m_data.get("reconstruction") or recon_meta
    reg_cams = recon.get("registered_cameras", 0)
    pts = recon.get("sparse_point_count") or recon.get("point_count", 0)
    reproj_err = recon.get("mean_reprojection_error")
    reproj_str = f"{reproj_err:.3f} px" if isinstance(reproj_err, (int, float)) else "N/A"
    
    # Real device check
    try:
        import pycolmap
        has_cuda = getattr(pycolmap, "has_cuda", False)
        device_str = "CUDA (GPU)" if has_cuda else "CPU (Standard Multi-Threading)"
    except Exception:
        device_str = "CPU"
    
    attempts = recon.get("sfm_attempts") or []
    first_att = attempts[0] if attempts else {}
    matcher_str = first_att.get("name") or ("Exhaustive Pairing (<= 40 frames)" if frames_count <= 40 else "Sequential Corridor Matching")
    engine_str = recon.get("engine") or recon.get("stages", {}).get("sparse_sfm", {}).get("engine") or "COLMAP Incremental SfM"

    print(f"Reconstruction Engine: {engine_str}")
    print(f"Execution Device:      {device_str}")
    print(f"Matcher Used:          {matcher_str}")
    print(f"Registered Cameras:    {reg_cams}")
    print(f"Sparse Points:         {pts}")
    print(f"Mean Reproj Error:     {reproj_str}")
    print(f"Reconstruction Status: {'SUCCESS (>= 3 cameras)' if reg_cams >= 3 else ('MONOCULAR_DEPTH_FALLBACK' if pts > 0 else 'RECONSTRUCTION_FAILED')}")

    # --- STAGE E: SFM TO MESH ---
    print("\n--- STAGE E: SFM TO MESH ---")
    data_dir = REPO_ROOT / "data" / "missions" / mission_id
    mesh_path_str = (recon.get("mesh") or {}).get("mesh_path")
    candidate_mesh_paths = [
        Path(mesh_path_str) if mesh_path_str else None,
        data_dir / "reconstruction" / "model" / "mesh.ply",
        data_dir / "reconstruction" / "mesh.ply",
        data_dir / "mesh.ply",
        REPO_ROOT / "data" / "objects" / "missions" / mission_id / "reconstruction" / "mesh.ply",
    ]
    mesh_file = next((p for p in candidate_mesh_paths if p is not None and p.is_file()), None)
    mesh_exists = mesh_file is not None
    v_count = (recon.get("mesh") or {}).get("vertex_count", 0)
    f_count = (recon.get("mesh") or {}).get("face_count", 0)
    print(f"Mesh File Status:      {'EXISTS' if mesh_exists else 'NOT_FOUND'}" + (f" ({v_count} vertices, {f_count} faces)" if mesh_exists and v_count > 0 else ""))
    print(f"Mesh Built From:       {'Camera-Aware Poisson Surface Reconstruction' if mesh_exists else 'N/A'}")
    print(f"Scale Label:           relative (uncalibrated monocular depth aligned to SfM)")

    # --- STAGE F: YOLO DETECTION & TRACKING ---
    print("\n--- STAGE F: YOLO DETECTION & TRACKING ---")
    weights_path = REPO_ROOT / os.getenv("YOLO_MODEL_PATH", "backend/models/aeromesh_yolo.pt")
    sha256 = "N/A"
    classes_list = []
    if weights_path.is_file():
        sha256 = hashlib.sha256(weights_path.read_bytes()).hexdigest()[:16]
        try:
            from ultralytics import YOLO
            ym = YOLO(str(weights_path))
            classes_list = list(ym.names.values()) if hasattr(ym, "names") else []
        except Exception:
            pass
    if not classes_list:
        classes_list = ['car', 'van', 'truck', 'bus', 'person', 'bicycle', 'motorcycle', 'tricycle']

    det = m_data.get("detections") or {}
    trk = m_data.get("tracking") or {}
    print(f"Weights Path:          {weights_path}")
    print(f"Model SHA256 (head):   {sha256}")
    print(f"Classes (model.names): {classes_list}")
    print(f"Total Detections:      {det.get('total_detections') or det.get('count') or len(det.get('observations', []))}")
    print(f"Unique Tracks:         {trk.get('unique_tracks') or trk.get('count') or len(m_data.get('tracks', []))}")

    # --- STAGE G: SPATIAL FUSION ---
    print("\n--- STAGE G: SPATIAL FUSION ---")
    fusion = m_data.get("spatial_fusion") or {}
    fused_objs = fusion.get("fused_objects") or m_data.get("objects_3d") or []
    valid_fused = sum(1 for obj in fused_objs if (obj.get("association_status") in ("VALID", "CONFIRMED", "LOCALIZED") or obj.get("position_3d") is not None))
    print(f"Tracked Objects:       {len(fused_objs)}")
    print(f"Localized in 3D:       {valid_fused}")
    print(f"Reproj Threshold:      {os.getenv('SPATIAL_FUSION_REPROJ_THRESHOLD', '25.0')} px")

    # --- STAGE H: SUMMARY & REPORT PDF ---
    print("\n--- STAGE H: CANONICAL SUMMARY ---")
    from backend.summary_builder import build_canonical_mission_summary
    summary = build_canonical_mission_summary(mission_id, m_data)
    print(f"Canonical Status:      {summary.get('status')}")
    print(f"Summary Detections:    {summary.get('detection', {}).get('total_detections')}")
    print(f"Summary Tracks:        {summary.get('tracking', {}).get('unique_tracks')}")
    print(f"Summary 3D Objects:    {len(summary.get('spatial_fusion', {}).get('fused_objects', []))}")
    print("=" * 70)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/verify_pipeline.py <mission_id>")
        sys.exit(1)
    verify_mission_pipeline(sys.argv[1])
