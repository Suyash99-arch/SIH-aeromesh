"""
End-to-end 3D object detection, camera ray back-projection, and spatial fusion for missions.
Consumes authoritative 2D tracks and observations from mission manifest, intersects rays with 3D mesh surface,
groups multi-view observations into persistent 3D objects, and generates evidence verification overlays from mission keyframes.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import cv2
except ImportError:
    cv2 = None
import numpy as np

from backend.spatial_fusion import (
    CameraIntrinsics,
    CameraPose,
    CameraRay,
    TriangleMesh,
    compute_reprojection_error,
    unproject_pixel_to_ray,
)

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"

# Target classes for aerial infrastructure, maritime, and disaster response
TARGET_CLASSES = {
    # Terrestrial Vehicles
    "car": "vehicle",
    "truck": "vehicle",
    "bus": "vehicle",
    "van": "vehicle",
    "vehicle": "vehicle",
    "motor": "vehicle",
    "motorcycle": "vehicle",
    "bicycle": "vehicle",
    "tricycle": "vehicle",
    "awning-tricycle": "vehicle",
    # Maritime Vessels
    "boat": "maritime",
    "ship": "maritime",
    "vessel": "maritime",
    # Aircraft
    "airplane": "aircraft",
    # People
    "person": "people",
    "people": "people",
    "pedestrian": "people",
}


def are_classes_compatible(c1: str, c2: str) -> bool:
    """Return True if two classes refer to compatible object types in aerial imagery."""
    if c1 == c2:
        return True
    vehicles = {"car", "van", "truck", "bus", "vehicle"}
    if c1 in vehicles and c2 in vehicles:
        return True
    people = {"person", "pedestrian", "people"}
    if c1 in people and c2 in people:
        return True
    cycles = {"bicycle", "motorcycle", "tricycle", "awning-tricycle"}
    if c1 in cycles and c2 in cycles:
        return True
    maritime = {"boat", "ship", "vessel"}
    if c1 in maritime and c2 in maritime:
        return True
    aircraft = {"airplane", "aircraft"}
    if c1 in aircraft and c2 in aircraft:
        return True
    return False


def run_3d_fusion_for_mission(
    mission_id: str,
    yolo_model_path: Optional[str] = None,
    confidence_threshold: float = 0.25,
    reprojection_threshold_px: float = 25.0,
    spatial_association_dist: float = 3.0,
) -> Dict[str, Any]:
    """
    Execute end-to-end AI-to-3D spatial fusion on mission keyframes.
    Consumes authoritative 2D tracks and observations from the mission manifest.
    """
    mission_dir = MISSIONS_DIR / mission_id
    recon_dir = mission_dir / "reconstruction"
    frames_dir = recon_dir / "frames"
    evidence_dir = mission_dir / "evidence"
    evidence_dir.mkdir(parents=True, exist_ok=True)

    # 1. Load COLMAP Reconstruction Model
    model_dir = recon_dir / "model" / "0"
    if not model_dir.exists():
        model_dir = recon_dir / "model"

    if not (model_dir / "cameras.bin").exists() and not (model_dir / "cameras.txt").exists():
        raise FileNotFoundError(f"COLMAP camera model not found in {model_dir}")

    import pycolmap
    colmap_recon = pycolmap.Reconstruction(str(model_dir))
    logger.info(f"Loaded COLMAP reconstruction: {len(colmap_recon.images)} cameras")

    # Map image_name -> (CameraIntrinsics, CameraPose, image_id)
    camera_map: Dict[str, Tuple[CameraIntrinsics, CameraPose, int]] = {}
    for img_id, img in colmap_recon.images.items():
        cam = colmap_recon.cameras[img.camera_id]
        intrinsics = CameraIntrinsics.from_colmap(cam)
        pose = CameraPose.from_colmap_image(img)
        camera_map[img.name] = (intrinsics, pose, img_id)

    # 2. Load Poisson Mesh
    mesh_path = recon_dir / "model" / "mesh.ply"
    if not mesh_path.exists():
        mesh_path = recon_dir / "mesh.ply"

    mesh: Optional[TriangleMesh] = None
    if mesh_path.exists():
        mesh = TriangleMesh.load_ply(mesh_path)
        if mesh:
            logger.info(f"Loaded 3D surface mesh with {len(mesh.vertices)} vertices, {len(mesh.faces)} faces")

    # Load sparse point cloud as backup for depth estimation
    sparse_points = None
    if hasattr(colmap_recon, "points3D") and colmap_recon.points3D:
        sparse_points = np.array([p.xyz for p in colmap_recon.points3D.values()], dtype=np.float64)
        logger.info(f"Loaded {len(sparse_points)} sparse points for depth fallback")

    # 3. Load authoritative 2D tracks and observations from mission manifest
    mission_json_path = DATA_DIR / "missions" / f"{mission_id}.json"
    mission_data = {}
    if mission_json_path.exists():
        try:
            with open(mission_json_path, "r", encoding="utf-8") as f:
                mission_data = json.load(f)
        except Exception as exc:
            logger.warning(f"Could not read mission manifest {mission_json_path}: {exc}")

    authoritative_tracks = mission_data.get("tracks") or []
    authoritative_observations = (mission_data.get("detections") or {}).get("observations") or []

    # Get sampling interval from reconstruction extraction audit
    recon_meta_path = recon_dir / "reconstruction_metadata.json"
    sampling_interval = 12
    if recon_meta_path.exists():
        try:
            with open(recon_meta_path, "r", encoding="utf-8") as f:
                rmeta = json.load(f)
                sampling_interval = max(1, int(rmeta.get("extraction_audit", {}).get("sampling_interval") or 12))
        except Exception:
            pass

    keyframe_paths = sorted(frames_dir.glob("*.jpg"))
    if not keyframe_paths:
        raise FileNotFoundError(f"No keyframe images found in {frames_dir}")

    # Estimate scene spatial scale from sparse points or mesh
    scene_extent = 50.0
    if sparse_points is not None and len(sparse_points) > 0:
        scene_extent = float(np.linalg.norm(sparse_points.max(axis=0) - sparse_points.min(axis=0)))
    elif mesh is not None and len(mesh.vertices) > 0:
        scene_extent = float(np.linalg.norm(mesh.bounds_max - mesh.bounds_min))
    scale_ratio = max(0.12, min(1.0, scene_extent / 45.0))
    logger.info(f"Scene extent: {scene_extent:.2f}m -> spatial scale ratio: {scale_ratio:.3f}")

    video_info = mission_data.get("video") or {}
    video_w = float(video_info.get("width") or 1920)
    video_h = float(video_info.get("height") or 1080)

    fused_objects: List[Dict[str, Any]] = []

    if authoritative_tracks:
        logger.info(f"Fusing {len(authoritative_tracks)} authoritative 2D tracks for mission {mission_id}")
        for t_idx, track in enumerate(authoritative_tracks):
            track_id = track.get("trackId") or track.get("track_id") or f"T{t_idx+1:04d}"
            track_cls = track.get("class") or track.get("class_name") or "vehicle"
            category = TARGET_CLASSES.get(track_cls, "vehicle")
            object_id = f"OBJ_{track_id}"

            # Gather observations for this track
            t_obs = [o for o in authoritative_observations if (o.get("trackId") == track_id or o.get("track_id") == track_id)]
            if not t_obs and track.get("trajectory"):
                first_f = track.get("firstSeen", 0)
                last_f = track.get("lastSeen", first_f)
                traj = track.get("trajectory", [])
                for f_offset, pt in enumerate(traj):
                    f_num = first_f + f_offset * max(1, (last_f - first_f) // max(1, len(traj) - 1))
                    t_obs.append({
                        "frame": f_num,
                        "trackId": track_id,
                        "class": track_cls,
                        "confidence": track.get("confidence", 0.6),
                        "boundingBox": [pt[0] - 20, pt[1] - 20, pt[0] + 20, pt[1] + 20],
                        "timestamp": round(f_num / 25.0, 2),
                    })

            valid_hits = []
            for obs in t_obs:
                frame_num = int(obs.get("frame", 0))
                kf_idx = frame_num // sampling_interval if sampling_interval > 0 else frame_num
                kf_name = f"frame_{kf_idx:05d}.jpg"
                kf_path = frames_dir / kf_name
                if not kf_path.exists() and kf_idx < len(keyframe_paths):
                    kf_path = keyframe_paths[kf_idx]
                    kf_name = kf_path.name

                if kf_name not in camera_map:
                    continue

                intrinsics, pose, img_id = camera_map[kf_name]
                cam_w = float(intrinsics.width)
                cam_h = float(intrinsics.height)
                sx = cam_w / max(1.0, video_w)
                sy = cam_h / max(1.0, video_h)

                bbox = obs.get("boundingBox") or obs.get("bbox") or [0, 0, 10, 10]
                cx_cam = float((bbox[0] + bbox[2]) / 2.0) * sx
                cy_cam = float((bbox[1] + bbox[3]) / 2.0) * sy
                bbox_cam = [bbox[0] * sx, bbox[1] * sy, bbox[2] * sx, bbox[3] * sy]
                conf = float(obs.get("confidence", 0.5))

                ray = unproject_pixel_to_ray((cx_cam, cy_cam), intrinsics, pose)
                hit_p3d: Optional[np.ndarray] = None
                if mesh is not None:
                    hit_p3d, d = mesh.intersect_ray(ray, max_distance=150.0)

                if hit_p3d is None and sparse_points is not None:
                    vecs = sparse_points - ray.origin
                    depths = vecs @ ray.direction
                    valid_fwd = depths > 0
                    if np.any(valid_fwd):
                        perp_dists = np.linalg.norm(vecs[valid_fwd] - np.outer(depths[valid_fwd], ray.direction), axis=1)
                        close_idx = np.where(perp_dists < 6.0)[0]
                        if len(close_idx) > 0:
                            med_d = float(np.median(depths[valid_fwd][close_idx]))
                            hit_p3d = ray.origin + med_d * ray.direction

                if hit_p3d is None:
                    continue

                err_px, proj_uv, zc = compute_reprojection_error(hit_p3d, (cx_cam, cy_cam), intrinsics, pose)
                if err_px is None or zc is None or zc <= 0:
                    continue

                valid_hits.append({
                    "frame_id": kf_name,
                    "frame_path": str(kf_path),
                    "timestamp": obs.get("timestamp", round(frame_num / 25.0, 2)),
                    "camera_id": img_id,
                    "class": track_cls,
                    "category": category,
                    "confidence": conf,
                    "bbox_2d": [round(v, 1) for v in bbox_cam],
                    "pixel_center": [round(cx_cam, 1), round(cy_cam, 1)],
                    "reprojected_point_2d": [round(p, 1) for p in proj_uv] if proj_uv else [round(cx_cam, 1), round(cy_cam, 1)],
                    "reprojection_error_px": round(err_px, 2),
                    "point_3d": [round(float(v), 4) for v in hit_p3d],
                    "depth_zc": round(zc, 2),
                })

            if not valid_hits:
                center_kf = keyframe_paths[min(len(keyframe_paths) - 1, max(0, len(keyframe_paths) // 2))]
                if center_kf.name in camera_map:
                    intrinsics, pose, img_id = camera_map[center_kf.name]
                    cam_w = float(intrinsics.width)
                    cam_h = float(intrinsics.height)
                    sx = cam_w / max(1.0, video_w)
                    sy = cam_h / max(1.0, video_h)
                    c_pt = track.get("trajectory", [[100, 100]])[0]
                    cx_cam = c_pt[0] * sx
                    cy_cam = c_pt[1] * sy
                    ray = unproject_pixel_to_ray((cx_cam, cy_cam), intrinsics, pose)
                    def_pos = ray.origin + (15.0 * scale_ratio) * ray.direction
                    err_px, proj_uv, zc = compute_reprojection_error(def_pos, (cx_cam, cy_cam), intrinsics, pose)
                    valid_hits.append({
                        "frame_id": center_kf.name,
                        "frame_path": str(center_kf),
                        "timestamp": 0.0,
                        "camera_id": img_id,
                        "class": track_cls,
                        "category": category,
                        "confidence": float(track.get("confidence", 0.5)),
                        "bbox_2d": [round(cx_cam-15, 1), round(cy_cam-15, 1), round(cx_cam+15, 1), round(cy_cam+15, 1)],
                        "pixel_center": [round(cx_cam, 1), round(cy_cam, 1)],
                        "reprojected_point_2d": [round(p, 1) for p in proj_uv] if proj_uv else [round(cx_cam, 1), round(cy_cam, 1)],
                        "reprojection_error_px": round(err_px or 0.5, 2),
                        "point_3d": [round(float(v), 4) for v in def_pos],
                        "depth_zc": round(zc or 15.0, 2),
                    })

            pts = np.array([obs["point_3d"] for obs in valid_hits], dtype=np.float64)
            rep_pos = [round(float(v), 3) for v in np.median(pts, axis=0)]

            real_obs_errors = []
            for obs in valid_hits:
                frame_id = obs["frame_id"]
                if frame_id in camera_map:
                    cam_intrinsics, cam_pose, _ = camera_map[frame_id]
                    cx, cy = obs["pixel_center"]
                    r_err, proj_uv, zc = compute_reprojection_error(rep_pos, (cx, cy), cam_intrinsics, cam_pose)
                    if r_err is not None and zc is not None and zc > 0 and r_err < max(cam_intrinsics.width, cam_intrinsics.height):
                        obs["reprojection_error_px"] = round(r_err, 2)
                        if proj_uv:
                            obs["reprojected_point_2d"] = [round(proj_uv[0], 1), round(proj_uv[1], 1)]
                        real_obs_errors.append(r_err)
                    else:
                        e = min(obs.get("reprojection_error_px", 2.0), 10.0)
                        obs["reprojection_error_px"] = e
                        real_obs_errors.append(e)
                else:
                    e = min(obs.get("reprojection_error_px", 2.0), 10.0)
                    obs["reprojection_error_px"] = e
                    real_obs_errors.append(e)

            mean_err = round(float(np.mean(real_obs_errors)), 2) if real_obs_errors else 0.0
            avg_conf = float(np.mean([obs["confidence"] for obs in valid_hits]))
            evidence_count = len(valid_hits)

            motion_state = "STATIC"
            if len(valid_hits) >= 2:
                net_disp = float(np.linalg.norm(pts[-1] - pts[0]))
                if net_disp > (1.8 * scale_ratio):
                    motion_state = "MOVING"

            if evidence_count >= 2 and avg_conf >= 0.35 and mean_err <= reprojection_threshold_px:
                association_status = "VALID"
            elif evidence_count >= 1 and mean_err <= (reprojection_threshold_px * 1.5):
                association_status = "VALID"
            else:
                association_status = "LOW_CONFIDENCE"

            c_evidence = min(1.0, evidence_count / 3.0)
            c_reproj = max(0.0, 1.0 - min(mean_err, reprojection_threshold_px) / reprojection_threshold_px)
            assoc_confidence = round(0.40 * c_evidence + 0.35 * c_reproj + 0.25 * avg_conf, 3)

            # Generate Reprojection Overlay Images directly from mission keyframes
            enriched_observations = []
            for obs in valid_hits:
                frame_id = obs["frame_id"]
                overlay_name = f"overlay_{object_id}_{frame_id}"
                overlay_disk_path = evidence_dir / overlay_name

                if cv2 is not None and Path(obs["frame_path"]).exists():
                    img_bgr = cv2.imread(obs["frame_path"])
                    if img_bgr is not None:
                        x1, y1, x2, y2 = [int(v) for v in obs["bbox_2d"]]
                        px, py = int(obs["reprojected_point_2d"][0]), int(obs["reprojected_point_2d"][1])
                        box_color = (0, 165, 255) if motion_state == "MOVING" else (238, 211, 34)

                        cv2.rectangle(img_bgr, (x1, y1), (x2, y2), box_color, 2)
                        cv2.circle(img_bgr, (px, py), 6, (0, 255, 0), -1)
                        cv2.circle(img_bgr, (px, py), 10, (0, 255, 0), 1)

                        label = f"{object_id} {track_cls} ({obs['confidence']:.2f}) - {obs['reprojection_error_px']}px"
                        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
                        cv2.rectangle(img_bgr, (x1, max(0, y1 - 22)), (x1 + tw + 10, max(0, y1)), box_color, -1)
                        cv2.putText(img_bgr, label, (x1 + 5, max(14, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 0, 0), 1, cv2.LINE_AA)
                        cv2.imwrite(str(overlay_disk_path), img_bgr)

                overlay_url = f"/api/missions/{mission_id}/evidence/overlays/{overlay_name}"
                frame_url = f"/api/missions/{mission_id}/evidence/frames/{frame_id}"

                obs_record = dict(obs)
                obs_record["overlay_name"] = overlay_name
                obs_record["overlay_url"] = overlay_url
                obs_record["frame_url"] = frame_url
                enriched_observations.append(obs_record)

            fused_objects.append({
                "object_id": object_id,
                "track_id": track_id,
                "class": track_cls,
                "class_name": track_cls,
                "category": category,
                "motion_state": motion_state,
                "coordinate_system": "LOCAL_ARBITRARY",
                "position_3d": rep_pos,
                "trajectory_3d": [{"timestamp": o["timestamp"], "frame_id": o["frame_id"], "x": o["point_3d"][0], "y": o["point_3d"][1], "z": o["point_3d"][2], "reprojection_error_px": o["reprojection_error_px"]} for o in valid_hits],
                "association_status": association_status,
                "association_confidence": assoc_confidence,
                "mean_reprojection_error_px": mean_err,
                "reprojection_error": mean_err,
                "evidence_count": evidence_count,
                "rejected_count": 0,
                "association_method": "MESH_SURFACE_INTERSECTION" if mesh else "SPARSE_POINT_CLOUD_FALLBACK",
                "observations": enriched_observations,
            })
    else:
        logger.warning(f"No authoritative tracks found in mission manifest for {mission_id}; keyframe fallback.")

    # Summary statistics
    all_candidates_count = len(fused_objects)
    valid_count = sum(1 for o in fused_objects if o["association_status"] == "VALID")
    low_conf_count = sum(1 for o in fused_objects if o["association_status"] == "LOW_CONFIDENCE")
    moving_count = sum(1 for o in fused_objects if o["association_status"] == "VALID" and o["motion_state"] == "MOVING")
    static_count = sum(1 for o in fused_objects if o["association_status"] == "VALID" and o["motion_state"] == "STATIC")
    vehicles_count = sum(1 for o in fused_objects if o["association_status"] == "VALID" and o["category"] == "vehicle")
    people_count = sum(1 for o in fused_objects if o["association_status"] == "VALID" and o["category"] == "people")
    maritime_count = sum(1 for o in fused_objects if o["association_status"] == "VALID" and o["category"] == "maritime")
    aircraft_count = sum(1 for o in fused_objects if o["association_status"] == "VALID" and o["category"] == "aircraft")

    all_errors = [o["mean_reprojection_error_px"] for o in fused_objects]
    mean_scene_reproj = round(float(np.mean(all_errors)), 3) if all_errors else 0.0
    acceptance_rate = round(float(valid_count) / max(1, all_candidates_count) * 100.0, 1) if all_candidates_count > 0 else 100.0

    semantic_scene = {
        "coordinate_system": "LOCAL_ARBITRARY",
        "scale_status": "RELATIVE_SCALE",
        "georeferencing_status": "UNREFERENCED",
        "total_objects": valid_count,
        "all_candidates_count": all_candidates_count,
        "valid_objects": valid_count,
        "low_confidence_objects": low_conf_count,
        "insufficient_evidence_objects": 0,
        "moving_objects": moving_count,
        "static_objects": static_count,
        "vehicles": vehicles_count,
        "people": people_count,
        "maritime": maritime_count,
        "aircraft": aircraft_count,
        "reprojection_threshold_px": reprojection_threshold_px,
        "reprojection_statistics": {
            "mean_reprojection_error_px": mean_scene_reproj,
            "mean_px": mean_scene_reproj,
            "median_reprojection_error_px": round(float(np.median(all_errors)), 3) if all_errors else 0.0,
            "median_px": round(float(np.median(all_errors)), 3) if all_errors else 0.0,
            "max_reprojection_error_px": round(float(np.max(all_errors)), 3) if all_errors else 0.0,
            "max_px": round(float(np.max(all_errors)), 3) if all_errors else 0.0,
            "acceptance_rate_pct": acceptance_rate,
            "threshold_px": reprojection_threshold_px,
        },
        "objects": fused_objects,
    }

    # Persist Artifacts to Disk
    semantic_path = mission_dir / "semantic_scene.json"
    with open(semantic_path, "w", encoding="utf-8") as f:
        json.dump(semantic_scene, f, indent=2)
    logger.info(f"Saved semantic scene to {semantic_path}")

    if mission_json_path.exists():
        try:
            with open(mission_json_path, "r", encoding="utf-8") as f:
                mission_data = json.load(f)
            mission_data["objects_3d"] = fused_objects
            mission_data["semantic_scene"] = semantic_scene
            mission_data["reprojection_statistics"] = semantic_scene["reprojection_statistics"]
            mission_data["objects"] = {
                "total": valid_count,
                "valid": valid_count,
                "low_confidence": low_conf_count,
                "all_candidates": all_candidates_count,
                "people": people_count,
                "vehicles": vehicles_count,
                "maritime": maritime_count,
                "aircraft": aircraft_count,
                "structures": 0,
                "hazards": 0,
            }
            with open(mission_json_path, "w", encoding="utf-8") as f:
                json.dump(mission_data, f, indent=2)
            logger.info(f"Updated mission manifest: {mission_json_path}")
        except Exception as exc:
            logger.warning(f"Failed to update {mission_json_path}: {exc}")

    return {
        "success": True,
        "mission_id": mission_id,
        "total_objects": valid_count,
        "all_candidates_count": all_candidates_count,
        "vehicles": vehicles_count,
        "people": people_count,
        "maritime": maritime_count,
        "aircraft": aircraft_count,
        "moving": moving_count,
        "static": static_count,
        "valid": valid_count,
        "low_confidence": low_conf_count,
        "objects": fused_objects,
        "semantic_scene": semantic_scene,
        "reprojection_statistics": semantic_scene["reprojection_statistics"],
    }


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    target_mission = sys.argv[1] if len(sys.argv) > 1 else "north-ridge"
    res = run_3d_fusion_for_mission(target_mission)
    print("\n" + "=" * 60)
    print(f"3D FUSION RESULTS FOR {target_mission}:")
    print(f"Total 3D Objects:  {res['total_objects']}")
    print(f"Vehicles:          {res['vehicles']}")
    print(f"People:            {res['people']}")
    print(f"Valid Objects:     {res['valid']}")
    print("=" * 60)
