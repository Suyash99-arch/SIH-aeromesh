"""
Pre-flight Reconstructability and Parallax Analysis for Hexa Spark.

Estimates translation baseline, angular parallax, and homography vs epipolar
inliers before computationally expensive SfM processing.
Warns users if footage is a stationary hover, pure yaw rotation, or lacks baseline.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)


def analyze_video_reconstructability(
    video_path: str | Path,
    num_samples: int = 8,
    max_dimension: int = 1024,
) -> Dict[str, Any]:
    """
    Analyzes video motion dynamics, homography inliers, and translation parallax.
    
    Returns structured analysis dictionary suitable for storing in mission metadata.
    """
    path = Path(video_path)
    if not path.is_file():
        return {
            "score": 0,
            "is_reconstructable": False,
            "motion_type": "UNKNOWN",
            "warning": "Video file not found for reconstructability check",
            "shooting_guidance": "Provide a valid MP4/MOV aerial video file.",
            "metrics": {},
        }

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return {
            "score": 0,
            "is_reconstructable": False,
            "motion_type": "UNREADABLE",
            "warning": "Could not decode video stream for reconstructability check",
            "shooting_guidance": "Check video codec compatibility (H.264/yuv420p recommended).",
            "metrics": {},
        }

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    if total_frames <= 2:
        cap.release()
        return {
            "score": 0,
            "is_reconstructable": False,
            "motion_type": "TOO_SHORT",
            "warning": "Video too short (less than 3 frames)",
            "shooting_guidance": "Upload an aerial capture with at least 5-10 seconds of video.",
            "metrics": {},
        }

    # Step through frames sequentially
    step = max(1, total_frames // max(num_samples, 2))
    target_indices = set(min(total_frames - 1, i * step) for i in range(num_samples))
    target_indices.add(0)
    target_indices.add(total_frames - 1)

    sampled_frames: List[Tuple[int, np.ndarray, float]] = []
    frame_idx = 0

    while cap.isOpened() and len(sampled_frames) < len(target_indices):
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx in target_indices:
            h, w = frame.shape[:2]
            scale = max_dimension / max(h, w)
            if scale < 1.0:
                small = cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
            else:
                small = frame
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            # Compute Laplacian variance for sharpness
            lap_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            sampled_frames.append((frame_idx, gray, lap_var))
        frame_idx += 1

    cap.release()

    if len(sampled_frames) < 2:
        return {
            "score": 10,
            "is_reconstructable": False,
            "motion_type": "INSUFFICIENT_FRAMES",
            "warning": "Could not sample sufficient frames for reconstructability analysis",
            "shooting_guidance": "Ensure the video has multiple readable keyframes.",
            "metrics": {},
        }

    # Feature extraction and matching across sequential pairs
    orb = cv2.ORB_create(nfeatures=1500)
    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)

    pair_metrics: List[Dict[str, Any]] = []
    homography_ratios: List[float] = []
    displacements: List[float] = []

    for i in range(len(sampled_frames) - 1):
        idx1, g1, s1 = sampled_frames[i]
        idx2, g2, s2 = sampled_frames[i + 1]

        kp1, des1 = orb.detectAndCompute(g1, None)
        kp2, des2 = orb.detectAndCompute(g2, None)

        if des1 is None or des2 is None or len(kp1) < 10 or len(kp2) < 10:
            continue

        matches = bf.match(des1, des2)
        if len(matches) < 8:
            continue

        matches = sorted(matches, key=lambda m: m.distance)
        top_matches = matches[:min(300, len(matches))]

        pts1 = np.float32([kp1[m.queryIdx].pt for m in top_matches])
        pts2 = np.float32([kp2[m.trainIdx].pt for m in top_matches])

        disp_vecs = pts2 - pts1
        mags = np.linalg.norm(disp_vecs, axis=1)
        med_disp = float(np.median(mags))
        displacements.append(med_disp)

        # Fit Homography (RANSAC)
        H, mask_h = cv2.findHomography(pts1, pts2, cv2.RANSAC, 3.0)
        h_inliers = int(np.sum(mask_h)) if mask_h is not None else 0
        h_ratio = h_inliers / max(1, len(pts1))
        homography_ratios.append(h_ratio)

        # Fit Fundamental Matrix (RANSAC)
        F, mask_f = cv2.findFundamentalMat(pts1, pts2, cv2.FM_RANSAC, 3.0)
        f_inliers = int(np.sum(mask_f)) if mask_f is not None else 0

        pair_metrics.append({
            "pair": [idx1, idx2],
            "median_displacement_px": round(med_disp, 2),
            "homography_inlier_ratio": round(h_ratio, 3),
            "fundamental_inliers": f_inliers,
            "total_matches": len(pts1),
        })

    # Overall clip span (first to last frame)
    span_disp = 0.0
    span_h_ratio = 1.0
    if len(sampled_frames) >= 2:
        idx1, g1, _ = sampled_frames[0]
        idx2, g2, _ = sampled_frames[-1]
        kp1, des1 = orb.detectAndCompute(g1, None)
        kp2, des2 = orb.detectAndCompute(g2, None)
        if des1 is not None and des2 is not None and len(kp1) >= 10 and len(kp2) >= 10:
            matches = bf.match(des1, des2)
            if len(matches) >= 8:
                matches = sorted(matches, key=lambda m: m.distance)[:min(300, len(matches))]
                pts1 = np.float32([kp1[m.queryIdx].pt for m in matches])
                pts2 = np.float32([kp2[m.trainIdx].pt for m in matches])
                span_disp = float(np.median(np.linalg.norm(pts2 - pts1, axis=1)))
                H_span, mask_h_span = cv2.findHomography(pts1, pts2, cv2.RANSAC, 3.0)
                if mask_h_span is not None:
                    span_h_ratio = float(np.sum(mask_h_span)) / max(1, len(pts1))

    # Evaluate Metrics & Score
    avg_h_ratio = float(np.mean(homography_ratios)) if homography_ratios else 1.0
    avg_disp = float(np.mean(displacements)) if displacements else 0.0
    mean_sharpness = float(np.mean([s[2] for s in sampled_frames]))

    # Scoring formula:
    # 1. Parallax component (non-homography component): 0 to 45 pts
    # If avg_h_ratio > 0.85 -> near zero translation baseline
    parallax_pts = max(0.0, min(45.0, (1.0 - avg_h_ratio) * 100.0 * 1.5))

    # 2. Displacement component (overall movement across clip): 0 to 35 pts
    disp_pts = max(0.0, min(35.0, (span_disp / 150.0) * 35.0))

    # 3. Sharpness component: 0 to 20 pts
    sharp_pts = max(0.0, min(20.0, (mean_sharpness / 200.0) * 20.0))

    total_score = int(round(parallax_pts + disp_pts + sharp_pts))
    total_score = max(5, min(95, total_score))

    # Motion classification
    is_hover_or_rotation = (avg_h_ratio >= 0.72) and (avg_disp < 35.0 or span_disp < 160.0)

    if is_hover_or_rotation:
        motion_type = "HOVER_OR_ROTATION"
        is_reconstructable = False
        warning = "This clip looks like a hover/rotation; 3D reconstruction may fail; detection will still work."
        guidance = (
            "For reliable 3D SfM reconstruction, fly a continuous linear, orbital, or lawnmower trajectory "
            "with active camera translation and 70%+ visual overlap. Avoid stationary hovering, pure in-place yaw rotations, or optical zoom."
        )
    elif mean_sharpness < 40.0:
        motion_type = "BLURRY_OR_DEGRADED"
        is_reconstructable = False
        warning = "Significant motion blur detected in keyframes; 3D feature matching may be unreliable."
        guidance = "Increase camera shutter speed or fly at a steadier velocity to prevent motion blur."
    elif total_score >= 50:
        motion_type = "TRANSLATIONAL_ORBIT"
        is_reconstructable = True
        warning = None
        guidance = "Clip demonstrates sufficient stereoscopic parallax and feature correspondences for 3D reconstruction."
    else:
        motion_type = "MARGINAL_PARALLAX"
        is_reconstructable = False
        warning = "Marginal parallax baseline detected. Sparse point cloud may be low-density or partial."
        guidance = "Fly closer or with a larger baseline separation between consecutive passes."

    return {
        "score": total_score,
        "is_reconstructable": is_reconstructable,
        "motion_type": motion_type,
        "warning": warning,
        "shooting_guidance": guidance,
        "metrics": {
            "sampled_frames_count": len(sampled_frames),
            "mean_sharpness_laplacian": round(mean_sharpness, 2),
            "mean_pair_displacement_px": round(avg_disp, 2),
            "span_displacement_px": round(span_disp, 2),
            "average_homography_inlier_ratio": round(avg_h_ratio, 3),
            "span_homography_inlier_ratio": round(span_h_ratio, 3),
            "pairs_evaluated": pair_metrics,
        },
    }
