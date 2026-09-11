"""
AeroMesh Seeded Mission Loader & Generator
Provides authoritative seeded mission data for the 4 core demonstration missions:
- north-ridge
- downtown-grid
- harbor-district
- river-approach
"""

from __future__ import annotations

import csv
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"

SCENE_ALIASES = {
    "north-ridge-01": "north-ridge",
    "north-ridge": "north-ridge",
    "downtown-perimeter-grid": "downtown-grid",
    "downtown-grid": "downtown-grid",
    "harbor-coastal-approach": "harbor-district",
    "harbor-district": "harbor-district",
    "river-approach": "river-approach",
}

SEEDED_MISSION_IDS = ["north-ridge", "downtown-grid", "harbor-district", "river-approach"]


def resolve_canonical_mission_id(mission_id: str) -> str:
    cleaned = str(mission_id).lower().strip()
    return SCENE_ALIASES.get(cleaned, cleaned)


def load_csv_fused_objects(mission_id: str) -> List[Dict[str, Any]]:
    """Parse real 3D spatial object data from data_{mission_id}.csv if available."""
    canonical_id = resolve_canonical_mission_id(mission_id)
    csv_paths = [
        DATA_DIR / "objects" / "missions" / canonical_id / "reports" / f"data_{canonical_id}.csv",
        DATA_DIR / "objects" / "missions" / mission_id / "reports" / f"data_{mission_id}.csv",
    ]
    for csv_path in csv_paths:
        if csv_path.exists():
            try:
                objects = []
                with open(csv_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for r in reader:
                        cls_name = r.get("class", "vehicle")
                        objects.append({
                            "object_id": r.get("object_id", ""),
                            "track_id": r.get("track_id", ""),
                            "class": cls_name,
                            "class_name": cls_name,
                            "category": "vehicle" if cls_name in ("car", "van", "truck", "bus", "vehicle") else "general",
                            "motion_state": r.get("motion_state", "STATIC"),
                            "coordinate_system": r.get("coordinate_system", "LOCAL_ARBITRARY"),
                            "position_3d": [
                                float(r.get("pos_x_local", 0.0)),
                                float(r.get("pos_y_local", 0.0)),
                                float(r.get("pos_z_local", 0.0)),
                            ],
                            "association_status": r.get("association_status", "VALID"),
                            "association_confidence": float(r.get("association_confidence", 0.8)),
                            "confidence": float(r.get("association_confidence", 0.8)),
                            "mean_reprojection_error_px": float(r.get("reprojection_error_px", 2.0)),
                            "reprojection_error": float(r.get("reprojection_error_px", 2.0)),
                            "evidence_count": int(r.get("observations_count", 1)),
                            "observations_count": int(r.get("observations_count", 1)),
                            "trajectory_3d": [],
                            "observations": [],
                        })
                if objects:
                    logger.info("Loaded %d real 3D objects from %s", len(objects), csv_path)
                    return objects
            except Exception as exc:
                logger.warning("Failed parsing %s: %s", csv_path, exc)
    return []


def build_semantic_scene_from_objects(objects_3d: List[Dict[str, Any]]) -> Dict[str, Any]:
    valid_objs = [o for o in objects_3d if o.get("association_status") == "VALID"]
    low_objs = [o for o in objects_3d if o.get("association_status") == "LOW_CONFIDENCE"]
    moving_objs = [o for o in valid_objs if o.get("motion_state") == "MOVING"]
    static_objs = [o for o in valid_objs if o.get("motion_state") == "STATIC"]
    return {
        "coordinate_system": "LOCAL_ARBITRARY",
        "scale_status": "RELATIVE_SCALE",
        "georeferencing_status": "UNREFERENCED",
        "total_objects": len(valid_objs),
        "all_candidates_count": len(objects_3d),
        "valid_objects": len(valid_objs),
        "low_confidence_objects": len(low_objs),
        "insufficient_evidence_objects": sum(1 for o in objects_3d if o.get("association_status") == "INSUFFICIENT_EVIDENCE"),
        "moving_objects": len(moving_objs),
        "static_objects": len(static_objs),
        "vehicles": sum(1 for o in valid_objs if o.get("category") == "vehicle"),
        "people": sum(1 for o in valid_objs if o.get("category") == "people"),
        "maritime": sum(1 for o in valid_objs if o.get("category") == "maritime"),
        "aircraft": sum(1 for o in valid_objs if o.get("category") == "aircraft"),
        "objects": objects_3d,
    }


SEEDED_RECONSTRUCTION_PROFILES = {
    "north-ridge": {
        "status": "complete",
        "success": True,
        "sparse_point_count": 5252,
        "point_count": 5252,
        "registered_cameras": 20,
        "total_images": 20,
        "mean_reprojection_error": 1.95,
        "mesh": {"face_count": 25584, "vertex_count": 12925, "format": "ply"},
    },
    "river-approach": {
        "status": "complete",
        "success": True,
        "sparse_point_count": 2612,
        "point_count": 2612,
        "registered_cameras": 18,
        "total_images": 20,
        "mean_reprojection_error": 1.42,
        "mesh": {"face_count": 20092, "vertex_count": 10203, "format": "ply"},
    },
    "downtown-grid": {
        "status": "complete",
        "success": True,
        "sparse_point_count": 4466,
        "point_count": 4466,
        "registered_cameras": 24,
        "total_images": 25,
        "mean_reprojection_error": 1.68,
        "mesh": {"face_count": 22393, "vertex_count": 11351, "format": "ply"},
    },
    "harbor-district": {
        "status": "complete",
        "success": True,
        "sparse_point_count": 2357,
        "point_count": 2357,
        "registered_cameras": 16,
        "total_images": 18,
        "mean_reprojection_error": 1.55,
        "mesh": {"face_count": 19708, "vertex_count": 9945, "format": "ply"},
    },
}


def build_seeded_mission_manifest(mission_id: str) -> Optional[Dict[str, Any]]:
    canonical_id = resolve_canonical_mission_id(mission_id)
    if canonical_id not in SEEDED_MISSION_IDS:
        return None

    # 1. Base UI metadata from seeded_missions_base.json
    base_file = Path(__file__).resolve().parent / "seeded_missions_base.json"
    base_meta = {}
    if base_file.exists():
        try:
            with open(base_file, "r", encoding="utf-8") as f:
                for item in json.load(f):
                    if item.get("id") == canonical_id:
                        base_meta = item
                        break
        except Exception as exc:
            logger.warning("Failed loading seeded_missions_base.json: %s", exc)

    # 2. Real inference results from mission_results.json
    results_file = BASE_DIR / "mission_results.json"
    inf_data = {}
    mr_entry = {}
    if results_file.exists():
        try:
            with open(results_file, "r", encoding="utf-8") as f:
                all_results = json.load(f)
                mr_entry = all_results.get(canonical_id, {})
                inf_data = mr_entry.get("inference", {})
        except Exception as exc:
            logger.warning("Failed loading mission_results.json: %s", exc)

    # 3. Real 3D objects from CSV or scene presets
    objects_3d = load_csv_fused_objects(canonical_id)
    semantic_scene = build_semantic_scene_from_objects(objects_3d) if objects_3d else None

    fps = mr_entry.get("fps") or 25.0
    total_frames = mr_entry.get("total_frames") or base_meta.get("frames", 125)
    duration_s = mr_entry.get("duration_s") or (round(total_frames / fps, 2) if fps else 5.0)

    # Video block
    video_meta = {
        "filename": "flight-video.mp4",
        "fps": round(float(fps), 2),
        "frames": total_frames,
        "total_frames": total_frames,
        "durationSeconds": duration_s,
        "duration_seconds": duration_s,
        "resolution": {"width": 1920, "height": 1080},
        "url": f"/api/missions/{canonical_id}/video",
    }

    # Processing block
    proc_meta = inf_data.get("processing") or {
        "status": "COMPLETE",
        "sampleFps": 2,
        "framesAnalyzed": min(total_frames, 12),
        "inferenceFps": 1.69,
    }

    # Detections & tracks
    det_meta = inf_data.get("detections") or base_meta.get("detections") or {}
    tracks_meta = inf_data.get("tracks") or []
    frame_quality = inf_data.get("frameQuality") or base_meta.get("quality") or {}
    provenance_meta = inf_data.get("provenance") or {}

    # Authoritative, distinct per-mission reconstruction block
    profile = SEEDED_RECONSTRUCTION_PROFILES.get(canonical_id, {})
    recon_meta = dict(base_meta.get("reconstruction") or {})
    recon_meta.update({
        "status": profile.get("status", "complete"),
        "success": profile.get("success", True),
        "sparse_point_count": profile.get("sparse_point_count", 2500),
        "point_count": profile.get("point_count", 2500),
        "registered_cameras": profile.get("registered_cameras", 20),
        "total_images": profile.get("total_images", 20),
        "mean_reprojection_error": profile.get("mean_reprojection_error", 1.5),
        "mesh": profile.get("mesh", {"face_count": 20000, "vertex_count": 10000, "format": "ply"}),
        "point_cloud_url": f"/api/missions/{canonical_id}/reconstruction/pointcloud",
        "mesh_url": f"/api/missions/{canonical_id}/reconstruction/mesh",
    })

    # Objects count summary
    if semantic_scene and semantic_scene.get("valid_objects"):
        objects_summary = {
            "total": semantic_scene["valid_objects"],
            "valid": semantic_scene["valid_objects"],
            "low_confidence": semantic_scene["low_confidence_objects"],
            "all_candidates": semantic_scene["all_candidates_count"],
            "people": semantic_scene["people"],
            "vehicles": semantic_scene["vehicles"],
            "maritime": semantic_scene["maritime"],
            "aircraft": semantic_scene["aircraft"],
            "structures": 0,
            "hazards": 0,
        }
    else:
        objects_summary = base_meta.get("objects") or {
            "total": det_meta.get("uniqueTracks", 0),
            "people": 0,
            "vehicles": det_meta.get("uniqueTracks", 0),
            "structures": 0,
            "hazards": 0,
        }

    manifest = {
        "id": canonical_id,
        "name": base_meta.get("name", canonical_id.replace("-", " ").title()),
        "sector": base_meta.get("sector", "Sector 01"),
        "location": base_meta.get("sector", "Tactical Airspace Grid"),
        "status": "complete",
        "priority": base_meta.get("priority", "high"),
        "type": base_meta.get("type", "Single-pass inspection"),
        "drone": base_meta.get("drone", "AERO-X4"),
        "coverage": base_meta.get("coverage", "1.42 km²"),
        "duration": base_meta.get("duration", "00:05"),
        "durationSeconds": duration_s,
        "frames": total_frames,
        "progress": 100,
        "confidence": base_meta.get("confidence", 85),
        "operator": "AeroMesh Flight Team",
        "created_by": "AeroMesh Flight Team",
        "createdAt": "2026-08-30T05:42:17.317578",
        "video": video_meta,
        "processing": proc_meta,
        "detections": det_meta,
        "tracks": tracks_meta,
        "frameQuality": frame_quality,
        "provenance": provenance_meta,
        "objects": objects_summary,
        "telemetry": base_meta.get("telemetry", {}),
        "quality": base_meta.get("quality", {}),
        "reconstruction": recon_meta,
        "measurements": base_meta.get("measurements", {}),
        "findings": base_meta.get("findings", []),
        "recommendations": base_meta.get("recommendations", []),
        "flightPath": base_meta.get("flightPath", []),
        "assets": {
            "video": f"/api/missions/{canonical_id}/video",
            "pointCloud": f"/api/missions/{canonical_id}/reconstruction/pointcloud",
            "mesh": f"/api/missions/{canonical_id}/reconstruction/mesh",
        },
        "markings": [],
        "metadata": {
            "seeded": True,
            "canonical_id": canonical_id,
            "scene_alias": mission_id,
        },
    }

    if objects_3d:
        manifest["objects_3d"] = objects_3d
    if semantic_scene:
        manifest["semantic_scene"] = semantic_scene

    return manifest


def ensure_seeded_missions(force: bool = False) -> List[str]:
    """Ensure JSON fallback files exist for all seeded missions."""
    MISSIONS_DIR.mkdir(parents=True, exist_ok=True)
    seeded = []

    for mission_id in SEEDED_MISSION_IDS:
        target_json = MISSIONS_DIR / f"{mission_id}.json"
        if not target_json.exists() or force:
            manifest = build_seeded_mission_manifest(mission_id)
            if manifest:
                with open(target_json, "w", encoding="utf-8") as f:
                    json.dump(manifest, f, indent=2)
                seeded.append(mission_id)
                logger.info("Persisted seeded mission manifest: %s", target_json)

        # Also ensure semantic_scene.json is available in missions/<id>/
        semantic_dir = MISSIONS_DIR / mission_id
        semantic_dir.mkdir(parents=True, exist_ok=True)
        semantic_file = semantic_dir / "semantic_scene.json"
        if not semantic_file.exists() or force:
            manifest = build_seeded_mission_manifest(mission_id)
            if manifest and manifest.get("semantic_scene"):
                with open(semantic_file, "w", encoding="utf-8") as f:
                    json.dump(manifest["semantic_scene"], f, indent=2)
                logger.info("Persisted semantic scene: %s", semantic_file)

    return seeded
