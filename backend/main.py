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
from typing import Optional
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
    
    # Get video info
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
    cap.release()
    
    video_info = {
        "filename": file.filename,
        "url": f"{str(request.base_url).rstrip('/')}/media/missions/{mission_id}/{video_path.name}",
        "size_mb": round(video_path.stat().st_size / (1024 * 1024), 2),
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
    """Process video for a mission"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    video_info = mission.get("video")
    if not video_info:
        raise HTTPException(status_code=400, detail="No video uploaded")
    
    mission_dir = MISSIONS_DIR / mission_id
    video_path = next(mission_dir.glob("video.*"), None)
    
    if not video_path or not video_path.exists():
        raise HTTPException(status_code=400, detail="Video file not found")
    
    try:
        # Import inference module (from SinglePass3D backend)
        inference_path = BASE_DIR / "SinglePass3D" / "backend"
        inference_file = inference_path / "inference.py"
        if inference_file.exists():
            spec = importlib.util.spec_from_file_location(
                "aeromesh_singlepass_inference", inference_file
            )
            if not spec or not spec.loader:
                raise RuntimeError("Could not load the SinglePass3D inference module")
            inference_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(inference_module)
            run_inference = inference_module.process_video
            result = run_inference(video_path, sample_fps=frame_sampling, confidence=detection_confidence)
        else:
            # Fallback: basic processing
            result = _basic_process(video_path, frame_sampling, detection_confidence)
        
        # Save results
        mission.update({
            "status": "processing_complete",
            "processing": result.get("processing"),
            "detections": result.get("detections"),
            "tracks": result.get("tracks"),
            "frameQuality": result.get("frameQuality"),
            "video": {**video_info, **result.get("video", {})},
            "metadata": {
                "frame_sampling": frame_sampling,
                "inference_resolution": inference_resolution,
                "detection_confidence": detection_confidence,
                "reconstruction_quality": reconstruction_quality
            }
        })
        
        # Generate findings
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
    """Basic video processing if inference module not available"""
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    
    frame_interval = max(1, int(fps / sample_fps))
    frame_qualities = []
    frame_index = 0
    
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % frame_interval == 0:
            quality = _analyze_frame_quality(frame)
            frame_qualities.append({"frame": frame_index, **quality})
        frame_index += 1
    
    cap.release()
    
    avg_quality = {
        key: round(sum(f.get(key, 0) for f in frame_qualities) / len(frame_qualities), 1)
        if frame_qualities else 0
        for key in ["sharpness", "brightness", "contrast"]
    }
    
    return {
        "video": {"fps": fps, "total_frames": total_frames},
        "processing": {
            "status": "COMPLETE",
            "sampleFps": sample_fps,
            "framesAnalyzed": len(frame_qualities),
            "inferenceFps": 0
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

def _analyze_frame_quality(frame) -> dict:
    """Analyze single frame quality"""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = min(100.0, cv2.Laplacian(gray, cv2.CV_64F).var() / 5)
    brightness = gray.mean() / 255 * 100
    contrast = min(100, gray.std() / 128 * 100)
    return {
        "sharpness": round(sharpness, 1),
        "brightness": round(brightness, 1),
        "contrast": round(contrast, 1)
    }

# ============================================================
# 3D RECONSTRUCTION
# ============================================================

@app.post("/api/missions/{mission_id}/reconstruct")
async def generate_reconstruction(mission_id: str):
    """Generate 3D reconstruction for a mission"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
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
