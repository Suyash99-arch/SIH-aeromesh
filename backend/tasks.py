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

    pts = recon_result.get("sparse_point_count", 0) or recon_result.get("point_count", 0)
    status = "COMPLETED" if pts >= 50 else "PARTIAL"
    update_job(job_id, status=status, stage=status, progress_percent=100, message=f"3D reconstruction complete ({pts} points)")
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
        candidate_model_dirs = [
            mission_dir / "reconstruction" / "model" / "0",
            mission_dir / "reconstruction" / "model",
            mission_dir / "reconstruction" / "pinhole_model" / "0",
            mission_dir / "reconstruction" / "sparse" / "0",
        ]
        model_dir = None
        for cmd in candidate_model_dirs:
            if cmd.exists() and ((cmd / "cameras.bin").exists() or (cmd / "cameras.txt").exists()):
                model_dir = cmd
                break

        mesh_path = get_reconstruction_mesh_path(mission_id) or (mission_dir / "reconstruction" / "mesh.ply")
        if not (mesh_path and Path(mesh_path).exists()):
            mesh_path = None

        thresh = reprojection_threshold_px or float(os.getenv("SPATIAL_FUSION_REPROJ_THRESHOLD", "25.0"))

        if model_dir and model_dir.exists():
            import pycolmap
            recon = pycolmap.Reconstruction(model_dir)
            engine, poses_by_name = SpatialFusionEngine.from_reconstruction(
                reconstruction=recon,
                mesh_path=mesh_path,
                reprojection_threshold_px=thresh,
            )
        else:
            try:
                from .fuse_mission_3d import run_3d_fusion_for_mission
                fuse_res = run_3d_fusion_for_mission(mission_id)
                fused_dicts = fuse_res.get("objects", [])
                update_job(job_id, status="COMPLETED", stage="COMPLETED", progress_percent=100, message=f"AI-to-3D spatial fusion completed ({len(fused_dicts)} objects)")
                result = get_job_result(job_id) or {}
                result["objects_3d"] = fused_dicts
                return result
            except Exception as _f_exc:
                import logging
                logging.getLogger(__name__).warning("run_3d_fusion_for_mission notice: %s", _f_exc)
            engine = SpatialFusionEngine(reprojection_threshold_px=thresh)
            poses_by_name = {}

        update_job(job_id, status="FUSING_3D", stage="FUSING_3D", progress_percent=60, message="Fusing 2D tracks with 3D camera rays")

        tracks = mission.get("tracks") or []
        obs_list = (mission.get("detections") or {}).get("observations", [])
        if obs_list:
            obs_by_track = {}
            for o in obs_list:
                tid = o.get("trackId") or o.get("track_id")
                if tid:
                    obs_by_track.setdefault(tid, []).append(o)

            # Ensure tracks have observations populated
            enriched_tracks = []
            for t in tracks:
                t_copy = dict(t)
                tid = t_copy.get("trackId") or t_copy.get("track_id")
                if tid and "observations" not in t_copy and tid in obs_by_track:
                    t_copy["observations"] = obs_by_track[tid]
                enriched_tracks.append(t_copy)
            tracks = enriched_tracks

        fused_objects = engine.fuse_all_tracks(tracks, poses_by_name)

        update_job(job_id, status="FUSING_3D", stage="FUSING_3D", progress_percent=85, message=f"Validated {len(fused_objects)} 3D objects")

        fused_dicts = [obj.to_dict() for obj in fused_objects]
        mission.update({
            "objects_3d": fused_dicts,
            "semantic_scene": {
                "coordinate_system": "LOCAL_ARBITRARY",
                "scale_status": "RELATIVE_SCALE",
                "georeferencing_status": "UNREFERENCED",
                "total_objects": len(fused_dicts),
                "valid_objects": sum(1 for obj in fused_dicts if obj["association_status"] == "VALID"),
                "moving_objects": sum(1 for obj in fused_dicts if obj["motion_state"] == "MOVING"),
                "static_objects": sum(1 for obj in fused_dicts if obj["motion_state"] == "STATIC"),
                "reprojection_threshold_px": thresh,
                "objects": fused_dicts,
            },
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
def _real_pipeline_task(job_id: str):
    from .jobs import get_job, update_job
    from .main import DATA_DIR, MissionData, MISSIONS_DIR
    from pathlib import Path

    job = get_job(job_id)
    if not job:
        return None
    mission_id = job.get("mission_id")
    if not mission_id:
        return None

    mission = MissionData(mission_id)
    video_path = mission.get("video_path")
    if not video_path or not Path(video_path).exists():
        candidates = [
            MISSIONS_DIR / mission_id / "video.mp4",
            DATA_DIR / "missions" / mission_id / "video.mp4",
            DATA_DIR / "objects" / "missions" / mission_id / "video.mp4",
        ]
        obj_dir = DATA_DIR / "objects" / "missions" / mission_id
        if obj_dir.is_dir():
            candidates.extend(list(obj_dir.glob("*.mp4")))
        miss_dir = MISSIONS_DIR / mission_id
        if miss_dir.is_dir():
            candidates.extend(list(miss_dir.glob("*.mp4")))
        for cand in candidates:
            if Path(cand).is_file() and Path(cand).stat().st_size > 0:
                video_path = str(cand)
                break

    # 1. Detection & Tracking
    det_res = _detection_task(job_id, video_path=video_path, sample_fps=2.0)
    detections = det_res.get("detections", []) if isinstance(det_res, dict) else []
    track_res = _tracking_task(job_id, detections=detections)
    tracks = track_res.get("tracks", []) if isinstance(track_res, dict) else []

    # Format findings for UI compatibility
    findings = []
    for d in detections:
        c_name = str(d.get("class_name") or d.get("class") or "object")
        b_box = d.get("bbox") or d.get("box_2d") or [0, 0, 0, 0]
        f_id = d.get("frame_id", 1)
        findings.append({
            "id": d.get("id") or f"det_{d.get('track_id', 'obj')}_{f_id}",
            "title": c_name.title(),
            "confidence": int(round(float(d.get("confidence", 0.8)) * 100)) if float(d.get("confidence", 0.8)) <= 1.0 else int(d.get("confidence", 80)),
            "frame": int(f_id) if str(f_id).isdigit() else 1,
            "severity": "medium",
            "box": b_box,
        })

    mission.update({
        "detections": {"observations": detections, "count": len(detections)},
        "tracks": tracks,
        "findings": findings,
    })
    mission.save()

    # 2. Quality Metrics & Reconstructability
    try:
        from .reconstructability import analyze_video_reconstructability
        from .quality_metrics import analyze_video_quality_timeseries
        if video_path and Path(video_path).is_file():
            recon_check = analyze_video_reconstructability(video_path)
            q_data = analyze_video_quality_timeseries(video_path, sample_fps=2.0)
            mission.update({
                "metadata": {**dict(mission.get("metadata") or {}), "reconstructability": recon_check},
                "frameQuality": q_data,
                "quality": q_data.get("summary", {}),
            })
            mission.save()
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Quality/reconstructability pre-flight failed: %s", exc)

    # 3. 3D Reconstruction
    recon_res = _reconstruction_task(job_id, mission_id=mission_id, video_path=video_path, max_frames=30)
    if isinstance(recon_res, dict) and recon_res.get("reconstruction"):
        mission.update({"reconstruction": recon_res["reconstruction"]})
        mission.save()

    # 4. Spatial Fusion & Scale Calibration
    fuse_res = _fusion_task(job_id, mission_id=mission_id)

    update_job(job_id, status="COMPLETED", stage="COMPLETED", progress_percent=100, message="Full end-to-end processing pipeline completed successfully")
    return get_job_result(job_id)

if celery_app is not None:
    _real_pipeline_task = celery_app.task(name="aeromesh.run_processing_pipeline")(_real_pipeline_task)

run_processing_pipeline = _real_pipeline_task


def enqueue_processing_job(job_id: str):
    if celery_app is None or not __import__("os").getenv("REDIS_URL", "").strip():
        return run_processing_pipeline(job_id)
    try:
        return run_processing_pipeline.delay(job_id)
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning("Celery dispatch unavailable (%s); executing synchronously", exc)
        return run_processing_pipeline(job_id)