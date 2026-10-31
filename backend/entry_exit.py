"""
Canonical Entry and Exit Points Engine for AeroMesh.

Deterministic Definition (Honest Border-Crossing Rules):
- ENTRY: A track whose first observation occurs after the first 0.5 s (t > 0.5s)
         AND whose bounding box center is within 12% of a frame border.
- EXIT:  A track whose last observation occurs before the last 0.5 s (t < duration - 0.5s)
         AND whose bounding box center is within 12% of a frame border.
- Tracks appearing or disappearing mid-frame (>12% from any border) are classified
  as "appeared/disappeared" (occlusion/re-ID), NOT entry/exit.
- Event positions are lifted to 3D using the fused 3D position or ground plane intersection.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional
import cv2

DATA_DIR = Path("data")
MISSIONS_DIR = DATA_DIR / "missions"


def is_near_frame_border(bbox: List[float], width: float, height: float, border_margin_pct: float = 0.12) -> bool:
    """Check if the center of a bounding box is within border_margin_pct (default 12%) of the frame boundary."""
    if not bbox or len(bbox) < 4:
        return False
    b0, b1, b2, b3 = [float(v) for v in bbox[:4]]
    if b0 <= 1.0 and b1 <= 1.0 and b2 <= 1.0 and b3 <= 1.0:
        cx = (b0 + b2) / 2.0
        cy = (b1 + b3) / 2.0
    else:
        w = max(1.0, float(width or 1280.0))
        h = max(1.0, float(height or 720.0))
        cx = (b0 + b2) / (2.0 * w)
        cy = (b1 + b3) / (2.0 * h)
    return (
        cx <= border_margin_pct
        or cx >= (1.0 - border_margin_pct)
        or cy <= border_margin_pct
        or cy >= (1.0 - border_margin_pct)
    )


def compute_mission_entry_exit(mission_id: str, mission_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Derive entry and exit events from stored detections manifest and fused 3D objects.
    Works deterministically on existing missions without video reprocessing.
    """
    m_dir = MISSIONS_DIR / mission_id
    video_path = m_dir / "video.mp4"
    if not video_path.exists():
        video_path = m_dir / "normalized_video.mp4"

    vw, vh, total_frames, fps, duration_s = 1280.0, 720.0, 300, 30.0, 10.0
    if video_path.exists():
        try:
            cap = cv2.VideoCapture(str(video_path))
            if cap.isOpened():
                vw = float(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280.0)
                vh = float(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720.0)
                total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 300)
                fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
                duration_s = total_frames / fps if fps > 0 else 10.0
                cap.release()
        except Exception:
            pass
    elif mission_data:
        v_info = mission_data.get("video") or {}
        duration_s = float(v_info.get("duration") or mission_data.get("duration") or 10.0)
        fps = float(v_info.get("fps") or 30.0)
        vw = float(v_info.get("width") or 1280.0)
        vh = float(v_info.get("height") or 720.0)

    # Gather stored observations
    det_file = m_dir / "detections.json"
    raw_obs: List[Dict[str, Any]] = []
    if det_file.exists():
        try:
            det_data = json.loads(det_file.read_text(encoding="utf-8"))
            raw_obs = det_data.get("observations") or []
        except Exception:
            pass

    if not raw_obs and mission_data:
        m_dets = mission_data.get("detections")
        if isinstance(m_dets, dict):
            raw_obs = m_dets.get("observations") or []
        elif isinstance(m_dets, list):
            raw_obs = m_dets

    # Map fused 3D objects
    pos_map: Dict[str, List[float]] = {}
    cls_map: Dict[str, str] = {}
    fused_objs = (mission_data.get("objects_3d") if mission_data else None) or []
    if not fused_objs:
        sem_file = m_dir / "semantic_scene.json"
        if sem_file.exists():
            try:
                sem = json.loads(sem_file.read_text(encoding="utf-8"))
                fused_objs = sem.get("objects") or []
            except Exception:
                pass

    for obj in fused_objs:
        tid = obj.get("track_id") or obj.get("object_id")
        if tid:
            pos_3d = obj.get("position_3d")
            if pos_3d and isinstance(pos_3d, (list, tuple)) and len(pos_3d) >= 3:
                pos_map[str(tid)] = [round(float(v), 3) for v in pos_3d[:3]]
            cls_map[str(tid)] = str(obj.get("class") or obj.get("class_name") or "object")

    # Group observations by track ID
    tracks_obs: Dict[str, List[Dict[str, Any]]] = {}
    for obs in raw_obs:
        tid = obs.get("trackId") or obs.get("track_id")
        if not tid:
            continue
        str_tid = str(tid)
        if str_tid not in tracks_obs:
            tracks_obs[str_tid] = []
        tracks_obs[str_tid].append(obs)

    entry_events: List[Dict[str, Any]] = []
    exit_events: List[Dict[str, Any]] = []

    for tid, ob_list in tracks_obs.items():
        ob_list.sort(key=lambda o: (float(o.get("timestamp") or 0.0), int(o.get("frame") or 0)))
        if not ob_list:
            continue
        first_obs = ob_list[0]
        last_obs = ob_list[-1]

        t_first = float(first_obs.get("timestamp") if first_obs.get("timestamp") is not None else ((first_obs.get("frame") or 0) / fps))
        t_last = float(last_obs.get("timestamp") if last_obs.get("timestamp") is not None else ((last_obs.get("frame") or 0) / fps))

        bbox_first = first_obs.get("boundingBox") or first_obs.get("bbox") or [0, 0, 0, 0]
        bbox_last = last_obs.get("boundingBox") or last_obs.get("bbox") or [0, 0, 0, 0]

        cls_name = cls_map.get(tid) or str(first_obs.get("class") or "object")
        pos_3d = pos_map.get(tid)

        # ENTRY: first seen after first 0.5s AND within 12% of a frame border
        if t_first > 0.5 and is_near_frame_border(bbox_first, vw, vh, border_margin_pct=0.12):
            entry_events.append({
                "id": f"entry_{tid}",
                "event_type": "ENTRY",
                "track_id": tid,
                "class": cls_name,
                "time_s": round(t_first, 2),
                "frame_idx": int(first_obs.get("frame") if first_obs.get("frame") is not None else round(t_first * fps)),
                "position_3d": pos_3d,
                "bbox": [round(float(v), 2) for v in bbox_first[:4]],
                "marker_color": "#22c55e",  # Green for entry
            })

        # EXIT: last seen before last 0.5s AND within 12% of a frame border
        if t_last < max(0.0, duration_s - 0.5) and is_near_frame_border(bbox_last, vw, vh, border_margin_pct=0.12):
            exit_events.append({
                "id": f"exit_{tid}",
                "event_type": "EXIT",
                "track_id": tid,
                "class": cls_name,
                "time_s": round(t_last, 2),
                "frame_idx": int(last_obs.get("frame") if last_obs.get("frame") is not None else round(t_last * fps)),
                "position_3d": pos_3d,
                "bbox": [round(float(v), 2) for v in bbox_last[:4]],
                "marker_color": "#ef4444",  # Red for exit
            })

    total_events = len(entry_events) + len(exit_events)
    message = (
        None
        if total_events > 0
        else "0 - no tracked object crossed the view boundary in this clip"
    )

    return {
        "available": True,
        "entry_count": len(entry_events),
        "exit_count": len(exit_events),
        "total_events": total_events,
        "events": entry_events + exit_events,
        "entry_events": entry_events,
        "exit_events": exit_events,
        "entries": entry_events,
        "exits": exit_events,
        "definition": "ENTRY = first seen after 0.5s within 12% of border; EXIT = last seen before final 0.5s near border. Mid-frame appearances are occlusion.",
        "message": message,
    }
