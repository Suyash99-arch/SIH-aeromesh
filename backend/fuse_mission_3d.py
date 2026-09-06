"""
End-to-end 3D object detection, camera ray back-projection, and spatial fusion for missions.
Runs YOLO on reconstruction keyframes, intersects rays with 3D mesh surface, groups observations
into persistent 3D objects, and generates evidence verification overlays.
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
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

# Target classes for aerial infrastructure & disaster response
TARGET_CLASSES = {
    "car": "vehicle",
    "truck": "vehicle",
    "bus": "vehicle",
    "van": "vehicle",
    "vehicle": "vehicle",
    "person": "people",
    "pedestrian": "people",
}


def run_3d_fusion_for_mission(
    mission_id: str = "north-ridge",
    yolo_model_path: Optional[str] = None,
    confidence_threshold: float = 0.25,
    reprojection_threshold_px: float = 25.0,
    spatial_association_dist: float = 3.0,
) -> Dict[str, Any]:
    """
    Execute end-to-end AI-to-3D spatial fusion on mission keyframes.
    """
    mission_dir = DATA_DIR / "missions" / mission_id
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

    # 3. Load YOLO Model
    if yolo_model_path is None:
        cand_paths = [
            BASE_DIR / "yolo11n.pt",
            BASE_DIR / "backend" / "models" / "yolo11n.pt",
            BASE_DIR / "backend" / "models" / "aeromesh_yolo.pt",
        ]
        for p in cand_paths:
            if p.exists():
                yolo_model_path = str(p)
                break

    if not yolo_model_path or not Path(yolo_model_path).exists():
        raise FileNotFoundError("YOLO weights not found. Ensure yolo11n.pt exists.")

    from ultralytics import YOLO
    model = YOLO(yolo_model_path)
    logger.info(f"Loaded YOLO detector from {yolo_model_path}")

    # 4. Run Detection & 3D Ray Back-Projection on Keyframes
    keyframe_paths = sorted(frames_dir.glob("*.jpg"))
    if not keyframe_paths:
        raise FileNotFoundError(f"No keyframe images found in {frames_dir}")

    detections_raw: List[Dict[str, Any]] = []

    for frame_idx, kf_path in enumerate(keyframe_paths):
        frame_name = kf_path.name
        if frame_name not in camera_map:
            continue

        intrinsics, pose, img_id = camera_map[frame_name]
        timestamp = round(frame_idx * (5.0 / max(len(keyframe_paths) - 1, 1)), 2)

        pred_res = model.predict(str(kf_path), conf=confidence_threshold, verbose=False)[0]
        boxes = pred_res.boxes

        for b_idx in range(len(boxes)):
            cls_id = int(boxes.cls[b_idx].item())
            cls_name = model.names[cls_id]
            conf = float(boxes.conf[b_idx].item())

            # Filter relevant classes
            if cls_name not in TARGET_CLASSES:
                continue

            xyxy = boxes.xyxy[b_idx].cpu().numpy().tolist()
            cx = float((xyxy[0] + xyxy[2]) / 2.0)
            cy = float((xyxy[1] + xyxy[3]) / 2.0)

            # Unproject 2D pixel to 3D world ray
            ray = unproject_pixel_to_ray((cx, cy), intrinsics, pose)

            # Find 3D intersection with mesh or point cloud
            hit_p3d: Optional[np.ndarray] = None
            dist: float = 0.0

            if mesh is not None:
                hit_p3d, d = mesh.intersect_ray(ray, max_distance=150.0)
                if hit_p3d is not None and d is not None:
                    dist = d

            # Point cloud fallback if mesh didn't hit or point is behind
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
                        dist = med_d

            if hit_p3d is None:
                continue

            # Compute reprojection error
            err_px, proj_uv, zc = compute_reprojection_error(hit_p3d, (cx, cy), intrinsics, pose)
            if err_px is None or err_px > reprojection_threshold_px or zc is None or zc <= 0:
                continue

            detections_raw.append({
                "frame_id": frame_name,
                "frame_path": str(kf_path),
                "timestamp": timestamp,
                "camera_id": img_id,
                "class": cls_name,
                "category": TARGET_CLASSES[cls_name],
                "confidence": conf,
                "bbox_2d": [round(v, 1) for v in xyxy],
                "pixel_center": [round(cx, 1), round(cy, 1)],
                "reprojected_point_2d": [round(p, 1) for p in proj_uv] if proj_uv else [round(cx, 1), round(cy, 1)],
                "reprojection_error_px": round(err_px, 2),
                "point_3d": [round(float(v), 4) for v in hit_p3d],
                "depth_zc": round(zc, 2),
            })

    logger.info(f"Extracted {len(detections_raw)} validated 3D back-projected detections")

    # 5. Spatio-Temporal Association into 3D Object Tracks
    # Group observations across keyframes by 3D spatial proximity and class
    tracks: List[List[Dict[str, Any]]] = []

    # Sort detections by timestamp / frame index
    detections_raw.sort(key=lambda d: d["timestamp"])

    for det in detections_raw:
        det_p = np.array(det["point_3d"])
        best_track_idx = -1
        best_dist = float("inf")

        for t_idx, track in enumerate(tracks):
            # Check class compatibility
            if track[0]["class"] != det["class"]:
                continue
            # Check frame separation (avoid grouping two detections from same frame)
            if any(obs["frame_id"] == det["frame_id"] for obs in track):
                continue
            # Spatial distance to track representative point
            track_pts = np.array([obs["point_3d"] for obs in track])
            track_center = np.median(track_pts, axis=0)
            d = float(np.linalg.norm(track_center - det_p))
            if d < spatial_association_dist and d < best_dist:
                best_dist = d
                best_track_idx = t_idx

        if best_track_idx >= 0:
            tracks[best_track_idx].append(det)
        else:
            tracks.append([det])

    # 6. Build Structured 3D Objects with Motion Classification
    fused_objects: List[Dict[str, Any]] = []

    for t_idx, obs_list in enumerate(tracks, start=1):
        track_id = f"T{t_idx:04d}"
        object_id = f"OBJ_{track_id}"
        cls_name = obs_list[0]["class"]
        category = obs_list[0]["category"]

        pts = np.array([obs["point_3d"] for obs in obs_list], dtype=np.float64)
        rep_pos = [round(float(v), 3) for v in np.median(pts, axis=0)]

        # Trajectory & motion state
        trajectory: List[Dict[str, Any]] = []
        for obs in obs_list:
            trajectory.append({
                "timestamp": obs["timestamp"],
                "frame_id": obs["frame_id"],
                "x": obs["point_3d"][0],
                "y": obs["point_3d"][1],
                "z": obs["point_3d"][2],
                "reprojection_error_px": obs["reprojection_error_px"],
            })

        motion_state = "STATIC"
        if len(obs_list) >= 2:
            net_disp = float(np.linalg.norm(pts[-1] - pts[0]))
            if net_disp > 1.8:
                motion_state = "MOVING"
            else:
                motion_state = "STATIC"

        # Evidence count & Association status
        evidence_count = len(obs_list)
        errors = [obs["reprojection_error_px"] for obs in obs_list]
        mean_err = round(float(np.mean(errors)), 2)
        avg_conf = float(np.mean([obs["confidence"] for obs in obs_list]))

        if evidence_count >= 2 and avg_conf >= 0.35 and mean_err <= reprojection_threshold_px:
            association_status = "VALID"
        elif evidence_count >= 1:
            association_status = "LOW_CONFIDENCE"
        else:
            association_status = "INSUFFICIENT_EVIDENCE"

        # Confidence score (0.0 - 1.0)
        c_evidence = min(1.0, evidence_count / 3.0)
        c_reproj = max(0.0, 1.0 - mean_err / reprojection_threshold_px)
        assoc_confidence = round(0.40 * c_evidence + 0.35 * c_reproj + 0.25 * avg_conf, 3)

        # 7. Generate Reprojection Overlay Images for Evidence Modal
        enriched_observations: List[Dict[str, Any]] = []
        for obs in obs_list:
            frame_id = obs["frame_id"]
            overlay_name = f"overlay_{object_id}_{frame_id}"
            overlay_disk_path = evidence_dir / overlay_name
            
            # Draw visual evidence overlay
            img_bgr = cv2.imread(obs["frame_path"])
            if img_bgr is not None:
                x1, y1, x2, y2 = [int(v) for v in obs["bbox_2d"]]
                cx, cy = int(obs["pixel_center"][0]), int(obs["pixel_center"][1])
                px, py = int(obs["reprojected_point_2d"][0]), int(obs["reprojected_point_2d"][1])

                # Color: cyan for static, orange for moving
                box_color = (0, 165, 255) if motion_state == "MOVING" else (238, 211, 34)

                # Bounding box
                cv2.rectangle(img_bgr, (x1, y1), (x2, y2), box_color, 2)

                # Reprojected center circle
                cv2.circle(img_bgr, (px, py), 6, (0, 255, 0), -1)
                cv2.circle(img_bgr, (px, py), 10, (0, 255, 0), 1)

                # Label banner
                label = f"{object_id} {cls_name} ({obs['confidence']:.2f}) - {obs['reprojection_error_px']}px"
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
            "class": cls_name,
            "class_name": cls_name,
            "category": category,
            "motion_state": motion_state,
            "coordinate_system": "LOCAL_ARBITRARY",
            "position_3d": rep_pos,
            "trajectory_3d": trajectory,
            "association_status": association_status,
            "association_confidence": assoc_confidence,
            "mean_reprojection_error_px": mean_err,
            "reprojection_error": mean_err,
            "evidence_count": evidence_count,
            "rejected_count": 0,
            "association_method": "MESH_SURFACE_INTERSECTION" if mesh else "SPARSE_POINT_CLOUD_FALLBACK",
            "observations": enriched_observations,
        })

    # Summary statistics
    total_objects = len(fused_objects)
    valid_count = sum(1 for o in fused_objects if o["association_status"] == "VALID")
    low_conf_count = sum(1 for o in fused_objects if o["association_status"] == "LOW_CONFIDENCE")
    moving_count = sum(1 for o in fused_objects if o["motion_state"] == "MOVING")
    static_count = sum(1 for o in fused_objects if o["motion_state"] == "STATIC")
    vehicles_count = sum(1 for o in fused_objects if o["category"] == "vehicle")
    people_count = sum(1 for o in fused_objects if o["category"] == "people")

    semantic_scene = {
        "coordinate_system": "LOCAL_ARBITRARY",
        "scale_status": "RELATIVE_SCALE",
        "georeferencing_status": "UNREFERENCED",
        "total_objects": total_objects,
        "valid_objects": valid_count,
        "low_confidence_objects": low_conf_count,
        "insufficient_evidence_objects": 0,
        "moving_objects": moving_count,
        "static_objects": static_count,
        "vehicles": vehicles_count,
        "people": people_count,
        "reprojection_threshold_px": reprojection_threshold_px,
        "objects": fused_objects,
    }

    # 8. Persist Artifacts to Disk
    # A) data/missions/{mission_id}/semantic_scene.json
    semantic_path = mission_dir / "semantic_scene.json"
    with open(semantic_path, "w", encoding="utf-8") as f:
        json.dump(semantic_scene, f, indent=2)
    logger.info(f"Saved semantic scene to {semantic_path}")

    # B) Update data/missions/{mission_id}.json
    mission_json_path = DATA_DIR / "missions" / f"{mission_id}.json"
    if mission_json_path.exists():
        try:
            with open(mission_json_path, "r", encoding="utf-8") as f:
                mission_data = json.load(f)
            mission_data["objects_3d"] = fused_objects
            mission_data["semantic_scene"] = semantic_scene
            mission_data["objects"] = {
                "total": total_objects,
                "people": people_count,
                "vehicles": vehicles_count,
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
        "total_objects": total_objects,
        "vehicles": vehicles_count,
        "people": people_count,
        "moving": moving_count,
        "static": static_count,
        "valid": valid_count,
        "low_confidence": low_conf_count,
        "objects": fused_objects,
    }


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    res = run_3d_fusion_for_mission("north-ridge")
    print("\n" + "=" * 60)
    print("3D FUSION RESULTS:")
    print(f"Total 3D Objects:  {res['total_objects']}")
    print(f"Vehicles:          {res['vehicles']}")
    print(f"People:            {res['people']}")
    print(f"Static Objects:    {res['static']}")
    print(f"Moving Objects:    {res['moving']}")
    print(f"Valid Objects:     {res['valid']}")
    print("=" * 60)
    for obj in res["objects"][:5]:
        print(f" - {obj['object_id']} ({obj['class']}): pos={obj['position_3d']} state={obj['motion_state']} err={obj['mean_reprojection_error_px']}px obs={obj['evidence_count']}")
