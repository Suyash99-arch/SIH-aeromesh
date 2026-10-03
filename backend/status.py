"""
Canonical Mission and Pipeline Status Engine for Hexa Spark.

Strictly separates:
- NOT_RUN: Video uploaded/staged, but processing pipeline has not been initiated.
- QUEUED: Job submitted to background worker queue, waiting to execute.
- PROCESSING: Currently executing pipeline stages.
- FAILED(stage, reason): Explicit failure at a specific pipeline stage with plain-English explanation.
- PARTIAL: Some stages completed (e.g., 2D detection & tracking succeeded, but 3D SfM could not register sufficient cameras or sparse-only).
- COMPLETE: All requested stages executed successfully with verified 3D camera poses.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, Optional, Tuple


class MissionStatus(str, Enum):
    NOT_RUN = "NOT_RUN"
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    FAILED = "FAILED"
    PARTIAL = "PARTIAL"
    COMPLETE = "COMPLETE"


class PipelineStage(str, Enum):
    INGEST = "INGEST"
    PREFLIGHT = "PREFLIGHT"
    EXTRACT_FRAMES = "EXTRACT_FRAMES"
    DETECT_TRACK = "DETECT_TRACK"
    RECONSTRUCTION = "RECONSTRUCTION"
    SURFACE_MESH = "SURFACE_MESH"
    SPATIAL_FUSION = "SPATIAL_FUSION"
    REPORTING = "REPORTING"


def resolve_mission_status(
    mission_data: Dict[str, Any],
    job_data: Optional[Dict[str, Any]] = None,
    reconstruction_data: Optional[Dict[str, Any]] = None,
) -> Tuple[MissionStatus, Optional[str], Optional[str], Dict[str, Any]]:
    """
    Determines honest overall mission status and stage details.
    
    Returns:
        (status, failed_stage, failure_reason, stage_breakdown)
    """
    stage_breakdown = {
        "ingest": "COMPLETED" if mission_data.get("video") or mission_data.get("video_path") else "NOT_RUN",
        "preflight": "NOT_RUN",
        "detection": "NOT_RUN",
        "tracking": "NOT_RUN",
        "reconstruction": "NOT_RUN",
        "mesh": "NOT_RUN",
        "spatial_fusion": "NOT_RUN",
    }

    # 1. Check Job State if active
    if job_data:
        job_status = (job_data.get("status") or "").upper()
        job_stage = (job_data.get("stage") or "").upper()
        if job_status == "QUEUED":
            return MissionStatus.QUEUED, None, None, stage_breakdown
        if job_status in ("PROCESSING", "RUNNING", "EXTRACTING_FRAMES", "DETECTING_OBJECTS", "TRACKING", "RECONSTRUCTING", "GENERATING_MESH", "FUSING_3D"):
            return MissionStatus.PROCESSING, None, None, stage_breakdown
        if job_status == "FAILED" or job_stage == "FAILED":
            failed_stage = job_data.get("failed_stage") or job_stage or "PIPELINE"
            err_msg = job_data.get("error_message") or job_data.get("message") or "Unknown processing error"
            return MissionStatus.FAILED, failed_stage, err_msg, stage_breakdown

    raw_status = (mission_data.get("status") or "").lower()
    processing = mission_data.get("processing") or {}

    # Check if currently processing or queued
    if raw_status in ("processing", "running"):
        return MissionStatus.PROCESSING, None, None, stage_breakdown
    if raw_status == "queued":
        return MissionStatus.QUEUED, None, None, stage_breakdown

    # 2. Check if processing has ever run
    has_detections = bool(mission_data.get("detections")) or bool(mission_data.get("findings"))
    has_tracks = bool(mission_data.get("tracks"))
    has_recon = bool(reconstruction_data) or bool(mission_data.get("reconstruction")) or bool(mission_data.get("sparse_point_count"))

    if raw_status in ("video_uploaded", "uploaded", "created", "draft") and not (has_detections or has_tracks or has_recon):
        return MissionStatus.NOT_RUN, None, "Processing pipeline has not been initiated for this video", stage_breakdown

    # Update stage breakdown from data
    if has_detections:
        stage_breakdown["detection"] = "COMPLETED"
    if has_tracks:
        stage_breakdown["tracking"] = "COMPLETED"

    recon = reconstruction_data or mission_data.get("reconstruction") or {}
    total_imgs = int(recon.get("total_images") or mission_data.get("total_images") or 0)
    reg_cams = int(recon.get("registered_cameras") or mission_data.get("registered_cameras") or 0)
    points = int(recon.get("sparse_point_count") or recon.get("point_count") or mission_data.get("sparse_point_count") or 0)
    mesh_faces = int((recon.get("mesh") or {}).get("face_count", 0) or recon.get("mesh_faces", 0))

    if total_imgs == 0:
        stage_breakdown["reconstruction"] = "NOT_RUN"
    elif reg_cams == 0:
        stage_breakdown["reconstruction"] = "FAILED"
    elif reg_cams < total_imgs * 0.7:
        stage_breakdown["reconstruction"] = "PARTIAL"
    else:
        stage_breakdown["reconstruction"] = "COMPLETED"

    if mesh_faces > 0:
        stage_breakdown["mesh"] = "COMPLETED"
    elif stage_breakdown["reconstruction"] in ("COMPLETED", "PARTIAL"):
        stage_breakdown["mesh"] = "UNAVAILABLE"

    has_fusion = bool(mission_data.get("objects_3d")) or bool((mission_data.get("semantic_scene") or {}).get("objects"))
    if has_fusion:
        stage_breakdown["spatial_fusion"] = "COMPLETED"

    # Evaluate Overall Status
    # Did reconstruction completely fail when attempted?
    if total_imgs > 0 and reg_cams == 0:
        reason = recon.get("sfm_failure") or recon.get("error") or "SfM registered 0 cameras (insufficient stereoscopic parallax or feature correspondences)"
        if has_detections or has_tracks:
            return MissionStatus.PARTIAL, "reconstruction", reason, stage_breakdown
        return MissionStatus.FAILED, "reconstruction", reason, stage_breakdown

    # Partial reconstruction (some cameras registered, or sparse cloud without full mesh)
    if stage_breakdown["reconstruction"] == "PARTIAL":
        return MissionStatus.PARTIAL, None, f"Reconstruction partial: {reg_cams}/{total_imgs} cameras registered", stage_breakdown

    # Complete
    if stage_breakdown["detection"] == "COMPLETED" and stage_breakdown["reconstruction"] in ("COMPLETED", "PARTIAL") and reg_cams > 0:
        return MissionStatus.COMPLETE, None, None, stage_breakdown

    # If detections succeeded but reconstruction was not run
    if has_detections and total_imgs == 0:
        return MissionStatus.PARTIAL, None, "AI detections and tracking complete; 3D reconstruction was not executed", stage_breakdown

    if raw_status in ("completed", "complete"):
        return MissionStatus.COMPLETE, None, None, stage_breakdown

    return MissionStatus.NOT_RUN, None, "No pipeline stages have executed", stage_breakdown
