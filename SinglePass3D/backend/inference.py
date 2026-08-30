"""Pretrained YOLO video inference with lightweight IoU tracking.

This module deliberately reports only observations made during inference.  It
does not synthesize detections for demo videos and it does not claim training.
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path
from time import perf_counter

import cv2

COCO_GROUPS = {
    "person": "people",
    "car": "vehicles", "truck": "vehicles", "bus": "vehicles", "motorcycle": "vehicles", "bicycle": "vehicles",
    "dog": "animals", "cat": "animals", "bird": "animals",
}


def _iou(a: list[float], b: list[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1, ix2, iy2 = max(ax1, bx1), max(ay1, by1), min(ax2, bx2), min(ay2, by2)
    intersection = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    union = (ax2 - ax1) * (ay2 - ay1) + (bx2 - bx1) * (by2 - by1) - intersection
    return intersection / union if union else 0.0


def _quality(frame) -> dict[str, float]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = min(100.0, cv2.Laplacian(gray, cv2.CV_64F).var() / 5)
    brightness = gray.mean() / 255 * 100
    contrast = gray.std() / 128 * 100
    return {"sharpness": round(sharpness, 1), "brightness": round(brightness, 1), "contrast": round(min(100, contrast), 1)}


def process_video(video_path: Path, model_path: str = "yolo11n.pt", sample_fps: float = 2.0, confidence: float = 0.35) -> dict:
    """Run COCO-pretrained YOLO over sampled frames and return factual results."""
    from ultralytics import YOLO

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")
    fps = capture.get(cv2.CAP_PROP_FPS) or 0
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width, height = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH)), int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    interval = max(1, round(fps / sample_fps)) if fps else 1
    model = YOLO(model_path)
    active_tracks: list[dict] = []
    all_tracks: list[dict] = []
    observations: list[dict] = []
    frame_qualities: list[dict] = []
    frame_index = 0
    started = perf_counter()

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index % interval:
            frame_index += 1
            continue
        result = model(frame, conf=confidence, verbose=False)[0]
        frame_qualities.append({"frame": frame_index, **_quality(frame)})
        seen: set[int] = set()
        for box in result.boxes:
            class_name = result.names[int(box.cls[0])]
            bbox = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            match = next((track for track in active_tracks if track["class"] == class_name and _iou(track["bbox"], bbox) >= 0.3), None)
            if match is None:
                match = {"trackId": f"T{len(all_tracks) + 1:04d}", "class": class_name, "firstSeen": frame_index, "hits": 0}
                active_tracks.append(match)
                all_tracks.append(match)
            match.update({"bbox": bbox, "confidence": round(float(box.conf[0]), 3), "lastSeen": frame_index, "hits": match["hits"] + 1})
            seen.add(id(match))
            observations.append({"frame": frame_index, "trackId": match["trackId"], "class": class_name, "confidence": match["confidence"], "boundingBox": bbox})
        active_tracks = [track for track in active_tracks if frame_index - track["lastSeen"] <= interval * 3]
        frame_index += 1
    capture.release()

    group_counts = Counter(COCO_GROUPS.get(track["class"], "other") for track in all_tracks)
    class_counts = Counter(track["class"] for track in all_tracks)
    average_quality = {key: round(sum(item[key] for item in frame_qualities) / len(frame_qualities), 1) if frame_qualities else 0 for key in ("sharpness", "brightness", "contrast")}
    return {
        "video": {"filename": video_path.name, "fps": round(fps, 2), "frames": total_frames, "durationSeconds": round(total_frames / fps, 2) if fps else None, "resolution": {"width": width, "height": height}},
        "processing": {"status": "COMPLETE", "sampleFps": sample_fps, "framesAnalyzed": len(frame_qualities), "inferenceFps": round(len(frame_qualities) / max(perf_counter() - started, 0.001), 2)},
        "detections": {"uniqueTracks": len(all_tracks), "byGroup": dict(group_counts), "byClass": dict(class_counts), "observations": observations},
        "tracks": all_tracks,
        "frameQuality": {"estimated": True, "average": average_quality, "samples": frame_qualities},
        "provenance": {"objectDetection": {"model": "YOLO11n", "mode": "pretrained", "dataset": "COCO / Microsoft COCO", "inference": "local"}, "note": "COCO-pretrained general object detection; not trained or fine-tuned on aerial imagery."},
    }
