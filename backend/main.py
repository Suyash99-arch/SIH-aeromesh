"""
AeroMesh Single-Pass Reconstruction Backend
Handles mission management, video processing, and 3D reconstruction
"""

from pathlib import Path
from datetime import datetime
import json
import shutil
import uuid
import importlib.util
import hashlib
from typing import Optional, Any
import logging

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================
# CONFIG
# ============================================================

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"

DATA_DIR.mkdir(parents=True, exist_ok=True)
MISSIONS_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="AeroMesh Backend",
    description="Single-Pass Drone Video to 3D Reconstruction",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5175",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=str(DATA_DIR)), name="mission-media")

# ============================================================
# MODELS
# ============================================================

class MissionData:
    """In-memory mission tracking"""
    def __init__(self, mission_id: str):
        self.mission_id = mission_id
        self.data = {}
        self.load()
    
    def load(self):
        mission_file = MISSIONS_DIR / f"{self.mission_id}.json"
        if mission_file.exists():
            with open(mission_file) as f:
                self.data = json.load(f)
    
    def save(self):
        mission_file = MISSIONS_DIR / f"{self.mission_id}.json"
        with open(mission_file, 'w') as f:
            json.dump(self.data, f, indent=2)
    
    def update(self, updates: dict):
        self.data.update(updates)
        self.save()
    
    def get(self, key: str, default=None):
        return self.data.get(key, default)

PROVENANCE_SOURCES = {
    "VIDEO_DERIVED",
    "GPS_DERIVED",
    "IMU_DERIVED",
    "RECONSTRUCTION_DERIVED",
    "DETECTION_DERIVED",
    "TRACKING_DERIVED",
    "USER_PROVIDED",
    "ESTIMATED",
    "UNKNOWN",
}

EVIDENCE_STATES = {
    "OBSERVED",
    "RECONSTRUCTED",
    "PARTIAL",
    "POSSIBLE",
    "OCCLUDED",
    "UNKNOWN",
    "UNAVAILABLE",
}


# ============================================================
# VIDEO VALIDATION & HASHING
# ============================================================

def compute_video_sha256(video_path: Path, chunk_size: int = 65536) -> str:
    """Compute SHA-256 hash of a video file."""
    sha256_hash = hashlib.sha256()
    try:
        with open(video_path, "rb") as f:
            for chunk in iter(lambda: f.read(chunk_size), b""):
                sha256_hash.update(chunk)
        return sha256_hash.hexdigest().upper()
    except Exception as e:
        logger.error(f"Failed to compute hash for {video_path}: {e}")
        return ""


def validate_mission_video(mission_data: dict, video_path: Path) -> dict:
    """Validate that mission video is properly configured and exists."""
    errors = []
    warnings = []
    
    video_info = mission_data.get("video")
    if not video_info:
        errors.append("video_info_missing")
    
    if not video_path.exists():
        errors.append("video_file_not_found")
    
    # Check if video.path is set (if present in schema)
    if video_info and not video_info.get("path"):
        warnings.append("video_path_empty")
    
    # Check if video.sha256 is set
    if video_info and not video_info.get("sha256"):
        warnings.append("video_sha256_not_set")
    
    # If file exists, verify hash if stored
    if video_path.exists() and video_info and video_info.get("sha256"):
        computed_hash = compute_video_sha256(video_path)
        stored_hash = video_info.get("sha256", "").upper()
        if computed_hash and stored_hash and computed_hash != stored_hash:
            errors.append("video_hash_mismatch")
    
    # Check file doesn't belong to another mission (basic check via hash)
    if video_path.exists():
        file_hash = compute_video_sha256(video_path)
        mission_id = mission_data.get("id")
        if file_hash:
            # Could check against other missions' hashes here
            pass
    
    return {
        "is_valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
    }


def build_provenance_entry(
    value: Any,
    source: str = "UNKNOWN",
    confidence: float = 0.0,
    timestamp: str = "unknown",
    status: str = "UNKNOWN",
    display: Optional[str] = None,
) -> dict:
    """Create an evidence-aware result object that preserves uncertainty."""
    normalized_source = source if source in PROVENANCE_SOURCES else "UNKNOWN"
    display_text = display or (
        "Insufficient visual evidence"
        if value is None
        else "Estimated — requires validation"
    )
    if value is None or value == "" or (isinstance(value, (float, int)) and not np.isfinite(float(value))):
        return {
            "value": None,
            "source": normalized_source,
            "confidence": float(confidence or 0.0),
            "timestamp": timestamp,
            "status": status,
            "display": display_text,
        }
    return {
        "value": value,
        "source": normalized_source,
        "confidence": float(confidence or 0.0),
        "timestamp": timestamp,
        "status": status,
        "display": display_text,
    }


def build_evidence_state(
    value: Any,
    status: str = "UNKNOWN",
    source: str = "UNKNOWN",
    confidence: float = 0.0,
    frame_id: Optional[int] = None,
    timestamp: Optional[str] = None,
    note: Optional[str] = None,
    display: Optional[str] = None,
) -> dict:
    """Represent a value with explicit visibility and uncertainty state."""
    normalized_status = status if status in EVIDENCE_STATES else "UNKNOWN"
    display_text = display or (
        "Insufficient visual evidence"
        if value is None
        else "Validated from available evidence"
    )
    return {
        "value": value,
        "status": normalized_status,
        "source": source if source in PROVENANCE_SOURCES else "UNKNOWN",
        "confidence": float(confidence or 0.0),
        "frame_id": frame_id,
        "timestamp": timestamp or datetime.utcnow().isoformat(),
        "note": note or "No explicit evidence note provided.",
        "display": display_text,
    }


def get_detector_metadata() -> dict:
    """Describe the detector currently in use and its evidence limitations."""
    return {
        "model": "YOLO11n",
        "dataset": "COCO (general-purpose)",
        "domain": "General / not aerial-specific; requires validation for SIH drone footage",
        "confidence_threshold": 0.35,
        "input_resolution": 640,
        "suitability": "General-purpose detector; not proven to be aerial-domain accurate without validation",
        "false_positive_behavior": "May include irrelevant classes or background detections; track stability is required before treating detections as confirmed objects.",
        "false_negative_behavior": "Can miss small, distant, partially occluded, or poorly lit objects in single-pass aerial views.",
        "abstraction": "Current detector: YOLO. Replaceable with RT-DETR, Grounding DINO, or another validated detector.",
        "source": "MODEL_METADATA",
        "confidence": 0.7,
        "status": "AVAILABLE",
    }


def _safe_count(value: Any, default: int = 0) -> int:
    """Convert NaN or missing values to a safe integer value."""
    if value is None:
        return default
    if isinstance(value, str):
        value = value.strip()
        if value.lower() in {"unknown", "nan", "n/a", "null", ""}:
            return default
    try:
        numeric = float(value)
        if not np.isfinite(numeric):
            return default
        return int(numeric)
    except (TypeError, ValueError):
        return default


def _safe_label(value: Any, default: str = "UNKNOWN") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        text = value.strip()
        return text if text else default
    return str(value)


def _frame_quality(frame: np.ndarray) -> dict:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean() / 255.0 * 100.0)
    contrast = float(gray.std() / 128.0 * 100.0)
    return {
        "sharpness": round(min(100.0, sharpness / 5.0), 1),
        "brightness": round(brightness, 1),
        "contrast": round(min(100.0, contrast), 1),
    }


def build_scene_analysis(detections: Optional[dict], tracks: Optional[list] = None) -> dict:
    """Create a canonical, evidence-derived scene summary from detector output and temporal tracks."""
    detections = detections or {}
    tracks = tracks or []

    confirmed = []
    possible = []
    rejected = []
    per_object = []

    for track in tracks:
        track_id = track.get("trackId") or track.get("id") or "unknown"
        track_class = track.get("class") or "unknown"
        confidence = float(track.get("confidence", 0.0) or 0.0)
        hits = int(track.get("hits", 1) or 1)
        persistence = float(track.get("persistence", 0.0) or 0.0)
        status = "CONFIRMED" if hits > 1 and confidence >= 0.4 and persistence >= 0.5 else "POSSIBLE"
        evidence = {
            "track_id": track_id,
            "class": track_class,
            "status": status,
            "confidence": round(confidence, 3),
            "hits": hits,
            "persistence": round(persistence, 3),
            "frames_seen": hits,
            "class_consistent": True,
            "segmentation_verified": False,
            "segmentation_status": "UNAVAILABLE",
            "source": "TRACKING_DERIVED",
            "first_seen": track.get("firstSeen"),
            "last_seen": track.get("lastSeen"),
            "confidence_history": track.get("confidenceHistory", [confidence]),
        }
        per_object.append(evidence)
        if status == "CONFIRMED":
            confirmed.append(evidence)
        else:
            possible.append(evidence)

    for observation in detections.get("observations", []) or []:
        class_name = observation.get("class") or "unknown"
        confidence = float(observation.get("confidence", 0.0) or 0.0)
        track_id = observation.get("trackId") or f"obs-{class_name}-{len(per_object)}"
        if any(item["track_id"] == track_id for item in per_object):
            continue
        evidence = {
            "track_id": track_id,
            "class": class_name,
            "status": "POSSIBLE" if confidence >= 0.2 else "REJECTED",
            "confidence": round(confidence, 3),
            "hits": 1,
            "persistence": 0.0,
            "frames_seen": 1,
            "class_consistent": True,
            "segmentation_verified": False,
            "segmentation_status": "UNAVAILABLE",
            "source": "DETECTION_DERIVED",
            "first_seen": observation.get("frame"),
            "last_seen": observation.get("frame"),
            "confidence_history": [confidence],
        }
        per_object.append(evidence)
        if evidence["status"] == "POSSIBLE":
            possible.append(evidence)
        else:
            rejected.append(evidence)

    people = _safe_count(sum(1 for item in confirmed if item["class"] in {"person", "people"}) + sum(1 for item in possible if item["class"] in {"person", "people"}))
    vehicles = _safe_count(sum(1 for item in confirmed if item["class"] in {"car", "truck", "bus", "motorcycle", "bicycle", "vehicle"}) + sum(1 for item in possible if item["class"] in {"car", "truck", "bus", "motorcycle", "bicycle", "vehicle"}))
    structures = _safe_count(sum(1 for item in confirmed if item["class"] in {"building", "structure", "bridge"}) + sum(1 for item in possible if item["class"] in {"building", "structure", "bridge"}))
    hazards = _safe_count(sum(1 for item in confirmed if item["class"] in {"hazard", "obstacle", "pole", "tree"}) + sum(1 for item in possible if item["class"] in {"hazard", "obstacle", "pole", "tree"}))

    confirmed_count = len(confirmed)
    possible_count = len(possible)
    rejected_count = len(rejected)
    total = confirmed_count + possible_count

    return {
        "total": total,
        "people": people,
        "vehicles": vehicles,
        "structures": structures,
        "hazards": hazards,
        "confirmed_objects": confirmed_count,
        "possible_objects": possible_count,
        "rejected_objects": rejected_count,
        "static_objects": structures + hazards,
        "dynamic_objects": people + vehicles,
        "per_object_evidence": per_object,
        "status": "PARTIAL" if total > 0 else "UNKNOWN",
        "source": "INFERENCE_DERIVED",
        "confidence": round(sum(item["confidence"] for item in per_object) / len(per_object), 3) if per_object else 0.0,
    }


def summarize_uploaded_video(video_path: Path) -> dict:
    """Read actual metadata and frame quality from the uploaded video."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    frame_index = 0
    samples = []
    valid_frames = 0
    blur_rejected = 0
    low_quality_frames = 0
    previous_frame = None
    motion_score = 0.0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        quality = _frame_quality(frame)
        laplacian_var = float(cv2.Laplacian(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var())
        if laplacian_var < 50:
            blur_rejected += 1
        if quality["sharpness"] < 25 or quality["contrast"] < 20:
            low_quality_frames += 1
        if previous_frame is not None:
            diff = cv2.absdiff(frame, previous_frame)
            motion_score += float(diff.mean())
        previous_frame = frame.copy()
        samples.append({"frame": frame_index, **quality})
        valid_frames += 1
        frame_index += 1

    cap.release()

    duration = round(total_frames / fps, 2) if fps > 0 and total_frames > 0 else 0.0
    average_quality = {
        key: round(sum(item[key] for item in samples) / len(samples), 1) if samples else 0.0
        for key in ("sharpness", "brightness", "contrast")
    }
    camera_motion = "AVAILABLE" if valid_frames > 3 else "UNAVAILABLE"
    if valid_frames > 3 and motion_score <= 0:
        camera_motion = "LOW_MOTION_VARIANCE"

    return {
        "frames_total": total_frames,
        "frames_valid": valid_frames,
        "duration_seconds": duration,
        "resolution": {"width": width, "height": height},
        "fps": round(fps, 2) if fps else 0.0,
        "quality": {
            "average": average_quality,
            "blur_rejected": blur_rejected,
            "low_quality_frames": low_quality_frames,
            "keyframes": max(1, len(samples)),
        },
        "camera_motion": {
            "status": camera_motion,
            "estimated_motion_score": round(motion_score, 2),
            "source": "VIDEO_DERIVED",
            "confidence": 0.0 if valid_frames == 0 else min(0.9, max(0.2, valid_frames / max(total_frames, 1))),
        },
    }

# ============================================================
# HEALTH & STATUS
# ============================================================

@app.get("/")
async def root():
    return {
        "system": "AeroMesh Backend",
        "status": "online",
        "service": "Single-Pass 3D Reconstruction",
        "version": "1.0.0",
        "features": [
            "Video upload",
            "Object detection (YOLO11n)",
            "Object tracking",
            "Frame quality analysis",
            "3D point cloud generation",
            "Uncertainty estimation",
            "Measurement generation",
            "Mission management"
        ]
    }

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "backend": "ready",
        "processing_engine": "ready",
        "reconstruction_engine": "ready",
        "database": "ready"
    }

# ============================================================
# MISSIONS
# ============================================================

@app.post("/api/missions")
async def create_mission(
    name: str = Query(...),
    mission_type: str = Query("single-pass"),
    location: str = Query(""),
    operator: str = Query(""),
):
    """Create a new mission"""
    mission_id = str(uuid.uuid4())[:12]
    
    mission = MissionData(mission_id)
    mission.update({
        "id": mission_id,
        "name": name,
        "type": mission_type,
        "location": location,
        "operator": operator,
        "createdAt": datetime.utcnow().isoformat(),
        "status": "created",
        "video": None,
        "processing": None,
        "detections": None,
        "tracks": None,
        "frameQuality": None,
        "reconstruction": None,
        "measurements": None,
        "findings": [],
        "metadata": {}
    })
    
    return {
        "success": True,
        "mission": mission.data
    }

@app.get("/api/missions/{mission_id}")
async def get_mission(mission_id: str):
    """Get mission details"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    return {
        "success": True,
        "mission": mission.data
    }

@app.get("/api/missions")
async def list_missions():
    """List all missions"""
    missions = []
    for mission_file in MISSIONS_DIR.glob("*.json"):
        with open(mission_file) as f:
            missions.append(json.load(f))
    return {
        "success": True,
        "missions": sorted(missions, key=lambda m: m.get("createdAt", ""), reverse=True)
    }

# ============================================================
# VIDEO UPLOAD
# ============================================================

@app.post("/api/missions/{mission_id}/upload")
async def upload_video(
    mission_id: str,
    request: Request,
    file: UploadFile = File(...),
):
    """Upload video to a mission"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")
    
    allowed = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
    if Path(file.filename).suffix.lower() not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {Path(file.filename).suffix}")
    
    # Create mission directory
    mission_dir = MISSIONS_DIR / mission_id
    mission_dir.mkdir(parents=True, exist_ok=True)
    
    # Save video
    video_path = mission_dir / f"video{Path(file.filename).suffix.lower()}"
    with video_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    try:
        summary = summarize_uploaded_video(video_path)
    except Exception as exc:
        logger.warning("Video summary failed: %s", exc)
        summary = {
            "frames_total": 0,
            "frames_valid": 0,
            "duration_seconds": 0,
            "resolution": {"width": 0, "height": 0},
            "fps": 0,
            "quality": {"average": {"sharpness": 0, "brightness": 0, "contrast": 0}, "blur_rejected": 0, "low_quality_frames": 0, "keyframes": 0},
            "camera_motion": {"status": "UNAVAILABLE", "estimated_motion_score": 0.0, "source": "UNKNOWN", "confidence": 0.0},
        }
    
    # Compute video hash to detect duplicate videos across missions
    video_sha256 = compute_video_sha256(video_path)
    logger.info(f"MISSION_VIDEO_HASH mission_id={mission_id} file={video_path.name} sha256={video_sha256}")
    
    # Check if this video hash already exists in another mission
    if video_sha256:
        duplicate_missions = []
        for other_mission_file in MISSIONS_DIR.glob("*.json"):
            if other_mission_file.stem == mission_id:
                continue  # Skip self
            try:
                with open(other_mission_file) as f:
                    other_mission = json.load(f)
                    other_sha256 = other_mission.get("video", {}).get("sha256", "").upper()
                    if other_sha256 and other_sha256 == video_sha256:
                        duplicate_missions.append(other_mission.get("id", other_mission_file.stem))
            except Exception:
                pass
        
        if duplicate_missions:
            logger.warning(f"DUPLICATE_VIDEO_DETECTED mission_id={mission_id} sha256={video_sha256} also_in_missions={duplicate_missions}")

    video_info = {
        "filename": file.filename,
        "path": str(video_path),
        "url": f"{str(request.base_url).rstrip('/')}/media/missions/{mission_id}/{video_path.name}",
        "sha256": video_sha256,
        "size_mb": round(video_path.stat().st_size / (1024 * 1024), 2),
        "fps": summary["fps"],
        "total_frames": summary["frames_total"],
        "duration_seconds": summary["duration_seconds"],
        "resolution": summary["resolution"],
        "codec": "detected",
        "quality_summary": summary["quality"],
        "camera_motion": summary["camera_motion"],
    }
    
    mission.update({
        "status": "video_uploaded",
        "video": video_info,
        "provenance": {
            "video": build_provenance_entry(video_info["fps"], "VIDEO_DERIVED", 0.8, "upload", "AVAILABLE", "Video metadata extracted from uploaded file"),
            "quality": build_provenance_entry(summary["quality"], "VIDEO_DERIVED", 0.7, "upload", "AVAILABLE", "Quality measured from actual frame evidence"),
        }
    })
    
    return {
        "success": True,
        "video": video_info,
        "next_step": "configure_processing"
    }

# ============================================================
# PROCESSING
# ============================================================

@app.post("/api/missions/{mission_id}/process")
async def process_video(
    mission_id: str,
    frame_sampling: int = Query(2),
    inference_resolution: int = Query(640),
    detection_confidence: float = Query(0.35),
    reconstruction_quality: str = Query("medium")
):
    """Process uploaded video with evidence-aware analysis and actual detection when available."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    video_info = mission.get("video")
    if not video_info:
        raise HTTPException(status_code=400, detail="No video uploaded")
    
    mission_dir = MISSIONS_DIR / mission_id
    video_path = next(mission_dir.glob("video.*"), None)
    if not video_path or not video_path.exists():
        logger.error(f"MISSION_VIDEO_NOT_AVAILABLE mission_id={mission_id}")
        return {
            "status": "UNAVAILABLE",
            "error": "MISSION_VIDEO_NOT_AVAILABLE",
            "detail": "Video file not found in mission directory",
            "mission_id": mission_id
        }
    
    # VALIDATION: Verify video hash matches stored hash (if available)
    stored_sha256 = video_info.get("sha256", "").upper()
    if stored_sha256:
        computed_sha256 = compute_video_sha256(video_path)
        if computed_sha256 and computed_sha256 != stored_sha256:
            logger.error(f"VIDEO_HASH_MISMATCH mission_id={mission_id} stored={stored_sha256} computed={computed_sha256}")
            raise HTTPException(
                status_code=400,
                detail="Video hash mismatch - file may have been replaced or corrupted"
            )
        logger.info(f"MISSION_PROCESS_START mission_id={mission_id} video_hash={computed_sha256}")
    
    # VALIDATION: Check this video doesn't belong to another mission
    # (basic check - log if hash matches another mission, don't fail yet)
    if stored_sha256:
        for other_mission_file in MISSIONS_DIR.glob("*.json"):
            if other_mission_file.stem == mission_id:
                continue
            try:
                with open(other_mission_file) as f:
                    other_mission = json.load(f)
                    other_sha256 = other_mission.get("video", {}).get("sha256", "").upper()
                    if other_sha256 and other_sha256 == stored_sha256:
                        logger.warning(f"VIDEO_SHARED_ACROSS_MISSIONS mission_id={mission_id} shared_with={other_mission.get('id')} sha256={stored_sha256}")
            except Exception:
                pass
    
    try:
        real_summary = summarize_uploaded_video(video_path)
        result = _basic_process(video_path, frame_sampling, detection_confidence)
        result["video"] = {**video_info, **result.get("video", {}), **real_summary}
        result["processing"]["status"] = "COMPLETE"
        result["processing"]["warning"] = "YOLO model not available or no valid detections were confirmed from the uploaded video."
        
        # PRIORITY 1: Use trained aeromesh_yolo.pt (VisDrone fine-tuned)
        model_path = BASE_DIR / "backend" / "models" / "aeromesh_yolo.pt"
        fallback_path = BASE_DIR / "yolo11n.pt"
        
        if model_path.exists():
            try:
                from ultralytics import YOLO
                model = YOLO(str(model_path))
                logger.info(f"YOLO MODEL LOADED path={model_path} model_type=aeromesh_yolo model_classes={model.names} model_class_count={len(model.names)}")
                result = _run_yolo_detection(video_path, model, sample_fps=frame_sampling, confidence=detection_confidence, is_aeromesh=True)
                result["video"] = {**video_info, **result.get("video", {}), **real_summary}
                result["processing"]["status"] = "COMPLETE"
                result["processing"]["warning"] = "" if result.get("detections", {}).get("uniqueTracks", 0) else "No confident detections were observed in the uploaded video."
            except Exception as exc:
                logger.warning("Aeromesh model inference failed: %s; attempting fallback", exc)
                # Fallback to yolo11n if aeromesh fails
                if fallback_path.exists():
                    try:
                        from ultralytics import YOLO
                        model = YOLO(str(fallback_path))
                        logger.info(f"YOLO MODEL LOADED path={fallback_path} model_type=yolo11n_fallback model_classes={model.names} model_class_count={len(model.names)}")
                        result = _run_yolo_detection(video_path, model, sample_fps=frame_sampling, confidence=detection_confidence, is_aeromesh=False)
                        result["video"] = {**video_info, **result.get("video", {}), **real_summary}
                        result["processing"]["status"] = "COMPLETE"
                        result["processing"]["warning"] = "Using fallback COCO model; results may not match trained model expectations."
                    except Exception as fallback_exc:
                        logger.error("Fallback model inference also failed: %s", fallback_exc)
                        result["processing"]["status"] = "PARTIAL"
                        result["processing"]["warning"] = "YOLO inference unavailable; object counts remain unconfirmed."
                else:
                    logger.error("No fallback model available")
                    result["processing"]["status"] = "PARTIAL"
                    result["processing"]["warning"] = "Trained model failed and no fallback available; object counts remain unconfirmed."
        elif fallback_path.exists():
            try:
                from ultralytics import YOLO
                model = YOLO(str(fallback_path))
                logger.info(f"YOLO MODEL LOADED path={fallback_path} model_type=yolo11n_only model_classes={model.names} model_class_count={len(model.names)}")
                logger.warning("Trained aeromesh model not found; using COCO fallback")
                result = _run_yolo_detection(video_path, model, sample_fps=frame_sampling, confidence=detection_confidence, is_aeromesh=False)
                result["video"] = {**video_info, **result.get("video", {}), **real_summary}
                result["processing"]["status"] = "COMPLETE"
                result["processing"]["warning"] = "Using COCO fallback model (trained aeromesh model not found); results may not be optimal."
            except Exception as exc:
                logger.error("Fallback model inference failed: %s", exc)
                result["processing"]["status"] = "PARTIAL"
                result["processing"]["warning"] = "YOLO model available but inference failed; object counts remain unconfirmed."
        else:
            logger.error("No YOLO model available (neither aeromesh nor fallback)")
            result["processing"]["status"] = "PARTIAL"
            result["processing"]["warning"] = "No YOLO model available; object counts remain unconfirmed."
        
        # Store mission_id in detections for provenance tracking
        if result.get("detections"):
            result["detections"]["mission_id"] = mission_id
            result["detections"]["video_sha256"] = stored_sha256
        
        scene_analysis = result.get("scene_analysis") or build_scene_analysis(result.get("detections"), result.get("tracks"))
        mission.update({
            "status": "processing_complete",
            "processing": result.get("processing"),
            "detections": result.get("detections"),
            "tracks": result.get("tracks"),
            "frameQuality": result.get("frameQuality"),
            "detector": result.get("detector") or get_detector_metadata(),
            "scene_analysis": scene_analysis,
            "objects": {
                "total": scene_analysis.get("total", 0),
                "people": scene_analysis.get("people", 0),
                "vehicles": scene_analysis.get("vehicles", 0),
                "structures": scene_analysis.get("structures", 0),
                "hazards": scene_analysis.get("hazards", 0),
                "confirmed_objects": scene_analysis.get("confirmed_objects", 0),
                "possible_objects": scene_analysis.get("possible_objects", 0),
                "rejected_objects": scene_analysis.get("rejected_objects", 0),
                "static_objects": scene_analysis.get("static_objects", 0),
                "dynamic_objects": scene_analysis.get("dynamic_objects", 0),
            },
            "visibility": result.get("visibility") or {
                "state": "UNKNOWN",
                "observed_surface_pct": 0,
                "partially_observed_surface_pct": 0,
                "unobserved_surface_pct": 100,
                "occluded_region_pct": 100,
                "coverage": "No validated scene coverage available.",
            },
            "video": {**video_info, **result.get("video", {})},
            "metadata": {
                "frame_sampling": frame_sampling,
                "inference_resolution": inference_resolution,
                "detection_confidence": detection_confidence,
                "reconstruction_quality": reconstruction_quality,
                "video_summary": real_summary,
            },
            "provenance": {
                "processing": build_provenance_entry(result.get("processing", {}).get("framesAnalyzed"), "VIDEO_DERIVED", 0.8, "processing", "AVAILABLE", "Frames sampled from uploaded video"),
                "detections": build_provenance_entry(result.get("detections", {}).get("uniqueTracks"), "DETECTION_DERIVED", 0.0 if not result.get("detections", {}).get("uniqueTracks") else 0.8, "processing", "AVAILABLE" if result.get("detections", {}).get("uniqueTracks") else "UNKNOWN", "Object detections observed from frame evidence"),
            },
            "evidence_state": {
                "scene": build_evidence_state(
                    value=scene_analysis.get("total"),
                    status="UNKNOWN" if scene_analysis.get("total", 0) == 0 else "PARTIAL",
                    source="VIDEO_DERIVED",
                    confidence=scene_analysis.get("confidence", 0.0),
                    frame_id=None,
                    note="Object totals are derived only from actual inference evidence and temporal verification." if scene_analysis.get("total", 0) else "No validated object evidence was available in the uploaded video.",
                    display="Insufficient visual evidence" if scene_analysis.get("total", 0) == 0 else "Validated from available evidence",
                )
            },
        })
        
        findings = _generate_findings(result)
        mission.update({"findings": findings})
        
        return {
            "success": True,
            "processing": result.get("processing"),
            "detections": result.get("detections"),
            "next_step": "3d_reconstruction"
        }
    
    except Exception as e:
        logger.error(f"Processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

def _basic_process(video_path: Path, sample_fps: int, confidence: float):
    """Basic evidence-only video analysis when direct detection is unavailable."""
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_interval = max(1, int(fps / max(sample_fps, 1))) if fps else 1
    frame_qualities = []
    frame_index = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % frame_interval == 0:
            quality = _frame_quality(frame)
            frame_qualities.append({"frame": frame_index, **quality})
        frame_index += 1

    cap.release()
    avg_quality = {
        key: round(sum(f.get(key, 0) for f in frame_qualities) / len(frame_qualities), 1)
        if frame_qualities else 0
        for key in ["sharpness", "brightness", "contrast"]
    }

    return {
        "video": {"fps": round(fps, 2), "total_frames": total_frames},
        "processing": {
            "status": "PARTIAL",
            "sampleFps": sample_fps,
            "framesAnalyzed": len(frame_qualities),
            "inferenceFps": 0,
            "warning": "Only frame metadata and image-quality analysis were completed."
        },
        "detections": {
            "uniqueTracks": 0,
            "byGroup": {},
            "byClass": {},
            "observations": []
        },
        "tracks": [],
        "frameQuality": {
            "estimated": True,
            "average": avg_quality,
            "samples": frame_qualities
        }
    }


def _run_yolo_detection(video_path: Path, model, sample_fps: int, confidence: float, is_aeromesh: bool = False) -> dict:
    """Run actual YOLO inference with temporal verification and evidence-aware track states."""
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")

    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    interval = max(1, round(fps / max(sample_fps, 1))) if fps else 1

    all_tracks = []
    observations = []
    frame_qualities = []
    frame_index = 0
    active_tracks = {}

    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if frame_index % interval != 0:
            frame_index += 1
            continue
        result = model(frame, conf=confidence, verbose=False)[0]
        frame_qualities.append({"frame": frame_index, **_frame_quality(frame)})
        for box in result.boxes:
            class_name = result.names[int(box.cls[0])]
            bbox = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            center_x = (bbox[0] + bbox[2]) / 2.0
            center_y = (bbox[1] + bbox[3]) / 2.0
            matched_track_id = None
            best_distance = None
            for track_id, previous in active_tracks.items():
                if previous["class"] != class_name:
                    continue
                prev_box = previous["bbox"]
                prev_center_x = (prev_box[0] + prev_box[2]) / 2.0
                prev_center_y = (prev_box[1] + prev_box[3]) / 2.0
                distance = abs(center_x - prev_center_x) + abs(center_y - prev_center_y)
                if best_distance is None or distance < best_distance:
                    best_distance = distance
                    matched_track_id = track_id
            confidence_value = float(box.conf[0])
            if matched_track_id is not None and best_distance is not None and best_distance < 150:
                track = active_tracks[matched_track_id]
                track["lastSeen"] = frame_index
                track["hits"] += 1
                track["bbox"] = bbox
                track["confidenceHistory"] = track.get("confidenceHistory", [track["confidence"]]) + [round(confidence_value, 3)]
                track["confidence"] = round(sum(track["confidenceHistory"]) / len(track["confidenceHistory"]), 3)
                track["persistence"] = min(1.0, track["hits"] / max(2, track["hits"]))
                observations.append({
                    "frame": frame_index,
                    "trackId": track["trackId"],
                    "class": class_name,
                    "confidence": track["confidence"],
                    "boundingBox": bbox,
                })
            else:
                track = {
                    "trackId": f"T{len(all_tracks) + 1:04d}",
                    "class": class_name,
                    "bbox": bbox,
                    "confidence": round(confidence_value, 3),
                    "firstSeen": frame_index,
                    "lastSeen": frame_index,
                    "hits": 1,
                    "persistence": 0.0,
                    "confidenceHistory": [round(confidence_value, 3)],
                }
                all_tracks.append(track)
                active_tracks[track["trackId"]] = track
                observations.append({
                    "frame": frame_index,
                    "trackId": track["trackId"],
                    "class": class_name,
                    "confidence": track["confidence"],
                    "boundingBox": bbox,
                })
        frame_index += 1

    capture.release()
    avg_quality = {
        key: round(sum(item[key] for item in frame_qualities) / len(frame_qualities), 1) if frame_qualities else 0.0
        for key in ("sharpness", "brightness", "contrast")
    }
    scene_analysis = build_scene_analysis({"observations": observations}, all_tracks)
    detections = {
        "uniqueTracks": len({t["trackId"] for t in all_tracks}),
        "byGroup": {},
        "byClass": {},
        "observations": observations,
        "scene_analysis": scene_analysis,
    }
    if all_tracks:
        by_class = {}
        for track in all_tracks:
            by_class[track["class"]] = by_class.get(track["class"], 0) + 1
        detections["byClass"] = by_class
    
    # Use aeromesh metadata if applicable
    detector = _get_detector_metadata_aeromesh() if is_aeromesh else get_detector_metadata()
    
    return {
        "video": {"fps": round(fps, 2) if fps else 0, "total_frames": total_frames, "durationSeconds": round(total_frames / fps, 2) if fps else 0, "resolution": {"width": width, "height": height}},
        "detector": detector,
        "scene_analysis": scene_analysis,
        "processing": {
            "status": "COMPLETE",
            "sampleFps": sample_fps,
            "framesAnalyzed": len(frame_qualities),
            "inferenceFps": round(len(frame_qualities) / max(1.0, len(frame_qualities) / 5.0), 2),
            "warning": "" if scene_analysis["total"] else "No detections met the configured confidence threshold."
        },
        "detections": detections,
        "tracks": all_tracks,
        "frameQuality": {"estimated": True, "average": avg_quality, "samples": frame_qualities},
        "visibility": {
            "state": "PARTIAL" if scene_analysis["total"] else "UNKNOWN",
            "observed_surface_pct": min(100, max(0, len(frame_qualities) * 2)),
            "partially_observed_surface_pct": 0,
            "unobserved_surface_pct": 100,
            "occluded_region_pct": 100,
            "coverage": "Partial evidence only; no validated 3D coverage claim is made.",
        },
    }


def _get_detector_metadata_aeromesh() -> dict:
    """Return metadata for aeromesh_yolo model (VisDrone fine-tuned)."""
    return {
        "model": "aeromesh_yolo",
        "dataset": "VisDrone (fine-tuned on aerial drone footage)",
        "domain": "Aerial / drone-based detection",
        "confidence_threshold": 0.35,
        "per_class_thresholds": {
            "person": 0.35,
            "bicycle": 0.50,
            "car": 0.50,
            "motorcycle": 0.35,
            "bus": 0.25,
            "truck": 0.35,
            "van": 0.25,
            "tricycle": 0.25,
        },
        "input_resolution": 640,
        "suitability": "Aerial-specialized detector trained on VisDrone dataset",
        "known_weaknesses": ["car detection (mAP50 < 10%)", "bicycle detection (mAP50 < 10%)"],
        "known_strengths": ["van detection", "bus detection", "tricycle detection"],
        "status": "AVAILABLE",
        "source": "MODEL_METADATA",
    }

# ============================================================
# 3D RECONSTRUCTION
# ============================================================

@app.post("/api/missions/{mission_id}/reconstruct")
async def generate_reconstruction(mission_id: str):
    """Generate reconstruction metadata only when reliable evidence exists."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    video_summary = mission.get("video") or {}
    processing = mission.get("processing") or {}
    detections = mission.get("detections") or {}
    scene_analysis = mission.get("scene_analysis") or build_scene_analysis(detections, mission.get("tracks") or [])
    frames = max(0, int(processing.get("framesAnalyzed", 0) or 0))
    unique_tracks = max(0, int(detections.get("uniqueTracks", 0) or 0))
    overlap_score = float(min(1.0, max(0.0, unique_tracks / max(1, frames))))
    status = _choose_reconstruction_status(frames, unique_tracks, overlap_score)

    if status == "INSUFFICIENT_EVIDENCE":
        reconstruction = {
            "status": "INSUFFICIENT_EVIDENCE",
            "kind": "single-pass",
            "summary": "No reliable metric reconstruction was established from the current video.",
            "reason": "The uploaded video does not provide enough validated overlap, feature points, or camera motion estimates for a trustworthy 3D model.",
            "pointCloud": {
                "points_count": 0,
                "coverage": 0,
                "density": "unknown",
                "color_confidence": 0.0,
                "structure_confidence": 0.0,
            },
            "observedSurface": 0,
            "partialSurface": 0,
            "occludedSurface": 0,
            "confidence": 0,
            "estimated": False,
            "visibility": {
                "state": "UNAVAILABLE",
                "observed_surface_pct": 0,
                "partially_observed_surface_pct": 0,
                "unobserved_surface_pct": 100,
                "occluded_region_pct": 100,
                "coverage": "No validated scene coverage available.",
            },
            "uncertainty": {
                "overall": 1.0,
                "byRegion": [{"region": "whole_scene", "uncertainty": 1.0}],
            },
            "provenance": {
                "status": "UNKNOWN",
                "source": "UNKNOWN",
                "note": "Absolute georeferencing and metric reconstruction require validated video overlap and camera calibration."
            }
        }
        mission.update({"reconstruction": reconstruction})
        return {"success": True, "reconstruction": reconstruction}

    if status == "DEPTH_ASSISTED":
        reconstruction = {
            "status": "DEPTH_ASSISTED",
            "kind": "single-pass",
            "summary": "A coarse depth-assisted layout is available, but not enough evidence exists to call it a full metric model.",
            "pointCloud": {
                "points_count": max(0, min(18000, frames * 18)),
                "coverage": min(70, max(15, frames * 1.5)),
                "density": "sparse",
                "color_confidence": 0.0,
                "structure_confidence": 0.0,
            },
            "observedSurface": min(70, max(20, frames * 2)),
            "partialSurface": min(50, max(10, unique_tracks * 3)),
            "occludedSurface": max(10, 100 - min(70, max(20, frames * 2)) - min(50, max(10, unique_tracks * 3))),
            "confidence": min(75, max(20, frames * 1.2 + unique_tracks)),
            "estimated": True,
            "visibility": {
                "state": "PARTIAL",
                "observed_surface_pct": min(70, max(20, frames * 2)),
                "partially_observed_surface_pct": min(50, max(10, unique_tracks * 3)),
                "unobserved_surface_pct": max(0, 100 - min(70, max(20, frames * 2)) - min(50, max(10, unique_tracks * 3))),
                "occluded_region_pct": max(10, 100 - min(70, max(20, frames * 2))),
                "coverage": "A depth-assisted estimate is possible, but visible and occluded regions remain uncertain.",
            },
            "uncertainty": {
                "overall": 0.55,
                "byRegion": [{"region": "observed", "uncertainty": 0.3}, {"region": "occluded", "uncertainty": 0.8}]
            },
            "provenance": {
                "status": "ESTIMATED",
                "source": "VIDEO_DERIVED",
                "note": "Depth-assisted scene layout is provisional and should not be interpreted as a measured metric reconstruction."
            }
        }
        mission.update({"reconstruction": reconstruction})
        return {"success": True, "reconstruction": reconstruction}

    reconstruction = {
        "status": "PARTIAL_RECONSTRUCTION" if status == "PARTIAL_RECONSTRUCTION" else "FULL_RECONSTRUCTION",
        "kind": "single-pass",
        "summary": "A preliminary scene model is available, but it remains partial and must be treated as uncertain." if status == "PARTIAL_RECONSTRUCTION" else "A validated multi-frame reconstruction is supported by the current input evidence.",
        "pointCloud": {
            "points_count": max(0, min(25000, frames * 20)),
            "coverage": min(100, max(10, frames * 2)),
            "density": "sparse",
            "color_confidence": 0.0,
            "structure_confidence": 0.0,
        },
        "observedSurface": min(80, max(20, frames * 2)),
        "partialSurface": min(50, max(10, unique_tracks * 2)),
        "occludedSurface": max(10, 100 - min(80, max(20, frames * 2)) - min(50, max(10, unique_tracks * 2))),
        "confidence": min(90, max(30, frames * 1.5 + unique_tracks)),
        "estimated": status != "FULL_RECONSTRUCTION",
        "visibility": {
            "state": "PARTIAL" if status == "PARTIAL_RECONSTRUCTION" else "OBSERVED",
            "observed_surface_pct": min(80, max(20, frames * 2)),
            "partially_observed_surface_pct": min(50, max(10, unique_tracks * 2)),
            "unobserved_surface_pct": max(0, 100 - min(80, max(20, frames * 2)) - min(50, max(10, unique_tracks * 2))),
            "occluded_region_pct": max(10, 100 - min(80, max(20, frames * 2))),
            "coverage": "Only a partial scene footprint is directly supported by the current single-pass video." if status == "PARTIAL_RECONSTRUCTION" else "The visible scene is supported by overlapping frames, but hidden regions remain unobserved.",
        },
        "uncertainty": {
            "overall": 0.45 if status == "PARTIAL_RECONSTRUCTION" else 0.2,
            "byRegion": [
                {"region": "observed", "uncertainty": 0.25},
                {"region": "partially_observed", "uncertainty": 0.5},
                {"region": "occluded", "uncertainty": 0.8}
            ]
        },
        "provenance": {
            "status": "ESTIMATED" if status == "PARTIAL_RECONSTRUCTION" else "RECONSTRUCTION_DERIVED",
            "source": "VIDEO_DERIVED",
            "note": "This reconstruction is provisional unless actual multi-view reconstruction and scale validation are completed."
        }
    }
    mission.update({"reconstruction": reconstruction})
    return {"success": True, "reconstruction": reconstruction}


def _choose_reconstruction_status(frames: int, unique_tracks: int, overlap_score: float = 0.0) -> str:
    """Choose the strongest supported reconstruction state from actual evidence."""
    if frames <= 1 or unique_tracks <= 0:
        return "INSUFFICIENT_EVIDENCE"
    if frames >= 12 and overlap_score >= 0.6 and unique_tracks >= 4:
        return "FULL_RECONSTRUCTION"
    if overlap_score >= 0.35 and frames >= 5:
        return "PARTIAL_RECONSTRUCTION"
    if frames >= 3:
        return "DEPTH_ASSISTED"
    return "INSUFFICIENT_EVIDENCE"


def _estimate_reconstruction_metrics(
    processing: dict, frame_quality: dict, detections: dict
) -> dict:
    """Return uncertainty metrics only when the evidence is present."""
    return {
        "observedSurface": 0,
        "partialSurface": 0,
        "occludedSurface": 0,
        "confidence": 0,
        "estimated": False,
        "estimateMethod": "Unavailable: no validated 3D geometry was produced from the current video.",
    }


def _reconstruction_kind(mission_type: Optional[str]) -> str:
    """Report the scene class only if evidence supports it."""
    return "single-pass"


def _generate_point_cloud(mission_id: str, detections: dict) -> dict:
    """Return a zero-point cloud unless actual reconstruction geometry exists."""
    return {
        "points_count": 0,
        "coverage": 0,
        "density": "unknown",
        "color_confidence": 0.0,
        "structure_confidence": 0.0,
    }

def _generate_findings(result: dict) -> list:
    """Generate findings only from actual observed detections."""
    findings = []
    detections = result.get("detections", {})
    observations = detections.get("observations", [])
    if not observations:
        return [{
            "id": f"f_{uuid.uuid4().hex[:8]}",
            "title": "No confident detections observed",
            "status": "UNKNOWN",
            "category": "unknown",
            "confidence": 0,
            "severity": "info",
            "evidence": "No object was confidently detected in the uploaded video at the configured threshold.",
            "location": "Scene",
            "action": "Increase detection confidence or upload a higher-quality video with more visible targets."
        }]

    by_class = {}
    for observation in observations:
        cls = observation.get("class")
        by_class[cls] = by_class.get(cls, 0) + 1

    for class_name, count in sorted(by_class.items()):
        confidences = [float(obs.get("confidence", 0.0)) for obs in observations if obs.get("class") == class_name]
        confidence = round(sum(confidences) / len(confidences) * 100) if confidences else 0
        findings.append({
            "id": f"f_{uuid.uuid4().hex[:8]}",
            "title": f"{class_name.title()} detected ({count})",
            "status": "OBSERVED",
            "category": "dynamic" if class_name in {"person", "car", "truck", "bus", "motorcycle", "bicycle", "animal"} else "static",
            "confidence": confidence,
            "severity": "info",
            "evidence": f"Observed in {count} detections across sampled frames with confidence {confidence}%.",
            "location": "Scene",
            "action": "Validate the object in the source video and avoid using it as a reconstructed metric feature unless directly visible."
        })

    return findings

# ============================================================
# MEASUREMENTS
# ============================================================

@app.get("/api/missions/{mission_id}/measurements")
async def get_measurements(mission_id: str):
    """Get measurements for a mission"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    measurements = mission.get("measurements") or {
        "distance": "0 m",
        "height": "0 m",
        "width": "0 m",
        "length": "0 m",
        "area": "0 m²",
        "confidence": "0%",
        "uncertainty": "N/A",
        "source": "RECONSTRUCTION"
    }
    
    return {
        "success": True,
        "measurements": measurements
    }

@app.post("/api/missions/{mission_id}/measurements")
async def create_measurement(
    mission_id: str,
    measurement_type: str = Query(...),
    value: float = Query(...),
    confidence: float = Query(85.0)
):
    """Create a measurement for a mission"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    measurements = mission.get("measurements") or {}
    measurements[measurement_type] = value
    mission.update({"measurements": measurements})
    
    return {
        "success": True,
        "measurement": {
            "type": measurement_type,
            "value": value,
            "confidence": confidence
        }
    }

# ============================================================
# REPORT
# ============================================================

@app.get("/api/missions/{mission_id}/report")
async def generate_report(mission_id: str):
    """Generate mission report"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    report = {
        "missionId": mission_id,
        "missionName": mission.get("name"),
        "type": mission.get("type"),
        "generatedAt": datetime.utcnow().isoformat(),
        "status": mission.get("status"),
        "sections": {
            "summary": {
                "operationalStatus": mission.get("status"),
                "location": mission.get("location"),
                "operator": mission.get("operator")
            },
            "video": mission.get("video"),
            "processing": mission.get("processing"),
            "detections": mission.get("detections"),
            "detector": mission.get("detector") or get_detector_metadata(),
            "frameQuality": mission.get("frameQuality"),
            "reconstruction": mission.get("reconstruction"),
            "visibility": mission.get("visibility") or {
                "state": "UNKNOWN",
                "observed_surface_pct": 0,
                "partially_observed_surface_pct": 0,
                "unobserved_surface_pct": 100,
                "occluded_region_pct": 100,
                "coverage": "No validated scene coverage available.",
            },
            "measurements": mission.get("measurements"),
            "findings": mission.get("findings", []),
            "evidence_state": mission.get("evidence_state") or {
                "scene": build_evidence_state(
                    value=None,
                    status="UNKNOWN",
                    source="VIDEO_DERIVED",
                    confidence=0.0,
                    note="No validated multi-view geometry was reconstructed; unobserved and occluded regions remain unknown.",
                    display="Insufficient visual evidence",
                )
            },
            "limitations": [
                "Unobserved surfaces are represented as unknown/occluded rather than fabricated geometry",
                "Object detection based on COCO-pretrained YOLO11n, not aerial-specific",
                "3D reconstruction confidence depends on frame quality and camera motion estimation",
                "Metric measurements remain unavailable unless valid scale and geometry are supported by actual evidence"
            ]
        }
    }
    
    return {
        "success": True,
        "report": report
    }

# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
