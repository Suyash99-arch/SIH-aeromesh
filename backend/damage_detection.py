import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"


def _extract_frame_set(video_path: Path, mission_id: str, max_frames: int = 30) -> Dict[str, Any]:
    mission_dir = MISSIONS_DIR / mission_id
    frames_dir = mission_dir / "damage_frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return {"success": False, "reason": "video_not_readable", "frames_dir": str(frames_dir)}

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total_frames <= 0:
        cap.release()
        return {"success": False, "reason": "missing_frame_count", "frames_dir": str(frames_dir)}

    sample_step = max(1, total_frames // max_frames)
    saved = 0
    frame_index = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % sample_step == 0 or frame_index == total_frames - 1:
            frame_path = frames_dir / f"damage_{frame_index:05d}.jpg"
            cv2.imwrite(str(frame_path), frame)
            saved += 1
        frame_index += 1
    cap.release()

    if saved == 0:
        return {"success": False, "reason": "no_frames_saved", "frames_dir": str(frames_dir)}

    return {"success": True, "frames_dir": str(frames_dir), "saved_frames": saved}


def _roboflow_credentials() -> Optional[Dict[str, str]]:
    api_key = os.getenv("ROBOFLOW_API_KEY", "").strip()
    model_id = os.getenv("ROBOFLOW_MODEL_ID", "").strip()
    if not api_key or not model_id:
        return None
    return {"api_key": api_key, "model_id": model_id}


def _parse_model_id(model_id: str) -> Optional[Dict[str, str]]:
    parts = [p.strip() for p in model_id.split("/") if p.strip()]
    if len(parts) >= 3:
        return {"workspace": parts[0], "project": parts[1], "version": parts[2]}
    if len(parts) == 2:
        return {"workspace": parts[0], "project": parts[1], "version": "1"}
    return None


def _classify_damage_confidence(confidence: float) -> str:
    if confidence > 0.6:
        return "OBSERVED"
    if confidence >= 0.3:
        return "POSSIBLE"
    return "UNKNOWN"


def _roboflow_predictions_from_image(image_path: Path, model_id: str, api_key: str) -> List[Dict[str, Any]]:
    try:
        from roboflow import Roboflow  # type: ignore
    except Exception:
        return []

    parsed = _parse_model_id(model_id)
    if not parsed:
        return []

    try:
        rf = Roboflow(api_key=api_key)
        project = rf.workspace(parsed["workspace"]).project(parsed["project"])
        model = project.version(int(parsed["version"])).model
        predictions = model.predict(str(image_path), confidence=30, overlap=30)
        if not predictions:
            return []
        result_list = []
        raw_preds = getattr(predictions, "predictions", predictions)
        for pred in raw_preds:
            pred_dict = getattr(pred, "__dict__", pred)
            conf = float(getattr(pred, "confidence", pred_dict.get("confidence", 0.0)) or 0.0)
            label = getattr(pred, "class_name", pred_dict.get("class_name") or pred_dict.get("className") or "damage")
            width = float(getattr(pred, "width", pred_dict.get("width", 0.0)) or 0.0)
            height = float(getattr(pred, "height", pred_dict.get("height", 0.0)) or 0.0)
            x = float(getattr(pred, "x", pred_dict.get("x", 0.0)) or 0.0)
            y = float(getattr(pred, "y", pred_dict.get("y", 0.0)) or 0.0)
            result_list.append({
                "class": str(label),
                "confidence": round(conf, 3),
                "bbox": [x, y, x + width, y + height],
            })
        return result_list
    except Exception:
        return []


def analyze_damage_for_mission(video_path: Path, mission_id: str, max_frames: int = 30) -> Dict[str, Any]:
    started = time.time()
    creds = _roboflow_credentials()
    if creds is None:
        return {
            "available": False,
            "status": "UNKNOWN",
            "reason": "ROBOFLOW_API_KEY or ROBOFLOW_MODEL_ID was not set.",
            "findings": [],
            "processing_time_s": round(time.time() - started, 2),
            "method": "roboflow",
        }

    extraction = _extract_frame_set(video_path, mission_id, max_frames=max_frames)
    if not extraction.get("success"):
        return {
            "available": False,
            "status": "UNKNOWN",
            "reason": extraction.get("reason", "No frames available for damage inference"),
            "findings": [],
            "processing_time_s": round(time.time() - started, 2),
            "method": "roboflow",
        }

    frames_dir = Path(extraction["frames_dir"])
    findings = []
    findings_by_class: Dict[str, List[float]] = {}
    frame_index = 0

    for frame_path in sorted(frames_dir.glob("*.jpg")):
        predictions = _roboflow_predictions_from_image(frame_path, creds["model_id"], creds["api_key"])
        for pred in predictions:
            label = str(pred.get("class") or "damage")
            conf = float(pred.get("confidence") or 0.0)
            if conf < 0.3:
                continue
            findings_by_class.setdefault(label, []).append(conf)
            state = _classify_damage_confidence(conf)
            if state == "UNKNOWN":
                continue
            findings.append({
                "id": f"damage-{frame_index}-{label}-{len(findings)}",
                "title": f"Damage candidate: {label}",
                "status": state,
                "category": "damage",
                "confidence": round(conf, 3),
                "severity": "warning" if state == "OBSERVED" else "info",
                "evidence": f"Roboflow damage model flagged {label} in frame {frame_index} with confidence {conf:.3f}.",
                "location": "Frame",
                "action": "Inspect the flagged region and validate with additional imagery before escalating.",
                "bbox": pred.get("bbox"),
                "source": "ROBOFLOW_DERIVED",
                "frame_index": frame_index,
            })
        frame_index += 1

    aggregated = []
    for label, scores in findings_by_class.items():
        avg_score = float(np.mean(scores)) if scores else 0.0
        aggregated.append({
            "label": label,
            "confidence": round(avg_score, 3),
            "status": _classify_damage_confidence(avg_score),
        })

    return {
        "available": bool(findings),
        "status": "OBSERVED" if any(item["status"] == "OBSERVED" for item in findings) else ("POSSIBLE" if findings else "UNKNOWN"),
        "findings": findings,
        "aggregated": aggregated,
        "method": "roboflow",
        "processing_time_s": round(time.time() - started, 2),
    }


def detect_entry_exit_points(video_path: Path, mission_id: str, max_frames: int = 20) -> Dict[str, Any]:
    extraction = _extract_frame_set(video_path, mission_id, max_frames=max_frames)
    if not extraction.get("success"):
        return {"available": False, "status": "UNKNOWN", "points": [], "method": "opencv_heuristic", "reason": extraction.get("reason")} 

    frames_dir = Path(extraction["frames_dir"])
    points = []
    for frame_path in sorted(frames_dir.glob("*.jpg"))[:5]:
        frame = cv2.imread(str(frame_path))
        if frame is None:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, (5, 5), 0)
        edges = cv2.Canny(blur, 50, 150)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 600:
                continue
            x, y, w, h = cv2.boundingRect(contour)
            if w < 25 or h < 25:
                continue
            confidence = 0.42 if w > 40 and h > 40 else 0.31
            points.append({
                "id": f"entry-exit-{len(points) + 1}",
                "frame": frame_path.name,
                "bbox": [int(x), int(y), int(x + w), int(y + h)],
                "confidence": round(confidence, 3),
                "status": "POSSIBLE" if confidence >= 0.3 else "UNKNOWN",
                "method": "opencv_heuristic",
                "note": "Heuristic contour-based opening detector; lower accuracy than a trained door/window model.",
            })

    return {
        "available": bool(points),
        "status": "POSSIBLE" if points else "UNKNOWN",
        "points": points,
        "method": "opencv_heuristic",
    }
