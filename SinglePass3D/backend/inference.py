"""TRAINED AEROMESH YOLO video inference with class-aware IoU tracking.

This module runs the trained aeromesh_yolo.pt model (VisDrone fine-tuned) on drone video
and reports only actual detections made during inference. No synthetic data, no fabricated
coordinates, no demo fallback.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
from time import perf_counter
import sys

import cv2
from ultralytics import YOLO


def _resolve_repo_root() -> Path:
    """Resolve the repository root directory from the current file location."""
    # SinglePass3D/backend/inference.py → resolve to Sih root
    current = Path(__file__).resolve()  # SinglePass3D/backend/inference.py
    backend_dir = current.parent  # SinglePass3D/backend/
    single_pass_3d = backend_dir.parent  # SinglePass3D/
    repo_root = single_pass_3d.parent  # Sih (repository root)
    return repo_root


def _resolve_trained_model() -> Path:
    """Resolve the trained aeromesh_yolo.pt model path from repository root."""
    repo_root = _resolve_repo_root()
    model_path = repo_root / "backend" / "models" / "aeromesh_yolo.pt"
    
    if not model_path.exists():
        raise FileNotFoundError(
            f"FATAL: Trained model not found at {model_path}\n"
            f"Repository root: {repo_root}\n"
            f"Expected: backend/models/aeromesh_yolo.pt"
        )
    
    return model_path


AEROMESH_CLASSES = {
    0: "awning-tricycle",
    1: "bicycle",
    2: "bus",
    3: "car",
    4: "motor",
    5: "pedestrian",
    6: "people",
    7: "tricycle",
    8: "truck",
    9: "van",
}

AEROMESH_GROUPS = {
    "awning-tricycle": "vehicles",
    "bicycle": "vehicles",
    "bus": "vehicles",
    "car": "vehicles",
    "motor": "vehicles",
    "pedestrian": "people",
    "people": "people",
    "tricycle": "vehicles",
    "truck": "vehicles",
    "van": "vehicles",
}


def _iou(a: list[float], b: list[float]) -> float:
    """Compute Intersection-over-Union for two bounding boxes."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1, ix2, iy2 = max(ax1, bx1), max(ay1, by1), min(ax2, bx2), min(ay2, by2)
    intersection = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - intersection
    return intersection / union if union else 0.0


def _quality(frame) -> dict[str, float]:
    """Compute quality metrics for a frame."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = min(100.0, cv2.Laplacian(gray, cv2.CV_64F).var() / 5)
    brightness = gray.mean() / 255 * 100
    contrast = gray.std() / 128 * 100
    return {
        "sharpness": round(sharpness, 1),
        "brightness": round(brightness, 1),
        "contrast": round(min(100, contrast), 1),
    }


def process_video(
    video_path: Path,
    model_path: str = None,
    sample_fps: float = 2.0,
    confidence: float = 0.35,
) -> dict:
    """
    Run trained AEROMESH YOLO detection on sampled frames with class-aware tracking.
    
    Args:
        video_path: Path to input video file
        model_path: Optional override for model path (must be valid if provided)
        sample_fps: Target frame sampling rate (frames per second)
        confidence: YOLO confidence threshold
    
    Returns:
        Dict containing video info, detections, tracks, and provenance
    """
    
    # ====================================================================
    # RESOLVE TRAINED MODEL PATH
    # ====================================================================
    
    if model_path is None:
        model_path = str(_resolve_trained_model())
    else:
        # If explicit path provided, verify it exists
        model_path_obj = Path(model_path)
        if not model_path_obj.exists():
            raise FileNotFoundError(f"Model not found at {model_path}")
        model_path = str(model_path_obj.resolve())
    
    # ====================================================================
    # LOAD TRAINED MODEL
    # ====================================================================
    
    try:
        model = YOLO(model_path)
        print(f"[INFERENCE] Loaded trained model from: {model_path}")
        print(f"[INFERENCE] Model classes: {list(model.names.values())}")
    except Exception as e:
        raise RuntimeError(f"Failed to load model from {model_path}: {e}")
    
    # ====================================================================
    # OPEN VIDEO
    # ====================================================================
    
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")
    
    fps = capture.get(cv2.CAP_PROP_FPS) or 0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width, height = (
        int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)),
        int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT)),
    )
    
    if not fps or fps <= 0:
        raise ValueError("Could not determine video FPS")
    
    interval = max(1, round(fps / sample_fps)) if fps else 1
    
    # ====================================================================
    # INFERENCE LOOP
    # ====================================================================
    
    active_tracks: list[dict] = []
    all_tracks: list[dict] = []
    observations: list[dict] = []
    frame_qualities: list[dict] = []
    frame_index = 0
    started = perf_counter()
    
    print(f"[INFERENCE] Processing video: {video_path.name}")
    print(f"[INFERENCE] Resolution: {width}x{height}, FPS: {fps}, Total frames: {total_frames}")
    print(f"[INFERENCE] Sampling interval: every {interval} frame(s)")
    
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        
        if frame_index % interval != 0:
            frame_index += 1
            continue
        
        # ================================================================
        # RUN YOLO INFERENCE
        # ================================================================
        
        result = model(frame, conf=confidence, verbose=False)[0]
        frame_qualities.append({"frame": frame_index, **_quality(frame)})
        
        # ================================================================
        # PROCESS DETECTIONS WITH CLASS-AWARE TRACKING
        # ================================================================
        
        seen: set[int] = set()
        
        for box in result.boxes:
            class_id = int(box.cls[0])
            class_name = result.names[class_id]
            confidence_score = float(box.conf[0])
            bbox = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            
            # ============================================================
            # CLASS-AWARE TRACKING: Match same class and high IoU
            # ============================================================
            
            match = next(
                (
                    track
                    for track in active_tracks
                    if track["class"] == class_name and _iou(track["bbox"], bbox) >= 0.3
                ),
                None,
            )
            
            if match is None:
                # Create new track
                match = {
                    "trackId": f"T{len(all_tracks) + 1:04d}",
                    "class": class_name,
                    "firstSeen": frame_index,
                    "hits": 0,
                    "confidences": [],
                }
                active_tracks.append(match)
                all_tracks.append(match)
            
            match.update({
                "bbox": bbox,
                "confidence": confidence_score,
                "lastSeen": frame_index,
                "hits": match["hits"] + 1,
            })
            match["confidences"].append(confidence_score)
            seen.add(id(match))
            
            # ============================================================
            # RECORD OBSERVATION
            # ============================================================
            
            observations.append({
                "frame": frame_index,
                "trackId": match["trackId"],
                "class": class_name,
                "confidence": confidence_score,
                "boundingBox": bbox,
            })
        
        # Drop tracks that haven't been seen recently (tolerance: 3 intervals)
        active_tracks = [
            track
            for track in active_tracks
            if frame_index - track["lastSeen"] <= interval * 3
        ]
        
        frame_index += 1
    
    capture.release()
    
    # ====================================================================
    # COMPUTE STATISTICS
    # ====================================================================
    
    group_counts = Counter(
        AEROMESH_GROUPS.get(track["class"], "other") for track in all_tracks
    )
    class_counts = Counter(track["class"] for track in all_tracks)
    
    # Compute average confidence per track
    for track in all_tracks:
        if track["confidences"]:
            track["averageConfidence"] = round(sum(track["confidences"]) / len(track["confidences"]), 3)
            del track["confidences"]  # Don't include raw list in output
    
    average_quality = {
        key: round(
            sum(item[key] for item in frame_qualities) / len(frame_qualities), 1
        )
        if frame_qualities
        else 0
        for key in ("sharpness", "brightness", "contrast")
    }
    
    elapsed = perf_counter() - started
    inference_fps = len(frame_qualities) / max(elapsed, 0.001)
    
    # ====================================================================
    # BUILD RESULT
    # ====================================================================
    
    return {
        "video": {
            "filename": video_path.name,
            "fps": round(fps, 2),
            "frames": total_frames,
            "durationSeconds": round(total_frames / fps, 2) if fps else None,
            "resolution": {"width": width, "height": height},
        },
        "processing": {
            "status": "COMPLETE",
            "sampleFps": sample_fps,
            "framesAnalyzed": len(frame_qualities),
            "inferenceFps": round(inference_fps, 2),
            "elapsedSeconds": round(elapsed, 2),
        },
        "detections": {
            "uniqueTracks": len(all_tracks),
            "byGroup": dict(group_counts),
            "byClass": dict(class_counts),
            "observations": observations,
        },
        "tracks": all_tracks,
        "frameQuality": {
            "estimated": True,
            "average": average_quality,
            "samples": frame_qualities,
        },
        "provenance": {
            "objectDetection": {
                "model": "aeromesh_yolo.pt",
                "mode": "trained/fine-tuned",
                "dataset": "VisDrone-10 class detection model",
                "classes": AEROMESH_CLASSES,
                "inference": "local (ultralytics YOLO)",
                "modelPath": str(model_path),
            },
            "note": "Trained model optimized for aerial drone footage detection",
        },
    }
