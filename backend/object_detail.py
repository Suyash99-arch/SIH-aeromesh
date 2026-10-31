"""
Interactive Object Detail and Lazy Thumbnail Engine for AeroMesh (Section B1).

Endpoints:
- GET /api/v1/missions/{id}/objects/{object_id}
- GET /api/v1/missions/{id}/objects/{object_id}/thumbnails/{filename}
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("AEROMESH_DATA_DIR", str(BASE_DIR / "data"))).resolve()
MISSIONS_DIR = DATA_DIR / "missions"
MAX_CACHE_BYTES = 20 * 1024 * 1024  # 20 MB cap per mission


def enforce_thumbnail_cache_cap(cache_dir: Path, max_bytes: int = MAX_CACHE_BYTES) -> None:
    """Cap total thumbnail disk cache per mission at 20 MB (LRU pruning by mtime)."""
    if not cache_dir.exists():
        return
    try:
        files = list(cache_dir.glob("*.jpg"))
        total_size = sum(f.stat().st_size for f in files)
        if total_size <= max_bytes:
            return

        # Sort oldest first (LRU)
        files.sort(key=lambda f: f.stat().st_mtime)
        target_size = int(max_bytes * 0.85)  # Prune to 85% of cap (17 MB)
        for f in files:
            if total_size <= target_size:
                break
            sz = f.stat().st_size
            try:
                f.unlink()
                total_size -= sz
            except Exception:
                pass
    except Exception as e:
        logger.warning(f"[object_detail] Failed to prune thumbnail cache: {e}")


def get_mission_raw_data(mission_id: str) -> Tuple[Dict[str, Any], Path]:
    """Load mission JSON data and directory."""
    m_dir = MISSIONS_DIR / mission_id
    if not m_dir.exists():
        m_dir = DATA_DIR / "objects" / "missions" / mission_id

    json_paths = [
        MISSIONS_DIR / f"{mission_id}.json",
        m_dir / "mission.json",
        DATA_DIR / "objects" / "missions" / f"{mission_id}.json",
    ]
    data: Dict[str, Any] = {}
    for p in json_paths:
        if p.exists():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                break
            except Exception:
                pass
    return data, m_dir


def get_object_detail(
    mission_id: str,
    object_id: str,
    mission_data: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Derive object detail from stored detection manifest and fused 3D objects.
    Returns:
        {
            "class": "van",
            "track_id": "T0001",
            "object_id": "OBJ_T0001",
            "motion_state": "STATIC",
            "position_3d": [-2.998, -5.08, 17.224],
            "confidence": 0.74,
            "observations": [
                {
                    "frame_idx": 0,
                    "time_s": 0.0,
                    "bbox": [608.47, 0.37, 647.94, 25.61],
                    "confidence": 0.742,
                    "is_keyframe": True,
                    "thumb_url": "/api/v1/missions/{id}/objects/{object_id}/thumbnails/{thumb_name}.jpg"
                },
                ...
            ]
        }
    """
    data = mission_data
    m_dir = MISSIONS_DIR / mission_id
    if not data:
        data, m_dir = get_mission_raw_data(mission_id)

    if not data:
        return None

    # 1. Match Fused 3D Object
    fused_objs = data.get("objects_3d") or data.get("semantic_scene", {}).get("objects", [])
    if not fused_objs:
        sem_path = m_dir / "semantic_scene.json"
        if sem_path.exists():
            try:
                with open(sem_path, "r", encoding="utf-8") as f:
                    sem_data = json.load(f)
                fused_objs = sem_data.get("objects", [])
            except Exception:
                pass

    matched_fused = None
    target_clean = str(object_id).strip()
    for obj in fused_objs:
        oid = str(obj.get("object_id") or "").strip()
        tid = str(obj.get("track_id") or "").strip()
        if target_clean in (oid, tid) or target_clean == f"OBJ_{tid}" or f"OBJ_{target_clean}" == oid:
            matched_fused = obj
            break

    # 2. Gather 2D Observations
    raw_obs: List[Dict[str, Any]] = []
    det_dict = data.get("detections")
    if isinstance(det_dict, dict):
        raw_obs = det_dict.get("observations", []) or []
    elif isinstance(det_dict, list):
        raw_obs = det_dict

    if not raw_obs:
        det_path = m_dir / "detections.json"
        if det_path.exists():
            try:
                with open(det_path, "r", encoding="utf-8") as f:
                    det_data = json.load(f)
                raw_obs = det_data.get("observations", []) or []
            except Exception:
                pass

    resolved_track_id = (matched_fused.get("track_id") or target_clean) if matched_fused else target_clean
    if resolved_track_id.startswith("OBJ_"):
        resolved_track_id = resolved_track_id[4:]

    matched_obs = []
    for obs in raw_obs:
        tid = str(obs.get("trackId") or obs.get("track_id") or "").strip()
        if tid in (resolved_track_id, target_clean, f"OBJ_{resolved_track_id}"):
            matched_obs.append(obs)

    # If neither fused nor raw observations exist, this is an unknown object
    if not matched_fused and not matched_obs:
        return None

    # Derive class name
    cls_name = "object"
    if matched_fused:
        cls_name = matched_fused.get("class") or matched_fused.get("class_name") or matched_fused.get("category") or "object"
    elif matched_obs:
        cls_name = matched_obs[0].get("class") or matched_obs[0].get("category") or "object"

    # Derive motion state
    motion_state = "STATIC"
    if matched_fused and matched_fused.get("motion_state"):
        motion_state = matched_fused.get("motion_state")

    # Derive 3D position
    pos_3d = None
    if matched_fused:
        raw_pos = matched_fused.get("position_3d") or matched_fused.get("point_3d")
        if raw_pos and isinstance(raw_pos, (list, tuple)) and len(raw_pos) >= 3:
            pos_3d = [round(float(v), 3) for v in raw_pos[:3]]

    # Video FPS & Duration
    fps = 30.0
    v_info = data.get("video") or {}
    if v_info.get("fps"):
        fps = float(v_info["fps"])

    # Keyframe IDs from fused object
    keyframe_indices = set()
    if matched_fused:
        for k_obs in matched_fused.get("observations", []):
            f_name = k_obs.get("frame_id") or ""
            # e.g. frame_00015.jpg
            if "frame_" in f_name:
                try:
                    num_str = f_name.replace("frame_", "").replace(".jpg", "").replace(".png", "")
                    keyframe_indices.add(int(num_str))
                except Exception:
                    pass

    # Build per-frame observations
    obs_list: List[Dict[str, Any]] = []
    seen_frames = set()

    for o in matched_obs:
        fi = int(o.get("frame", o.get("frame_index", 0)))
        if fi in seen_frames:
            continue
        seen_frames.add(fi)

        bbox = o.get("boundingBox") or o.get("bbox") or []
        if isinstance(bbox, (list, tuple)) and len(bbox) >= 4:
            clean_bbox = [round(float(b), 2) for b in bbox[:4]]
        else:
            clean_bbox = [0.0, 0.0, 0.0, 0.0]

        conf = float(o.get("confidence", 0.0) or 0.0)
        time_s = float(o.get("timestamp", fi / fps if fps > 0 else 0.0) or (fi / fps if fps > 0 else 0.0))
        is_kf = fi in keyframe_indices

        thumb_name = f"thumb_{resolved_track_id}_f{fi}.jpg"
        obs_list.append({
            "frame_idx": fi,
            "time_s": round(time_s, 2),
            "bbox": clean_bbox,
            "confidence": round(conf, 3),
            "is_keyframe": is_kf,
            "thumb_url": f"/api/v1/missions/{mission_id}/objects/{resolved_track_id}/thumbnails/{thumb_name}",
        })

    obs_list.sort(key=lambda x: x["frame_idx"])

    # Identify top 6 observations by confidence for priority lazy thumbnails
    sorted_by_conf = sorted(obs_list, key=lambda x: x["confidence"], reverse=True)
    top_frames = {o["frame_idx"] for o in sorted_by_conf[:6]}
    for o in obs_list:
        o["is_top_thumbnail"] = o["frame_idx"] in top_frames

    mean_conf = float(np.mean([o["confidence"] for o in obs_list])) if obs_list else 0.0

    return {
        "success": True,
        "mission_id": mission_id,
        "object_id": matched_fused.get("object_id") if matched_fused else f"OBJ_{resolved_track_id}",
        "track_id": resolved_track_id,
        "class": cls_name,
        "motion_state": motion_state,
        "position_3d": pos_3d,
        "confidence": round(mean_conf, 3),
        "total_observations": len(obs_list),
        "observations": obs_list,
    }


def generate_thumbnail(
    mission_id: str,
    track_id: str,
    frame_idx: int,
    bbox: Optional[List[float]] = None,
    mission_data: Optional[Dict[str, Any]] = None,
) -> Optional[Path]:
    """
    Generate on-demand thumbnail image (max 224 px, JPEG q80).
    Cached on disk with LRU pruning capped at 20 MB.
    """
    m_dir = MISSIONS_DIR / mission_id
    if not m_dir.exists():
        m_dir = DATA_DIR / "objects" / "missions" / mission_id

    thumb_dir = m_dir / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)

    thumb_path = thumb_dir / f"thumb_{track_id}_f{frame_idx}.jpg"
    if thumb_path.exists() and thumb_path.stat().st_size > 0:
        return thumb_path

    # Look for extracted frame on disk first
    frame_candidates = [
        m_dir / "reconstruction" / "frames" / f"frame_{frame_idx:05d}.jpg",
        m_dir / "frames" / f"frame_{frame_idx:05d}.jpg",
        DATA_DIR / "processing" / mission_id / "frames" / f"frame_{frame_idx:05d}.jpg",
    ]
    frame_bgr: Optional[np.ndarray] = None
    for cand in frame_candidates:
        if cand.exists():
            frame_bgr = cv2.imread(str(cand))
            if frame_bgr is not None:
                break

    # If frame not on disk, decode directly from video
    if frame_bgr is None:
        video_candidates = [
            m_dir / "video.mp4",
            m_dir / "normalized_video.mp4",
            DATA_DIR / "objects" / "missions" / mission_id / "video.mp4",
        ]
        for v_path in video_candidates:
            if v_path.exists():
                try:
                    cap = cv2.VideoCapture(str(v_path))
                    if cap.isOpened():
                        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
                        ret, img = cap.read()
                        if ret and img is not None:
                            frame_bgr = img
                        cap.release()
                    if frame_bgr is not None:
                        break
                except Exception:
                    pass

    if frame_bgr is None:
        logger.warning(f"[object_detail] Could not read frame {frame_idx} for thumbnail")
        return None

    h, w = frame_bgr.shape[:2]

    # Crop bounding box with 12% padding
    if bbox and len(bbox) >= 4:
        b0, b1, b2, b3 = [float(v) for v in bbox[:4]]
        if b0 <= 1.0 and b1 <= 1.0 and b2 <= 1.0 and b3 <= 1.0:
            x1, y1, x2, y2 = b0 * w, b1 * h, b2 * w, b3 * h
        else:
            x1, y1, x2, y2 = b0, b1, b2, b3

        pad_x = (x2 - x1) * 0.12
        pad_y = (y2 - y1) * 0.12
        cx1 = max(0, int(round(x1 - pad_x)))
        cy1 = max(0, int(round(y1 - pad_y)))
        cx2 = min(w, int(round(x2 + pad_x)))
        cy2 = min(h, int(round(y2 + pad_y)))

        if (cx2 - cx1) >= 4 and (cy2 - cy1) >= 4:
            crop = frame_bgr[cy1:cy2, cx1:cx2]
        else:
            crop = frame_bgr
    else:
        crop = frame_bgr

    # Resize to max 224 px keeping aspect ratio
    ch, cw = crop.shape[:2]
    max_dim = max(cw, ch)
    if max_dim > 224:
        scale = 224.0 / max_dim
        tw = max(1, int(round(cw * scale)))
        th = max(1, int(round(ch * scale)))
        crop = cv2.resize(crop, (tw, th), interpolation=cv2.INTER_AREA)

    # Encode as JPEG q80
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 80]
    success, enc = cv2.imencode(".jpg", crop, encode_params)
    if not success:
        return None

    with open(thumb_path, "wb") as f:
        f.write(enc.tobytes())

    # Prune cache if over 20 MB
    enforce_thumbnail_cache_cap(thumb_dir, MAX_CACHE_BYTES)

    return thumb_path
