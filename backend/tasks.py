from __future__ import annotations

from .jobs import update_job
from .model_registry import ModelUnavailableError

try:
    from celery import Celery
except ImportError:  # pragma: no cover
    Celery = None


celery_app = Celery("aeromesh", broker=None, backend=None) if Celery else None
if celery_app is not None:
    broker_url = __import__("os").getenv("CELERY_BROKER_URL") or __import__("os").getenv("REDIS_URL", "redis://localhost:6379/0")
    result_backend = __import__("os").getenv("CELERY_RESULT_BACKEND") or broker_url
    celery_app.conf.broker_url = broker_url
    celery_app.conf.result_backend = result_backend


def _placeholder(job_id: str):
    update_job(job_id, status="COMPLETED", stage="COMPLETED", progress_percent=100, message="Placeholder pipeline completed; expensive processing is not enabled in Phase 4")
    return get_job_result(job_id)


def _detection_task(job_id: str, video_path=None, sample_fps: float = 2.0, confidence: float | None = None, iou: float | None = None, classes=None, *args, **kwargs):
    update_job(job_id, status="DETECTING_OBJECTS", stage="DETECTING_OBJECTS", progress_percent=40, message="Running YOLO object detection")
    try:
        from .detection import DetectionService
        from .model_registry import ModelRegistry
        service = DetectionService(ModelRegistry())
        record = service.registry.require_available()
        detections = service.detect_video(video_path, sample_fps=sample_fps, confidence=confidence or float(__import__("os").getenv("YOLO_CONFIDENCE", "0.35")), iou=iou or float(__import__("os").getenv("YOLO_IOU", "0.7")), classes=set(classes) if classes else None) if video_path else []
    except ModelUnavailableError as exc:
        update_job(job_id, status="FAILED", stage="FAILED", error_message=f"MODEL_NOT_FOUND: {exc}", message="YOLO model unavailable")
        return get_job_result(job_id)
    except Exception as exc:
        update_job(job_id, status="FAILED", stage="FAILED", error_message=f"DETECTION_FAILED: {exc}", message="Object detection failed")
        return get_job_result(job_id)
    update_job(job_id, status="DETECTING_OBJECTS", stage="DETECTING_OBJECTS", progress_percent=55, message=f"Object detections available: {len(detections)}")
    result = get_job_result(job_id) or {}
    result["detections"] = [record.__dict__ for record in detections]
    result["model"] = record.__dict__
    return result


def _tracking_task(job_id: str, detections=None, *args, **kwargs):
    update_job(job_id, status="TRACKING", stage="TRACKING", progress_percent=70, message="Tracking detected objects")
    from .detection import DetectionRecord
    from .tracking import ByteTrackAdapter
    grouped = {}
    for item in detections or []:
        detection = item if isinstance(item, DetectionRecord) else DetectionRecord(**item)
        grouped.setdefault(detection.frame_id, []).append(detection)
    tracks = ByteTrackAdapter().track(grouped.values())
    update_job(job_id, status="TRACKING", stage="TRACKING", progress_percent=85, message="Persistent tracks available")
    result = get_job_result(job_id) or {}
    result["tracks"] = [track.to_dict() for track in tracks]
    result["unique_objects"] = len(tracks)
    return result


def _reconstruction_task(job_id: str, mission_id: str = "", video_path=None, max_frames: int = 40, *args, **kwargs):
    update_job(job_id, status="RECONSTRUCTING", stage="RECONSTRUCTING", progress_percent=20, message="Extracting and filtering frames for 3D reconstruction")
    from pathlib import Path
    from .reconstruction import run_reconstruction_for_mission

    def progress_cb(msg: str, pct: int):
        stage = "GENERATING_MESH" if pct >= 85 else "RECONSTRUCTING"
        update_job(job_id, status=stage, stage=stage, progress_percent=pct, message=msg)

    try:
        recon_result = run_reconstruction_for_mission(
            mission_id=mission_id,
            video_path=Path(video_path) if video_path else Path(""),
            max_frames=max_frames,
            progress_cb=progress_cb,
        )
    except Exception as exc:
        update_job(job_id, status="FAILED", stage="FAILED", error_message=f"RECONSTRUCTION_FAILED: {exc}", message="Reconstruction failed")
        return get_job_result(job_id)

    if not recon_result.get("success"):
        update_job(job_id, status="FAILED", stage="FAILED", error_message=recon_result.get("error", "Reconstruction failed"), message="Reconstruction failed")
        return get_job_result(job_id)

    status = "COMPLETED" if recon_result.get("sparse_point_count", 0) >= 100 else "PARTIAL"
    update_job(job_id, status=status, stage=status, progress_percent=100, message=f"3D reconstruction complete ({recon_result.get('sparse_point_count', 0)} points)")
    result = get_job_result(job_id) or {}
    result["reconstruction"] = recon_result
    return result


def _fusion_task(job_id: str, mission_id: str = "", reprojection_threshold_px: float | None = None, *args, **kwargs):
    update_job(job_id, status="FUSING_3D", stage="FUSING_3D", progress_percent=20, message="Starting AI-to-3D spatial association")
    import os
    from pathlib import Path
    from .spatial_fusion import SpatialFusionEngine
    from .reconstruction import get_reconstruction_mesh_path

    try:
        from .main import MissionData
        mission = MissionData(mission_id)
        if not mission.data:
            update_job(job_id, status="FAILED", stage="FAILED", error_message="MISSION_NOT_FOUND", message="Mission not found")
            return get_job_result(job_id)

        update_job(job_id, status="FUSING_3D", stage="FUSING_3D", progress_percent=40, message="Loading 3D camera poses and scene geometry")
        
        mission_dir = Path(f"data/missions/{mission_id}")
        model_dir = mission_dir / "reconstruction" / "pinhole_model" / "0"
        if not model_dir.exists():
            model_dir = mission_dir / "reconstruction" / "sparse" / "0"

        mesh_path = get_reconstruction_mesh_path(mission_id) or (mission_dir / "reconstruction" / "mesh.ply")
        if not (mesh_path and Path(mesh_path).exists()):
            mesh_path = None

        thresh = reprojection_threshold_px or float(os.getenv("SPATIAL_FUSION_REPROJ_THRESHOLD", "25.0"))

        if model_dir.exists():
            import pycolmap
            recon = pycolmap.Reconstruction(model_dir)
            engine, poses_by_name = SpatialFusionEngine.from_reconstruction(
                reconstruction=recon,
                mesh_path=mesh_path,
                reprojection_threshold_px=thresh,
            )
        else:
            engine = SpatialFusionEngine(reprojection_threshold_px=thresh)
            poses_by_name = {}

        update_job(job_id, status="FUSING_3D", stage="FUSING_3D", progress_percent=60, message="Fusing 2D tracks with 3D camera rays")

        tracks = mission.get("tracks") or []
        fused_objects = engine.fuse_all_tracks(tracks, poses_by_name)

        update_job(job_id, status="FUSING_3D", stage="FUSING_3D", progress_percent=85, message=f"Validated {len(fused_objects)} 3D objects")

        fused_dicts = [obj.to_dict() for obj in fused_objects]
        mission.set("objects_3d", fused_dicts)
        mission.set("semantic_scene", {
            "coordinate_system": "LOCAL_ARBITRARY",
            "scale_status": "RELATIVE_SCALE",
            "georeferencing_status": "UNREFERENCED",
            "total_objects": len(fused_dicts),
            "valid_objects": sum(1 for obj in fused_dicts if obj["association_status"] == "VALID"),
            "moving_objects": sum(1 for obj in fused_dicts if obj["motion_state"] == "MOVING"),
            "static_objects": sum(1 for obj in fused_dicts if obj["motion_state"] == "STATIC"),
            "reprojection_threshold_px": thresh,
            "objects": fused_dicts,
        })
        mission.save()

        update_job(job_id, status="COMPLETED", stage="COMPLETED", progress_percent=100, message=f"AI-to-3D spatial fusion completed ({len(fused_dicts)} objects)")
        result = get_job_result(job_id) or {}
        result["objects_3d"] = fused_dicts
        return result

    except Exception as exc:
        update_job(job_id, status="FAILED", stage="FAILED", error_message=f"FUSION_FAILED: {exc}", message="Spatial fusion failed")
        return get_job_result(job_id)


def get_job_result(job_id):
    from .jobs import get_job
    return get_job(job_id)


def _register(name):
    if celery_app is None:
        return _placeholder
    return celery_app.task(name=f"aeromesh.{name}")(_placeholder)


validate_video = _register("validate_video")
extract_frames = _register("extract_frames")
if celery_app is not None:
    detect_objects = celery_app.task(name="aeromesh.detect_objects")(_detection_task)
    track_objects = celery_app.task(name="aeromesh.track_objects")(_tracking_task)
    reconstruct = celery_app.task(name="aeromesh.reconstruct")(_reconstruction_task)
    fuse_objects_3d = celery_app.task(name="aeromesh.fuse_objects_3d")(_fusion_task)
else:
    detect_objects = _detection_task
    track_objects = _tracking_task
    reconstruct = _reconstruction_task
    fuse_objects_3d = _fusion_task
generate_mesh = _register("generate_mesh")
analyze = _register("analyze")
generate_report = _register("generate_report")
run_processing_pipeline = _register("run_processing_pipeline")


def enqueue_processing_job(job_id: str):
    if celery_app is None or not __import__("os").getenv("REDIS_URL", "").strip():
        return run_processing_pipeline(job_id)
    return run_processing_pipeline.delay(job_id)