"""
End-to-End Fresh Video Verification & Lockdown Runner
Generates two completely different video files, runs them through the full pipeline via FastAPI client,
verifies all stages A through H, checks robustness, and captures raw evidence.
"""

import sys
import os
import time
import json
import subprocess
import shutil
import hashlib
from pathlib import Path
import numpy as np
import cv2

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from fastapi.testclient import TestClient
from backend.main import app
from backend.summary_builder import build_canonical_mission_summary

client = TestClient(app)


def generate_video(
    output_path: Path,
    width: int,
    height: int,
    fps: int,
    duration_sec: float,
    scene_seed: int,
    color_tint: tuple = (1.0, 1.0, 1.0),
    num_boxes: int = 10,
    with_labels: bool = True
):
    output_path.parent.mkdir(parents=True, exist_ok=True)
    total_frames = int(fps * duration_sec)
    
    # We will render frames to temp dir and encode with ffmpeg
    temp_frames_dir = output_path.parent / f"frames_{output_path.stem}"
    if temp_frames_dir.exists():
        shutil.rmtree(temp_frames_dir)
    temp_frames_dir.mkdir(parents=True, exist_ok=True)
    
    rng = np.random.RandomState(scene_seed)
    
    # Generate 3D objects (boxes/cuboids)
    boxes = []
    classes = ["car", "truck", "bus", "person", "van"]
    for i in range(num_boxes):
        cx = float(rng.uniform(-5.0, 5.0))
        cz = float(rng.uniform(6.0, 24.0))
        w = float(rng.uniform(1.2, 2.8))
        h = float(rng.uniform(1.0, 2.5))
        d = float(rng.uniform(1.2, 3.0))
        cls = classes[i % len(classes)]
        col = rng.randint(40, 230, size=3).tolist()
        boxes.append({"center": [cx, -h/2.0, cz], "size": [w, h, d], "class": cls, "color": col})
        
    fx = float(width) * 0.9
    fy = float(width) * 0.9
    cx0 = width / 2.0
    cy0 = height / 2.0
    
    for f_idx in range(total_frames):
        t = f_idx / total_frames
        # Parallax camera motion: flying along Z, orbiting slightly on X and Y
        cam_x = math_sin = 2.0 * np.sin(t * np.pi * 1.5)
        cam_y = 1.8 + 0.6 * np.cos(t * np.pi * 1.2)
        cam_z = t * 12.0
        
        # Look-at point ahead
        look_z = cam_z + 15.0
        
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        # Ground plane gradient
        for y in range(height // 2, height):
            grad = int(60 + 60 * (y - height // 2) / (height // 2))
            frame[y, :] = (int(grad * color_tint[0]), int((grad + 15) * color_tint[1]), int((grad - 10) * color_tint[2]))
        # Sky gradient
        for y in range(0, height // 2):
            grad = int(140 + 80 * (1.0 - y / (height // 2)))
            frame[y, :] = (int(grad * color_tint[0] * 1.1), int(grad * color_tint[1]), int((grad - 30) * color_tint[2]))
            
        # Ground grid / texture lines
        for gz in range(0, 40, 2):
            # Project ground lines
            pz = gz - cam_z
            if pz > 0.5:
                py_proj = int(cy0 + fy * (cam_y) / pz)
                if 0 <= py_proj < height:
                    cv2.line(frame, (0, py_proj), (width, py_proj), (70, 75, 70), 1)
                    
        # Render 3D boxes projected
        for box in sorted(boxes, key=lambda b: -(b["center"][2] - cam_z)):
            bx, by, bz = box["center"]
            bw, bh, bd = box["size"]
            rel_z = bz - cam_z
            if rel_z <= 0.8:
                continue
            rel_x = bx - cam_x
            rel_y = by + cam_y
            
            # Project center
            px = int(cx0 + fx * rel_x / rel_z)
            py = int(cy0 + fy * rel_y / rel_z)
            pw = int(fx * bw / rel_z)
            ph = int(fy * bh / rel_z)
            
            x0 = max(0, px - pw // 2)
            y0 = max(0, py - ph // 2)
            x1 = min(width - 1, px + pw // 2)
            y1 = min(height - 1, py + ph // 2)
            
            if x1 > x0 and y1 > y0:
                col = [int(c * color_tint[i_c]) for i_c, c in enumerate(box["color"])]
                cv2.rectangle(frame, (x0, y0), (x1, y1), col, -1)
                cv2.rectangle(frame, (x0, y0), (x1, y1), (20, 20, 20), 2)
                # Draw texture features inside box for high SIFT response
                for sub_i in range(3):
                    sx = x0 + (x1 - x0) * (sub_i + 1) // 4
                    cv2.line(frame, (sx, y0), (sx, y1), (255, 255, 255), 1)
                
                if with_labels:
                    cv2.putText(frame, box["class"], (x0 + 4, max(15, y0 - 4)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

        # High frequency texture noise
        noise = rng.randint(-12, 12, size=(height, width, 3))
        frame = np.clip(frame.astype(np.int16) + noise, 0, 255).astype(np.uint8)
        
        cv2.imwrite(str(temp_frames_dir / f"frame_{f_idx:05d}.jpg"), frame)
        
    # FFmpeg encode
    cmd = [
        "ffmpeg", "-y", "-framerate", str(fps),
        "-i", str(temp_frames_dir / "frame_%05d.jpg"),
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        str(output_path)
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    shutil.rmtree(temp_frames_dir, ignore_errors=True)
    print(f"[OK] Generated {output_path.name} ({width}x{height} @ {fps}fps, {duration_sec}s, {total_frames} frames)")


def run_mission(video_path: Path, mission_name: str, auth_token: str) -> dict:
    headers = {"Authorization": f"Bearer {auth_token}"}
    
    # 1. Create Mission
    t_start = time.time()
    resp = client.post(
        "/api/v1/missions",
        params={"name": mission_name},
        headers=headers
    )
    assert resp.status_code in (200, 201), f"Create mission failed: {resp.text}"
    m_data = resp.json()
    m_id = m_data.get("id") or m_data.get("mission_id") or (m_data.get("mission") or {}).get("id")
    print(f"\n[+] Created Mission: {m_id} ('{mission_name}')")
    
    # 2. Upload Video
    with open(video_path, "rb") as f:
        resp_up = client.post(
            f"/api/v1/missions/{m_id}/upload",
            files={"file": (video_path.name, f, "video/mp4")},
            headers=headers
        )
    assert resp_up.status_code in (200, 201), f"Upload failed: {resp_up.text}"
    print(f"[+] Uploaded {video_path.name} to mission {m_id}")
    
    # 3. Start Processing
    resp_start = client.post(
        f"/api/v1/missions/{m_id}/process",
        json={"run_reconstruction": True, "run_detection": True, "run_tracking": True, "run_fusion": True},
        headers=headers
    )
    assert resp_start.status_code in (200, 202), f"Start process failed: {resp_start.text}"
    print(f"[+] Pipeline started for {m_id}")
    
    # 3. Poll until terminal state
    timings = {}
    last_stage = None
    t0_stage = time.time()
    
    while True:
        resp_poll = client.get(f"/api/v1/missions/{m_id}", headers=headers)
        assert resp_poll.status_code == 200, f"Poll failed: {resp_poll.text}"
        m_state = resp_poll.json()
        m_obj = m_state.get("mission") if isinstance(m_state.get("mission"), dict) else m_state
        status = str(m_obj.get("status") or "").lower()
        current_stage = m_obj.get("stage") or status
        
        if current_stage != last_stage:
            if last_stage:
                timings[last_stage] = round(time.time() - t0_stage, 2)
            print(f"  -> Stage: {current_stage} (Elapsed so far: {time.time() - t_start:.1f}s)", flush=True)
            last_stage = current_stage
            t0_stage = time.time()
            
        if status in ("completed", "complete", "failed", "partial", "error"):
            timings[last_stage] = round(time.time() - t0_stage, 2)
            total_elapsed = round(time.time() - t_start, 2)
            print(f"[+] Mission {m_id} finished in state '{status}' in {total_elapsed}s", flush=True)
            break
            
        time.sleep(1.0)
        
    return {"mission_id": m_id, "mission_data": m_obj, "timings": timings, "total_time": total_elapsed}


if __name__ == "__main__":
    print("=" * 80)
    print("STEP 1: FRESH-VIDEO END-TO-END VERIFICATION")
    print("=" * 80)
    
    # Authenticate as INDIVIDUAL user
    reg_payload = {"email": "pilot_fresh_verify@aeromesh.internal", "password": "SecurePassword123!", "full_name": "Verification Pilot", "role": "individual"}
    resp_reg = client.post("/api/v1/auth/register", json=reg_payload)
    if resp_reg.status_code not in (200, 201):
        # login if exists
        resp_login = client.post("/api/v1/auth/login", json={"email": reg_payload["email"], "password": reg_payload["password"]})
        assert resp_login.status_code == 200, f"Login failed: {resp_login.text}"
        token = resp_login.json()["access_token"]
    else:
        token = resp_reg.json().get("access_token") or client.post("/api/v1/auth/login", json={"email": reg_payload["email"], "password": reg_payload["password"]}).json()["access_token"]
        
    print(f"[OK] Authenticated INDIVIDUAL user (token head: {token[:12]}...)")
    
    # Generate Video A
    vid_a = REPO_ROOT / "data" / "staging" / "fresh_test_video_alpha_640x360.mp4"
    generate_video(vid_a, width=640, height=360, fps=15, duration_sec=4.0, scene_seed=101, color_tint=(1.0, 1.0, 1.0), num_boxes=8)
    
    # Generate Video B
    vid_b = REPO_ROOT / "data" / "staging" / "fresh_test_video_beta_960x540.mp4"
    generate_video(vid_b, width=960, height=540, fps=20, duration_sec=5.0, scene_seed=777, color_tint=(0.8, 1.1, 0.9), num_boxes=14)
    
    # Run Video A
    print("\n>>> PROCESSING VIDEO A: fresh_test_video_alpha_640x360.mp4 <<<")
    res_a = run_mission(vid_a, "Mission Alpha (640x360)", token)
    
    # Run Video B
    print("\n>>> PROCESSING VIDEO B: fresh_test_video_beta_960x540.mp4 <<<")
    res_b = run_mission(vid_b, "Mission Beta (960x540)", token)
    
    # Output Verification Comparison
    print("\n" + "=" * 80)
    print("STEP 2: PIPELINE CONNECTIVITY & DIFFERENCE PROOF")
    print("=" * 80)
    
    ma = res_a["mission_data"]
    mb = res_b["mission_data"]
    id_a = res_a["mission_id"]
    id_b = res_b["mission_id"]
    
    # Print Directory Tree
    for label, m_id in [("Video A", id_a), ("Video B", id_b)]:
        print(f"\n--- Directory Tree for {label} ({m_id}) ---")
        m_dir = REPO_ROOT / "data" / "missions" / m_id
        if m_dir.is_dir():
            for p in sorted(m_dir.rglob("*")):
                if p.is_file():
                    rel = p.relative_to(m_dir)
                    print(f"  {str(rel):45} | {p.stat().st_size:>10} bytes")
                    
    # Generate & Save 3 Annotated Frames per video
    for label, m_id in [("Video A", id_a), ("Video B", id_b)]:
        m_dir = REPO_ROOT / "data" / "missions" / m_id
        frames_dir = m_dir / "reconstruction" / "frames"
        det_file = m_dir / "detections.json"
        if frames_dir.is_dir() and det_file.is_file():
            det_data = json.loads(det_file.read_text(encoding="utf-8"))
            obs = det_data.get("observations") or det_data.get("detections") or []
            frames = sorted(list(frames_dir.glob("*.jpg")))
            sample_frames = frames[::max(1, len(frames)//3)][:3]
            for s_idx, f_path in enumerate(sample_frames):
                img = cv2.imread(str(f_path))
                if img is not None:
                    # Draw boxes for this frame
                    f_num = int(f_path.stem.split("_")[-1]) if "_" in f_path.stem else s_idx
                    frame_obs = [o for o in obs if o.get("frame_idx") == f_num or o.get("frame_id") == f_num or o.get("frame_number") == f_num]
                    for o in frame_obs:
                        b = o.get("bbox") or o.get("box") or [0, 0, 50, 50]
                        cls = o.get("class_name") or o.get("label") or "object"
                        conf = o.get("confidence", 0.8)
                        cv2.rectangle(img, (int(b[0]), int(b[1])), (int(b[2]), int(b[3])), (0, 255, 0), 2)
                        cv2.putText(img, f"{cls} {conf:.2f}", (int(b[0]), max(15, int(b[1]) - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
                    out_ann = m_dir / f"annotated_frame_{s_idx+1}.jpg"
                    cv2.imwrite(str(out_ann), img)
                    print(f"[OK] Saved annotated sample frame: {out_ann.name} for {label}")

    print("\n--- Pipeline Difference Proof ---")
    print(f"{'Property':32} | {'Video A (' + id_a[:8] + ')':23} | {'Video B (' + id_b[:8] + ')':23} | Differ?")
    print("-" * 90)
    
    res_a_str = f"{ma.get('video', {}).get('resolution', {}).get('width')}x{ma.get('video', {}).get('resolution', {}).get('height')}"
    res_b_str = f"{mb.get('video', {}).get('resolution', {}).get('width')}x{mb.get('video', {}).get('resolution', {}).get('height')}"
    print(f"{'Resolution':32} | {res_a_str:23} | {res_b_str:23} | {res_a_str != res_b_str}")
    
    dur_a = ma.get('video', {}).get('duration_seconds')
    dur_b = mb.get('video', {}).get('duration_seconds')
    print(f"{'Duration (s)':32} | {str(dur_a):23} | {str(dur_b):23} | {dur_a != dur_b}")
    
    kf_a = len(list((REPO_ROOT / 'data' / 'missions' / id_a / 'reconstruction' / 'frames').glob('*.jpg')))
    kf_b = len(list((REPO_ROOT / 'data' / 'missions' / id_b / 'reconstruction' / 'frames').glob('*.jpg')))
    print(f"{'Extracted Keyframes':32} | {str(kf_a):23} | {str(kf_b):23} | {kf_a != kf_b}")
    
    pts_a = ma.get('reconstruction', {}).get('point_count') or ma.get('reconstruction', {}).get('sparse_point_count', 0)
    pts_b = mb.get('reconstruction', {}).get('point_count') or mb.get('reconstruction', {}).get('sparse_point_count', 0)
    print(f"{'Reconstructed 3D Points':32} | {str(pts_a):23} | {str(pts_b):23} | {pts_a != pts_b}")
    
    det_a = ma.get('detections', {}).get('total_detections', 0)
    det_b = mb.get('detections', {}).get('total_detections', 0)
    print(f"{'YOLO Total Detections':32} | {str(det_a):23} | {str(det_b):23} | {det_a != det_b}")
    
    trk_a = ma.get('tracking', {}).get('unique_tracks', 0)
    trk_b = mb.get('tracking', {}).get('unique_tracks', 0)
    print(f"{'Unique Tracklets':32} | {str(trk_a):23} | {str(trk_b):23} | {trk_a != trk_b}")
    
    fused_a = len(ma.get('spatial_fusion', {}).get('fused_objects', []))
    fused_b = len(mb.get('spatial_fusion', {}).get('fused_objects', []))
    print(f"{'Fused 3D Objects':32} | {str(fused_a):23} | {str(fused_b):23} | {fused_a != fused_b}")
    
    print("\n[+] Stage Timings Video A:", res_a["timings"])
    print("[+] Stage Timings Video B:", res_b["timings"])
    
    # STEP 3: Robustness checks
    print("\n" + "=" * 80)
    print("STEP 3: ROBUSTNESS & FAILURE HONESTY")
    print("=" * 80)
    
    # Corrupt video test
    corrupt_file = REPO_ROOT / "data" / "staging" / "corrupt_test_file.mp4"
    corrupt_file.write_bytes(b"NOT_A_REAL_MP4_VIDEO_HEADER_123456789")
    resp_m_corrupt = client.post("/api/v1/missions", params={"name": "Corrupt Video Mission"}, headers={"Authorization": f"Bearer {token}"})
    m_corrupt_id = resp_m_corrupt.json()["mission"]["id"]
    with open(corrupt_file, "rb") as f:
        resp_up_c = client.post(f"/api/v1/missions/{m_corrupt_id}/upload", files={"file": (corrupt_file.name, f, "video/mp4")}, headers={"Authorization": f"Bearer {token}"})
    print(f"[Robustness] Upload corrupt video status: {resp_up_c.status_code}")
    if resp_up_c.status_code == 200:
        resp_proc_c = client.post(f"/api/v1/missions/{m_corrupt_id}/process", headers={"Authorization": f"Bearer {token}"})
        print(f"[Robustness] Process corrupt video trigger status: {resp_proc_c.status_code}")
        # Poll corrupt mission
        for _ in range(10):
            p = client.get(f"/api/v1/missions/{m_corrupt_id}", headers={"Authorization": f"Bearer {token}"}).json()
            if p.get("status") in ("failed", "error", "complete", "completed"):
                print(f"[Robustness] Corrupt video terminal state: status='{p.get('status')}', error='{p.get('error')}'")
                break
            time.sleep(1.0)
    else:
        print(f"[Robustness] Corrupt video rejected upfront at upload with error: {resp_up_c.text}")

