"""
AeroMesh Single-Pass Reconstruction Backend
Handles mission management, video processing, and 3D reconstruction
"""

import json
import logging
import os
import shutil
import time
import uuid
import importlib.util
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
import uvicorn
from backend.database import check_database, get_configured_engine, init_database, session_scope
from backend.repository import MissionRepository
from backend.jobs import JOB_STAGES, create_job, get_job, update_job
from backend.storage import get_storage, mission_object_key
from backend.tasks import enqueue_processing_job
from pydantic import BaseModel, Field
from backend.scale_calibration import (
    ScaleCalibrationService,
    CalibrationRecord,
    CalibrationMethod,
    ScaleStatus,
)
from backend.measurement_engine import (
    GeometricMeasurementEngine,
    MeasurementStatus,
    DistanceMeasurement,
    PolygonMeasurement,
    ElevationMeasurement,
    ObjectDimensionsMeasurement,
    VolumeMeasurement,
)

scale_calibration_service = ScaleCalibrationService()

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

try:
    from backend.reconstruction import (
        get_reconstruction_pointcloud_path,
        get_reconstruction_mesh_path,
        get_reconstruction_metadata,
        run_reconstruction_for_mission,
    )
except Exception:  # pragma: no cover
    def run_reconstruction_for_mission(*args, **kwargs):
        return {
            "success": False,
            "status": "FAILED",
            "reason": "pycolmap reconstruction module unavailable",
            "point_count": 0,
            "processing_time_s": 0.0,
            "output_path": None,
        }
    def get_reconstruction_pointcloud_path(*args, **kwargs):
        return None
    def get_reconstruction_mesh_path(*args, **kwargs):
        return None
    def get_reconstruction_metadata(*args, **kwargs):
        return None

try:
    from backend.damage_detection import analyze_damage_for_mission, detect_entry_exit_points
except Exception:  # pragma: no cover
    def analyze_damage_for_mission(*args, **kwargs):
        return {
            "available": False,
            "status": "UNKNOWN",
            "reason": "damage detection module unavailable",
            "findings": [],
            "processing_time_s": 0.0,
            "method": "roboflow",
        }
    def detect_entry_exit_points(*args, **kwargs):
        return {
            "available": False,
            "status": "UNKNOWN",
            "points": [],
            "method": "opencv_heuristic",
        }

# ============================================================
# CONFIG
# ============================================================

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
if load_dotenv:
    load_dotenv(BASE_DIR / ".env")

DATA_DIR.mkdir(parents=True, exist_ok=True)
MISSIONS_DIR.mkdir(parents=True, exist_ok=True)

configured_engine = get_configured_engine()
if configured_engine is not None:
    try:
        init_database(configured_engine)
        logger.info("Database storage enabled")
    except Exception as exc:
        logger.warning("Database unavailable; JSON storage fallback remains active: %s", exc)

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
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1):(517[3-9]|4173)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/media", StaticFiles(directory=str(DATA_DIR)), name="mission-media")

# ============================================================
# MODELS
# ============================================================

# VisDrone class remapping: map fine-tuned model classes to scene_analysis categories
VISDRONE_CLASS_REMAPPING = {
    # Pedestrian classes -> people
    "pedestrian": "person",
    "people": "person",
    # Vehicle classes -> vehicles
    "bicycle": "bicycle",
    "car": "car",
    "van": "van",
    "truck": "truck",
    "tricycle": "tricycle",
    "awning-tricycle": "tricycle",
    "bus": "bus",
    "motor": "motorcycle",
}

# Per-class confidence thresholds (model-specific tuning)
# Aeromesh model is weak on car & bicycle (mAP50 < 10%), strong on van/bus/tricycle
PER_CLASS_CONFIDENCE_THRESHOLDS = {
    "car": 0.50,        # Weak performer - higher threshold
    "bicycle": 0.50,    # Weak performer - higher threshold
    "van": 0.25,        # Strong performer - lower threshold
    "bus": 0.25,        # Strong performer - lower threshold
    "tricycle": 0.25,   # Strong performer - lower threshold
    "truck": 0.35,      # Moderate performer
    "person": 0.35,     # Default
    "motorcycle": 0.35, # Default
}

DEFAULT_CONFIDENCE_THRESHOLD = 0.35


def _load_detection_model(use_aeromesh: bool = True):
    """
    Load the detection model with fallback logic.
    
    Tries to load aeromesh_yolo.pt (fine-tuned on VisDrone dataset).
    Falls back to yolo11n.pt (COCO-pretrained) if aeromesh file is missing.
    
    Args:
        use_aeromesh: If True, prefer aeromesh model; if False, use yolo11n
        
    Returns:
        Tuple of (model, model_name, is_aeromesh_loaded)
    """
    from ultralytics import YOLO
    
    configured_path = os.getenv("YOLO_MODEL_PATH", "").strip()
    aeromesh_path = Path(configured_path) if configured_path else BASE_DIR / "backend" / "models" / "aeromesh_yolo.pt"
    fallback_path = BASE_DIR / "yolo11n.pt"
    
    if use_aeromesh and aeromesh_path.exists():
        try:
            model = YOLO(str(aeromesh_path))
            logger.info("Loaded aeromesh_yolo.pt (VisDrone fine-tuned model)")
            return model, "aeromesh_yolo", True
        except Exception as exc:
            logger.warning("Failed to load aeromesh_yolo.pt, falling back to yolo11n.pt: %s", exc)
    elif use_aeromesh and not aeromesh_path.exists():
        logger.warning("aeromesh_yolo.pt not found at %s; falling back to yolo11n.pt", aeromesh_path)
    
    if fallback_path.exists():
        try:
            model = YOLO(str(fallback_path))
            logger.info("Loaded yolo11n.pt (COCO-pretrained fallback)")
            return model, "yolo11n", False
        except Exception as exc:
            logger.error("Failed to load fallback model yolo11n.pt: %s", exc)
            raise
    
    raise FileNotFoundError(f"MODEL_NOT_FOUND: No detection model found at {aeromesh_path} or {fallback_path}. Set YOLO_MODEL_PATH to an authorized local model file.")


def _get_confidence_threshold(class_name: str, is_aeromesh: bool = True) -> float:
    """
    Get per-class confidence threshold.
    
    When using aeromesh model, applies class-specific thresholds based on model performance.
    Otherwise uses default threshold.
    
    Args:
        class_name: YOLO class name (e.g., "person", "car")
        is_aeromesh: Whether using aeromesh model (VisDrone fine-tuned)
        
    Returns:
        Confidence threshold for this class
    """
    if not is_aeromesh:
        return DEFAULT_CONFIDENCE_THRESHOLD
    
    # Remap VisDrone class if needed
    remapped = VISDRONE_CLASS_REMAPPING.get(class_name, class_name)
    return PER_CLASS_CONFIDENCE_THRESHOLDS.get(remapped, DEFAULT_CONFIDENCE_THRESHOLD)


def _remap_visdrone_class(class_name: str) -> str:
    """
    Remap VisDrone class names to standard scene_analysis categories.
    
    Maps fine-tuned model classes to scene_analysis categories:
    - people category: person
    - vehicles category: car, van, truck, bus, bicycle, motorcycle, tricycle
    - structures/hazards: (unchanged from detection model)
    
    Args:
        class_name: Original class name from model
        
    Returns:
        Remapped class name for scene analysis
    """
    return VISDRONE_CLASS_REMAPPING.get(class_name, class_name)


class MissionData:
    """Mission service facade with database-first and JSON fallback storage."""
    def __init__(self, mission_id: str):
        self.mission_id = mission_id
        self.data = {}
        self.load()
    
    def load(self):
        database_engine = get_configured_engine()
        if database_engine is not None:
            try:
                with session_scope(database_engine) as session:
                    database_payload = MissionRepository(session).get(self.mission_id)
                if database_payload is not None:
                    self.data = database_payload
                    return
            except Exception as exc:
                logger.warning("Database read unavailable; using JSON fallback: %s", exc)
        mission_file = MISSIONS_DIR / f"{self.mission_id}.json"
        if mission_file.exists():
            with open(mission_file) as f:
                self.data = json.load(f)
    
    def save(self):
        database_engine = get_configured_engine()
        if database_engine is not None:
            try:
                with session_scope(database_engine) as session:
                    repository = MissionRepository(session)
                    if repository.get(self.mission_id) is None:
                        repository.create(self.data)
                    else:
                        repository.update(self.mission_id, self.data)
                return
            except Exception as exc:
                logger.warning("Database write unavailable; using JSON fallback: %s", exc)
        mission_file = MISSIONS_DIR / f"{self.mission_id}.json"
        with open(mission_file, 'w') as f:
            json.dump(self.data, f, indent=2)
    
    def update(self, updates: dict):
        self.data.update(updates)
        self.save()
    
    def get(self, key: str, default=None):
        return self.data.get(key, default)

# ============================================================
# HEALTH & STATUS
# ============================================================

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

EVIDENCE_STATES = {"OBSERVED", "TRACKED", "RECONSTRUCTED", "PARTIAL", "POSSIBLE", "OCCLUDED", "UNKNOWN", "UNAVAILABLE"}


def build_provenance_entry(
    value: Optional[object],
    source: str = "UNKNOWN",
    confidence: float = 0.0,
    timestamp: Optional[str] = None,
    status: str = "UNKNOWN",
    display: Optional[str] = None,
) -> dict:
    """Create a provenance record with explicit evidence state."""
    normalized_source = source if source in PROVENANCE_SOURCES else "UNKNOWN"
    display_text = display or (
        "Insufficient visual evidence"
        if value is None
        else "Validated from available evidence"
    )
    if value is None or value == "" or (isinstance(value, (float, int)) and not np.isfinite(float(value))):
        return {
            "value": None,
            "source": normalized_source,
            "confidence": float(confidence or 0.0),
            "timestamp": timestamp,
            "status": status if status in EVIDENCE_STATES else "UNKNOWN",
            "display": display_text,
        }
    return {
        "value": value,
        "source": normalized_source,
        "confidence": float(confidence or 0.0),
        "timestamp": timestamp,
        "status": status if status in EVIDENCE_STATES else "UNKNOWN",
        "display": display_text,
    }


def build_evidence_state(
    value: object,
    status: str = "UNKNOWN",
    source: str = "UNKNOWN",
    confidence: float = 0.0,
    frame_id: Optional[int] = None,
    timestamp: Optional[str] = None,
    note: Optional[str] = None,
    display: Optional[str] = None,
) -> dict:
    """Represent a value with explicit visibility and evidence state."""
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


def get_detector_metadata(is_aeromesh: bool = True) -> dict:
    """
    Describe the detector currently in use and its evidence limitations.
    
    Args:
        is_aeromesh: If True, returns metadata for aeromesh model; else returns YOLO11n metadata
        
    Returns:
        Model metadata dictionary with performance characteristics
    """
    if is_aeromesh:
        return {
            "model": "aeromesh_yolo",
            "dataset": "VisDrone (fine-tuned on aerial drone footage)",
            "domain": "Aerial / drone-based detection",
            "confidence_threshold": 0.35,  # Default; per-class thresholds vary
            "per_class_thresholds": {
                "car": 0.50,        # Weak performer (mAP50 < 10%)
                "bicycle": 0.50,    # Weak performer (mAP50 < 10%)
                "van": 0.25,        # Strong performer
                "bus": 0.25,        # Strong performer
                "tricycle": 0.25,   # Strong performer
                "truck": 0.35,
                "person": 0.35,
                "motorcycle": 0.35,
            },
            "input_resolution": 640,
            "suitability": "Aerial-specialized detector trained on VisDrone dataset; per-class performance variance requires individual thresholds.",
            "known_weaknesses": ["car detection (mAP50 < 10%)", "bicycle detection (mAP50 < 10%)"],
            "known_strengths": ["van detection", "bus detection", "tricycle detection"],
            "status": "AVAILABLE",
            "source": "MODEL_METADATA",
        }
    else:
        return {
            "model": "YOLO11n",
            "dataset": "COCO (general-purpose)",
            "domain": "General / aerial-use requires validation",
            "confidence_threshold": 0.35,
            "input_resolution": 640,
            "suitability": "General-purpose detector; results must be temporal-confirmed before being treated as confirmed objects.",
            "status": "AVAILABLE",
            "source": "MODEL_METADATA",
        }



def _safe_count(value: object, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, str):
        s = value.strip().lower()
        if s in {"unknown", "nan", "n/a", "null", ""}:
            return default
    try:
        numeric = float(value)
        if not np.isfinite(numeric):
            return default
        return int(numeric)
    except (TypeError, ValueError):
        return default


def _safe_label(value: object, default: str = "UNKNOWN") -> str:
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
    """Build a canonical, evidence-derived scene summary."""
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
    vehicles = _safe_count(sum(1 for item in confirmed if item["class"] in {"car", "van", "truck", "bus", "motorcycle", "bicycle", "tricycle", "vehicle"}) + sum(1 for item in possible if item["class"] in {"car", "van", "truck", "bus", "motorcycle", "bicycle", "tricycle", "vehicle"}))
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
    database_engine = get_configured_engine()
    database_configured = database_engine is not None
    database_ready = check_database(database_engine) if database_configured else False
    return {
        "status": "healthy",
        "backend": "ready",
        "processing_engine": "ready",
        "reconstruction_engine": "ready",
        "database": "ready" if database_ready else ("configured_unavailable" if database_configured else "json_fallback"),
    }


@app.get("/api/missions/{mission_id}/status")
async def get_mission_status(mission_id: str):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    stage = mission.data.get("status") or "created"
    return {
        "success": True,
        "mission_id": mission_id,
        "status": stage,
        "stages": [
            "UPLOADED",
            "ANALYZING_VIDEO",
            "EXTRACTING_FRAMES",
            "DETECTING_OBJECTS",
            "TRACKING_OBJECTS",
            "ESTIMATING_CAMERA",
            "RECONSTRUCTING",
            "BUILDING_SCENE",
            "BUILDING_GEOSPATIAL",
            "COMPLETE",
            "PARTIAL",
            "FAILED",
        ],
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
    database_engine = get_configured_engine()
    if database_engine is not None and check_database(database_engine):
        with session_scope(database_engine) as session:
            return {
                "success": True,
                "missions": MissionRepository(session).list(),
            }
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
    
    storage = get_storage(DATA_DIR / "objects")
    storage_key = mission_object_key(mission_id, file.filename)
    storage_metadata = storage.upload(
        storage_key,
        file.file,
        file.filename,
        file.content_type,
    )

    # Get video info from a temporary local representation only when the local
    # fallback is active; processing resolves the storage object on demand.
    video_path = DATA_DIR / "objects" / storage_key
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
    cap.release()
    
    video_info = {
        "filename": file.filename,
        "url": f"{str(request.base_url).rstrip('/')}/api/storage/{storage_key}",
        "storage_key": storage_metadata.key,
        "content_type": storage_metadata.content_type,
        "size_bytes": storage_metadata.size,
        "sha256": storage_metadata.checksum,
        "size_mb": round(storage_metadata.size / (1024 * 1024), 2),
        "fps": round(fps, 2),
        "total_frames": total_frames,
        "duration_seconds": round(total_frames / fps, 2) if fps > 0 else 0,
        "resolution": {"width": width, "height": height},
        "codec": "detected"
    }
    
    mission.update({
        "status": "video_uploaded",
        "video": video_info
    })
    database_engine = get_configured_engine()
    if database_engine is not None and check_database(database_engine):
        with session_scope(database_engine) as session:
            MissionRepository(session).record_video(mission_id, video_info)
    
    return {
        "success": True,
        "video": video_info,
        "next_step": "configure_processing"
    }


@app.get("/api/storage/{storage_key:path}")
async def download_storage_object(storage_key: str):
    """Download an object through the configured local or S3 storage adapter."""
    storage = get_storage(DATA_DIR / "objects")
    if not storage.exists(storage_key):
        raise HTTPException(status_code=404, detail="Storage object not found")
    content_type = "application/octet-stream"
    if hasattr(storage, "download"):
        body = storage.download(storage_key)
        return Response(content=body, media_type=content_type)


@app.post("/api/jobs")
async def create_processing_job(
    mission_id: str = Query(...),
    frame_sampling: int = Query(2),
    inference_resolution: int = Query(640),
    detection_confidence: float = Query(0.35),
    reconstruction_quality: str = Query("medium"),
):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    job = create_job(mission_id, {
        "frame_sampling": frame_sampling,
        "inference_resolution": inference_resolution,
        "detection_confidence": detection_confidence,
        "reconstruction_quality": reconstruction_quality,
    })
    mission.update({"processing_job_id": job["id"]})
    enqueue_processing_job(job["id"])
    job = get_job(job["id"]) or job
    return {"success": True, "job": job}


@app.get("/api/jobs/{job_id}")
async def get_processing_job(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Processing job not found")
    return {"success": True, "job": job, "stages": list(JOB_STAGES)}


@app.get("/api/missions/{mission_id}/processing-status")
async def get_processing_status(mission_id: str):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    job_id = mission.get("processing_job_id")
    job = get_job(str(job_id)) if job_id else None
    return {"success": True, "mission_id": mission_id, "job": job, "stages": list(JOB_STAGES)}

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
    """Process uploaded video using real metadata and evidence-first analysis."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    video_info = mission.get("video")
    if not video_info:
        raise HTTPException(status_code=400, detail="No video uploaded")

    job = create_job(mission_id, {
        "frame_sampling": frame_sampling,
        "inference_resolution": inference_resolution,
        "detection_confidence": detection_confidence,
        "reconstruction_quality": reconstruction_quality,
    })
    mission.update({"processing_job_id": job["id"]})
    update_job(job["id"], status="VALIDATING", stage="VALIDATING", progress_percent=5, message="Validating uploaded video")

    mission_dir = MISSIONS_DIR / mission_id
    storage_key = video_info.get("storage_key")
    storage = get_storage(DATA_DIR / "objects")
    storage_root = getattr(storage, "root", None)
    stored_path = storage_root / storage_key if storage_key and storage_root else None
    if storage_key and (stored_path is None or not stored_path.exists()):
        materialized_path = DATA_DIR / "processing" / mission_id / Path(video_info.get("filename", "video.mp4")).name
        materialized_path.parent.mkdir(parents=True, exist_ok=True)
        materialized_path.write_bytes(storage.download(storage_key))
        stored_path = materialized_path
    video_path = stored_path if stored_path and stored_path.exists() else next(mission_dir.glob("video.*"), None)
    if not video_path or not video_path.exists():
        raise HTTPException(status_code=400, detail="Video file not found")

    try:
        update_job(job["id"], status="EXTRACTING_FRAMES", stage="EXTRACTING_FRAMES", progress_percent=15, message="Analyzing video frames")
        real_summary = summarize_uploaded_video(video_path)
        result = _basic_process(video_path, frame_sampling, detection_confidence)
        result["video"] = {**video_info, **result.get("video", {}), **real_summary}
        result["processing"]["status"] = "COMPLETE"
        result["processing"]["warning"] = "YOLO model not available or no valid detections were confirmed from the uploaded video."

        # Load aeromesh model with fallback to yolo11n
        try:
            model, model_name, is_aeromesh = _load_detection_model(use_aeromesh=True)
            result = _run_yolo_detection(video_path, model, sample_fps=frame_sampling, confidence=detection_confidence, is_aeromesh=is_aeromesh)
            result["video"] = {**video_info, **result.get("video", {}), **real_summary}
            result["processing"]["status"] = "COMPLETE"
            result["processing"]["warning"] = "" if result.get("detections", {}).get("uniqueTracks", 0) else "No confident detections were observed in the uploaded video."
        except Exception as exc:
            logger.warning("Detection model inference unavailable: %s", exc)
            result["processing"]["status"] = "PARTIAL"
            result["processing"]["error_code"] = "MODEL_NOT_FOUND" if "MODEL_NOT_FOUND" in str(exc) or isinstance(exc, FileNotFoundError) else "DETECTION_FAILED"
            result["processing"]["warning"] = f"{result['processing']['error_code']}: object counts remain unconfirmed."
            result["detector"] = {"available": False, "error_code": result["processing"]["error_code"], "error": str(exc)}

        scene_analysis = result.get("scene_analysis") or build_scene_analysis(result.get("detections"), result.get("tracks"))

        damage_result = analyze_damage_for_mission(video_path, mission_id, max_frames=20)
        entry_exit_result = detect_entry_exit_points(video_path, mission_id, max_frames=12)
        reconstruction_result = run_reconstruction_for_mission(mission_id, video_path, max_frames=60)

        if damage_result.get("available"):
            damage_findings = damage_result.get("findings", [])
            if isinstance(damage_findings, list) and damage_findings:
                existing_findings = list(mission.get("findings") or [])
                existing_findings.extend(damage_findings)
                mission.update({"findings": existing_findings})
                scene_analysis.setdefault("per_object_evidence", []).extend([
                    {
                        "track_id": f"damage-{idx}",
                        "class": item.get("category", "damage"),
                        "status": item.get("status"),
                        "confidence": item.get("confidence", 0.0),
                        "source": "ROBOFLOW_DERIVED",
                    }
                    for idx, item in enumerate(damage_findings)
                ])

        if entry_exit_result.get("available"):
            mission.update({
                "entry_exit_points": entry_exit_result.get("points", []),
                "entry_exit_detection": {
                    "status": entry_exit_result.get("status", "UNKNOWN"),
                    "method": entry_exit_result.get("method", "opencv_heuristic"),
                    "points": entry_exit_result.get("points", []),
                }
            })

        mission.update({
            "status": "processing_complete",
            "processing": result.get("processing"),
            "detections": result.get("detections"),
            "tracks": result.get("tracks"),
            "frameQuality": result.get("frameQuality"),
            "detector": result.get("detector") or get_detector_metadata(is_aeromesh=True),
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
            "video": {**video_info, **result.get("video", {})},
            "metadata": {
                "frame_sampling": frame_sampling,
                "inference_resolution": inference_resolution,
                "detection_confidence": detection_confidence,
                "reconstruction_quality": reconstruction_quality,
                "video_summary": real_summary,
                "damage_detection": damage_result,
                "entry_exit_detection": entry_exit_result,
                "reconstruction": reconstruction_result,
            },
            "provenance": {
                "processing": build_provenance_entry(result.get("processing", {}).get("framesAnalyzed"), "VIDEO_DERIVED", 0.8, "processing", "AVAILABLE", "Frames sampled from uploaded video"),
                "detections": build_provenance_entry(result.get("detections", {}).get("uniqueTracks"), "DETECTION_DERIVED", 0.0 if not result.get("detections", {}).get("uniqueTracks") else 0.8, "processing", "AVAILABLE" if result.get("detections", {}).get("uniqueTracks") else "UNKNOWN", "Object detections observed from frame evidence"),
                "reconstruction": build_provenance_entry(reconstruction_result.get("point_count"), "RECONSTRUCTION_DERIVED", 0.0 if not reconstruction_result.get("point_count") else 0.6, "processing", "AVAILABLE" if reconstruction_result.get("point_count") else "UNKNOWN", "Reconstruction output from pycolmap extraction and model fitting"),
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
                ),
                "reconstruction": build_evidence_state(
                    value=reconstruction_result.get("point_count"),
                    status=reconstruction_result.get("status", "UNKNOWN"),
                    source="RECONSTRUCTION_DERIVED",
                    confidence=0.0 if not reconstruction_result.get("point_count") else 0.6,
                    note=reconstruction_result.get("error") or "pycolmap reconstruction output was generated from sampled frames.",
                    display="Reconstruction unavailable" if not reconstruction_result.get("point_count") else "Reconstruction point cloud created",
                ),
                "damage": build_evidence_state(
                    value=len(damage_result.get("findings", [])),
                    status=damage_result.get("status", "UNKNOWN"),
                    source="DETECTION_DERIVED" if damage_result.get("available") else "UNKNOWN",
                    confidence=max((item.get("confidence", 0.0) for item in damage_result.get("findings", []) if isinstance(item, dict)), default=0.0),
                    note=damage_result.get("reason") or "Damage detections were generated by the Roboflow model when valid credentials were available.",
                    display="Damage analysis unavailable" if not damage_result.get("available") else "Roboflow damage findings generated",
                ),
            },
            "reconstruction": {
                "status": reconstruction_result.get("status", "UNKNOWN"),
                "point_count": reconstruction_result.get("point_count", 0),
                "success": reconstruction_result.get("success", False),
                "method": reconstruction_result.get("method", "pycolmap"),
                "processing_time_s": reconstruction_result.get("processing_time_s", 0.0),
                "output_path": reconstruction_result.get("output_path"),
                "error": reconstruction_result.get("error"),
            },
            "damage_detection": damage_result,
            "entry_exit_detection": entry_exit_result,
        })

        findings = _generate_findings(result)
        if damage_result.get("findings"):
            findings.extend(damage_result["findings"])
        mission.update({"findings": findings})
        database_engine = get_configured_engine()
        if database_engine is not None and check_database(database_engine):
            with session_scope(database_engine) as session:
                MissionRepository(session).replace_detection_results(
                    mission_id,
                    (result.get("detections") or {}).get("observations", []),
                    result.get("tracks", []),
                )
        update_job(job["id"], status="COMPLETED", stage="COMPLETED", progress_percent=100, message="Processing completed")
        return {
            "success": True,
            "job_id": job["id"],
            "processing": result.get("processing"),
            "detections": result.get("detections"),
            "scene_analysis": scene_analysis,
            "reconstruction": reconstruction_result,
            "damage_detection": damage_result,
            "entry_exit_detection": entry_exit_result,
            "next_step": "3d_reconstruction",
        }

    except Exception as e:
        update_job(job["id"], status="FAILED", stage="FAILED", error_message=str(e), message="Processing failed")
        logger.error(f"Processing failed: {e}")
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")

def _basic_process(video_path: Path, sample_fps: int, confidence: float):
    """Basic evidence-only processing when direct detection is unavailable."""
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
        key: round(sum(f.get(key, 0) for f in frame_qualities) / len(frame_qualities), 1) if frame_qualities else 0
        for key in ("sharpness", "brightness", "contrast")
    }
    scene_analysis = build_scene_analysis({"observations": []}, [])
    return {
        "video": {"fps": float(fps), "total_frames": total_frames},
        "processing": {
            "status": "COMPLETE",
            "sampleFps": sample_fps,
            "framesAnalyzed": len(frame_qualities),
            "inferenceFps": 0,
            "warning": "No confident detections observed in the uploaded video.",
        },
        "detections": {
            "uniqueTracks": 0,
            "byGroup": {},
            "byClass": {},
            "observations": [],
        },
        "tracks": [],
        "frameQuality": {
            "estimated": True,
            "average": avg_quality,
            "samples": frame_qualities,
        },
        "scene_analysis": scene_analysis,
        "visibility": {
            "state": "UNKNOWN",
            "observed_surface_pct": 0,
            "partially_observed_surface_pct": 0,
            "unobserved_surface_pct": 100,
            "occluded_region_pct": 100,
            "coverage": "No validated scene coverage available.",
        },
    }


def summarize_uploaded_video(video_path: Path) -> dict:
    """Read actual metadata and quality from the uploaded video."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    frame_index = 0
    samples = []
    motion_score = 0.0
    previous_frame = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        quality = _frame_quality(frame)
        samples.append({"frame": frame_index, **quality})
        if previous_frame is not None:
            diff = cv2.absdiff(frame, previous_frame)
            motion_score += float(diff.mean())
        previous_frame = frame.copy()
        frame_index += 1

    cap.release()

    duration = round(total_frames / fps, 2) if fps > 0 and total_frames > 0 else 0.0
    average_quality = {
        key: round(sum(item[key] for item in samples) / len(samples), 1) if samples else 0.0
        for key in ("sharpness", "brightness", "contrast")
    }
    valid_frames = len(samples)
    return {
        "frames_total": total_frames,
        "frames_valid": max(1, valid_frames),
        "duration_seconds": duration,
        "resolution": {"width": width, "height": height},
        "fps": round(fps, 2) if fps else 0.0,
        "quality": {"average": average_quality, "keyframes": max(1, valid_frames)},
        "camera_motion": {
            "status": "AVAILABLE" if valid_frames else "UNAVAILABLE",
            "estimated_motion_score": round(motion_score, 2),
            "source": "VIDEO_DERIVED",
            "confidence": 0.0 if not samples else min(0.9, max(0.2, valid_frames / max(total_frames, 1))),
        },
    }


def _run_yolo_detection(video_path: Path, model, sample_fps: int, confidence: float, is_aeromesh: bool = True) -> dict:
    """
    Run real YOLO inference and reduce false positives using temporal persistence.
    
    For aeromesh (VisDrone fine-tuned) model:
    - Applies per-class confidence thresholds (car/bicycle: 0.50, van/bus/tricycle: 0.25)
    - Remaps VisDrone class names to scene_analysis categories
    - Logs model performance characteristics
    
    For YOLO11n (COCO-pretrained) model:
    - Uses default confidence threshold (0.35)
    - Uses standard class names
    
    Evidence-state logic (OBSERVED/TRACKED/PARTIAL/UNKNOWN) is preserved unchanged.
    
    Args:
        video_path: Path to video file
        model: Loaded YOLO model instance
        sample_fps: Frames per second to sample at
        confidence: Base confidence threshold (may be overridden by per-class for aeromesh)
        is_aeromesh: Whether using aeromesh (VisDrone fine-tuned) model vs. YOLO11n
    
    Returns:
        Detection results dict with tracks, detections, scene_analysis, etc.
    """
    from backend.detection import DetectionRecord
    from backend.tracking import UltralyticsTracker

    records = UltralyticsTracker(model).track_video(
        video_path,
        sample_fps=sample_fps,
        confidence=confidence,
        iou=float(os.getenv("YOLO_IOU", "0.7")),
    )
    filtered = []
    for record in records:
        if is_aeromesh and record.confidence < _get_confidence_threshold(record.class_name, True):
            continue
        class_name = _remap_visdrone_class(record.class_name) if is_aeromesh else record.class_name
        filtered.append(DetectionRecord(record.frame_id, class_name, record.confidence, record.bbox, record.timestamp, record.track_id))
    tracks_by_id = {}
    observations = []
    for index, record in enumerate(filtered):
        track_id = record.track_id or f"T{index + 1:04d}"
        track = tracks_by_id.setdefault(track_id, {"trackId": track_id, "class": record.class_name, "firstSeen": int(record.frame_id), "lastSeen": int(record.frame_id), "hits": 0, "confidences": [], "trajectory": []})
        track["lastSeen"] = int(record.frame_id)
        track["hits"] += 1
        track["confidences"].append(record.confidence)
        track["trajectory"].append([(record.bbox[0] + record.bbox[2]) / 2, (record.bbox[1] + record.bbox[3]) / 2])
        observations.append({"frame": int(record.frame_id), "trackId": track_id, "class": record.class_name, "confidence": record.confidence, "boundingBox": record.bbox, "timestamp": record.timestamp})
    all_tracks = []
    for track in tracks_by_id.values():
        track["averageConfidence"] = round(sum(track["confidences"]) / len(track["confidences"]), 3)
        del track["confidences"]
        all_tracks.append(track)
    scene_analysis = build_scene_analysis({"observations": observations}, all_tracks)
    by_class = {}
    for track in all_tracks:
        by_class[track["class"]] = by_class.get(track["class"], 0) + 1
    return {
        "video": {"filename": video_path.name},
        "detector": get_detector_metadata(is_aeromesh=is_aeromesh),
        "processing": {"status": "COMPLETE", "sampleFps": sample_fps, "framesAnalyzed": len({item["frame"] for item in observations}), "inferenceFps": 0, "warning": "" if all_tracks else "No detections met the configured confidence threshold."},
        "detections": {"uniqueTracks": len(all_tracks), "byGroup": {}, "byClass": by_class, "observations": observations, "scene_analysis": scene_analysis},
        "tracks": all_tracks,
        "frameQuality": {"estimated": True, "average": {}, "samples": []},
        "scene_analysis": scene_analysis,
    }

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
    per_class_detections = {}  # Track detections per class for reporting

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
            original_class_name = result.names[int(box.cls[0])]
            conf_value = float(box.conf[0])
            
            # Apply per-class confidence filtering for aeromesh model
            if is_aeromesh:
                per_class_threshold = _get_confidence_threshold(original_class_name, is_aeromesh=True)
                if conf_value < per_class_threshold:
                    # Skip detection if below per-class threshold
                    continue
                # Remap VisDrone class to scene_analysis category
                class_name = _remap_visdrone_class(original_class_name)
                per_class_detections[original_class_name] = per_class_detections.get(original_class_name, 0) + 1
            else:
                class_name = original_class_name
                per_class_detections[class_name] = per_class_detections.get(class_name, 0) + 1
            
            bbox = [round(float(v), 1) for v in box.xyxy[0].tolist()]
            c_x = (bbox[0] + bbox[2]) / 2.0
            c_y = (bbox[1] + bbox[3]) / 2.0
            matched_track_id = None
            best_distance = None
            for track_id, previous in active_tracks.items():
                if previous["class"] != class_name:
                    continue
                prev_box = previous["bbox"]
                prev_cx = (prev_box[0] + prev_box[2]) / 2.0
                prev_cy = (prev_box[1] + prev_box[3]) / 2.0
                distance = abs(c_x - prev_cx) + abs(c_y - prev_cy)
                if best_distance is None or distance < best_distance:
                    best_distance = distance
                    matched_track_id = track_id
            
            if matched_track_id is not None and best_distance is not None and best_distance < 150:
                track = active_tracks[matched_track_id]
                track["lastSeen"] = frame_index
                track["hits"] += 1
                track["bbox"] = bbox
                track["confidenceHistory"] = track.get("confidenceHistory", [track["confidence"]]) + [round(conf_value, 3)]
                track["confidence"] = round(sum(track["confidenceHistory"]) / len(track["confidenceHistory"]), 3)
                track["persistence"] = min(1.0, track["hits"] / max(2, track["hits"]))
                observations.append({"frame": frame_index, "trackId": track["trackId"], "class": class_name, "confidence": track["confidence"], "boundingBox": bbox})
            else:
                track = {
                    "trackId": f"T{len(all_tracks) + 1:04d}",
                    "class": class_name,
                    "bbox": bbox,
                    "confidence": round(conf_value, 3),
                    "firstSeen": frame_index,
                    "lastSeen": frame_index,
                    "hits": 1,
                    "persistence": 0.0,
                    "confidenceHistory": [round(conf_value, 3)],
                }
                all_tracks.append(track)
                active_tracks[track["trackId"]] = track
                observations.append({"frame": frame_index, "trackId": track["trackId"], "class": class_name, "confidence": track["confidence"], "boundingBox": bbox})
        frame_index += 1

    capture.release()
    scene_analysis = build_scene_analysis({"observations": observations}, all_tracks)
    detections = {
        "uniqueTracks": len({t["trackId"] for t in all_tracks}),
        "byGroup": {},
        "byClass": {},
        "observations": observations,
        "scene_analysis": scene_analysis,
        "per_class_detection_summary": per_class_detections,  # Raw detection counts per class
    }
    if all_tracks:
        by_class = {}
        for track in all_tracks:
            by_class[track["class"]] = by_class.get(track["class"], 0) + 1
        detections["byClass"] = by_class

    return {
        "video": {"fps": round(fps, 2) if fps else 0, "total_frames": total_frames, "durationSeconds": round(total_frames / fps, 2) if fps else 0, "resolution": {"width": width, "height": height}},
        "detector": get_detector_metadata(is_aeromesh=is_aeromesh),
        "processing": {
            "status": "COMPLETE",
            "sampleFps": sample_fps,
            "framesAnalyzed": len(frame_qualities),
            "inferenceFps": round(len(frame_qualities) / max(1.0, len(frame_qualities) / 5.0), 2),
            "warning": "" if scene_analysis["total"] else "No detections met the configured confidence threshold.",
        },
        "detections": detections,
        "tracks": all_tracks,
        "frameQuality": {"estimated": True, "average": {key: round(sum(item[key] for item in frame_qualities) / len(frame_qualities), 1) if frame_qualities else 0.0 for key in ("sharpness", "brightness", "contrast")}, "samples": frame_qualities},
        "scene_analysis": scene_analysis,
        "visibility": {
            "state": "PARTIAL" if scene_analysis["total"] else "UNKNOWN",
            "observed_surface_pct": min(100, max(0, len(frame_qualities) * 2)),
            "partially_observed_surface_pct": 0,
            "unobserved_surface_pct": 100,
            "occluded_region_pct": 100,
            "coverage": "Partial evidence only; no validated 3D coverage claim is made.",
        },
    }


# ============================================================
# 3D RECONSTRUCTION
# ============================================================

@app.get("/api/missions/{mission_id}/reconstruction")
async def get_mission_reconstruction(mission_id: str):
    """Return the stored reconstruction metadata for a mission."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    meta = get_reconstruction_metadata(mission_id)
    reconstruction = meta or mission.get("reconstruction") or {
        "status": "UNKNOWN",
        "point_count": 0,
        "success": False,
        "method": "pycolmap",
        "processing_time_s": 0.0,
        "output_path": None,
        "error": "No reconstruction was generated yet.",
    }
    return {"success": bool(reconstruction.get("success")), "reconstruction": reconstruction}


@app.get("/api/model-status")
async def get_model_status():
    from backend.model_registry import ModelRegistry
    return {"success": True, "model": ModelRegistry().metadata()}


def _object_payload(mission_id: str) -> dict:
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    detections = mission.get("detections") or {}
    tracks = mission.get("tracks") or []
    observations = detections.get("observations") if isinstance(detections, dict) else []
    return {"mission_id": mission_id, "detections": observations or [], "tracks": tracks, "summary": {
        "total_unique_objects": len(tracks),
        "counts_by_class": detections.get("byClass", {}) if isinstance(detections, dict) else {},
    }}


@app.get("/api/missions/{mission_id}/detections")
async def get_mission_detections(mission_id: str):
    payload = _object_payload(mission_id)
    return {"success": True, "mission_id": mission_id, "detections": payload["detections"]}


@app.get("/api/missions/{mission_id}/tracks")
async def get_mission_tracks(mission_id: str):
    payload = _object_payload(mission_id)
    return {"success": True, "mission_id": mission_id, "tracks": payload["tracks"]}


@app.get("/api/missions/{mission_id}/objects")
async def get_mission_objects(mission_id: str):
    payload = _object_payload(mission_id)
    return {"success": True, "mission_id": mission_id, "objects": payload["tracks"], "summary": payload["summary"]}


@app.get("/api/missions/{mission_id}/object-summary")
async def get_mission_object_summary(mission_id: str):
    payload = _object_payload(mission_id)
    return {"success": True, "mission_id": mission_id, **payload["summary"]}


@app.get("/api/missions/{mission_id}/semantic-scene")
async def get_mission_semantic_scene(mission_id: str):
    """Return the 3D semantic scene representation with spatial fusion results."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    scene = mission.get("semantic_scene")
    if not scene:
        objects_3d = mission.get("objects_3d") or []
        scene = {
            "coordinate_system": "LOCAL_ARBITRARY",
            "scale_status": "RELATIVE_SCALE",
            "georeferencing_status": "UNREFERENCED",
            "total_objects": len(objects_3d),
            "valid_objects": sum(1 for obj in objects_3d if obj.get("association_status") == "VALID"),
            "moving_objects": sum(1 for obj in objects_3d if obj.get("motion_state") == "MOVING"),
            "static_objects": sum(1 for obj in objects_3d if obj.get("motion_state") == "STATIC"),
            "objects": objects_3d,
        }
    return {"success": True, "mission_id": mission_id, "semantic_scene": scene}


@app.get("/api/missions/{mission_id}/objects-3d")
async def get_mission_objects_3d(mission_id: str):
    """Return the list of 3D objects associated with the reconstructed scene."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    objects_3d = mission.get("objects_3d") or []
    return {
        "success": True,
        "mission_id": mission_id,
        "coordinate_system": "LOCAL_ARBITRARY",
        "scale_status": "RELATIVE_SCALE",
        "georeferencing_status": "UNREFERENCED",
        "total_objects": len(objects_3d),
        "objects": objects_3d,
    }


@app.get("/api/missions/{mission_id}/objects/{object_id}/3d")
async def get_mission_object_3d(mission_id: str, object_id: str):
    """Return 3D spatial fusion details, trajectory, and reprojection evidence for a specific object."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    objects_3d = mission.get("objects_3d") or []
    match = None
    for obj in objects_3d:
        if obj.get("object_id") == object_id or obj.get("track_id") == object_id:
            match = obj
            break

    if not match:
        raise HTTPException(status_code=404, detail=f"3D Object {object_id} not found in mission")

    return {"success": True, "mission_id": mission_id, "object": match}


@app.post("/api/missions/{mission_id}/fuse-3d")
async def fuse_mission_objects_3d(mission_id: str, reprojection_threshold_px: float = 25.0):
    """Trigger AI-to-3D spatial fusion for a mission."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    from backend.jobs import create_job
    from backend.tasks import fuse_objects_3d

    job = create_job(mission_id, parameters={"reprojection_threshold_px": reprojection_threshold_px})
    result = fuse_objects_3d(job["id"], mission_id=mission_id, reprojection_threshold_px=reprojection_threshold_px)
    return {"success": True, "job_id": job["id"], "mission_id": mission_id, "result": result}


@app.get("/api/missions/{mission_id}/reconstruction/pointcloud")
async def get_mission_pointcloud(mission_id: str):
    """Serve the generated PLY point cloud for a mission if it exists."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    pointcloud_path = get_reconstruction_pointcloud_path(mission_id)
    if not pointcloud_path or not pointcloud_path.exists():
        raise HTTPException(status_code=404, detail="Reconstruction point cloud not found")

    return FileResponse(
        path=str(pointcloud_path),
        media_type="application/octet-stream",
        filename=pointcloud_path.name,
    )


@app.get("/api/missions/{mission_id}/reconstruction/mesh")
async def get_mission_mesh(mission_id: str):
    """Serve the generated PLY mesh for a mission if it exists."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    mesh_path = get_reconstruction_mesh_path(mission_id)
    if not mesh_path or not mesh_path.exists():
        raise HTTPException(status_code=404, detail="Reconstruction mesh not found")

    return FileResponse(
        path=str(mesh_path),
        media_type="application/octet-stream",
        filename=mesh_path.name,
    )


@app.post("/api/missions/{mission_id}/reconstruct")
async def generate_reconstruction(mission_id: str):
    """Generate 3D reconstruction for a mission"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    # If real video exists, trigger the authoritative photogrammetric pipeline
    video_path_raw = mission.get("video_path")
    if video_path_raw and Path(video_path_raw).exists():
        recon_res = run_reconstruction_for_mission(mission_id, Path(video_path_raw))
        mission.update({
            "reconstruction": recon_res,
            "status": recon_res.get("status", "COMPLETED"),
        })
        return {
            "success": bool(recon_res.get("success")),
            "reconstruction": recon_res,
        }
    
    detections = mission.get("detections")
    if not detections:
        raise HTTPException(status_code=400, detail="No detections available")
    
    # Generate point cloud from detections
    point_cloud = _generate_point_cloud(mission_id, detections)
    
    reconstruction = {
        "status": "complete",
        "kind": _reconstruction_kind(mission.get("type")),
        "pointCloud": point_cloud,
        **_estimate_reconstruction_metrics(
            mission.get("processing") or {},
            mission.get("frameQuality") or {},
            detections,
        ),
        "uncertainty": {
            "overall": 0.13,
            "byRegion": [
                {"region": "north", "uncertainty": 0.08},
                {"region": "east", "uncertainty": 0.12},
                {"region": "south", "uncertainty": 0.18},
                {"region": "west", "uncertainty": 0.25}
            ]
        }
    }
    
    mission.update({"reconstruction": reconstruction})
    
    return {
        "success": True,
        "reconstruction": reconstruction
    }

def _estimate_reconstruction_metrics(
    processing: dict, frame_quality: dict, detections: dict
) -> dict:
    """Estimate coverage from available evidence, without presenting it as measured geometry."""
    frames_analyzed = max(0, int(processing.get("framesAnalyzed", 0) or 0))
    average = frame_quality.get("average") or {}
    sharpness = max(0.0, min(100.0, float(average.get("sharpness", 0) or 0)))
    unique_tracks = max(0, int(detections.get("uniqueTracks", 0) or 0))
    frame_factor = min(frames_analyzed / 300.0, 1.0)
    track_density = min(unique_tracks / max(frames_analyzed, 1) * 100.0, 100.0)
    observed = round(max(20.0, min(94.0, 24.0 + frame_factor * 38.0 + sharpness * 0.28)))
    partial = round(max(3.0, min(55.0, (100.0 - observed) * 0.62)))
    occluded = round(max(2.0, 100.0 - observed - partial))
    confidence = round(
        max(20.0, min(96.0, 35.0 + sharpness * 0.38 + frame_factor * 22.0 + track_density * 0.15))
    )
    return {
        "observedSurface": observed,
        "partialSurface": partial,
        "occludedSurface": occluded,
        "confidence": confidence,
        "estimated": True,
        "estimateMethod": "Heuristic from analyzed-frame count, average sharpness, and detection density",
    }


def _reconstruction_kind(mission_type: Optional[str]) -> str:
    """Map the operator-selected mission type to a supported procedural scene."""
    normalized = (mission_type or "").lower()
    if "survey" in normalized or "urban" in normalized:
        return "urban"
    if "infrastructure" in normalized or "bridge" in normalized:
        return "bridge"
    if "emergency" in normalized or "river" in normalized or "water" in normalized:
        return "river"
    return "default"


def _generate_point_cloud(mission_id: str, detections: dict) -> dict:
    """Generate basic point cloud from detections"""
    unique_tracks = detections.get("uniqueTracks", 5)
    points_count = min(1000 * unique_tracks, 25000)
    
    return {
        "points_count": points_count,
        "coverage": min(100, max(0, unique_tracks * 4)),
        "density": "medium",
        "color_confidence": 0.78,
        "structure_confidence": 0.82
    }

def _generate_findings(result: dict) -> list:
    """Generate AI findings from processing results"""
    findings = []
    detections = result.get("detections", {})
    by_group = detections.get("byGroup", {})
    tracks = detections.get("tracks", [])

    def group_confidence(group: str) -> int:
        confidences = [
            float(track.get("confidence", 0)) * 100
            for track in tracks
            if (
                group == "people"
                and track.get("class") == "person"
            )
            or (
                group == "vehicles"
                and track.get("class")
                in {"car", "truck", "bus", "motorcycle", "bicycle"}
            )
        ]
        return round(sum(confidences) / len(confidences)) if confidences else 0
    
    if by_group.get("people", 0) > 0:
        findings.append({
            "id": f"f_{uuid.uuid4().hex[:8]}",
            "title": f"People detected ({by_group['people']})",
            "status": "OBSERVED",
            "category": "dynamic",
            "confidence": group_confidence("people"),
            "severity": "info",
            "evidence": f"Tracked {by_group['people']} distinct individuals across frames",
            "location": "Scene",
            "action": "Review detected individuals for operational relevance"
        })
    
    if by_group.get("vehicles", 0) > 0:
        findings.append({
            "id": f"f_{uuid.uuid4().hex[:8]}",
            "title": f"Vehicles detected ({by_group['vehicles']})",
            "status": "OBSERVED",
            "category": "dynamic",
            "confidence": group_confidence("vehicles"),
            "severity": "info",
            "evidence": f"Tracked {by_group['vehicles']} vehicles in scene",
            "location": "Scene",
            "action": "Monitor vehicle movement and trajectories"
        })
    
    return findings

# ============================================================
# PHASE 7: SCALE CALIBRATION & GEOMETRIC MEASUREMENTS
# ============================================================

class ReferenceDistanceCalibrationRequest(BaseModel):
    point_a: list[float]
    point_b: list[float]
    known_distance_meters: float
    source_evidence: str = "Known physical distance"
    confidence: float = 0.95
    uncertainty_meters: float | None = None
    created_by: str = "operator"


class KnownObjectSizeCalibrationRequest(BaseModel):
    object_id: str
    reconstructed_length: float
    known_length_meters: float
    source_evidence: str = "Known object dimension"
    confidence: float = 0.85
    uncertainty_meters: float | None = None
    created_by: str = "operator"


class DistanceMeasurementRequest(BaseModel):
    point_a: list[float]
    point_b: list[float]
    calibration_id: str | None = None
    store: bool = True


class PolygonMeasurementRequest(BaseModel):
    vertices: list[list[float]]
    calibration_id: str | None = None
    store: bool = True


class ElevationMeasurementRequest(BaseModel):
    point_a: list[float]
    point_b: list[float]
    has_verified_gravity: bool = False
    calibration_id: str | None = None
    store: bool = True


class ObjectMeasurementRequest(BaseModel):
    has_verified_gravity: bool = False
    calibration_id: str | None = None
    store: bool = True


class VolumeMeasurementRequest(BaseModel):
    is_watertight: bool = False
    vertices: list[list[float]] | None = None
    faces: list[list[int]] | None = None
    calibration_id: str | None = None
    store: bool = True


@app.get("/api/missions/{mission_id}/calibrations")
async def get_mission_calibrations(mission_id: str):
    """List scale calibrations and current active calibration."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    active_cal = scale_calibration_service.get_active_calibration(mission_id)
    all_cals = scale_calibration_service.list_calibrations(mission_id)

    return {
        "success": True,
        "mission_id": mission_id,
        "scale_status": ScaleStatus.METRIC_CALIBRATED.value if active_cal else ScaleStatus.RELATIVE_SCALE.value,
        "coordinate_system": "LOCAL_ARBITRARY",
        "georeferencing_status": "UNREFERENCED",
        "active_calibration": active_cal.to_dict() if active_cal else None,
        "calibrations": [c.to_dict() for c in all_cals],
    }


@app.post("/api/missions/{mission_id}/calibrations/reference-distance")
async def calibrate_by_reference_distance(mission_id: str, req: ReferenceDistanceCalibrationRequest):
    """Calibrate photogrammetric scale using two known 3D points and a known physical distance."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    try:
        record = scale_calibration_service.calibrate_by_reference_distance(
            mission_id=mission_id,
            point_a=req.point_a,
            point_b=req.point_b,
            known_distance_meters=req.known_distance_meters,
            source_evidence=req.source_evidence,
            confidence=req.confidence,
            created_by=req.created_by,
            uncertainty_meters=req.uncertainty_meters,
        )
        cals = mission.get("calibrations") or []
        cals.append(record.to_dict())
        mission.update({"calibrations": cals, "active_calibration": record.to_dict()})

        return {"success": True, "calibration": record.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/missions/{mission_id}/calibrations/object-size")
async def calibrate_by_object_size(mission_id: str, req: KnownObjectSizeCalibrationRequest):
    """Calibrate photogrammetric scale using a known physical object dimension."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    try:
        record = scale_calibration_service.calibrate_by_known_object_size(
            mission_id=mission_id,
            object_id=req.object_id,
            reconstructed_length=req.reconstructed_length,
            known_length_meters=req.known_length_meters,
            source_evidence=req.source_evidence,
            confidence=req.confidence,
            created_by=req.created_by,
            uncertainty_meters=req.uncertainty_meters,
        )
        cals = mission.get("calibrations") or []
        cals.append(record.to_dict())
        mission.update({"calibrations": cals, "active_calibration": record.to_dict()})

        return {"success": True, "calibration": record.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/missions/{mission_id}/calibrations/{calibration_id}/activate")
async def activate_calibration(mission_id: str, calibration_id: str):
    """Activate a specific calibration record."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    record = scale_calibration_service.activate_calibration(mission_id, calibration_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Calibration {calibration_id} not found")

    mission.update({"active_calibration": record.to_dict()})
    return {"success": True, "calibration": record.to_dict()}


@app.post("/api/missions/{mission_id}/calibrations/deactivate")
async def deactivate_calibrations(mission_id: str):
    """Deactivate all calibrations, returning scene to uncalibrated relative scale."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    scale_calibration_service.deactivate_all(mission_id)
    mission.update({"active_calibration": None})
    return {"success": True, "scale_status": ScaleStatus.RELATIVE_SCALE.value}


@app.delete("/api/missions/{mission_id}/calibrations/{calibration_id}")
async def delete_calibration(mission_id: str, calibration_id: str):
    """Delete a calibration record."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    deleted = scale_calibration_service.delete_calibration(mission_id, calibration_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Calibration {calibration_id} not found")

    active = scale_calibration_service.get_active_calibration(mission_id)
    mission.update({"active_calibration": active.to_dict() if active else None})
    return {"success": True, "deleted": calibration_id}


@app.get("/api/missions/{mission_id}/measurements")
async def get_measurements(mission_id: str):
    """Get measurements for a mission with scale and calibration status transparency."""
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

    active_cal = scale_calibration_service.get_active_calibration(mission_id)
    items = mission.get("measurement_items") or []

    return {
        "success": True,
        "measurements": measurements,
        "scale_status": ScaleStatus.METRIC_CALIBRATED.value if active_cal else ScaleStatus.RELATIVE_SCALE.value,
        "metric_available": bool(active_cal is not None),
        "coordinate_system": "LOCAL_ARBITRARY",
        "georeferencing_status": "UNREFERENCED",
        "active_calibration": active_cal.to_dict() if active_cal else None,
        "items": items,
    }


@app.post("/api/missions/{mission_id}/measurements")
async def create_measurement(
    mission_id: str,
    measurement_type: str = Query(...),
    value: float = Query(...),
    confidence: float = Query(85.0)
):
    """Create a measurement for a mission (legacy compatibility)."""
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


@app.post("/api/missions/{mission_id}/measurements/distance")
async def measure_distance_3d(mission_id: str, req: DistanceMeasurementRequest):
    """Compute 3D Euclidean distance between two points."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    cal = None
    if req.calibration_id:
        for c in scale_calibration_service.list_calibrations(mission_id):
            if c.calibration_id == req.calibration_id:
                cal = c
                break
    else:
        cal = scale_calibration_service.get_active_calibration(mission_id)

    res = GeometricMeasurementEngine.distance_3d(req.point_a, req.point_b, calibration=cal)
    res_dict = res.to_dict()

    if req.store:
        items = mission.get("measurement_items") or []
        items.append({"type": "distance", **res_dict})
        meas = mission.get("measurements") or {}
        meas["distance"] = f"{res.value} {res.unit}"
        mission.update({"measurement_items": items, "measurements": meas})

    return {"success": True, "measurement": res_dict}


@app.post("/api/missions/{mission_id}/measurements/polygon")
async def measure_polygon(mission_id: str, req: PolygonMeasurementRequest):
    """Compute 3D planar polygon area and perimeter using Stokes' theorem / Newell's method."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    cal = scale_calibration_service.get_active_calibration(mission_id)
    try:
        res = GeometricMeasurementEngine.measure_polygon(req.vertices, calibration=cal)
        res_dict = res.to_dict()

        if req.store:
            items = mission.get("measurement_items") or []
            items.append({"type": "polygon", **res_dict})
            meas = mission.get("measurements") or {}
            meas["area"] = f"{res.area} {res.unit_area}"
            mission.update({"measurement_items": items, "measurements": meas})

        return {"success": True, "measurement": res_dict}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/missions/{mission_id}/measurements/elevation")
async def measure_elevation(mission_id: str, req: ElevationMeasurementRequest):
    """Compute vertical difference and slope angle between two points."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    cal = scale_calibration_service.get_active_calibration(mission_id)
    res = GeometricMeasurementEngine.measure_elevation(
        req.point_a,
        req.point_b,
        calibration=cal,
        has_verified_gravity=req.has_verified_gravity,
    )
    res_dict = res.to_dict()

    if req.store:
        items = mission.get("measurement_items") or []
        items.append({"type": "elevation", **res_dict})
        meas = mission.get("measurements") or {}
        meas["height"] = f"{res.vertical_difference} {res.unit}"
        mission.update({"measurement_items": items, "measurements": meas})

    return {"success": True, "measurement": res_dict}


@app.post("/api/missions/{mission_id}/measurements/object/{object_id}")
async def measure_object_dimensions(mission_id: str, object_id: str, req: ObjectMeasurementRequest = None):
    """Measure physical dimensions of a 3D fused object with INSUFFICIENT_GEOMETRY guards."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    req = req or ObjectMeasurementRequest()
    cal = scale_calibration_service.get_active_calibration(mission_id)

    # Locate object in mission
    objects_3d = mission.get("objects_3d") or []
    target_obj = None
    for obj in objects_3d:
        if obj.get("object_id") == object_id or obj.get("track_id") == object_id:
            target_obj = obj
            break

    pts = []
    cls_name = "object"
    if target_obj:
        cls_name = target_obj.get("class_name", "object")
        traj = target_obj.get("trajectory_3d") or []
        for t in traj:
            if isinstance(t, dict) and "x" in t and "y" in t and "z" in t:
                pts.append([t["x"], t["y"], t["z"]])
        if not pts and target_obj.get("position_3d"):
            pts.append(target_obj["position_3d"])

    res = GeometricMeasurementEngine.measure_object_dimensions(
        object_id=object_id,
        class_name=cls_name,
        points_3d=pts,
        calibration=cal,
        has_verified_gravity=req.has_verified_gravity,
    )
    res_dict = res.to_dict()

    if req.store:
        items = mission.get("measurement_items") or []
        items.append({"type": "object_dimensions", **res_dict})
        meas = mission.get("measurements") or {}
        if res.length is not None:
            meas["length"] = f"{res.length} {res.unit}"
        if res.width is not None:
            meas["width"] = f"{res.width} {res.unit}"
        if res.height is not None:
            meas["height"] = f"{res.height} {res.unit}"
        if res.footprint_area is not None:
            meas["area"] = f"{res.footprint_area} {res.area_unit}"
        mission.update({"measurement_items": items, "measurements": meas})

    return {"success": True, "measurement": res_dict}


@app.post("/api/missions/{mission_id}/measurements/volume")
async def measure_volume(mission_id: str, req: VolumeMeasurementRequest):
    """Compute 3D volume, requiring verified closed/watertight geometry."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    cal = scale_calibration_service.get_active_calibration(mission_id)
    res = GeometricMeasurementEngine.measure_volume(
        vertices=req.vertices,
        faces=req.faces,
        is_watertight=req.is_watertight,
        calibration=cal,
    )
    res_dict = res.to_dict()

    if req.store:
        items = mission.get("measurement_items") or []
        items.append({"type": "volume", **res_dict})
        mission.update({"measurement_items": items})

    return {"success": True, "measurement": res_dict}

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
            "frameQuality": mission.get("frameQuality"),
            "reconstruction": mission.get("reconstruction"),
            "measurements": mission.get("measurements"),
            "findings": mission.get("findings", []),
            "limitations": [
                "Unobserved surfaces are represented as unknown/occluded rather than fabricated geometry",
                "Object detection based on COCO-pretrained YOLO11n, not aerial-specific",
                "3D reconstruction confidence depends on frame quality and camera motion estimation"
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
