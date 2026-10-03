"""
Video Frame Quality & Uncertainty Analysis Engine for Hexa Spark.

Mathematical Formulations:
1. Sharpness (S):
   Var(Laplacian(I)) normalized: min(100.0, Var(nabla^2 I) / 5.0)
2. Motion Blur (B):
   Gradient anisotropy & directional high-frequency edge attenuation.
3. Exposure & Lighting (L):
   Histogram clipping penalty (under/over saturation) + midtone deviation penalty.
4. Compression / Noise Blockiness (C):
   8x8 DCT block boundary discontinuity ratio vs intra-block variance.
5. Overall Quality (Q):
   0.35 * S + 0.25 * B + 0.25 * L + 0.15 * C
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def compute_frame_quality_metrics(frame_bgr: np.ndarray) -> Dict[str, float]:
    """
    Computes rigorous per-frame optical and container quality metrics.
    
    Returns:
        {
            "sharpness": float [0-100],
            "motion_blur": float [0-100], (100 = sharp/no blur)
            "lighting": float [0-100],    (100 = balanced exposure)
            "compression": float [0-100], (100 = clean/no artifacts)
            "overall": float [0-100]
        }
    """
    if frame_bgr is None or frame_bgr.size == 0:
        return {"sharpness": 0.0, "motion_blur": 0.0, "lighting": 0.0, "compression": 0.0, "overall": 0.0}

    # Downsample slightly if 4K for fast consistent metric calculation
    h, w = frame_bgr.shape[:2]
    target_w = 1280
    if w > target_w:
        scale = target_w / w
        proc_img = cv2.resize(frame_bgr, (target_w, int(h * scale)), interpolation=cv2.INTER_AREA)
    else:
        proc_img = frame_bgr

    gray = cv2.cvtColor(proc_img, cv2.COLOR_BGR2GRAY)
    gh, gw = gray.shape

    # 1. SHARPNESS: Variance of Laplacian
    lap = cv2.Laplacian(gray, cv2.CV_64F)
    lap_var = float(lap.var())
    sharpness = max(0.0, min(100.0, (lap_var / 5.0)))

    # 2. MOTION BLUR: Gradient Direction Anisotropy & High-Frequency Density
    gx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    abs_gx = np.abs(gx)
    abs_gy = np.abs(gy)

    mean_gx = float(np.mean(abs_gx))
    mean_gy = float(np.mean(abs_gy))
    denom = mean_gx + mean_gy + 1e-5
    anisotropy = abs(mean_gx - mean_gy) / denom  # High anisotropy indicates 1D directional motion blur

    mag = np.sqrt(gx * gx + gy * gy)
    edge_density = float(np.sum(mag > 35.0)) / float(gh * gw)
    # Clear frames have high edge density and low directional smearing
    blur_score = max(0.0, min(100.0, 100.0 * (1.0 - 0.65 * anisotropy) * min(1.0, edge_density / 0.06)))

    # 3. EXPOSURE & LIGHTING: Clipping & Midtone Balance
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
    total_px = float(gh * gw)
    under_exposed = float(np.sum(hist[:10])) / total_px
    over_exposed = float(np.sum(hist[246:])) / total_px
    clipping_ratio = under_exposed + over_exposed

    mean_lum = float(np.mean(gray))
    lum_dev = abs(mean_lum - 128.0) / 128.0

    lighting_score = max(0.0, min(100.0, 100.0 * (1.0 - 2.8 * clipping_ratio) - (lum_dev * 30.0)))

    # 4. COMPRESSION / NOISE BLOCKINESS: 8x8 DCT grid boundary discontinuity
    # Check vertical 8px boundaries vs adjacent intra-block columns
    step = 8
    cols_grid = np.arange(step, gw - 1, step)
    cols_intra = cols_grid - 1

    if len(cols_grid) > 4:
        diff_grid = np.mean(np.abs(gray[:, cols_grid].astype(float) - gray[:, cols_grid - 1].astype(float)))
        diff_intra = np.mean(np.abs(gray[:, cols_intra].astype(float) - gray[:, cols_intra - 1].astype(float))) + 1e-4
        blockiness_ratio = max(0.0, (diff_grid - diff_intra) / diff_intra)
        compression_score = max(0.0, min(100.0, 100.0 - (blockiness_ratio * 120.0)))
    else:
        compression_score = 90.0

    # 5. OVERALL FORMULA
    overall = (
        0.35 * sharpness +
        0.25 * blur_score +
        0.25 * lighting_score +
        0.15 * compression_score
    )

    return {
        "sharpness": round(sharpness, 1),
        "motion_blur": round(blur_score, 1),
        "lighting": round(lighting_score, 1),
        "compression": round(compression_score, 1),
        "overall": round(overall, 1),
    }


def analyze_video_quality_timeseries(
    video_path: str | Path,
    sample_fps: float = 2.0,
    max_frames: int = 150,
) -> Dict[str, Any]:
    """
    Computes quality timeseries across video frames and summary distributions.
    """
    path = Path(video_path)
    if not path.is_file():
        return {"samples": [], "summary": {}}

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return {"samples": [], "summary": {}}

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    video_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frame_interval = max(1, int(round(video_fps / sample_fps)))

    samples: List[Dict[str, Any]] = []
    current_frame = 0

    while cap.isOpened() and len(samples) < max_frames:
        ret, frame = cap.read()
        if not ret:
            break
        if current_frame % frame_interval == 0:
            timestamp_s = round(current_frame / video_fps, 2)
            q = compute_frame_quality_metrics(frame)
            samples.append({
                "frame": current_frame,
                "timestamp_s": timestamp_s,
                **q
            })
        current_frame += 1

    cap.release()

    if not samples:
        return {"samples": [], "summary": {}}

    # Compute overall summary
    sharp_vals = [s["sharpness"] for s in samples]
    blur_vals = [s["motion_blur"] for s in samples]
    light_vals = [s["lighting"] for s in samples]
    comp_vals = [s["compression"] for s in samples]
    overall_vals = [s["overall"] for s in samples]

    summary = {
        "sharpness": round(float(np.mean(sharp_vals)), 1),
        "motion_blur": round(float(np.mean(blur_vals)), 1),
        "lighting": round(float(np.mean(light_vals)), 1),
        "compression": round(float(np.mean(comp_vals)), 1),
        "overall": round(float(np.mean(overall_vals)), 1),
        "min_quality": round(float(np.min(overall_vals)), 1),
        "max_quality": round(float(np.max(overall_vals)), 1),
        "p10_quality": round(float(np.percentile(overall_vals, 10)), 1),
        "p90_quality": round(float(np.percentile(overall_vals, 90)), 1),
        "total_analyzed_frames": len(samples),
    }

    return {
        "samples": samples,
        "summary": summary,
    }
