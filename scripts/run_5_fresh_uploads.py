#!/usr/bin/env python3
"""
Runs 5 FRESH uploads end-to-end via the REAL API endpoints:
(a) Landscape drone video ~60s
(b) Short shaky/low-texture clip (~8s)
(c) Portrait phone video (9:16)
(d) >2 minute video (>120s)
(e) Video with few/no detectable objects
Reports all metrics in a markdown table.
"""
import os
import sys
import time
import json
import uuid
import requests
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://127.0.0.1:8000/api/v1"
TEST_VIDEOS_DIR = ROOT / "scratch" / "test_videos"

CHUNK_SIZE = 2 * 1024 * 1024  # 2MB chunks, matching frontend uploadVideoChunk

TEST_CASES = [
    {
        "key": "A",
        "label": "(a) Landscape Drone (~60s)",
        "file": TEST_VIDEOS_DIR / "video_a_landscape_60s.mp4",
        "name": "Fresh-A-Landscape-60s",
    },
    {
        "key": "B",
        "label": "(b) Shaky/Low-Texture Clip",
        "file": TEST_VIDEOS_DIR / "video_b_shaky_lowtexture.mp4",
        "name": "Fresh-B-Shaky-LowTex",
    },
    {
        "key": "C",
        "label": "(c) Portrait Phone Video (9:16)",
        "file": TEST_VIDEOS_DIR / "video_c_portrait_phone.mp4",
        "name": "Fresh-C-Portrait-Phone",
    },
    {
        "key": "D",
        "label": "(d) >2 Minute Video",
        "file": TEST_VIDEOS_DIR / "video_d_long_2min.mp4",
        "name": "Fresh-D-Long-2Min",
    },
    {
        "key": "E",
        "label": "(e) Few/No Detectable Objects",
        "file": TEST_VIDEOS_DIR / "video_e_no_objects.mp4",
        "name": "Fresh-E-Zero-Detections",
    },
]

def upload_video_file(mission_id: str, file_path: Path) -> float:
    """Uploads video using either direct upload (<=4MB) or chunked upload (>4MB), exactly as frontend does."""
    file_size = file_path.stat().st_size
    t_start = time.time()
    
    if file_size <= 4 * 1024 * 1024:
        print(f"  [2] Direct upload ({file_size / (1024*1024):.2f} MB <= 4 MB)...")
        with open(file_path, "rb") as f:
            r = requests.post(
                f"{BASE_URL}/missions/{mission_id}/upload",
                files={"file": (file_path.name, f, "video/mp4")},
                timeout=300
            )
        if r.status_code != 200:
            raise RuntimeError(f"Direct upload failed ({r.status_code}): {r.text}")
    else:
        total_chunks = (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE
        upload_id = f"upl_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        print(f"  [2] Chunked upload ({file_size / (1024*1024):.2f} MB in {total_chunks} chunks)...")
        
        with open(file_path, "rb") as f:
            for idx in range(total_chunks):
                chunk_data = f.read(CHUNK_SIZE)
                r = requests.post(
                    f"{BASE_URL}/missions/{mission_id}/upload/chunk",
                    params={
                        "chunk_index": idx,
                        "total_chunks": total_chunks,
                        "upload_id": upload_id,
                        "filename": file_path.name,
                    },
                    files={"chunk": (file_path.name, chunk_data, "application/octet-stream")},
                    timeout=300
                )
                if r.status_code != 200:
                    raise RuntimeError(f"Chunk {idx}/{total_chunks} failed ({r.status_code}): {r.text}")
                pct = int(((idx + 1) / total_chunks) * 100)
                if (idx + 1) % 10 == 0 or idx + 1 == total_chunks:
                    print(f"      Chunk {idx + 1}/{total_chunks} uploaded ({pct}%)")

    upload_duration = round(time.time() - t_start, 2)
    print(f"  [2] Upload Complete in {upload_duration}s")
    return upload_duration

def run_single_mission(tc: dict) -> dict:
    print("\n" + "=" * 70)
    print(f"Starting Test {tc['key']}: {tc['label']}")
    print(f"Video file: {tc['file']} (Size: {tc['file'].stat().st_size / 1024 / 1024:.2f} MB)")
    print("=" * 70)

    # 1. Create Mission (exact API call made by UI)
    create_payload = {
        "name": tc["name"],
        "description": f"Automated E2E Verification Test {tc['key']}",
        "type": "Inspection Survey",
        "sector": "Verification",
        "operator": "AI Verification Agent",
    }
    r_create = requests.post(f"{BASE_URL}/missions", params=create_payload, timeout=30)
    if r_create.status_code != 200:
        raise RuntimeError(f"Mission creation failed: {r_create.text}")
    mission_id = r_create.json().get("mission", {}).get("id")
    print(f"  [1] Mission Created: ID = {mission_id}")

    # 2. Upload Video
    upload_duration = upload_video_file(mission_id, tc["file"])

    # 3. Trigger Processing Pipeline (exact call made by UI)
    print(f"  [3] Launching pipeline processing on /missions/{mission_id}/process...")
    t_proc_start = time.time()
    r_proc = requests.post(
        f"{BASE_URL}/missions/{mission_id}/process",
        json={
            "frame_sampling": 2.0,
            "detection_confidence": 0.25,
            "reconstruction_quality": "medium",
            "scene_profile": "road",
        },
        timeout=60
    )
    if r_proc.status_code != 200:
        print(f"  [!] Process launch returned non-200: {r_proc.text}")

    # 4. Poll status until complete or failed (exact polling pattern as frontend)
    print(f"  [4] Polling processing status for mission {mission_id}...")
    final_status = "UNKNOWN"
    last_reported_stage = ""
    timeout_s = 600  # 10 minute ceiling per video on CPU
    start_poll = time.time()

    while time.time() - start_poll < timeout_s:
        try:
            r_st = requests.get(f"{BASE_URL}/missions/{mission_id}/processing-status", timeout=15)
            if r_st.status_code == 200:
                st_data = r_st.json()
                ov_status = st_data.get("status", "")
                progress = st_data.get("progress_percent", 0)
                current_stage = st_data.get("current_stage") or ""

                stage_display = f"{current_stage} ({progress}%)"
                if stage_display != last_reported_stage:
                    print(f"      Pipeline progress: {stage_display} [status: {ov_status}]", flush=True)
                    last_reported_stage = stage_display

                if ov_status in ("COMPLETED", "FAILED", "INTERRUPTED"):
                    final_status = ov_status
                    break
        except Exception as e:
            print(f"      Polling notice: {e}", flush=True)

        # Also check mission manifest directly
        try:
            r_m = requests.get(f"{BASE_URL}/missions/{mission_id}", timeout=15)
            if r_m.status_code == 200:
                m_raw = r_m.json().get("mission", {})
                m_st = str(m_raw.get("status", "")).lower()
                if m_st in ("complete", "reconstruction_ready", "processing_complete"):
                    final_status = "COMPLETED"
                    break
                elif m_st in ("failed", "interrupted"):
                    final_status = "FAILED"
                    break
        except Exception:
            pass

        time.sleep(3)

    proc_duration = round(time.time() - t_proc_start, 2)
    print(f"  [5] Processing finished in {proc_duration}s with overall status: {final_status}")

    # 5. Fetch Authoritative Manifest & Artifacts
    r_get = requests.get(f"{BASE_URL}/missions/{mission_id}", timeout=30)
    if r_get.status_code != 200:
        raise RuntimeError(f"Failed fetching manifest: {r_get.text}")
    m = r_get.json().get("mission", {})

    recon = m.get("reconstruction") or {}
    processing = m.get("processing") or {}
    timings = m.get("timings") or processing.get("stage_timings") or m.get("stage_timings") or {}
    
    # Format stage timings cleanly
    timings_parts = []
    for k, v in timings.items():
        if isinstance(v, (int, float)):
            stage_name = k.replace("stage_", "").split("_")[-1]
            timings_parts.append(f"{stage_name}:{v}s")
    timings_str = " | ".join(timings_parts) if timings_parts else f"total:{proc_duration}s"

    tier_used = recon.get("tier_used", "N/A")
    quality_label = recon.get("quality_label", "N/A")
    reg_cams = recon.get("registered_cameras", 0)
    tot_imgs = recon.get("total_images", 0)
    pt_count = recon.get("point_count") or recon.get("sparse_point_count") or recon.get("stages", {}).get("sparse_sfm", {}).get("points") or 0

    # Check mesh size on disk
    mesh_size_mb = 0.0
    for cand in [
        ROOT / "data" / "objects" / "missions" / mission_id / "reconstruction" / "mesh.ply",
        ROOT / "data" / "missions" / mission_id / "reconstruction" / "model" / "mesh.ply",
        ROOT / "data" / "missions" / mission_id / "reconstruction" / "mesh.ply",
    ]:
        if cand.exists():
            mesh_size_mb = round(cand.stat().st_size / (1024 * 1024), 2)
            break

    # 2D detections count
    dets_data = m.get("detections") or {}
    det_2d_count = dets_data.get("uniqueTracks") or len(dets_data.get("observations") or [])
    
    # Fused 3D objects
    objs_3d = len(m.get("objects_3d") or [])

    m_status = m.get("status", final_status)
    warning = recon.get("warning") or processing.get("warning") or recon.get("error") or "None"

    print(f"  Summary: Status={m_status}, Tier={tier_used} ({quality_label}), Reg={reg_cams}/{tot_imgs}, Pts={pt_count:,}, 3DObjs={objs_3d}")

    return {
        "key": tc["key"],
        "label": tc["label"],
        "mission_id": mission_id,
        "upload_time": f"{upload_duration}s",
        "time_per_stage": timings_str,
        "total_time": f"{proc_duration}s",
        "tier_used": f"Tier {tier_used} ({quality_label})",
        "registered_ratio": f"{reg_cams}/{tot_imgs}",
        "point_count": f"{pt_count:,}",
        "mesh_size_mb": f"{mesh_size_mb} MB" if mesh_size_mb > 0 else "None",
        "2d_detections": det_2d_count,
        "fused_3d_objects": objs_3d,
        "final_status": m_status,
        "errors_or_retries": warning,
    }

def main():
    results = []
    for tc in TEST_CASES:
        res = run_single_mission(tc)
        results.append(res)
        time.sleep(2)

    # Save results json
    out_json = ROOT / "scratch" / "fresh_uploads_results.json"
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)

    print("\n" + "=" * 100)
    print("ALL 5 FRESH UPLOADS COMPLETE — FINAL VERIFICATION SUMMARY TABLE")
    print("=" * 100)
    header = (
        f"| Test | Mission ID | Upload | Total Time | Tier Used | Reg/Total | Points | Mesh | 2D Dets | 3D Objs | Status | Errors/Retries |"
    )
    divider = "|---|---|---|---|---|---|---|---|---|---|---|---|"
    print(header)
    print(divider)
    for r in results:
        print(
            f"| {r['label']} | `{r['mission_id'][:8]}` | {r['upload_time']} | {r['total_time']} | "
            f"{r['tier_used']} | {r['registered_ratio']} | {r['point_count']} | {r['mesh_size_mb']} | "
            f"{r['2d_detections']} | {r['fused_3d_objects']} | **{r['final_status']}** | {r['errors_or_retries']} |"
        )
    print("=" * 100)

if __name__ == "__main__":
    main()
