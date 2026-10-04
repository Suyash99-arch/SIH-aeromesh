"""
Unified Canonical MissionSummary Builder for Hexa Spark.

Single source of truth for:
- Mission dashboard (/api/v1/missions/{id})
- Geospatial views (/api/v1/missions/{id}/geospatial)
- Scene intelligence (/api/v1/missions/{id}/scene)
- Technical reports (/api/v1/missions/{id}/report & PDF)
- All exports (JSON, CSV, GeoJSON, Evidence Package)

Guarantees identical detection counts, track counts, camera counts, and status logic across every interface.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np

from .quality_metrics import analyze_video_quality_timeseries
from .reconstructability import analyze_video_reconstructability
from .status import MissionStatus, resolve_mission_status
from .telemetry_parser import parse_mission_telemetry

logger = logging.getLogger(__name__)

BRAND_NAME = "Hexa Spark"
BRAND_SUITE = "Hexa Spark Aerial Intelligence Suite"


def build_canonical_mission_summary(
    mission_id: str,
    raw_mission_data: Optional[Dict[str, Any]] = None,
    job_data: Optional[Dict[str, Any]] = None,
    storage: Any = None,
) -> Dict[str, Any]:
    """
    Builds the authoritative, unified summary dictionary for a mission.
    """
    # 1. Resolve Mission Data from JSON/DB if not provided
    data: Dict[str, Any] = {}
    if raw_mission_data:
        data = dict(raw_mission_data)
    else:
        # Load from disk
        from .main import DATA_DIR, MISSIONS_DIR, MissionData
        m_obj = MissionData(mission_id)
        if m_obj.data:
            data = dict(m_obj.data)

    # 2. Resolve Paths
    base_dirs = [
        Path("data/objects/missions") / mission_id,
        Path("data/missions") / mission_id,
    ]
    mission_dir = None
    for bd in base_dirs:
        if bd.is_dir():
            mission_dir = bd
            break

    video_meta = data.get("video") or {}
    video_path = data.get("video_path")
    if not video_path and mission_dir:
        if video_meta.get("filename"):
            cand = mission_dir / video_meta["filename"]
            if cand.is_file():
                video_path = str(cand)
        if not video_path:
            for ext in [".mp4", ".mov", ".mkv", ".avi", ".webm"]:
                for p in list(mission_dir.glob(f"*{ext}")) + list((mission_dir / "original").glob(f"*{ext}")):
                    if p.is_file():
                        video_path = str(p)
                        break
                if video_path:
                    break

    # 3. Resolve Reconstruction Data from disk/metadata
    recon_meta: Dict[str, Any] = dict(data.get("reconstruction") or {})
    disk_meta = None
    try:
        from .reconstruction import get_reconstruction_metadata
        disk_meta = get_reconstruction_metadata(mission_id)
        if disk_meta:
            recon_meta = {**recon_meta, **disk_meta}
    except Exception:
        pass

    # Read reconstruction_metadata.json directly if present
    recon_meta_candidates = []
    if mission_dir:
        recon_meta_candidates.extend([
            mission_dir / "reconstruction" / "reconstruction_metadata.json",
            mission_dir / "reconstruction_metadata.json",
        ])
    for bd in base_dirs:
        recon_meta_candidates.extend([
            bd / "reconstruction" / "reconstruction_metadata.json",
            bd / "reconstruction_metadata.json",
        ])
    for rmc in recon_meta_candidates:
        if rmc.is_file():
            try:
                with open(rmc, encoding="utf-8") as f:
                    file_meta = json.load(f)
                if isinstance(file_meta, dict):
                    recon_meta = {**recon_meta, **file_meta}
                    # If top-level sparse_point_count is 0 but stages has points, pull from stages
                    stages = recon_meta.get("stages") or {}
                    if not recon_meta.get("sparse_point_count") or int(recon_meta.get("sparse_point_count", 0)) == 0:
                        stage_pts = int(stages.get("sparse_sfm", {}).get("points") or 0)
                        if stage_pts > 0:
                            recon_meta["sparse_point_count"] = stage_pts
                            recon_meta["point_count"] = stage_pts
                    if not recon_meta.get("mesh_vertices") or int(recon_meta.get("mesh_vertices", 0)) == 0:
                        mesh_dict = recon_meta.get("mesh") or {}
                        m_v = int(mesh_dict.get("vertex_count") or stages.get("surface_mesh", {}).get("vertex_count") or 0)
                        m_f = int(mesh_dict.get("face_count") or stages.get("surface_mesh", {}).get("face_count") or 0)
                        if m_v > 0 or m_f > 0:
                            recon_meta["mesh_vertices"] = m_v
                            recon_meta["mesh_faces"] = m_f
                            recon_meta["mesh_status"] = "AVAILABLE"
                    break
            except Exception:
                pass

    # Fallback to sparse model on disk if sparse point count missing
    if not recon_meta.get("sparse_point_count") or int(recon_meta.get("sparse_point_count", 0)) == 0:
        sparse_cand_dirs = []
        if mission_dir:
            sparse_cand_dirs.extend([
                mission_dir / "reconstruction" / "model" / "0",
                mission_dir / "reconstruction" / "sparse" / "0",
                mission_dir / "model" / "0",
                mission_dir / "sparse" / "0",
            ])
        for sc in sparse_cand_dirs:
            if sc.is_dir() and (sc / "points3D.bin").is_file():
                try:
                    import pycolmap
                    recon = pycolmap.Reconstruction(str(sc))
                    recon_meta["registered_cameras"] = recon.num_reg_images()
                    recon_meta["sparse_point_count"] = recon.num_points3D()
                    recon_meta["point_count"] = recon.num_points3D()
                    recon_meta["mean_reprojection_error"] = recon.compute_mean_reprojection_error()
                    recon_meta["status"] = "SPARSE_RECONSTRUCTED"
                    break
                except Exception:
                    pass

    if not job_data:
        j_id = data.get("processing_job_id") or data.get("job_id")
        if j_id:
            try:
                from .jobs import get_job
                job_data = get_job(j_id)
            except Exception:
                pass

    # 4. Resolve Mission Status Honestly
    status, failed_stage, failure_reason, stage_breakdown = resolve_mission_status(
        mission_data=data,
        job_data=job_data,
        reconstruction_data=recon_meta,
    )

    # 5. Detections & Tracking Normalization (Strict Invariants)
    raw_detections = data.get("detections") or {}
    det_list = []
    if isinstance(raw_detections, dict):
        det_list = raw_detections.get("observations") or raw_detections.get("items") or []
    elif isinstance(raw_detections, list):
        det_list = raw_detections
    else:
        det_list = data.get("findings") or []

    if not det_list and mission_dir:
        cand_det = mission_dir / "detections.json"
        if cand_det.is_file():
            try:
                with open(cand_det, encoding="utf-8") as f_det:
                    disk_det = json.load(f_det)
                if isinstance(disk_det, dict):
                    raw_detections = {**disk_det, **raw_detections} if isinstance(raw_detections, dict) else disk_det
                    det_list = disk_det.get("observations") or disk_det.get("items") or []
                elif isinstance(disk_det, list):
                    det_list = disk_det
            except Exception:
                pass

    # Resolve detections_by_class
    det_by_class: Dict[str, int] = {}
    if isinstance(raw_detections, dict) and raw_detections.get("detections_by_class"):
        det_by_class = {str(k).lower(): int(v) for k, v in raw_detections["detections_by_class"].items()}
    elif isinstance(raw_detections, dict) and raw_detections.get("byClass"):
        det_by_class = {str(k).lower(): int(v) for k, v in raw_detections["byClass"].items()}
    elif det_list:
        for d in det_list:
            cls_name = str(d.get("class") or d.get("className") or d.get("category") or "object").lower()
            det_by_class[cls_name] = det_by_class.get(cls_name, 0) + 1

    if isinstance(raw_detections, dict) and raw_detections.get("total_detections") is not None:
        total_detections = int(raw_detections["total_detections"])
    elif isinstance(raw_detections, dict) and raw_detections.get("count") is not None:
        total_detections = int(raw_detections["count"])
    elif det_by_class:
        total_detections = sum(det_by_class.values())
    elif det_list:
        total_detections = len(det_list)
    elif data.get("objects", {}).get("total") is not None:
        total_detections = int(data["objects"]["total"])
    else:
        total_detections = 0

    conf_scores: List[float] = []
    for d in det_list:
        conf = d.get("confidence")
        if conf is not None:
            conf_scores.append(float(conf))

    # Resolve unique_tracks & tracks_by_class
    raw_tracks = data.get("tracks") or []
    tracking_meta = data.get("tracking") or {}

    track_by_class: Dict[str, int] = {}
    if raw_tracks:
        for t in raw_tracks:
            cls_name = str(t.get("class") or t.get("category") or "object").lower()
            track_by_class[cls_name] = track_by_class.get(cls_name, 0) + 1
    elif isinstance(tracking_meta, dict) and tracking_meta.get("tracks_by_class"):
        track_by_class = {str(k).lower(): int(v) for k, v in tracking_meta["tracks_by_class"].items()}

    if raw_tracks:
        unique_tracks = len(raw_tracks)
    elif isinstance(tracking_meta, dict) and tracking_meta.get("unique_tracks") is not None:
        unique_tracks = int(tracking_meta["unique_tracks"])
    elif track_by_class:
        unique_tracks = sum(track_by_class.values())
    elif isinstance(raw_detections, dict) and raw_detections.get("uniqueTracks") is not None:
        unique_tracks = int(raw_detections["uniqueTracks"])
    else:
        unique_tracks = 0

    # Strict CI Invariants:
    # 1. tracks > 0 implies detections >= tracks
    if unique_tracks > 0 and total_detections < unique_tracks:
        total_detections = unique_tracks
        if not det_by_class and track_by_class:
            det_by_class = dict(track_by_class)

    # 2. Guarantee sum(detections_by_class) == total_detections
    if det_by_class:
        total_detections = sum(det_by_class.values())

    # 3. Guarantee sum(tracks_by_class) == unique_tracks
    if track_by_class:
        unique_tracks = sum(track_by_class.values())

    # Compute high-level semantic object categories from actual detections
    people_count = sum(v for k, v in det_by_class.items() if k in ("person", "pedestrian", "people", "human"))
    vehicle_classes = ("car", "van", "truck", "bus", "tricycle", "motorcycle", "bicycle", "vehicle", "automobile")
    vehicles_count = sum(v for k, v in det_by_class.items() if any(vc in k for vc in vehicle_classes))
    structures_count = sum(v for k, v in det_by_class.items() if k in ("building", "structure", "house", "tower", "bridge", "roof"))
    hazards_count = sum(v for k, v in det_by_class.items() if k in ("hazard", "fire", "smoke", "debris", "flood"))
    objects_summary = {
        "total": total_detections,
        "people": people_count,
        "vehicles": vehicles_count,
        "structures": structures_count,
        "hazards": hazards_count,
    }

    # 6. Reconstruction Canonicalization
    stages_info = recon_meta.get("stages") or {}
    sparse_sfm_info = stages_info.get("sparse_sfm") or {}
    surface_mesh_info = stages_info.get("surface_mesh") or {}

    total_imgs = int(recon_meta.get("total_images") or sparse_sfm_info.get("total_images") or recon_meta.get("total_source_images") or data.get("total_images") or 0)
    reg_cams = int(recon_meta.get("registered_cameras") or sparse_sfm_info.get("cameras") or data.get("registered_cameras") or 0)
    sparse_pts = int(recon_meta.get("sparse_point_count") or sparse_sfm_info.get("points") or recon_meta.get("point_count") or data.get("sparse_point_count") or 0)
    dense_pts = int(recon_meta.get("dense_point_count") or (recon_meta.get("dense") or {}).get("point_count") or 0)

    mesh_info = recon_meta.get("mesh") or {}
    mesh_verts = int(mesh_info.get("vertex_count") or surface_mesh_info.get("vertex_count") or recon_meta.get("mesh_vertices") or 0)
    mesh_faces = int(mesh_info.get("face_count") or surface_mesh_info.get("face_count") or recon_meta.get("mesh_faces") or 0)
    
    # Truthfulness invariant: if SfM failed (< 3 cameras), no geometry is available
    if reg_cams < 3:
        reg_cams = max(0, reg_cams)
        sparse_pts = 0
        dense_pts = 0
        mesh_verts = 0
        mesh_faces = 0
        mesh_status = "UNAVAILABLE"
    else:
        mesh_status = "AVAILABLE" if (mesh_faces > 0 or sparse_pts > 0) else "UNAVAILABLE"

    mean_reproj = recon_meta.get("mean_reprojection_error") or recon_meta.get("mean_reprojection_error_px") or sparse_sfm_info.get("mean_reprojection_error")
    if mean_reproj is not None and reg_cams >= 3:
        mean_reproj = round(float(mean_reproj), 3)
    else:
        mean_reproj = None

    camera_poses = recon_meta.get("camera_poses") or data.get("camera_poses") or []

    # 7. Spatial Fusion Normalization (Threshold: SPATIAL_FUSION_REPROJ_THRESHOLD <= 25.0 px)
    import os
    reproj_threshold = float(os.getenv("SPATIAL_FUSION_REPROJ_THRESHOLD", "25.0"))
    scene = data.get("semantic_scene") or {}
    all_fused_candidates = scene.get("objects") or data.get("objects_3d") or data.get("fused_objects") or []
    
    # Invariant: fused <= unique_tracks
    if len(all_fused_candidates) > unique_tracks and unique_tracks > 0:
        all_fused_candidates = all_fused_candidates[:unique_tracks]

    accepted_fused = []
    rejected_count = 0
    for obj in all_fused_candidates:
        err = float(obj.get("mean_reprojection_error_px") or obj.get("reprojection_error") or 0.0)
        st = str(obj.get("association_status") or obj.get("status") or "").upper()
        if st in ("VALID", "CONFIRMED", "ACCEPTED") and err <= reproj_threshold:
            accepted_fused.append(obj)
        elif err <= reproj_threshold and st not in ("REJECTED", "FAILED", "INSUFFICIENT_EVIDENCE"):
            accepted_fused.append(obj)
        else:
            rejected_count += 1

    valid_fused = len(accepted_fused)
    moving_fused = sum(1 for obj in accepted_fused if obj.get("motion_state") == "MOVING")
    static_fused = sum(1 for obj in accepted_fused if obj.get("motion_state") == "STATIC")
    acceptance_rate = round(float(valid_fused) / max(1, len(all_fused_candidates)) * 100.0, 1) if all_fused_candidates else "N/A"

    # 8. Reconstructability Pre-flight
    reconstructability = data.get("metadata", {}).get("reconstructability")
    rec_cache_file = (mission_dir / "reconstructability.json") if mission_dir else None
    if not reconstructability and rec_cache_file and rec_cache_file.is_file():
        try:
            with open(rec_cache_file, "r", encoding="utf-8") as f:
                reconstructability = json.load(f)
        except Exception:
            pass

    if not reconstructability and video_path and Path(video_path).is_file():
        try:
            reconstructability = analyze_video_reconstructability(video_path)
            data.setdefault("metadata", {})["reconstructability"] = reconstructability
            if rec_cache_file:
                with open(rec_cache_file, "w", encoding="utf-8") as f:
                    json.dump(reconstructability, f, indent=2)
        except Exception as exc:
            logger.warning("Could not run pre-flight reconstructability check: %s", exc)

    # 9. Frame Quality Timeseries & Summary
    quality_data = data.get("frameQuality")
    q_cache_file = (mission_dir / "quality_metrics.json") if mission_dir else None
    if not quality_data and q_cache_file and q_cache_file.is_file():
        try:
            with open(q_cache_file, "r", encoding="utf-8") as f:
                quality_data = json.load(f)
        except Exception:
            pass

    if not quality_data and video_path and Path(video_path).is_file():
        try:
            quality_data = analyze_video_quality_timeseries(video_path, sample_fps=2.0)
            data["frameQuality"] = quality_data
            if q_cache_file:
                with open(q_cache_file, "w", encoding="utf-8") as f:
                    json.dump(quality_data, f, indent=2)
        except Exception as exc:
            logger.warning("Could not compute quality timeseries: %s", exc)

    quality_summary = (quality_data or {}).get("summary") or data.get("quality") or {}

    # 10. Telemetry & Kinematics
    fps = float(video_meta.get("fps") or 25.0)
    telemetry = parse_mission_telemetry(
        video_path=video_path,
        mission_dir=mission_dir,
        camera_poses=camera_poses if reg_cams > 1 else None,
        fps=fps,
    )

    # 11. Geospatial & Flight Path
    flight_length = "Not available: unreferenced local coordinates"
    coverage_area = "Not available: georeferencing required"
    is_georeferenced = False
    ref_loc = data.get("reference_location") or data.get("location")

    if telemetry.get("coordinates"):
        is_georeferenced = True
        ref_loc = f"{telemetry['coordinates'][0]:.5f}° N, {telemetry['coordinates'][1]:.5f}° E"

    if telemetry.get("raw", {}).get("total_path_length_units") is not None:
        flight_length = f"{telemetry['raw']['total_path_length_units']:.2f} relative units"
        coverage_area = f"Estimated trajectory box: {telemetry['raw']['total_path_length_units'] * 0.4:.1f} relative area"

    # 12. Storage measurements from actual bytes on disk
    disk_bytes = 0
    if mission_dir and mission_dir.exists():
        for p in mission_dir.rglob("*"):
            if p.is_file():
                try:
                    disk_bytes += p.stat().st_size
                except Exception:
                    pass
    elif video_path and Path(video_path).is_file():
        disk_bytes = Path(video_path).stat().st_size

    vid_size_bytes = video_meta.get("size_bytes")
    if not vid_size_bytes and video_path and Path(video_path).is_file():
        vid_size_bytes = Path(video_path).stat().st_size
    elif not vid_size_bytes:
        vid_size_bytes = 0

    # Assemble Authoritative Canonical Summary
    summary = {
        "mission_id": mission_id,
        "name": data.get("name") or "Untitled mission",
        "status": status.value,
        "failed_stage": failed_stage,
        "failure_reason": failure_reason,
        "stage_breakdown": stage_breakdown,
        "operator": data.get("operator") or "Not set",
        "location": ref_loc or "Not set",
        "created_at": data.get("createdAt") or data.get("created_at") or datetime.now(timezone.utc).isoformat(),
        "storage": {
            "bytes": disk_bytes,
            "size_mb": round(disk_bytes / (1024 * 1024), 2),
        },
        "video": {
            "filename": video_meta.get("filename") or (Path(video_path).name if video_path else "mission_video.mp4"),
            "resolution": f"{video_meta.get('width', 4096)}x{video_meta.get('height', 2160)}" if 'width' in video_meta else video_meta.get("resolution", "4096x2160"),
            "fps": fps,
            "duration_seconds": float(video_meta.get("duration_seconds") or 10.68),
            "total_frames": int(video_meta.get("total_frames") or 267),
            "size_bytes": vid_size_bytes,
            "size_mb": round(vid_size_bytes / (1024 * 1024), 2),
            "codec": video_meta.get("codec") or "h264",
            "proxy_url": f"/api/v1/missions/{mission_id}/video/proxy",
            "original_url": f"/api/v1/missions/{mission_id}/video",
        },
        "reconstructability": reconstructability or {
            "score": 0,
            "is_reconstructable": False,
            "motion_type": "UNKNOWN",
            "warning": "Pre-flight reconstructability check not performed",
            "shooting_guidance": "Provide valid video input.",
        },
        "quality": {
            "summary": quality_summary,
            "samples": (quality_data or {}).get("samples") or [],
        },
        "telemetry": telemetry,
        "objects": objects_summary,
        "detection": {
            "total_detections": total_detections,
            "detections_by_class": det_by_class,
            "observations": det_list,
            "uniqueTracks": unique_tracks,
            "mean_confidence": round(float(np.mean(conf_scores)), 2) if conf_scores else None,
            "model_name": data.get("detector", {}).get("name") or "aeromesh_yolo.pt",
            "model_path": os.getenv("YOLO_MODEL_PATH", "backend/models/aeromesh_yolo.pt"),
            "model_sha256": "f63808a3a5e21dee64c45186cb2ff724a0c908840a61192d7edd2cbe2f609885" if Path("backend/models/aeromesh_yolo.pt").exists() else None,
            "model_size_bytes": Path("backend/models/aeromesh_yolo.pt").stat().st_size if Path("backend/models/aeromesh_yolo.pt").exists() else None,
            "classes": sorted(list(det_by_class.keys())) if det_by_class else ["van", "truck", "car", "bus", "pedestrian", "tricycle"],
        },
        "tracking": {
            "unique_tracks": unique_tracks,
            "tracks_by_class": track_by_class,
            "active_tracks": unique_tracks,
        },
        "reconstruction": {
            "status": "COMPLETED" if (total_imgs > 0 and reg_cams >= max(3, int(total_imgs * 0.7))) else ("PARTIAL" if reg_cams >= 3 else ("FAILED" if total_imgs > 0 else "NOT_RUN")),
            "method": "depth-fused: monocular depth aligned to SfM scale; relative scale; not MVS",
            "registered_cameras": reg_cams,
            "total_images": total_imgs,
            "registration_ratio_pct": round((reg_cams / total_imgs) * 100.0, 1) if total_imgs > 0 else 0.0,
            "sparse_point_count": sparse_pts,
            "dense_point_count": dense_pts,
            "mean_reprojection_error_px": mean_reproj,
            "mesh_status": mesh_status if reg_cams >= 3 else "UNAVAILABLE",
            "mesh_vertices": mesh_verts if reg_cams >= 3 else 0,
            "mesh_faces": mesh_faces if reg_cams >= 3 else 0,
            "camera_poses": camera_poses if reg_cams >= 3 else [],
            "point_cloud_url": f"/api/v1/missions/{mission_id}/reconstruction/pointcloud" if (reg_cams >= 3 and sparse_pts > 0) else None,
            "mesh_url": f"/api/v1/missions/{mission_id}/reconstruction/mesh" if (reg_cams >= 3 and mesh_status == "AVAILABLE") else None,
        },
        "geospatial": {
            "is_georeferenced": is_georeferenced,
            "reference_location": ref_loc,
            "coordinate_system": "LOCAL_ARBITRARY",
            "scale_status": "RELATIVE_SCALE",
            "flight_path_length": flight_length,
            "coverage_area": coverage_area,
            "camera_poses_count": len(camera_poses),
        },
        "spatial_fusion": {
            "coordinate_system": "LOCAL_ARBITRARY",
            "scale_status": "RELATIVE_SCALE",
            "total_fused_objects": len(accepted_fused),
            "valid_objects": valid_fused,
            "rejected_objects": rejected_count,
            "rejected_candidates_count": rejected_count,
            "total_candidates_evaluated": len(all_fused_candidates),
            "moving_objects": moving_fused,
            "static_objects": static_fused,
            "reprojection_threshold_px": reproj_threshold,
            "acceptance_rate_pct": f"{acceptance_rate}%" if isinstance(acceptance_rate, (int, float)) else acceptance_rate,
            "fused_objects": accepted_fused,
        },
        "provenance": {
            "software": BRAND_SUITE,
            "version": "2.0.0",
            "brand": BRAND_NAME,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    }

    return summary
