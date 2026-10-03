"""
Batch Mission Runner for Video Evaluation
Executes full real API pipeline for every video in a target directory:
Sign-up -> Create Mission -> Upload -> Launch Pipeline -> Poll Summary -> Print Honest Table.

Zero hardcoded file names, mission IDs, or synthetic result injections.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Any
import requests


VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm"}


def register_test_user(api_url: str) -> tuple[str, dict]:
    """Register a real, fresh individual test user through the API."""
    ts = int(time.time() * 1000)
    email = f"runner_{ts}@example.com"
    payload = {
        "email": email,
        "password": "TestPassword123!",
        "full_name": f"Automated Evaluator {ts}",
        "portal_type": "individual",
    }
    
    url = f"{api_url.rstrip('/')}/api/v1/auth/register"
    resp = requests.post(url, json=payload, timeout=15)
    if resp.status_code != 200:
        raise RuntimeError(f"Failed to register test user at {url}: {resp.status_code} - {resp.text}")
        
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"No access token returned from registration: {data}")
        
    headers = {"Authorization": f"Bearer {token}"}
    return token, headers


def get_video_meta_local(video_path: Path) -> dict[str, Any]:
    """Inspect video locally using OpenCV for pre-flight stats."""
    import cv2
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return {"width": 0, "height": 0, "fps": 0.0, "duration": 0.0, "frames": 0}
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 24.0)
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frames / fps if fps > 0 else 0.0
    cap.release()
    return {"width": w, "height": h, "fps": round(fps, 2), "duration": round(duration, 2), "frames": frames}


def run_single_video(
    video_path: Path,
    api_url: str,
    headers: dict,
    timeout_seconds: int = 600,
) -> dict[str, Any]:
    """Execute end-to-end mission workflow for a single video."""
    api_base = api_url.rstrip("/")
    start_time = time.time()
    
    local_meta = get_video_meta_local(video_path)
    
    # 1. Create Mission
    create_url = f"{api_base}/api/v1/missions"
    resp = requests.post(create_url, params={"name": f"Eval_{video_path.stem}"}, headers=headers, timeout=15)
    if resp.status_code not in (200, 201):
        return {
            "video": video_path.name,
            "resolution": f"{local_meta['width']}x{local_meta['height']}",
            "duration": f"{local_meta['duration']}s",
            "frames_selected": 0,
            "sfm_attempt": "N/A",
            "reg_cameras": 0,
            "points": 0,
            "mesh": "no",
            "detections": 0,
            "tracks": 0,
            "fused": 0,
            "rejected": 0,
            "eta_vs_actual": "N/A",
            "final_status": "CREATE_FAILED",
            "errors": resp.text[:120],
        }
        
    data = resp.json()
    mission_obj = data.get("mission") if isinstance(data.get("mission"), dict) else data
    mission_id = mission_obj.get("id") or mission_obj.get("mission_id") or data.get("id") or data.get("mission_id")
    if not mission_id:
        return {
            "video": video_path.name,
            "resolution": f"{local_meta['width']}x{local_meta['height']}",
            "duration": f"{local_meta['duration']}s",
            "frames_selected": 0,
            "sfm_attempt": "N/A",
            "reg_cameras": 0,
            "points": 0,
            "mesh": "no",
            "detections": 0,
            "tracks": 0,
            "fused": 0,
            "rejected": 0,
            "eta_vs_actual": "N/A",
            "final_status": "CREATE_FAILED",
            "errors": "Could not extract mission ID from response",
        }
    
    # 2. Upload Video
    upload_url = f"{api_base}/api/v1/missions/{mission_id}/upload"
    with open(video_path, "rb") as f:
        files = {"file": (video_path.name, f, "video/mp4")}
        up_resp = requests.post(upload_url, files=files, headers=headers, timeout=120)
        
    if up_resp.status_code != 200:
        return {
            "video": video_path.name,
            "resolution": f"{local_meta['width']}x{local_meta['height']}",
            "duration": f"{local_meta['duration']}s",
            "frames_selected": 0,
            "sfm_attempt": "N/A",
            "reg_cameras": 0,
            "points": 0,
            "mesh": "no",
            "detections": 0,
            "tracks": 0,
            "fused": 0,
            "rejected": 0,
            "eta_vs_actual": "N/A",
            "final_status": "UPLOAD_FAILED",
            "errors": up_resp.text[:120],
        }
        
    # 3. Launch Pipeline
    process_url = f"{api_base}/api/v1/missions/{mission_id}/process"
    proc_payload = {
        "confidence": 0.35,
        "tile_inference": True,
        "force_dense": False,
    }
    proc_resp = requests.post(process_url, json=proc_payload, headers=headers, timeout=15)
    if proc_resp.status_code not in (200, 202):
        return {
            "video": video_path.name,
            "resolution": f"{local_meta['width']}x{local_meta['height']}",
            "duration": f"{local_meta['duration']}s",
            "frames_selected": 0,
            "sfm_attempt": "N/A",
            "reg_cameras": 0,
            "points": 0,
            "mesh": "no",
            "detections": 0,
            "tracks": 0,
            "fused": 0,
            "rejected": 0,
            "eta_vs_actual": "N/A",
            "final_status": "LAUNCH_FAILED",
            "errors": proc_resp.text[:120],
        }
        
    # 4. Poll /summary until complete/partial/failed
    summary_url = f"{api_base}/api/v1/missions/{mission_id}/summary"
    summary_data = {}
    
    poll_interval = 3
    max_polls = timeout_seconds // poll_interval
    
    for _ in range(max_polls):
        time.sleep(poll_interval)
        try:
            s_resp = requests.get(summary_url, headers=headers, timeout=10)
            if s_resp.status_code == 200:
                raw_json = s_resp.json()
                summary_data = raw_json.get("summary") if isinstance(raw_json.get("summary"), dict) else raw_json
                
                mission_info = summary_data.get("mission", {}) or {}
                status = str(mission_info.get("status") or summary_data.get("status") or "").upper()
                stage_states = summary_data.get("stage_states", {}) or {}
                
                # Check if terminal
                if status in ("COMPLETED", "PARTIAL", "FAILED", "PROCESSING_COMPLETE", "RECONSTRUCTED"):
                    break
                # Check individual stage terminal states
                recon_state = stage_states.get("reconstruction", {}).get("state")
                det_state = stage_states.get("detection", {}).get("state")
                if recon_state in ("COMPLETE", "FAILED", "SKIPPED") and det_state in ("COMPLETE", "FAILED", "SKIPPED"):
                    break
        except Exception:
            pass
            
    elapsed = time.time() - start_time
    
    # 5. Extract results from /summary
    raw_s = summary_data.get("summary") if isinstance(summary_data.get("summary"), dict) else summary_data
    mission_info = raw_s.get("mission", {}) or {}
    reconstruction = raw_s.get("reconstruction", {}) or {}
    detection = raw_s.get("detection", {}) or {}
    tracking = raw_s.get("tracking", {}) or {}
    spatial_fusion = raw_s.get("spatial_fusion", {}) or {}
    keyframes = raw_s.get("keyframes", {}) or {}
    
    reg_cams = int(reconstruction.get("registered_cameras") or reconstruction.get("cameras_count") or 0)
    points = int(reconstruction.get("sparse_point_count") or reconstruction.get("points_count") or reconstruction.get("sparse_points") or 0)
    has_mesh = "yes" if (reconstruction.get("mesh_status") == "AVAILABLE" or reconstruction.get("has_mesh") or reconstruction.get("mesh_url") or reconstruction.get("mesh_vertices", 0) > 0) else "no"
    
    frames_sel = int(keyframes.get("total_keyframes") or reconstruction.get("keyframes_count") or reconstruction.get("frames_selected") or len(keyframes.get("frames", [])) or 0)
    sfm_meta = reconstruction.get("reconstruction_metadata", {}) or {}
    sfm_attempt = sfm_meta.get("successful_attempt") or ("Attempt 1" if reg_cams > 0 else "None")
    
    det_total = int(detection.get("total_detections") or 0)
    tracks_total = int(tracking.get("unique_tracks") or 0)
    fused_total = int(spatial_fusion.get("valid_objects") or spatial_fusion.get("total_fused_objects") or 0)
    rejected_total = int(spatial_fusion.get("rejected_candidates") or 0)
    
    est_eta = raw_s.get("eta_seconds") or 0
    eta_str = f"{est_eta}s / {elapsed:.1f}s"
    final_status = str(mission_info.get("status") or raw_s.get("status") or "TIMEOUT").upper()
    
    errors = mission_info.get("error") or raw_s.get("error_message") or raw_s.get("failure_reason") or "None"
    
    return {
        "video": video_path.name,
        "resolution": f"{local_meta['width']}x{local_meta['height']}",
        "duration": f"{local_meta['duration']}s",
        "frames_selected": frames_sel,
        "sfm_attempt": sfm_attempt,
        "reg_cameras": reg_cams,
        "points": points,
        "mesh": has_mesh,
        "detections": det_total,
        "tracks": tracks_total,
        "fused": fused_total,
        "rejected": rejected_total,
        "eta_vs_actual": eta_str,
        "final_status": final_status,
        "errors": str(errors)[:80] if errors else "None",
    }


def main():
    parser = argparse.ArgumentParser(description="Run full evaluation across all videos in a folder.")
    parser.add_argument("folder", nargs="?", default="samples", help="Target folder containing video files")
    parser.add_argument("--api-url", default="http://localhost:8000", help="Base URL of backend API")
    parser.add_argument("--timeout", type=int, default=600, help="Per-video max processing timeout in seconds")
    
    args = parser.parse_args()
    target_dir = Path(args.folder)
    
    if not target_dir.exists():
        print(f"Error: Target directory '{target_dir}' does not exist.")
        sys.exit(1)
        
    videos = [p for p in target_dir.iterdir() if p.is_file() and p.suffix.lower() in VIDEO_EXTENSIONS and not p.name.endswith(".raw.mp4")]
    if not videos:
        print(f"No video files found in '{target_dir}' (searched {VIDEO_EXTENSIONS}).")
        sys.exit(0)
        
    print(f"Found {len(videos)} video(s) in '{target_dir}'. Registering real test evaluator user...", flush=True)
    token, headers = register_test_user(args.api_url)
    print("User authenticated. Starting evaluation pipeline...\n", flush=True)
    
    results = []
    for vid in videos:
        print(f"--> Processing: {vid.name} ({vid.stat().st_size / (1024*1024):.2f} MB)...", flush=True)
        row = run_single_video(vid, args.api_url, headers, timeout_seconds=args.timeout)
        results.append(row)
        print(f"    Finished {vid.name} -> Status: {row['final_status']} | Cameras: {row['reg_cameras']} | Detections: {row['detections']}", flush=True)
        
    # Print formatted Phase G Markdown Table
    print("\n" + "=" * 120, flush=True)
    print("PHASE G END-TO-END EVALUATION TABLE", flush=True)
    print("=" * 120, flush=True)
    
    headers_table = [
        "video", "resolution", "duration", "frames selected", "SfM attempt that succeeded",
        "registered cameras", "sparse points", "mesh yes/no", "detections", "tracks",
        "fused", "rejected", "ETA vs actual", "final status", "console errors"
    ]
    
    divider = "|-" + "-|-".join(["-" * max(len(h), 12) for h in headers_table]) + "-|"
    
    print("| " + " | ".join(headers_table) + " |", flush=True)
    print(divider, flush=True)
    
    for r in results:
        vals = [
            str(r["video"]),
            str(r["resolution"]),
            str(r["duration"]),
            str(r["frames_selected"]),
            str(r["sfm_attempt"]),
            str(r["reg_cameras"]),
            str(r["points"]),
            str(r["mesh"]),
            str(r["detections"]),
            str(r["tracks"]),
            str(r["fused"]),
            str(r["rejected"]),
            str(r["eta_vs_actual"]),
            str(r["final_status"]),
            str(r["errors"]),
        ]
        print("| " + " | ".join(vals) + " |", flush=True)
        
    print("=" * 120 + "\n", flush=True)


if __name__ == "__main__":
    main()
