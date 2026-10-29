"""
Dense Depth Photogrammetric Densification Module.

Aligns learned monocular depth (Depth Anything V2 Small) to SfM sparse points,
filters floaters via geometric multi-view consistency, and constructs high-density
point clouds (200k - 1M points) and Poisson surface meshes.

Honest disclosure:
"Dense: learned depth aligned to SfM (estimated, not measured MVS)"
"""

from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
import open3d as o3d
import torch
from PIL import Image

logger = logging.getLogger(__name__)


def ransac_fit_inverse_depth(
    d_rel: np.ndarray,
    z_sfm: np.ndarray,
    num_iters: int = 150,
    inlier_thresh: float = 0.15,
) -> Tuple[Optional[float], Optional[float], float]:
    """
    Robust RANSAC linear fit for:
        1 / z_sfm = s * d_rel + t

    Depth Anything outputs disparity-like values, which exhibit strong positive
    linear correlation with inverse depth (1 / z).
    """
    inv_z = 1.0 / z_sfm
    n_points = len(d_rel)
    if n_points < 5:
        return None, None, 1.0

    best_inliers = 0
    best_s: float = 1.0
    best_t: float = 0.0

    for _ in range(num_iters):
        idx = np.random.choice(n_points, 2, replace=False)
        d0, d1 = float(d_rel[idx[0]]), float(d_rel[idx[1]])
        y0, y1 = float(inv_z[idx[0]]), float(inv_z[idx[1]])
        if abs(d1 - d0) < 1e-4:
            continue
        s_cand = (y1 - y0) / (d1 - d0)
        if s_cand <= 0:
            continue
        t_cand = y0 - s_cand * d0
        pred_inv = s_cand * d_rel + t_cand
        pred_z = 1.0 / np.maximum(pred_inv, 1e-4)
        rel_err = np.abs(pred_z - z_sfm) / z_sfm
        inliers = int(np.sum(rel_err < inlier_thresh))
        if inliers > best_inliers:
            best_inliers = inliers
            best_s = s_cand
            best_t = t_cand

    # Refit least squares on inliers
    pred_inv = best_s * d_rel + best_t
    pred_z = 1.0 / np.maximum(pred_inv, 1e-4)
    inlier_mask = (np.abs(pred_z - z_sfm) / z_sfm) < max(inlier_thresh, 0.20)
    if np.sum(inlier_mask) >= 6:
        a_mat = np.vstack([d_rel[inlier_mask], np.ones(np.sum(inlier_mask))]).T
        best_s, best_t = np.linalg.lstsq(a_mat, inv_z[inlier_mask], rcond=None)[0]

    final_pred_z = 1.0 / np.maximum(best_s * d_rel + best_t, 1e-4)
    med_res = float(np.median(np.abs(final_pred_z - z_sfm) / z_sfm))
    return float(best_s), float(best_t), med_res


def densify_depth_aligned_to_sfm(
    recon: Any,
    frames_dir: Path,
    output_dir: Path,
    max_input_dimension: int = 518,
    target_points_min: int = 200_000,
    target_points_max: int = 1_000_000,
    progress_cb: Optional[Callable[[str, int], None]] = None,
) -> Dict[str, Any]:
    """
    Run learned Depth Anything V2 monocular depth estimation on keyframes,
    align to SfM scale using RANSAC on sparse point correspondences,
    filter floaters with multi-view consistency, and mesh with Open3D Poisson.

    Guaranteed never to raise exceptions: returns fallback structure on failure.
    """
    started = time.time()
    result: Dict[str, Any] = {
        "success": False,
        "status": "SKIPPED",
        "method": "monocular_depth_aligned_to_sfm",
        "point_count": 0,
        "mesh_faces": 0,
        "mesh_vertices": 0,
        "aligned_frames": 0,
        "residuals": {},
        "disclaimer": "Dense: learned depth aligned to SfM (estimated, not measured MVS)",
    }

    try:
        if recon is None:
            result["reason"] = "Reconstruction object is None"
            return result

        num_reg = recon.num_reg_images()
        frame_files = list(frames_dir.glob("*.jpg")) + list(frames_dir.glob("*.png"))
        total_imgs = len(frame_files)
        if total_imgs == 0:
            result["reason"] = "No keyframe images found"
            return result

        reg_ratio = num_reg / float(total_imgs)
        if reg_ratio < 0.60:
            logger.info("[densify_depth] SfM registered %.1f%% cameras (< 60%% threshold); skipping densify_depth", reg_ratio * 100)
            result["status"] = "SKIPPED_LOW_REGISTRATION"
            result["reason"] = f"Registration rate {reg_ratio * 100:.1f}% is below 60% threshold"
            return result

        if progress_cb:
            progress_cb("Estimating dense neural depth & aligning to SfM scale", 75)

        logger.info("[densify_depth] Loading DepthAnythingV2Runner for %d registered frames...", num_reg)
        from backend.depth_anything import DepthAnythingV2Runner
        runner = DepthAnythingV2Runner()

        registered_images = [img for img in recon.images.values() if getattr(img, "num_points3D", 0) > 0]
        registered_images.sort(key=lambda im: im.name)

        aligned_frames: List[Dict[str, Any]] = []
        residuals: Dict[str, float] = {}

        for colmap_img in registered_images:
            frame_path = frames_dir / colmap_img.name
            if not frame_path.exists():
                continue

            bgr = cv2.imread(str(frame_path))
            if bgr is None:
                continue
            orig_h, orig_w = bgr.shape[:2]

            # Scale to <= max_input_dimension (e.g. 518px) for fast CPU inference
            scale_input = min(1.0, float(max_input_dimension) / max(orig_h, orig_w))
            tw = max(1, int(round(orig_w * scale_input)))
            th = max(1, int(round(orig_h * scale_input)))
            img_small = cv2.resize(bgr, (tw, th), interpolation=cv2.INTER_AREA)

            # Predict relative depth
            pil_img = Image.fromarray(cv2.cvtColor(img_small, cv2.COLOR_BGR2RGB))
            inputs = runner.processor(images=pil_img, return_tensors="pt").to(runner.device)
            with torch.no_grad():
                outputs = runner.model(**inputs)
                pred = outputs.predicted_depth.squeeze().cpu().numpy()

            cfw = colmap_img.cam_from_world()
            r_mat = cfw.rotation.matrix()
            t_vec = cfw.translation
            cam = recon.cameras[colmap_img.camera_id]
            cw, ch = cam.width, cam.height
            dh, dw = pred.shape[:2]

            # Sample visible 3D sparse points in this frame
            sfm_z_list = []
            da_val_list = []

            for p2d in colmap_img.points2D:
                if not p2d.has_point3D():
                    continue
                p3d = recon.points3D[p2d.point3D_id]
                x_cam = r_mat @ np.array(p3d.xyz) + t_vec
                z_val = float(x_cam[2])
                if z_val <= 0.05:
                    continue
                u_norm = p2d.xy[0] / float(cw)
                v_norm = p2d.xy[1] / float(ch)
                xd = int(round(u_norm * (dw - 1)))
                yd = int(round(v_norm * (dh - 1)))
                if 0 <= xd < dw and 0 <= yd < dh:
                    sfm_z_list.append(z_val)
                    da_val_list.append(float(pred[yd, xd]))

            if len(sfm_z_list) < 8:
                continue

            sfm_z = np.array(sfm_z_list, dtype=np.float32)
            da_val = np.array(da_val_list, dtype=np.float32)

            best_s, best_t, med_res = ransac_fit_inverse_depth(da_val, sfm_z)
            if best_s is None or best_s <= 0:
                continue

            residuals[colmap_img.name] = round(med_res, 4)
            # Discard frame if residual is unusually high (> 35% median error)
            if med_res > 0.35:
                continue

            # Compute metric depth map aligned to SfM scale
            metric_depth = 1.0 / np.maximum(best_s * pred + best_t, 1e-4)
            # Clip extreme depth bounds using SfM ground-truth percentiles
            z_min = float(np.percentile(sfm_z, 2)) * 0.5
            z_max = float(np.percentile(sfm_z, 98)) * 1.5
            metric_depth = np.clip(metric_depth, z_min, z_max)

            # Scale camera intrinsics to depth map resolution (dw, dh)
            fx = cam.params[0] * (dw / float(cw))
            fy = (cam.params[1] if len(cam.params) > 3 and cam.model_name in ("PINHOLE", "OPENCV") else cam.params[0]) * (dh / float(ch))
            cx = (cam.params[1] if cam.model_name == "SIMPLE_RADIAL" else cam.params[2]) * (dw / float(cw))
            cy = (cam.params[2] if cam.model_name == "SIMPLE_RADIAL" else cam.params[3]) * (dh / float(ch))

            aligned_frames.append({
                "name": colmap_img.name,
                "R": r_mat,
                "t": t_vec,
                "R_inv": r_mat.T,
                "cam_center": -r_mat.T @ t_vec,
                "depth": metric_depth,
                "fx": fx, "fy": fy, "cx": cx, "cy": cy,
                "dw": dw, "dh": dh,
                "bgr": cv2.resize(bgr, (dw, dh), interpolation=cv2.INTER_AREA),
                "residual": med_res,
            })

        logger.info("[densify_depth] Aligned %d frames to SfM scale (median residual: %.2f%%)",
                    len(aligned_frames), float(np.median(list(residuals.values()))) * 100 if residuals else 0.0)

        if len(aligned_frames) < 3:
            result["reason"] = f"Insufficient aligned keyframes ({len(aligned_frames)} < 3)"
            result["status"] = "PARTIAL_INSUFFICIENT_FRAMES"
            return result

        if progress_cb:
            progress_cb("Filtering floaters via multi-view consistency & unprojecting", 85)

        # Multi-view consistency filter
        all_pts: List[np.ndarray] = []
        all_cols: List[np.ndarray] = []

        for i, f_curr in enumerate(aligned_frames):
            # Find 2-3 nearest keyframes
            dists = []
            for j, f_other in enumerate(aligned_frames):
                if i == j:
                    continue
                d = float(np.linalg.norm(f_curr["cam_center"] - f_other["cam_center"]))
                dists.append((d, j))
            dists.sort(key=lambda item: item[0])
            neighbor_indices = [idx for _, idx in dists[:3]]

            dw, dh = f_curr["dw"], f_curr["dh"]
            stride = 2
            u_coords, v_coords = np.meshgrid(np.arange(0, dw, stride), np.arange(0, dh, stride))
            z_vals = f_curr["depth"][v_coords, u_coords]

            x_cam = (u_coords - f_curr["cx"]) * z_vals / f_curr["fx"]
            y_cam = (v_coords - f_curr["cy"]) * z_vals / f_curr["fy"]
            pts_cam = np.stack([x_cam, y_cam, z_vals], axis=-1).reshape(-1, 3)
            pts_world = (f_curr["R_inv"] @ (pts_cam - f_curr["t"]).T).T

            consistent_mask = np.zeros(len(pts_world), dtype=bool)

            for n_idx in neighbor_indices:
                f_nb = aligned_frames[n_idx]
                pts_nb_cam = (f_nb["R"] @ pts_world.T + f_nb["t"].reshape(3, 1)).T
                z_proj = pts_nb_cam[:, 2]

                valid_z = z_proj > 0.05
                u_proj = np.zeros(len(pts_world), dtype=np.float32)
                v_proj = np.zeros(len(pts_world), dtype=np.float32)
                u_proj[valid_z] = f_nb["fx"] * pts_nb_cam[valid_z, 0] / z_proj[valid_z] + f_nb["cx"]
                v_proj[valid_z] = f_nb["fy"] * pts_nb_cam[valid_z, 1] / z_proj[valid_z] + f_nb["cy"]

                in_bounds = (
                    valid_z
                    & (u_proj >= 0) & (u_proj < f_nb["dw"] - 1)
                    & (v_proj >= 0) & (v_proj < f_nb["dh"] - 1)
                )

                ui = np.round(u_proj[in_bounds]).astype(int)
                vi = np.round(v_proj[in_bounds]).astype(int)
                measured_z = f_nb["depth"][vi, ui]

                depth_diff = np.abs(z_proj[in_bounds] - measured_z) / measured_z
                agrees = depth_diff < 0.12
                consistent_indices = np.where(in_bounds)[0][agrees]
                consistent_mask[consistent_indices] = True

            kept_pts = pts_world[consistent_mask]
            bgr_frame = f_curr["bgr"]
            rgb_frame = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
            sampled_cols = rgb_frame[v_coords, u_coords].reshape(-1, 3)[consistent_mask] / 255.0

            if len(kept_pts) > 0:
                all_pts.append(kept_pts)
                all_cols.append(sampled_cols)

        if not all_pts:
            result["reason"] = "No points survived multi-view consistency check"
            return result

        merged_pts = np.vstack(all_pts)
        merged_cols = np.vstack(all_cols)

        # Open3D point cloud
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(merged_pts)
        pcd.colors = o3d.utility.Vector3dVector(merged_cols)

        bbox = pcd.get_axis_aligned_bounding_box()
        diag = float(np.linalg.norm(bbox.get_max_bound() - bbox.get_min_bound()))
        cur_count = len(pcd.points)

        # Adaptive voxel downsampling targeting 200k - 1M points
        if cur_count > target_points_max:
            voxel_size = diag / 450.0
            pcd = pcd.voxel_down_sample(voxel_size)
        elif cur_count < target_points_min and len(merged_pts) > target_points_min:
            voxel_size = diag / 600.0
            pcd = pcd.voxel_down_sample(voxel_size)
        else:
            voxel_size = diag / 500.0
            pcd = pcd.voxel_down_sample(voxel_size)

        pcd, _ = pcd.remove_statistical_outlier(nb_neighbors=20, std_ratio=2.0)
        final_dense_points = len(pcd.points)

        dense_ply_path = output_dir / "dense_point_cloud.ply"
        o3d.io.write_point_cloud(str(dense_ply_path), pcd)
        logger.info("[densify_depth] Saved full dense point cloud to %s (%d points)", dense_ply_path, final_dense_points)

        # Cap the viewer's dense point cloud at 500k points for browser performance
        viewer_ply_path = output_dir / "dense_point_cloud_preview.ply"
        max_viewer_points = 500_000
        if final_dense_points > max_viewer_points:
            sample_ratio = max_viewer_points / float(final_dense_points)
            pcd_viewer = pcd.random_down_sample(sampling_ratio=sample_ratio)
            o3d.io.write_point_cloud(str(viewer_ply_path), pcd_viewer)
            logger.info("[densify_depth] Saved display-capped dense point cloud to %s (%d points)", viewer_ply_path, len(pcd_viewer.points))
        else:
            o3d.io.write_point_cloud(str(viewer_ply_path), pcd)

        if progress_cb:
            progress_cb("Reconstructing dense Poisson surface mesh & GLB", 92)

        # Poisson meshing
        pcd.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=voxel_size * 3.5, max_nn=30))
        mean_cam = np.mean([f["cam_center"] for f in aligned_frames], axis=0)
        pcd.orient_normals_towards_camera_location(mean_cam)

        mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd, depth=9, n_threads=4)
        densities_np = np.asarray(densities)
        if len(densities_np) > 0:
            trim_thresh = np.quantile(densities_np, 0.05)
            mesh.remove_vertices_by_mask(densities_np < trim_thresh)

        # Decimate dense mesh to <= 400k faces (quadric decimation, keep vertex colours)
        max_mesh_faces = 400_000
        if len(mesh.triangles) > max_mesh_faces:
            logger.info("[densify_depth] Decimating dense mesh from %d to <= %d faces...", len(mesh.triangles), max_mesh_faces)
            mesh = mesh.simplify_quadric_decimation(target_number_of_triangles=max_mesh_faces)
            mesh.remove_degenerate_triangles()
            mesh.remove_duplicated_triangles()
            mesh.remove_duplicated_vertices()
            mesh.remove_non_manifold_edges()

        # Color transfer via cKDTree on decimated mesh vertices
        from scipy.spatial import cKDTree
        pcd_pts = np.asarray(pcd.points)
        pcd_cols = np.asarray(pcd.colors)
        mesh_verts = np.asarray(mesh.vertices)
        if len(mesh_verts) > 0 and len(pcd_pts) > 0:
            tree = cKDTree(pcd_pts)
            _, idxs = tree.query(mesh_verts, k=1, workers=-1)
            mesh_cols = pcd_cols[idxs]
            mesh.vertex_colors = o3d.utility.Vector3dVector(mesh_cols)
        else:
            mesh_cols = np.ones((len(mesh_verts), 3), dtype=np.float32) * 0.7

        mesh_ply_path = output_dir / "dense_mesh.ply"
        o3d.io.write_triangle_mesh(str(mesh_ply_path), mesh)

        glb_path = output_dir / "dense_mesh.glb"
        try:
            import trimesh
            tri_mesh = trimesh.Trimesh(
                vertices=np.asarray(mesh.vertices),
                faces=np.asarray(mesh.triangles),
                vertex_colors=(mesh_cols * 255.0).astype(np.uint8),
                process=False,
            )
            tri_mesh.export(str(glb_path))
            logger.info("[densify_depth] Saved dense GLB mesh to %s (%d faces)", glb_path, len(mesh.triangles))
        except Exception as glb_exc:
            logger.warning("[densify_depth] GLB export notice: %s", glb_exc)

        elapsed = round(time.time() - started, 2)
        result.update({
            "success": True,
            "status": "COMPLETED",
            "point_count": final_dense_points,
            "mesh_faces": len(mesh.triangles),
            "mesh_vertices": len(mesh.vertices),
            "aligned_frames": len(aligned_frames),
            "residuals": residuals,
            "elapsed_s": elapsed,
            "dense_point_cloud_path": str(dense_ply_path),
            "dense_mesh_path": str(mesh_ply_path),
            "dense_glb_path": str(glb_path) if glb_path.exists() else None,
        })
        logger.info("[densify_depth] Completed successfully in %.2fs: %d points, %d faces",
                    elapsed, final_dense_points, len(mesh.triangles))
        return result

    except Exception as exc:
        logger.warning("[densify_depth] Optional dense stage notice: %s", exc, exc_info=True)
        result["reason"] = f"densify_depth exception: {exc}"
        result["status"] = "FAILED_OPTIONAL"
        return result

