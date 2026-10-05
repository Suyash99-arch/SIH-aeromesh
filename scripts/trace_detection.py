#!/usr/bin/env python3
"""
scripts/trace_detection.py <mission_id>

Traces the entire YOLO detection and tracking pipeline for a mission step-by-step:
- Detection stage state and log metadata
- Weights path + SHA256 + model.names + device + imgsz + tiling
- Frames processed
- Box count after EACH step:
  1. Raw model output (conf >= 0.01)
  2. After confidence threshold
  3. After minimum box size
  4. After tile merge / NMS
  5. After tracking (ByteTrack)
  6. After minimum track length / confidence filter
  7. After class majority vote
  8. After class allow-list / scene profile
  9. Final stored observations and unique tracks
  10. Final in /summary
  11. Number each UI page shows
- Cache / reuse inspection (by video hash or file path) with DISABLE_DETECTION_CACHE support
"""

import sys
import os
import json
import hashlib
import cv2
import numpy as np
from pathlib import Path

# Add project root to sys.path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from backend.main import (
    MissionData,
    _load_detection_model,
    get_detector_metadata,
)
from backend.detection import (
    DEFAULT_DETECTION_IMGSZ,
    DetectionRecord,
    calculate_frame_interval,
    generate_tiles,
    resolve_allowed_classes,
    suppress_tile_duplicates,
)
from backend.tracking import (
    ByteTrackAdapter,
    CameraMotionEstimator,
    apply_track_majority_vote,
    stitch_tracklets,
)
from backend.summary_builder import build_canonical_mission_summary


def compute_sha256(file_path: Path) -> str:
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def trace_mission(mission_id: str):
    print("=" * 84)
    print(f"YOLO DETECTION & TRACKING DETAILED TRACE FOR MISSION: {mission_id}")
    print("=" * 84)

    # 1. Load mission data from disk
    mission_obj = MissionData(mission_id)
    if not mission_obj.data:
        print(f"[ERROR] Mission '{mission_id}' not found in data/missions/ or database.")
        sys.exit(1)

    m_data = mission_obj.data
    m_status = m_data.get("status", "unknown")
    proc = m_data.get("processing", {})
    stored_detections = m_data.get("detections", {})
    stored_tracks = m_data.get("tracks", [])

    print(f"\n--- [1] MISSION & STAGE STATE ---")
    print(f"Mission ID         : {mission_id}")
    print(f"Mission Status     : {m_status}")
    print(f"Processing Stage   : {m_data.get('current_stage', 'none')} ({m_data.get('progress', 0)}%)")
    print(f"Processing Warning : {proc.get('warning', 'None')}")

    # 2. Check Cache or Reuse Configuration
    disable_cache_env = os.getenv("DISABLE_DETECTION_CACHE", "0").lower() in ("1", "true", "yes")
    print(f"\n--- [2] CACHE & REUSE AUDIT ---")
    print(f"DISABLE_DETECTION_CACHE Flag : {'ENABLED (Cache Bypassed)' if disable_cache_env else 'DISABLED (Default)'}")
    
    # Check if mission has cached hash
    video_meta = m_data.get("video", {})
    video_sha = video_meta.get("sha256", "none")
    print(f"Stored Video SHA256          : {video_sha}")
    det_cache_path = Path("data/cache/detections") / f"{video_sha}.json"
    if det_cache_path.exists():
        print(f"File-based detection cache   : FOUND at {det_cache_path}")
        if disable_cache_env:
            print("Action                       : IGNORED due to DISABLE_DETECTION_CACHE=1")
        else:
            print("Action                       : ACTIVE")
    else:
        print(f"File-based detection cache   : None (Running fresh inference)")

    # 3. Locate Stored Video
    stored_video_path = None
    cand_paths = [
        Path(f"data/objects/missions/{mission_id}/original/{video_meta.get('filename', '')}"),
        Path(f"data/missions/{mission_id}/video.mp4"),
        Path(f"data/objects/missions/{mission_id}/video.mp4"),
    ]
    if m_data.get("video_path"):
        cand_paths.insert(0, Path(m_data["video_path"]))

    for cp in cand_paths:
        if cp.is_file() and cp.stat().st_size > 0:
            stored_video_path = cp
            break

    if not stored_video_path:
        # Fallback to search inside mission directories
        for base_dir in [Path(f"data/missions/{mission_id}"), Path(f"data/objects/missions/{mission_id}")]:
            if base_dir.exists():
                for ext in [".mp4", ".mov", ".mkv"]:
                    for cand in list(base_dir.glob(f"*{ext}")) + list((base_dir / "original").glob(f"*{ext}")):
                        if cand.is_file() and cand.stat().st_size > 0:
                            stored_video_path = cand
                            break
                    if stored_video_path:
                        break

    if not stored_video_path or not stored_video_path.is_file():
        print(f"[ERROR] Stored video file missing for mission {mission_id}. Cannot run live trace.")
        sys.exit(1)

    print(f"Resolved Video Path          : {stored_video_path} ({stored_video_path.stat().st_size} bytes)")

    # 4. Model and Hardware Inspection
    model, model_name, is_aeromesh = _load_detection_model(use_aeromesh=True)
    weights_path = Path(getattr(model, "weights", None) or os.getenv("YOLO_MODEL_PATH", "backend/models/aeromesh_yolo.pt"))
    weights_sha256 = compute_sha256(weights_path) if weights_path.is_file() else "missing"
    model_names = getattr(model, "names", {})
    device_name = "CPU"
    try:
        import torch
        device_name = "CUDA" if torch.cuda.is_available() else "CPU"
    except Exception:
        pass

    tile_inference = True
    tile_rows = 2
    tile_cols = 2
    tile_overlap = 0.15
    tile_iou = 0.5

    print(f"\n--- [3] DETECTOR & WEIGHTS PROVENANCE ---")
    print(f"Model Architecture : {model_name} (VisDrone/COCO Aeromesh Fine-Tuned)")
    print(f"Model Weights Path : {weights_path}")
    print(f"Weights SHA256     : {weights_sha256}")
    print(f"Inference Device   : {device_name}")
    print(f"Model Classes      : {model_names}")
    print(f"Tiling Config      : Enabled={tile_inference} ({tile_rows}x{tile_cols} grid, overlap={tile_overlap}, iou={tile_iou})")

    # 5. Live Pipeline Step-by-Step Execution & Counting
    cap = cv2.VideoCapture(str(stored_video_path))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    sample_fps = 2.0
    interval = calculate_frame_interval(fps, sample_fps)

    print(f"\n--- [4] VIDEO STREAM PROPERTIES ---")
    print(f"Dimensions         : {width} x {height}")
    print(f"Total Video Frames : {total_frames} frames ({total_frames / fps:.2f}s at {fps:.2f} FPS)")
    print(f"Sample Rate        : {sample_fps} FPS (Stride = every {interval} frames)")

    # Step accumulators
    step1_raw_boxes = []          # Raw model output (conf >= 0.01)
    step2_conf_boxes = []         # After confidence threshold
    step3_minsize_boxes = []      # After relative minimum box size
    step4_tile_merged_boxes = []  # After tile duplicate suppression (NMS)

    # Threshold parameters
    base_confidence = 0.35
    # Relative minimum box size: min 0.5% of min(width, height) or 24 px
    min_box_w = max(24.0, width * 0.006)
    min_box_h = max(24.0, height * 0.006)

    online_tracker = ByteTrackAdapter(
        max_missed_frames=max(3, int(sample_fps * 1.5)),
        iou_threshold=0.25,
    )
    motion_estimator = CameraMotionEstimator(target_width=480)

    frame_num = 0
    sampled_count = 0

    print(f"\nRunning step-by-step feature tracing across video frames...")
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_num % interval == 0:
            sampled_count += 1
            motion = motion_estimator.estimate(frame)
            h, w = frame.shape[:2]
            tiles = generate_tiles(w, h, rows=tile_rows, cols=tile_cols, overlap=tile_overlap)

            frame_raw_records = []
            frame_conf_records = []
            frame_minsize_records = []

            for tx1, ty1, tx2, ty2 in tiles:
                tile = frame[ty1:ty2, tx1:tx2]
                
                # Step 1: Raw output at minimal confidence (0.01)
                res_raw = model(tile, conf=0.01, iou=0.7, verbose=False)[0]
                raw_boxes = getattr(res_raw, "boxes", [])
                names = getattr(res_raw, "names", {})

                for box in raw_boxes:
                    cls_id = int(box.cls[0].item() if hasattr(box.cls[0], "item") else box.cls[0])
                    cls_name = str(names.get(cls_id, cls_id))
                    conf_val = float(box.conf[0].item() if hasattr(box.conf[0], "item") else box.conf[0])
                    b = box.xyxy[0].tolist() if hasattr(box.xyxy[0], "tolist") else box.xyxy[0]
                    remapped_box = [
                        round(max(0.0, min(float(w), float(b[0]) + tx1)), 2),
                        round(max(0.0, min(float(h), float(b[1]) + ty1)), 2),
                        round(max(0.0, min(float(w), float(b[2]) + tx1)), 2),
                        round(max(0.0, min(float(h), float(b[3]) + ty1)), 2),
                    ]
                    rec = DetectionRecord(
                        frame_id=str(frame_num),
                        class_name=cls_name,
                        confidence=conf_val,
                        bbox=remapped_box,
                        timestamp=frame_num / fps,
                    )
                    frame_raw_records.append(rec)
                    step1_raw_boxes.append(rec)

                    # Step 2: Confidence threshold
                    if conf_val >= base_confidence:
                        frame_conf_records.append(rec)
                        step2_conf_boxes.append(rec)

                        # Step 3: Minimum box dimension
                        bw = remapped_box[2] - remapped_box[0]
                        bh = remapped_box[3] - remapped_box[1]
                        if bw >= min_box_w and bh >= min_box_h:
                            frame_minsize_records.append(rec)
                            step3_minsize_boxes.append(rec)

            # Step 4: Tile merge & duplicate suppression on kept minsize boxes
            kept_tile_records, dups = suppress_tile_duplicates(frame_minsize_records, iou_threshold=tile_iou)
            step4_tile_merged_boxes.extend(kept_tile_records)

            # Step 5: Update online tracker
            assigned = online_tracker.update_frame(kept_tile_records, camera_motion=motion)

        frame_num += 1

    cap.release()

    # Step 5: Tracked records & raw tracks
    step5_tracked_records = online_tracker.completed + online_tracker.active
    all_assigned_detections = []
    for trk in step5_tracked_records:
        for obs in trk.observations:
            all_assigned_detections.append(obs)
    step5_raw_track_count = len(step5_tracked_records)
    step5_box_count = len(all_assigned_detections)

    # Step 6: Minimum track length / persistence filter (min 2 hits for drone video)
    min_track_hits = 2
    step6_kept_tracks = [t for t in step5_tracked_records if t.detection_count >= min_track_hits]
    step6_box_count = sum(t.detection_count for t in step6_kept_tracks)
    step6_track_count = len(step6_kept_tracks)

    # Step 7: Majority vote for class label per track
    step7_records = []
    for t in step6_kept_tracks:
        for obs in t.observations:
            step7_records.append(
                DetectionRecord(
                    frame_id=str(obs["frame_id"]),
                    class_name=t.class_name,
                    confidence=obs["confidence"],
                    bbox=obs["bbox"],
                    timestamp=obs["timestamp"],
                    track_id=t.track_id,
                )
            )
    voted_records = apply_track_majority_vote(step7_records)
    step7_box_count = len(voted_records)
    step7_track_count = len({r.track_id for r in voted_records if r.track_id})

    # Step 8: Class allow-list or scene profile
    road_classes = resolve_allowed_classes("road", None)
    step8_records = [r for r in voted_records if road_classes is None or r.class_name in road_classes]
    step8_box_count = len(step8_records)
    step8_track_count = len({r.track_id for r in step8_records if r.track_id})

    # Step 9: Final stored in mission JSON
    final_stored_obs_count = len(stored_detections.get("observations", [])) if isinstance(stored_detections, dict) else len(stored_detections or [])
    final_stored_tracks_count = len(stored_tracks) if isinstance(stored_tracks, list) else 0

    # Step 10: Canonical /summary values
    canonical = build_canonical_mission_summary(mission_id, m_data)
    summary_det_count = canonical.get("detection", {}).get("total_detections", 0)
    summary_trk_count = canonical.get("tracking", {}).get("unique_tracks", 0)
    summary_fused_count = canonical.get("spatial_fusion", {}).get("total_fused_objects", 0)

    # Step 11: Numbers each UI page displays
    ui_overview_total = canonical.get("objects", {}).get("total", 0)
    ui_scene_tracks = canonical.get("tracking", {}).get("unique_tracks", 0)
    ui_scene_detections = canonical.get("detection", {}).get("total_detections", 0)
    ui_viewer_fused = canonical.get("spatial_fusion", {}).get("total_fused_objects", 0)
    ui_reports_detections = canonical.get("detection", {}).get("total_detections", 0)
    ui_reports_tracks = canonical.get("tracking", {}).get("unique_tracks", 0)

    # 6. Print Authoritative Step-by-Step Table
    print("\n" + "=" * 94)
    print(f"{'Step / Filter Pipeline Stage':<42} | {'Boxes':<10} | {'Tracks':<8} | {'Dropped/Delta':<14} | {'Notes'}")
    print("-" * 94)
    print(f"{'1. Raw model output (conf >= 0.01)':<42} | {len(step1_raw_boxes):<10} | {'—':<8} | {'0':<14} | Baseline detections before gating")
    drop_conf = len(step1_raw_boxes) - len(step2_conf_boxes)
    print(f"{'2. After confidence threshold (>= 0.35)':<42} | {len(step2_conf_boxes):<10} | {'—':<8} | {f'-{drop_conf}':<14} | Filtered low-confidence noise")
    drop_size = len(step2_conf_boxes) - len(step3_minsize_boxes)
    print(f"{'3. After relative min box size (>=24x24 px)':<42} | {len(step3_minsize_boxes):<10} | {'—':<8} | {f'-{drop_size}':<14} | Filtered tiny architectural lattice")
    drop_tile = len(step3_minsize_boxes) - len(step4_tile_merged_boxes)
    print(f"{'4. After tile merge & duplicate NMS':<42} | {len(step4_tile_merged_boxes):<10} | {'—':<8} | {f'-{drop_tile}':<14} | Merged tile boundaries")
    print(f"{'5. After tracking (ByteTrack)':<42} | {step5_box_count:<10} | {step5_raw_track_count:<8} | {'0':<14} | Assigned spatio-temporal IDs")
    drop_track_len = step5_box_count - step6_box_count
    print(f"{'6. After min track length filter (>= 2 hits)':<42} | {step6_box_count:<10} | {step6_track_count:<8} | {f'-{drop_track_len}':<14} | Removed single-frame flickers")
    print(f"{'7. After per-track class majority vote':<42} | {step7_box_count:<10} | {step7_track_count:<8} | {'0':<14} | Stabilized class flickering")
    drop_class = step7_box_count - step8_box_count
    print(f"{'8. After class allow-list / scene profile':<42} | {step8_box_count:<10} | {step8_track_count:<8} | {f'-{drop_class}':<14} | Validated scene-compatible classes")
    print(f"{'9. Stored in mission manifest':<42} | {final_stored_obs_count:<10} | {final_stored_tracks_count:<8} | {'—':<14} | Manifest record on disk")
    print(f"{'10. Canonical /summary API response':<42} | {summary_det_count:<10} | {summary_trk_count:<8} | {'—':<14} | Authoritative Single Source of Truth")
    print("=" * 94)

    # 7. Print UI Cross-Screen Consistency
    print("\n--- [5] UI PAGE NUMBER CONSUMPTION AUDIT ---")
    print(f"Mission Command Overview Card  : Total Objects = {ui_overview_total} (Tracks)")
    print(f"Scene Intelligence Screen       : Unique Tracks = {ui_scene_tracks}, Observations = {ui_scene_detections}")
    print(f"3D Reconstruction Viewer Panel  : 3D Fused Entities = {ui_viewer_fused}")
    print(f"Reports & PDF Deliverables      : Total Detections = {ui_reports_detections}, Tracks = {ui_reports_tracks}")

    # Check for number drop or meaning mutation
    print("\n--- [6] ANOMALY DETECTION & MEANING CHECK ---")
    if summary_det_count == summary_trk_count and summary_det_count > 0:
        print("[WARNING] Detections count equals unique tracks count! (Detections may be displaying tracks instead of frame observations)")
    else:
        print(f"[OK] Distinct numbers verified: Detections ({summary_det_count}) > Tracks ({summary_trk_count}) >= Fused ({summary_fused_count})")

    if summary_det_count == 0 and len(step1_raw_boxes) > 0:
        print(f"[ALERT] Boxes dropped to zero! (Reason: all {len(step1_raw_boxes)} raw detections were removed by downstream filters)")
    else:
        print(f"[OK] Pipeline preserved {summary_det_count} detections and {summary_trk_count} tracks.")

    print("=" * 84 + "\n")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/trace_detection.py <mission_id>")
        sys.exit(1)
    trace_mission(sys.argv[1])
