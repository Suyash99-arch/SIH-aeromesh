from __future__ import annotations

import enum
import json
import logging
import os
import shutil
import struct
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"

# Detect pycolmap availability
try:
    import pycolmap  # type: ignore
    has_pycolmap = True
except ImportError:
    pycolmap = None  # type: ignore
    has_pycolmap = False


class ReconstructionStatus(str, enum.Enum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    SPARSE_RECONSTRUCTED = "SPARSE_RECONSTRUCTED"
    DENSE_RECONSTRUCTED = "DENSE_RECONSTRUCTED"
    MESH_GENERATED = "MESH_GENERATED"
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    FAILED = "FAILED"


class ScaleStatus(str, enum.Enum):
    RELATIVE_SCALE = "RELATIVE_SCALE"
    METRIC_SCALE = "METRIC_SCALE"
    UNKNOWN_SCALE = "UNKNOWN_SCALE"


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


# ============================================================
# FRAME QUALITY & OVERLAP FILTERING
# ============================================================

def assess_frame_quality(
    frame: np.ndarray,
    min_sharpness: float = 12.0,
    min_brightness: float = 15.0,
    max_brightness: float = 88.0,
    min_features: int = 25,
) -> Dict[str, Any]:
    """
    Evaluate frame suitability for photogrammetry.
    Filters: blur (Laplacian variance), under/over exposure (mean luminance),
    and corner feature density (goodFeaturesToTrack).
    """
    if frame is None or frame.size == 0:
        return {
            "accepted": False,
            "sharpness": 0.0,
            "brightness": 0.0,
            "contrast": 0.0,
            "feature_count": 0,
            "rejection_reasons": ["empty_frame"],
        }

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    # Sharpness via Laplacian variance
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    
    # Exposure / brightness (0 - 100)
    brightness = float(gray.mean() / 255.0 * 100.0)
    
    # Contrast via standard deviation (0 - 100)
    contrast = float(gray.std() / 128.0 * 100.0)
    
    # Corner feature density (minimum corners for SIFT/SfM matching)
    # Downsample for fast feature checking if high resolution
    h, w = gray.shape[:2]
    scale = min(1.0, 640.0 / max(h, w))
    small = cv2.resize(gray, (int(w * scale), int(h * scale))) if scale < 1.0 else gray
    corners = cv2.goodFeaturesToTrack(small, maxCorners=200, qualityLevel=0.01, minDistance=10)
    feature_count = int(len(corners)) if corners is not None else 0

    rejections = []
    if sharpness < min_sharpness:
        rejections.append("low_sharpness")
    if brightness < min_brightness:
        rejections.append("under_exposed")
    elif brightness > max_brightness:
        rejections.append("over_exposed")
    if feature_count < min_features:
        rejections.append("insufficient_features")

    return {
        "accepted": len(rejections) == 0,
        "sharpness": round(sharpness, 2),
        "brightness": round(brightness, 1),
        "contrast": round(min(100.0, contrast), 1),
        "feature_count": feature_count,
        "rejection_reasons": rejections,
    }


def is_near_duplicate(frame1: np.ndarray, frame2: np.ndarray, diff_threshold: float = 3.0) -> bool:
    """Check if two consecutive frames have virtually zero motion/visual change."""
    if frame1 is None or frame2 is None:
        return False
    # Resize to thumbnail for fast mean absolute difference comparison
    g1 = cv2.resize(cv2.cvtColor(frame1, cv2.COLOR_BGR2GRAY), (160, 90))
    g2 = cv2.resize(cv2.cvtColor(frame2, cv2.COLOR_BGR2GRAY), (160, 90))
    diff = float(np.mean(np.abs(g1.astype(np.float32) - g2.astype(np.float32))))
    return diff < diff_threshold


def extract_frames_with_quality(
    video_path: Path,
    mission_id: str,
    max_frames: int = 40,
    target_fps: float = 2.0,
    min_sharpness: float = 12.0,
) -> Dict[str, Any]:
    """
    Extract frames from video with quality filtering and overlap selection.
    Avoids arbitrary selection by filtering blur, exposure, stationary duplicates,
    and feature-poor frames.
    """
    mission_dir = _ensure_dir(MISSIONS_DIR / mission_id / "reconstruction")
    frames_dir = _ensure_dir(mission_dir / "frames")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return {
            "success": False,
            "error": f"Unable to open video: {video_path}",
            "frames_dir": str(frames_dir),
            "selected_frames": [],
        }

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 24.0)
    if total_frames <= 0 or fps <= 0:
        cap.release()
        return {
            "success": False,
            "error": "Invalid video frame count or framerate",
            "frames_dir": str(frames_dir),
            "selected_frames": [],
        }

    # Frame interval for target sampling
    interval = max(1, round(fps / max(target_fps, 0.5)))
    
    extracted_candidates = 0
    selected_frames = []
    rejected_reasons_tally: Dict[str, int] = {}
    prev_accepted_frame = None
    frame_index = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if frame_index % interval == 0:
            extracted_candidates += 1
            timestamp = round(frame_index / fps, 3)
            
            # 1. Quality filter
            q = assess_frame_quality(frame, min_sharpness=min_sharpness)
            if not q["accepted"]:
                for r in q["rejection_reasons"]:
                    rejected_reasons_tally[r] = rejected_reasons_tally.get(r, 0) + 1
                frame_index += 1
                continue

            # 2. Duplicate / overlap filter against previously accepted frame
            if prev_accepted_frame is not None and is_near_duplicate(frame, prev_accepted_frame):
                rejected_reasons_tally["near_duplicate"] = rejected_reasons_tally.get("near_duplicate", 0) + 1
                frame_index += 1
                continue

            # Frame passed quality and overlap checks
            # Scale ultra-high-res 4K frames to 1920p max dimension for memory-safe CPU photogrammetry
            h, w = frame.shape[:2]
            if max(h, w) > 1920:
                scale_factor = 1920.0 / max(h, w)
                save_frame = cv2.resize(frame, (int(w * scale_factor), int(h * scale_factor)), interpolation=cv2.INTER_AREA)
            else:
                save_frame = frame

            frame_filename = f"frame_{len(selected_frames):05d}.jpg"
            frame_path = frames_dir / frame_filename
            cv2.imwrite(str(frame_path), save_frame)

            selected_frames.append({
                "frame_index": frame_index,
                "timestamp": timestamp,
                "filename": frame_filename,
                "path": str(frame_path),
                "quality": q,
            })
            prev_accepted_frame = frame.copy()

            if len(selected_frames) >= max_frames:
                break

        frame_index += 1

    cap.release()

    return {
        "success": len(selected_frames) >= 3,
        "frames_dir": str(frames_dir),
        "total_source_frames": total_frames,
        "extracted_candidates": extracted_candidates,
        "selected_count": len(selected_frames),
        "rejected_count": sum(rejected_reasons_tally.values()),
        "rejection_breakdown": rejected_reasons_tally,
        "sampling_interval": interval,
        "selected_frames": selected_frames,
    }


# ============================================================
# SCALE & GEOREFERENCE EVALUATION
# ============================================================

def evaluate_scale_and_georeference(
    has_gps: bool = False,
    has_rtk: bool = False,
    has_gcps: bool = False,
    known_scale: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Enforce scientific rigor on reconstructed geometry.
    Monocular drone video without calibrated metric targets or RTK GNSS
    is strictly marked as RELATIVE_SCALE.
    """
    if has_rtk or has_gcps:
        return {
            "scale_status": ScaleStatus.METRIC_SCALE.value,
            "georeferencing_status": "GEOREFERENCED",
            "coordinate_system": "EPSG:4326_OR_UTM",
            "scale_method": "RTK_OR_GCP_CALIBRATED",
            "uncertainty_note": "Absolute metric scale anchored by RTK GNSS or surveyed Ground Control Points.",
        }
    if has_gps:
        return {
            "scale_status": ScaleStatus.RELATIVE_SCALE.value,
            "georeferencing_status": "COARSE_GPS_ESTIMATED",
            "coordinate_system": "LOCAL_ARBITRARY",
            "scale_method": "CONSUMER_GPS_PRIOR",
            "uncertainty_note": "Consumer drone GNSS provides geographic context; photogrammetric model scale remains relative without ground control.",
        }
    return {
        "scale_status": ScaleStatus.RELATIVE_SCALE.value,
        "georeferencing_status": "UNREFERENCED",
        "coordinate_system": "LOCAL_ARBITRARY",
        "scale_method": "MONOCULAR_SFM_ESTIMATED",
        "uncertainty_note": "Monocular video SfM is scale-ambiguous; units are arbitrary relative coordinates, not true meters.",
    }


def inspect_video_camera_metadata(video_path: Path) -> Dict[str, Any]:
    """Inspect video technical metadata and declare camera intrinsics estimation state."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return {"available": False, "error": "Unable to decode video metadata"}

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    cap.release()

    return {
        "available": True,
        "resolution": {"width": width, "height": height},
        "fps": round(fps, 2),
        "total_frames": total_frames,
        "duration_seconds": round(total_frames / fps, 2) if fps > 0 else 0.0,
        "intrinsics_status": "ESTIMATED",
        "intrinsics_source": "ESTIMATED_BY_COLMAP",
        "intrinsics_model": "PINHOLE_RADIAL",
        "intrinsics_note": "Factory camera intrinsics not embedded; estimated automatically via COLMAP self-calibration.",
    }


# ============================================================
# COLMAP RECONSTRUCTION PIPELINE
# ============================================================

def _count_ply_points_and_faces(ply_path: Path) -> Tuple[int, int]:
    """Read vertex and face counts from a PLY header without loading full body."""
    if not ply_path.exists():
        return 0, 0
    vertex_count = 0
    face_count = 0
    try:
        with ply_path.open("r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                stripped = line.strip()
                if stripped.startswith("element vertex"):
                    parts = stripped.split()
                    if len(parts) >= 3 and parts[2].isdigit():
                        vertex_count = int(parts[2])
                elif stripped.startswith("element face"):
                    parts = stripped.split()
                    if len(parts) >= 3 and parts[2].isdigit():
                        face_count = int(parts[2])
                elif stripped.startswith("end_header"):
                    break
    except Exception:
        pass
    return vertex_count, face_count


def _run_pycolmap_sfm(
    database_path: Path,
    frames_dir: Path,
    output_dir: Path,
    progress_cb: Optional[Callable[[str, int], None]] = None,
) -> Dict[str, Any]:
    """Execute feature extraction, matching, and incremental SfM using native pycolmap."""
    if progress_cb:
        progress_cb("Extracting SIFT features", 30)

    # 1. Feature extraction with memory-safe CPU options and single drone camera
    extraction_options = pycolmap.FeatureExtractionOptions()
    extraction_options.max_image_size = 1920
    extraction_options.num_threads = min(os.cpu_count() or 4, 4)
    extraction_options.use_gpu = False

    reader_options = pycolmap.ImageReaderOptions()
    reader_options.camera_model = "SIMPLE_PINHOLE"

    pycolmap.extract_features(
        database_path=database_path,
        image_path=frames_dir,
        camera_mode=pycolmap.CameraMode.SINGLE,
        reader_options=reader_options,
        extraction_options=extraction_options,
    )

    if progress_cb:
        progress_cb("Matching visual features across frames", 55)

    # 2. Exhaustive feature matching with sequential fallback
    matching_options = pycolmap.FeatureMatchingOptions()
    matching_options.num_threads = min(os.cpu_count() or 4, 4)
    matching_options.use_gpu = False

    try:
        pycolmap.match_exhaustive(database_path=database_path, matching_options=matching_options)
    except Exception as exc:
        logger.info("Exhaustive match notice, attempting sequential match: %s", exc)
        try:
            pycolmap.match_sequential(database_path=database_path)
        except Exception:
            pass

    if progress_cb:
        progress_cb("Running incremental Structure from Motion", 70)

    # 3. Incremental mapping with aerial photogrammetry thresholds
    inc_options = pycolmap.IncrementalPipelineOptions()
    inc_options.num_threads = min(os.cpu_count() or 4, 4)
    inc_options.ba_refine_extra_params = False
    inc_options.ba_refine_principal_point = False
    inc_options.mapper.init_min_tri_angle = 3.0
    inc_options.mapper.init_max_forward_motion = 0.99
    inc_options.mapper.ba_local_min_tri_angle = 1.5
    inc_options.mapper.abs_pose_min_num_inliers = 15

    reconstructions = pycolmap.incremental_mapping(
        database_path=database_path,
        image_path=frames_dir,
        output_path=output_dir,
        options=inc_options,
    )

    if not reconstructions:
        return {
            "success": False,
            "status": ReconstructionStatus.FAILED.value,
            "error": "COLMAP incremental SfM could not reconstruct 3D points from the selected frames.",
            "sparse_point_count": 0,
            "registered_cameras": 0,
            "reconstruction": None,
        }

    # Select the primary reconstruction component (largest 3D point count)
    best_recon = max(reconstructions.values(), key=lambda r: r.num_points3D())
    sparse_points = best_recon.num_points3D()
    reg_images = best_recon.num_reg_images()

    # Export sparse point cloud to PLY
    sparse_ply_path = output_dir / "point_cloud.ply"
    best_recon.export_PLY(sparse_ply_path)

    # Camera poses / trajectory
    camera_poses = []
    for img_id, img in best_recon.images.items():
        if img.has_camera_ptr():
            # Projection center in world coordinates: -R^T * t
            R = img.cam_from_world.rotation.matrix()
            t = img.cam_from_world.translation
            center = -R.T @ t
            camera_poses.append({
                "image_id": img_id,
                "image_name": img.name,
                "position": [round(float(c), 4) for c in center],
            })

    mean_error = 0.0
    try:
        mean_error = round(float(best_recon.compute_mean_reprojection_error()), 3)
    except Exception:
        pass

    return {
        "success": sparse_points > 0,
        "status": ReconstructionStatus.SPARSE_RECONSTRUCTED.value if sparse_points >= 100 else ReconstructionStatus.PARTIAL.value,
        "sparse_point_count": sparse_points,
        "registered_cameras": reg_images,
        "total_images": len(best_recon.images),
        "mean_reprojection_error": mean_error,
        "camera_poses": camera_poses,
        "point_cloud_path": str(sparse_ply_path),
        "reconstruction_components": len(reconstructions),
        "best_recon": best_recon,
    }


def _compute_mesh_bounding_box(mesh_path: Path) -> Optional[Dict[str, List[float]]]:
    """Calculate axis-aligned bounding box for a generated PLY mesh."""
    if not mesh_path.exists():
        return None
    try:
        with open(mesh_path, "rb") as f:
            v_count = 0
            while True:
                line = f.readline().decode("latin1").strip()
                if line.startswith("element vertex"):
                    v_count = int(line.split()[-1])
                if line == "end_header":
                    break
            if v_count == 0:
                return None
            coords = []
            for _ in range(v_count):
                x, y, z, val, r, g, b = struct.unpack("<ffffBBB", f.read(19))
                coords.append((x, y, z))
            arr = np.array(coords)
            min_b = np.round(arr.min(axis=0), 4)
            max_b = np.round(arr.max(axis=0), 4)
            dims = np.round(max_b - min_b, 4)
            return {
                "min": min_b.tolist(),
                "max": max_b.tolist(),
                "dimensions": dims.tolist(),
            }
    except Exception:
        return None


def _export_point_cloud_with_normals(best_recon: Any, ply_out: Path) -> bool:
    """Export 3D point cloud with oriented viewing normals for Poisson meshing."""
    if not best_recon or not hasattr(best_recon, "points3D") or not best_recon.points3D:
        return False

    cam_centers = {}
    for img_id, img in best_recon.images.items():
        if img.has_camera_ptr():
            cfw = img.cam_from_world() if callable(img.cam_from_world) else img.cam_from_world
            cam_centers[img_id] = np.array(cfw.inverse().translation, dtype=np.float64)

    points = []
    colors = []
    normals = []

    for pt_id, pt in best_recon.points3D.items():
        xyz = np.array(pt.xyz, dtype=np.float64)
        rgb = pt.color
        view_dirs = []
        if hasattr(pt, "track") and hasattr(pt.track, "elements"):
            for elem in pt.track.elements:
                if elem.image_id in cam_centers:
                    v = cam_centers[elem.image_id] - xyz
                    norm = np.linalg.norm(v)
                    if norm > 1e-6:
                        view_dirs.append(v / norm)
        if view_dirs:
            n = np.mean(view_dirs, axis=0)
            norm_n = np.linalg.norm(n)
            n = n / norm_n if norm_n > 1e-6 else np.array([0., 0., 1.])
        else:
            n = np.array([0., 0., 1.])

        points.append(xyz)
        colors.append(rgb)
        normals.append(n)

    ply_out.parent.mkdir(parents=True, exist_ok=True)
    with open(ply_out, "wb") as f:
        header = (
            "ply\n"
            "format binary_little_endian 1.0\n"
            f"element vertex {len(points)}\n"
            "property float x\n"
            "property float y\n"
            "property float z\n"
            "property float nx\n"
            "property float ny\n"
            "property float nz\n"
            "property uchar red\n"
            "property uchar green\n"
            "property uchar blue\n"
            "end_header\n"
        ).encode("latin1")
        f.write(header)
        for p, n, c in zip(points, normals, colors):
            f.write(struct.pack("<ffffffBBB", float(p[0]), float(p[1]), float(p[2]), float(n[0]), float(n[1]), float(n[2]), int(c[0]), int(c[1]), int(c[2])))

    return ply_out.exists() and ply_out.stat().st_size > 0


def _run_dense_and_meshing(
    output_dir: Path,
    point_cloud_path: Path,
    best_recon: Any = None,
    progress_cb: Optional[Callable[[str, int], None]] = None,
) -> Dict[str, Any]:
    """
    Attempt image undistortion, dense MVS capability evaluation, and Poisson surface meshing.
    Explicitly reports CPU/GPU constraints rather than fabricating results.
    """
    dense_info: Dict[str, Any] = {
        "status": "UNAVAILABLE",
        "point_count": 0,
        "undistorted_images": 0,
        "reason": "Dense PatchMatch MVS requires an NVIDIA CUDA GPU. Sparse SfM preserved as authoritative 3D geometry.",
    }
    mesh_info: Dict[str, Any] = {
        "status": "UNAVAILABLE",
        "mesh_path": None,
        "vertex_count": 0,
        "face_count": 0,
        "method": None,
        "bounding_box": None,
        "reason": "Poisson surface reconstruction requires oriented point normals.",
    }

    # 1. Attempt image undistortion if sparse model exists
    dense_workspace = output_dir.parent / "dense"
    if has_pycolmap and best_recon is not None:
        try:
            dense_workspace.mkdir(parents=True, exist_ok=True)
            sparse_input_dir = output_dir
            frames_dir = output_dir.parent / "frames"
            if sparse_input_dir.exists() and frames_dir.exists():
                pycolmap.undistort_images(
                    output_path=dense_workspace,
                    input_path=sparse_input_dir,
                    image_path=frames_dir,
                    num_threads=min(os.cpu_count() or 4, 4),
                )
                dense_info["undistorted_images"] = len(best_recon.images)
        except Exception as exc:
            logger.info("Image undistortion notice: %s", exc)

    # 2. Dense Stereo / MVS capability check
    if has_pycolmap:
        try:
            if not getattr(pycolmap, "has_cuda", False):
                dense_info["reason"] = "Dense stereo reconstruction requires CUDA or HIP, neither of which is available on your system."
            else:
                pycolmap.patch_match_stereo(workspace_path=dense_workspace)
        except Exception as exc:
            dense_info["reason"] = f"Dense stereo MVS unavailable: {exc}"

    # 3. Surface mesh generation via pycolmap.poisson_meshing
    if progress_cb:
        progress_cb("Generating real Poisson surface mesh", 85)

    mesh_ply_path = output_dir / "mesh.ply"
    if has_pycolmap and best_recon is not None:
        try:
            normals_ply = output_dir / "sparse_with_normals.ply"
            has_normals = _export_point_cloud_with_normals(best_recon, normals_ply)
            if has_normals:
                options = pycolmap.PoissonMeshingOptions()
                options.depth = 8
                options.trim = 2.0
                options.num_threads = min(os.cpu_count() or 4, 4)
                pycolmap.poisson_meshing(str(normals_ply), str(mesh_ply_path), options=options)
                if mesh_ply_path.exists() and mesh_ply_path.stat().st_size > 0:
                    v_count, f_count = _count_ply_points_and_faces(mesh_ply_path)
                    bbox = _compute_mesh_bounding_box(mesh_ply_path)
                    if v_count > 0:
                        mesh_info = {
                            "status": "AVAILABLE",
                            "mesh_path": str(mesh_ply_path),
                            "vertex_count": v_count,
                            "face_count": f_count,
                            "method": "pycolmap_poisson",
                            "bounding_box": bbox,
                            "reason": None,
                        }
        except Exception as exc:
            mesh_info["reason"] = f"Poisson meshing error: {exc}"

    return {
        "dense": dense_info,
        "mesh": mesh_info,
    }


def run_reconstruction_pipeline(
    mission_id: str,
    frames_dir: Path,
    output_dir: Path,
    max_frames: int = 40,
    progress_cb: Optional[Callable[[str, int], None]] = None,
) -> Dict[str, Any]:
    """
    Authoritative photogrammetric reconstruction using COLMAP / pycolmap.
    Recovers camera poses, sparse point cloud, and optional surface mesh.
    """
    started = time.time()
    _ensure_dir(output_dir)
    database_path = output_dir / "database.db"

    # Verify frame directory
    frame_files = sorted(list(frames_dir.glob("*.jpg")) + list(frames_dir.glob("*.png")))
    if len(frame_files) < 2:
        return {
            "success": False,
            "status": ReconstructionStatus.FAILED.value,
            "error": f"Insufficient frames for reconstruction ({len(frame_files)} found; minimum 3 required).",
            "sparse_point_count": 0,
            "registered_cameras": 0,
            "scale": evaluate_scale_and_georeference(False),
            "processing_time_s": round(time.time() - started, 2),
        }

    # Execute SfM
    if has_pycolmap:
        sfm_res = _run_pycolmap_sfm(database_path, frames_dir, output_dir, progress_cb)
    else:
        return {
            "success": False,
            "status": ReconstructionStatus.FAILED.value,
            "error": "pycolmap is not installed in the active environment.",
            "sparse_point_count": 0,
            "registered_cameras": 0,
            "scale": evaluate_scale_and_georeference(False),
            "processing_time_s": round(time.time() - started, 2),
        }

    scale_info = evaluate_scale_and_georeference(has_gps=False)

    if not sfm_res.get("success"):
        return {
            "success": False,
            "status": ReconstructionStatus.FAILED.value,
            "error": sfm_res.get("error", "SfM pipeline failed to reconstruct 3D scene."),
            "sparse_point_count": 0,
            "registered_cameras": sfm_res.get("registered_cameras", 0),
            "scale": scale_info,
            "processing_time_s": round(time.time() - started, 2),
        }

    point_cloud_path = Path(sfm_res["point_cloud_path"])
    dense_and_mesh = _run_dense_and_meshing(output_dir, point_cloud_path, sfm_res.get("best_recon"), progress_cb)

    # Determine final status
    mesh_available = dense_and_mesh["mesh"]["status"] == "AVAILABLE"
    sparse_ok = sfm_res["sparse_point_count"] >= 100
    
    if mesh_available:
        final_status = ReconstructionStatus.MESH_GENERATED.value
    elif sparse_ok:
        final_status = ReconstructionStatus.SPARSE_RECONSTRUCTED.value
    else:
        final_status = ReconstructionStatus.PARTIAL.value

    duration_s = round(time.time() - started, 2)

    return {
        "success": True,
        "status": final_status,
        "engine": "pycolmap_authoritative",
        "sparse_point_count": sfm_res["sparse_point_count"],
        "dense_point_count": dense_and_mesh["dense"]["point_count"],
        "registered_cameras": sfm_res["registered_cameras"],
        "total_images": sfm_res.get("total_images", len(frame_files)),
        "mean_reprojection_error": sfm_res["mean_reprojection_error"],
        "camera_poses": sfm_res.get("camera_poses", []),
        "point_cloud_path": str(point_cloud_path),
        "point_cloud_url": f"/api/missions/{mission_id}/reconstruction/pointcloud",
        "mesh": dense_and_mesh["mesh"],
        "mesh_url": f"/api/missions/{mission_id}/reconstruction/mesh" if mesh_available else None,
        "dense": dense_and_mesh["dense"],
        "scale": scale_info,
        "processing_time_s": duration_s,
        "error": None,
    }


# ============================================================
# TOP-LEVEL ORCHESTRATOR FOR MISSIONS
# ============================================================

def run_reconstruction_for_mission(
    mission_id: str,
    video_path: Path,
    max_frames: int = 40,
    target_fps: float = 2.0,
    progress_cb: Optional[Callable[[str, int], None]] = None,
) -> Dict[str, Any]:
    """
    End-to-end photogrammetric reconstruction workflow for a mission video:
    1. Video technical inspection
    2. Quality-filtered frame extraction with visual overlap
    3. Real pycolmap feature extraction, matching, and incremental SfM
    4. Dense & mesh generation evaluation
    5. Storage and Database asset registration
    """
    started = time.time()
    
    if progress_cb:
        progress_cb("Inspecting video metadata", 5)
    video_meta = inspect_video_camera_metadata(video_path)

    if progress_cb:
        progress_cb("Extracting and quality-filtering frames", 15)
    extraction = extract_frames_with_quality(
        video_path=video_path,
        mission_id=mission_id,
        max_frames=max_frames,
        target_fps=target_fps,
    )

    if not extraction.get("success"):
        return {
            "success": False,
            "status": ReconstructionStatus.FAILED.value,
            "error": extraction.get("error", "No valid frames passed the visual quality and overlap filters."),
            "point_count": 0,
            "registered_cameras": 0,
            "processing_time_s": round(time.time() - started, 2),
            "video_metadata": video_meta,
            "extraction_audit": extraction,
            "scale": evaluate_scale_and_georeference(False),
        }

    recon_output_dir = _ensure_dir(MISSIONS_DIR / mission_id / "reconstruction" / "model")
    frames_dir = Path(extraction["frames_dir"])

    recon_result = run_reconstruction_pipeline(
        mission_id=mission_id,
        frames_dir=frames_dir,
        output_dir=recon_output_dir,
        max_frames=max_frames,
        progress_cb=progress_cb,
    )

    recon_result["video_metadata"] = video_meta
    recon_result["extraction_audit"] = {
        "total_source_frames": extraction.get("total_source_frames", 0),
        "extracted_candidates": extraction.get("extracted_candidates", 0),
        "selected_count": extraction.get("selected_count", 0),
        "rejected_count": extraction.get("rejected_count", 0),
        "rejection_breakdown": extraction.get("rejection_breakdown", {}),
        "sampling_interval": extraction.get("sampling_interval", 1),
    }

    # Persist assets to Phase 3 storage abstraction and Database
    try:
        from backend.storage import get_storage
        storage = get_storage(DATA_DIR / "objects")
        
        # 1. Point cloud PLY
        ply_path = Path(recon_result.get("point_cloud_path", ""))
        if ply_path.exists():
            storage_key = f"missions/{mission_id}/reconstruction/point_cloud.ply"
            with ply_path.open("rb") as f:
                storage.upload(storage_key, f, "point_cloud.ply", "application/octet-stream")
            recon_result["storage_key"] = storage_key

        # 2. Mesh PLY (if generated)
        mesh_path_str = recon_result.get("mesh", {}).get("mesh_path")
        if mesh_path_str:
            mesh_path = Path(mesh_path_str)
            if mesh_path.exists():
                mesh_storage_key = f"missions/{mission_id}/reconstruction/mesh.ply"
                with mesh_path.open("rb") as f:
                    storage.upload(mesh_storage_key, f, "mesh.ply", "application/octet-stream")
                recon_result["mesh"]["storage_key"] = mesh_storage_key

        # 3. Database persistence if configured
        from backend.database import get_configured_engine, check_database, session_scope
        from backend.models import ReconstructionAsset
        engine = get_configured_engine()
        if engine is not None and check_database(engine):
            with session_scope(engine) as session:
                if ply_path.exists():
                    session.add(ReconstructionAsset(
                        mission_id=mission_id,
                        asset_type="point_cloud",
                        storage_path=recon_result.get("storage_key"),
                        metadata_json={
                            "point_count": recon_result.get("sparse_point_count", 0),
                            "registered_cameras": recon_result.get("registered_cameras", 0),
                            "scale_status": recon_result.get("scale", {}).get("scale_status"),
                        },
                    ))
                if mesh_path_str and Path(mesh_path_str).exists():
                    session.add(ReconstructionAsset(
                        mission_id=mission_id,
                        asset_type="mesh",
                        storage_path=recon_result.get("mesh", {}).get("storage_key"),
                        metadata_json=recon_result.get("mesh", {}),
                    ))
                session.flush()
    except Exception as exc:
        logger.warning("Reconstruction storage/database persistence notice: %s", exc)

    # Save summary metadata JSON into reconstruction directory
    summary_file = MISSIONS_DIR / mission_id / "reconstruction" / "reconstruction_metadata.json"
    try:
        with summary_file.open("w", encoding="utf-8") as f:
            json.dump(recon_result, f, indent=2, default=str)
    except Exception:
        pass

    if progress_cb:
        progress_cb("Reconstruction finished", 100)

    return recon_result


# ============================================================
# ASSET RESOLVERS
# ============================================================

def get_reconstruction_pointcloud_path(mission_id: str) -> Optional[Path]:
    """Locate point cloud PLY file for a mission."""
    recon_dir = MISSIONS_DIR / mission_id / "reconstruction"
    candidates = [
        recon_dir / "point_cloud.ply",
        recon_dir / "model" / "point_cloud.ply",
        recon_dir / "pinhole_model" / "model_0.ply",
        recon_dir / "dense" / "sparse_with_normals.ply",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def get_reconstruction_mesh_path(mission_id: str) -> Optional[Path]:
    """Locate surface mesh PLY file for a mission."""
    recon_dir = MISSIONS_DIR / mission_id / "reconstruction"
    candidates = [
        recon_dir / "mesh.ply",
        recon_dir / "model" / "mesh.ply",
        recon_dir / "dense" / "mesh_poisson.ply",
        recon_dir / "mesh_poisson.ply",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def get_reconstruction_metadata(mission_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve saved reconstruction metadata JSON for a mission."""
    summary_file = MISSIONS_DIR / mission_id / "reconstruction" / "reconstruction_metadata.json"
    if summary_file.exists():
        try:
            return json.loads(summary_file.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None
