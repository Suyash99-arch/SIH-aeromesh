from __future__ import annotations

import math
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Sequence
import numpy as np

# Configurable default engineering threshold for reprojection error validation
DEFAULT_REPROJECTION_THRESHOLD_PX = float(os.getenv("SPATIAL_FUSION_REPROJ_THRESHOLD", "25.0"))


@dataclass
class CameraIntrinsics:
    fx: float
    fy: float
    cx: float
    cy: float
    width: int = 1920
    height: int = 1080
    model: str = "PINHOLE"

    @classmethod
    def from_colmap(cls, camera: Any) -> CameraIntrinsics:
        """Extract intrinsics from a pycolmap Camera or dictionary."""
        if hasattr(camera, "params"):
            params = list(camera.params)
            model_name = str(getattr(camera, "model", "PINHOLE"))
            w = int(getattr(camera, "width", 1920))
            h = int(getattr(camera, "height", 1080))
            if "SIMPLE_PINHOLE" in model_name:
                f, cx, cy = params[0], params[1], params[2]
                return cls(fx=float(f), fy=float(f), cx=float(cx), cy=float(cy), width=w, height=h, model="SIMPLE_PINHOLE")
            elif "PINHOLE" in model_name:
                fx, fy, cx, cy = params[0], params[1], params[2], params[3]
                return cls(fx=float(fx), fy=float(fy), cx=float(cx), cy=float(cy), width=w, height=h, model="PINHOLE")
            else:
                f = params[0]
                cx = params[1] if len(params) > 1 else w / 2.0
                cy = params[2] if len(params) > 2 else h / 2.0
                return cls(fx=float(f), fy=float(f), cx=float(cx), cy=float(cy), width=w, height=h, model=model_name)
        elif isinstance(camera, dict):
            return cls(
                fx=float(camera.get("fx", 2429.35)),
                fy=float(camera.get("fy", 2429.35)),
                cx=float(camera.get("cx", 960.0)),
                cy=float(camera.get("cy", 540.0)),
                width=int(camera.get("width", 1920)),
                height=int(camera.get("height", 1080)),
                model=str(camera.get("model", "PINHOLE")),
            )
        raise ValueError(f"Unsupported camera type: {type(camera)}")


@dataclass
class CameraPose:
    """Rigid 3D camera pose mapping world to camera coordinates: X_c = R * X_w + t"""
    R: np.ndarray  # 3x3 rotation matrix
    t: np.ndarray  # 3 translation vector
    image_name: str = ""
    camera_id: int = 1

    @classmethod
    def from_colmap_image(cls, image: Any) -> CameraPose:
        """Extract camera pose from pycolmap Image."""
        cfw = image.cam_from_world() if callable(getattr(image, "cam_from_world", None)) else image.cam_from_world
        matrix = cfw.matrix()
        R = np.array(matrix[:3, :3], dtype=np.float64)
        t = np.array(matrix[:3, 3], dtype=np.float64)
        return cls(R=R, t=t, image_name=str(image.name), camera_id=int(image.camera_id))

    @classmethod
    def from_rt(cls, R: np.ndarray | Sequence[Sequence[float]], t: np.ndarray | Sequence[float], image_name: str = "", camera_id: int = 1) -> CameraPose:
        return cls(R=np.array(R, dtype=np.float64), t=np.array(t, dtype=np.float64).reshape(3), image_name=image_name, camera_id=camera_id)

    @property
    def center(self) -> np.ndarray:
        """Camera optical center in world coordinates: C = -R^T * t"""
        return -self.R.T @ self.t

    @property
    def viewing_direction(self) -> np.ndarray:
        """Principal optical axis in world coordinates."""
        return self.R.T @ np.array([0.0, 0.0, 1.0], dtype=np.float64)


@dataclass
class CameraRay:
    origin: np.ndarray     # 3D world coordinates
    direction: np.ndarray  # Unit 3D world direction vector


def unproject_pixel_to_ray(pixel_xy: tuple[float, float], intrinsics: CameraIntrinsics, pose: CameraPose) -> CameraRay:
    """Unproject a 2D image pixel into a 3D ray in world coordinates."""
    u, v = pixel_xy
    xn = (u - intrinsics.cx) / intrinsics.fx
    yn = (v - intrinsics.cy) / intrinsics.fy
    d_cam = np.array([xn, yn, 1.0], dtype=np.float64)
    norm = np.linalg.norm(d_cam)
    if norm > 1e-12:
        d_cam /= norm
    d_world = pose.R.T @ d_cam
    norm_w = np.linalg.norm(d_world)
    if norm_w > 1e-12:
        d_world /= norm_w
    return CameraRay(origin=pose.center, direction=d_world)


def project_3d_to_pixel(point_3d: np.ndarray | Sequence[float], intrinsics: CameraIntrinsics, pose: CameraPose) -> tuple[float, float, float] | None:
    """Project a 3D world point into camera image coordinates.

    Returns (u, v, depth_zc) or None if point is behind camera (Z_c <= 0).
    """
    P_w = np.array(point_3d, dtype=np.float64).reshape(3)
    P_c = pose.R @ P_w + pose.t
    zc = float(P_c[2])
    if zc <= 1e-6:
        return None  # Behind camera or on focal plane
    u = intrinsics.fx * (P_c[0] / zc) + intrinsics.cx
    v = intrinsics.fy * (P_c[1] / zc) + intrinsics.cy
    return (float(u), float(v), zc)


def compute_reprojection_error(
    point_3d: np.ndarray | Sequence[float],
    target_pixel_xy: tuple[float, float],
    intrinsics: CameraIntrinsics,
    pose: CameraPose,
) -> tuple[float | None, tuple[float, float] | None, float | None]:
    """Calculate Euclidean reprojection error in pixels between projected 3D point and observed 2D pixel.

    Returns (error_px, projected_uv, depth_zc).
    """
    proj = project_3d_to_pixel(point_3d, intrinsics, pose)
    if proj is None:
        return (None, None, None)
    u_proj, v_proj, zc = proj
    u_orig, v_orig = target_pixel_xy
    error_px = math.hypot(u_proj - u_orig, v_proj - v_orig)
    return (float(error_px), (u_proj, v_proj), zc)


class TriangleMesh:
    """Lightweight binary/ASCII PLY triangle mesh with vectorized ray intersection."""

    def __init__(self, vertices: np.ndarray, faces: np.ndarray):
        """
        vertices: (N, 3) float32/float64 coordinates
        faces: (M, 3) int32/int64 vertex index triplets
        """
        self.vertices = np.asarray(vertices, dtype=np.float64)
        self.faces = np.asarray(faces, dtype=np.int32)
        self.v0 = self.vertices[self.faces[:, 0]]
        self.v1 = self.vertices[self.faces[:, 1]]
        self.v2 = self.vertices[self.faces[:, 2]]
        self.bounds_min = np.min(self.vertices, axis=0) if len(self.vertices) > 0 else np.zeros(3)
        self.bounds_max = np.max(self.vertices, axis=0) if len(self.vertices) > 0 else np.zeros(3)

    @classmethod
    def load_ply(cls, ply_path: Path | str) -> TriangleMesh | None:
        """Parse binary little-endian or ASCII PLY file."""
        path = Path(ply_path)
        if not path.exists() or path.stat().st_size == 0:
            return None
        try:
            with open(path, "rb") as f:
                header_lines = []
                while True:
                    line = f.readline()
                    if not line:
                        break
                    header_lines.append(line.decode("latin-1").strip())
                    if header_lines[-1] == "end_header":
                        break

                num_verts = 0
                num_faces = 0
                is_binary = False
                for line in header_lines:
                    if line.startswith("format binary_little_endian"):
                        is_binary = True
                    elif line.startswith("element vertex"):
                        num_verts = int(line.split()[-1])
                    elif line.startswith("element face"):
                        num_faces = int(line.split()[-1])

                if num_verts == 0 or num_faces == 0:
                    return None

                if is_binary:
                    vert_props = []
                    in_vert = False
                    for line in header_lines:
                        if line.startswith("element vertex"):
                            in_vert = True
                        elif line.startswith("element ") and in_vert:
                            break
                        elif in_vert and line.startswith("property"):
                            vert_props.append(line.split())

                    dtype_map = {"float": "<f4", "float32": "<f4", "double": "<f8", "uchar": "u1", "uint8": "u1", "int": "<i4"}
                    np_types = []
                    for prop in vert_props:
                        ptype = prop[1]
                        pname = prop[2]
                        np_types.append((pname, dtype_map.get(ptype, "<f4")))

                    dt_vertex = np.dtype(np_types)
                    raw_verts = np.fromfile(f, dtype=dt_vertex, count=num_verts)
                    vertices = np.column_stack([raw_verts["x"], raw_verts["y"], raw_verts["z"]]).astype(np.float64)

                    dt_face = np.dtype([("n", "<i4"), ("v0", "<i4"), ("v1", "<i4"), ("v2", "<i4")])
                    raw_faces = np.fromfile(f, dtype=dt_face, count=num_faces)
                    faces = np.column_stack([raw_faces["v0"], raw_faces["v1"], raw_faces["v2"]]).astype(np.int32)
                    return cls(vertices, faces)
                else:
                    verts_data = []
                    for _ in range(num_verts):
                        parts = f.readline().decode("latin-1").split()
                        verts_data.append([float(parts[0]), float(parts[1]), float(parts[2])])
                    faces_data = []
                    for _ in range(num_faces):
                        parts = f.readline().decode("latin-1").split()
                        faces_data.append([int(parts[1]), int(parts[2]), int(parts[3])])
                    return cls(np.array(verts_data, dtype=np.float64), np.array(faces_data, dtype=np.int32))
        except Exception:
            return None

    def intersect_ray(self, ray: CameraRay, max_distance: float = 500.0) -> tuple[np.ndarray | None, float | None]:
        """Find closest positive intersection point of ray with mesh using vectorized Möller-Trumbore."""
        if len(self.faces) == 0:
            return (None, None)

        orig = ray.origin
        r_dir = ray.direction

        e1 = self.v1 - self.v0
        e2 = self.v2 - self.v0
        pvec = np.cross(r_dir, e2)
        det = np.sum(e1 * pvec, axis=1)

        valid = np.abs(det) > 1e-8
        if not np.any(valid):
            return (None, None)

        inv_det = np.zeros_like(det)
        inv_det[valid] = 1.0 / det[valid]

        tvec = orig - self.v0
        u = np.sum(tvec * pvec, axis=1) * inv_det
        valid &= (u >= 0.0) & (u <= 1.0)

        qvec = np.cross(tvec, e1)
        v = np.sum(r_dir * qvec, axis=1) * inv_det
        valid &= (v >= 0.0) & (u + v <= 1.0)

        t = np.sum(e2 * qvec, axis=1) * inv_det
        valid &= (t > 1e-4) & (t <= max_distance)

        hits = np.where(valid)[0]
        if len(hits) == 0:
            return (None, None)

        best_idx = hits[np.argmin(t[hits])]
        best_t = float(t[best_idx])
        hit_point = orig + best_t * r_dir
        return (hit_point, best_t)


def triangulate_multiview_rays(rays: list[CameraRay]) -> tuple[np.ndarray | None, float]:
    """Optimal linear least-squares intersection of m >= 2 camera rays.

    Minimizes the sum of squared Euclidean distances to all rays:
        (sum (I - d_k * d_k^T)) * P = sum (I - d_k * d_k^T) * C_k
    """
    if len(rays) < 2:
        return (None, 0.0)

    A = np.zeros((3, 3), dtype=np.float64)
    b = np.zeros(3, dtype=np.float64)
    I = np.eye(3, dtype=np.float64)

    directions = []
    for ray in rays:
        d = ray.direction / np.linalg.norm(ray.direction)
        directions.append(d)
        C = ray.origin
        proj = I - np.outer(d, d)
        A += proj
        b += proj @ C

    max_angle_deg = 0.0
    for i in range(len(directions)):
        for j in range(i + 1, len(directions)):
            cos_theta = np.clip(np.abs(np.dot(directions[i], directions[j])), 0.0, 1.0)
            angle_deg = math.degrees(math.acos(cos_theta))
            if angle_deg > max_angle_deg:
                max_angle_deg = angle_deg

    try:
        cond = np.linalg.cond(A)
        if cond > 1e6 or np.isnan(cond):
            return (None, max_angle_deg)
        P = np.linalg.solve(A, b)
        return (P, max_angle_deg)
    except np.linalg.LinAlgError:
        return (None, max_angle_deg)


@dataclass
class SingleObservation3D:
    frame_id: str
    image_name: str
    camera_id: int
    bbox_2d: list[float]
    pixel_center: tuple[float, float]
    timestamp: float
    detection_confidence: float
    point_3d: list[float] | None = None
    reprojected_pixel: tuple[float, float] | None = None
    reprojection_error_px: float | None = None
    depth_zc: float | None = None
    accepted: bool = False
    rejection_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "frame_id": self.frame_id,
            "image_name": self.image_name,
            "camera_id": self.camera_id,
            "bbox_2d": [round(v, 2) for v in self.bbox_2d],
            "pixel_center": [round(v, 2) for v in self.pixel_center],
            "timestamp": round(self.timestamp, 3),
            "detection_confidence": round(self.detection_confidence, 4),
            "point_3d": [round(v, 4) for v in self.point_3d] if self.point_3d is not None else None,
            "reprojected_pixel": [round(v, 2) for v in self.reprojected_pixel] if self.reprojected_pixel is not None else None,
            "reprojection_error_px": round(self.reprojection_error_px, 2) if self.reprojection_error_px is not None else None,
            "depth_zc": round(self.depth_zc, 3) if self.depth_zc is not None else None,
            "accepted": self.accepted,
            "rejection_reason": self.rejection_reason,
        }


@dataclass
class FusedObject3D:
    object_id: str
    track_id: str
    class_name: str
    motion_state: str  # STATIC | MOVING | UNKNOWN
    coordinate_system: str = "LOCAL_ARBITRARY"
    position_3d: list[float] | None = None  # Representative [X, Y, Z]
    trajectory_3d: list[dict[str, Any]] = field(default_factory=list)
    association_status: str = "INSUFFICIENT_EVIDENCE"  # VALID | LOW_CONFIDENCE | INSUFFICIENT_EVIDENCE | REJECTED
    association_confidence: float = 0.0
    mean_reprojection_error_px: float | None = None
    median_reprojection_error_px: float | None = None
    p90_reprojection_error_px: float | None = None
    evidence_count: int = 0
    rejected_count: int = 0
    association_method: str = "MULTI_VIEW_TRIANGULATION"
    observations: list[SingleObservation3D] = field(default_factory=list)
    rejected_observations: list[SingleObservation3D] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "object_id": self.object_id,
            "track_id": self.track_id,
            "class": self.class_name,
            "class_name": self.class_name,
            "motion_state": self.motion_state,
            "coordinate_system": self.coordinate_system,
            "position_3d": [round(v, 4) for v in self.position_3d] if self.position_3d is not None else None,
            "trajectory_3d": self.trajectory_3d,
            "association_status": self.association_status,
            "association_confidence": round(self.association_confidence, 4),
            "reprojection_error": round(self.mean_reprojection_error_px, 2) if self.mean_reprojection_error_px is not None else None,
            "mean_reprojection_error_px": round(self.mean_reprojection_error_px, 2) if self.mean_reprojection_error_px is not None else None,
            "median_reprojection_error_px": round(self.median_reprojection_error_px, 2) if self.median_reprojection_error_px is not None else None,
            "p90_reprojection_error_px": round(self.p90_reprojection_error_px, 2) if self.p90_reprojection_error_px is not None else None,
            "evidence_count": self.evidence_count,
            "rejected_count": self.rejected_count,
            "association_method": self.association_method,
            "observations": [obs.to_dict() for obs in self.observations],
            "rejected_observations": [obs.to_dict() for obs in self.rejected_observations],
            "source_frames": [obs.frame_id for obs in self.observations if obs.accepted],
        }


class SpatialFusionEngine:
    """Connects 2D tracked detections to photogrammetric 3D camera poses and scene geometry."""

    def __init__(
        self,
        reprojection_threshold_px: float = DEFAULT_REPROJECTION_THRESHOLD_PX,
        mesh: TriangleMesh | None = None,
        sparse_points: np.ndarray | None = None,
    ):
        self.reprojection_threshold_px = float(reprojection_threshold_px)
        self.mesh = mesh
        self.sparse_points = sparse_points

    @classmethod
    def from_reconstruction(
        cls,
        reconstruction: Any,
        mesh_path: Path | str | None = None,
        reprojection_threshold_px: float = DEFAULT_REPROJECTION_THRESHOLD_PX,
    ) -> tuple[SpatialFusionEngine, dict[str, tuple[CameraIntrinsics, CameraPose]]]:
        """Initialize engine and extract pose/intrinsics dictionary keyed by image name."""
        mesh = None
        if mesh_path is not None:
            mesh = TriangleMesh.load_ply(mesh_path)

        sparse_pts = None
        if hasattr(reconstruction, "points3D") and reconstruction.points3D:
            sparse_pts = np.array([p.xyz for p in reconstruction.points3D.values()], dtype=np.float64)

        poses_by_name: dict[str, tuple[CameraIntrinsics, CameraPose]] = {}
        if hasattr(reconstruction, "images") and hasattr(reconstruction, "cameras"):
            for img_id, img in reconstruction.images.items():
                cam = reconstruction.cameras[img.camera_id]
                intrinsics = CameraIntrinsics.from_colmap(cam)
                pose = CameraPose.from_colmap_image(img)
                poses_by_name[img.name] = (intrinsics, pose)
                poses_by_name[Path(img.name).name] = (intrinsics, pose)

        engine = cls(
            reprojection_threshold_px=reprojection_threshold_px,
            mesh=mesh,
            sparse_points=sparse_pts,
        )
        return engine, poses_by_name

    def fuse_track(
        self,
        track_id: str,
        class_name: str,
        raw_detections: list[dict[str, Any]],
        poses_by_name: dict[str, tuple[CameraIntrinsics, CameraPose]],
    ) -> FusedObject3D:
        """Associate a single 2D track across camera poses and scene geometry into 3D."""
        all_obs: list[SingleObservation3D] = []
        valid_rays: list[CameraRay] = []
        valid_indices: list[int] = []

        # 1. Camera Pose & Ray Unprojection
        for det in raw_detections:
            frame_name = str(det.get("frame_id", ""))
            norm_name = Path(frame_name).name if frame_name else ""
            if norm_name not in poses_by_name and not norm_name.endswith(".jpg"):
                norm_name = f"{norm_name}.jpg"

            bbox = det.get("bbox") or [0.0, 0.0, 0.0, 0.0]
            cx = (bbox[0] + bbox[2]) / 2.0
            cy = (bbox[1] + bbox[3]) / 2.0
            conf = float(det.get("confidence", 0.5))
            ts = float(det.get("timestamp", 0.0))

            if norm_name not in poses_by_name:
                all_obs.append(SingleObservation3D(
                    frame_id=frame_name,
                    image_name=norm_name,
                    camera_id=-1,
                    bbox_2d=bbox,
                    pixel_center=(cx, cy),
                    timestamp=ts,
                    detection_confidence=conf,
                    accepted=False,
                    rejection_reason="UNREGISTERED_CAMERA_FRAME",
                ))
                continue

            intrinsics, pose = poses_by_name[norm_name]
            ray = unproject_pixel_to_ray((cx, cy), intrinsics, pose)

            obs = SingleObservation3D(
                frame_id=frame_name,
                image_name=norm_name,
                camera_id=pose.camera_id,
                bbox_2d=bbox,
                pixel_center=(cx, cy),
                timestamp=ts,
                detection_confidence=conf,
            )
            all_obs.append(obs)
            valid_rays.append(ray)
            valid_indices.append(len(all_obs) - 1)

        # 2. 2D -> 3D Association Candidates
        p_triangulated, baseline_angle = triangulate_multiview_rays(valid_rays) if len(valid_rays) >= 2 else (None, 0.0)

        per_frame_mesh_hits: list[np.ndarray | None] = []
        if self.mesh is not None:
            for ray in valid_rays:
                hit, dist = self.mesh.intersect_ray(ray)
                per_frame_mesh_hits.append(hit)
        else:
            per_frame_mesh_hits = [None] * len(valid_rays)

        # 3. Determine Candidate 3D Point(s)
        collective_p3d: np.ndarray | None = None
        method = "UNKNOWN"

        if p_triangulated is not None and baseline_angle >= 1.5:
            collective_p3d = p_triangulated
            method = "MULTI_VIEW_TRIANGULATION"
        else:
            valid_mesh_hits = [h for h in per_frame_mesh_hits if h is not None]
            if valid_mesh_hits:
                collective_p3d = np.median(valid_mesh_hits, axis=0)
                method = "MESH_SURFACE_INTERSECTION"
            elif p_triangulated is not None:
                collective_p3d = p_triangulated
                method = "MULTI_VIEW_TRIANGULATION_LOW_BASELINE"
            elif self.sparse_points is not None and len(valid_rays) > 0:
                ray = valid_rays[0]
                vecs = self.sparse_points - ray.origin
                depths = vecs @ ray.direction
                front = depths > 0
                if np.any(front):
                    perp_dists = np.linalg.norm(vecs[front] - np.outer(depths[front], ray.direction), axis=1)
                    close = np.where(perp_dists < 5.0)[0]
                    if len(close) > 0:
                        med_depth = np.median(depths[front][close])
                        collective_p3d = ray.origin + med_depth * ray.direction
                        method = "SPARSE_POINT_CLOUD_FALLBACK"

        # 4. Reprojection Validation for all candidate observations
        accepted_obs: list[SingleObservation3D] = []
        rejected_obs: list[SingleObservation3D] = []
        point_trajectory: list[dict[str, Any]] = []

        for idx, obs_idx in enumerate(valid_indices):
            obs = all_obs[obs_idx]
            intrinsics, pose = poses_by_name[obs.image_name]

            # Evaluate collective point first for multi-view consistency
            err_col, proj_col, zc_col = (None, None, None)
            if collective_p3d is not None:
                err_col, proj_col, zc_col = compute_reprojection_error(collective_p3d, obs.pixel_center, intrinsics, pose)

            per_hit = per_frame_mesh_hits[idx]

            # If collective point is within threshold, use it (static consistency)
            if err_col is not None and err_col <= self.reprojection_threshold_px and zc_col is not None:
                cand_p = collective_p3d
                error_px = err_col
                proj_uv = proj_col
                zc = zc_col
            elif per_hit is not None:
                # Moving object or single-view terrain intersection
                cand_p = per_hit
                error_px, proj_uv, zc = compute_reprojection_error(cand_p, obs.pixel_center, intrinsics, pose)
            elif collective_p3d is not None:
                cand_p = collective_p3d
                error_px = err_col
                proj_uv = proj_col
                zc = zc_col
            else:
                cand_p = None
                error_px = None
                proj_uv = None
                zc = None

            per_frame_p = per_hit if per_hit is not None else cand_p

            if cand_p is None:
                obs.accepted = False
                obs.rejection_reason = "NO_GEOMETRY_INTERSECTION"
                rejected_obs.append(obs)
                continue

            error_px, proj_uv, zc = compute_reprojection_error(cand_p, obs.pixel_center, intrinsics, pose)

            if error_px is None or zc is None:
                obs.accepted = False
                obs.rejection_reason = "BEHIND_CAMERA"
                rejected_obs.append(obs)
                continue

            obs.point_3d = [float(v) for v in cand_p]
            obs.reprojected_pixel = proj_uv
            obs.reprojection_error_px = error_px
            obs.depth_zc = zc

            # Check configurable reprojection error threshold
            if error_px <= self.reprojection_threshold_px:
                obs.accepted = True
                accepted_obs.append(obs)
                point_trajectory.append({
                    "timestamp": round(obs.timestamp, 3),
                    "frame_id": obs.frame_id,
                    "x": round(per_frame_p[0], 4),
                    "y": round(per_frame_p[1], 4),
                    "z": round(per_frame_p[2], 4),
                    "reprojection_error_px": round(error_px, 2),
                })
            else:
                obs.accepted = False
                obs.rejection_reason = "EXCESSIVE_REPROJECTION_ERROR"
                rejected_obs.append(obs)

        for obs in all_obs:
            if obs not in accepted_obs and obs not in rejected_obs:
                rejected_obs.append(obs)

        # 5. Multi-Frame Track Fusion & Representative Position
        evidence_count = len(accepted_obs)
        rejected_count = len(rejected_obs)

        if evidence_count == 0:
            return FusedObject3D(
                object_id=f"OBJ_{track_id}",
                track_id=track_id,
                class_name=class_name,
                motion_state="UNKNOWN",
                association_status="REJECTED",
                association_confidence=0.0,
                evidence_count=0,
                rejected_count=rejected_count,
                association_method=method,
                observations=all_obs,
                rejected_observations=rejected_obs,
            )

        errors = [obs.reprojection_error_px for obs in accepted_obs if obs.reprojection_error_px is not None]
        mean_err = float(np.mean(errors)) if errors else None
        median_err = float(np.median(errors)) if errors else None
        p90_err = float(np.percentile(errors, 90)) if errors else None

        all_pts = np.array([obs.point_3d for obs in accepted_obs], dtype=np.float64)
        rep_pos = [float(v) for v in np.median(all_pts, axis=0)]

        # 6. Motion State Classification (STATIC vs MOVING vs UNKNOWN)
        motion_state = "UNKNOWN"
        if len(point_trajectory) >= 3:
            traj_pts = np.array([[pt["x"], pt["y"], pt["z"]] for pt in point_trajectory], dtype=np.float64)
            d_net = float(np.linalg.norm(traj_pts[-1] - traj_pts[0]))
            pairwise = np.linalg.norm(np.diff(traj_pts, axis=0), axis=1)
            path_len = float(np.sum(pairwise))
            std_dev = float(np.mean(np.std(traj_pts, axis=0)))

            if d_net > 1.5 and path_len > 2.0 and std_dev > 0.5:
                motion_state = "MOVING"
            else:
                motion_state = "STATIC"
        elif evidence_count >= 1:
            motion_state = "STATIC"

        # 7. Association Confidence Scoring
        c_frames = min(1.0, evidence_count / 4.0)
        c_reproj = max(0.0, 1.0 - (mean_err or 0.0) / self.reprojection_threshold_px)
        avg_det_conf = float(np.mean([obs.detection_confidence for obs in accepted_obs]))
        c_baseline = min(1.0, baseline_angle / 15.0) if baseline_angle > 0 else 0.5

        confidence = 0.35 * c_frames + 0.35 * c_reproj + 0.15 * avg_det_conf + 0.15 * c_baseline
        confidence = float(np.clip(confidence, 0.0, 1.0))

        if evidence_count >= 2 and confidence >= 0.60:
            status = "VALID"
        elif evidence_count >= 2 and confidence >= 0.35:
            status = "LOW_CONFIDENCE"
        elif evidence_count < 2:
            status = "INSUFFICIENT_EVIDENCE"
        else:
            status = "LOW_CONFIDENCE"

        return FusedObject3D(
            object_id=f"OBJ_{track_id}",
            track_id=track_id,
            class_name=class_name,
            motion_state=motion_state,
            coordinate_system="LOCAL_ARBITRARY",
            position_3d=rep_pos,
            trajectory_3d=point_trajectory,
            association_status=status,
            association_confidence=confidence,
            mean_reprojection_error_px=mean_err,
            median_reprojection_error_px=median_err,
            p90_reprojection_error_px=p90_err,
            evidence_count=evidence_count,
            rejected_count=rejected_count,
            association_method=method,
            observations=all_obs,
            rejected_observations=rejected_obs,
        )

    def fuse_all_tracks(
        self,
        tracks: list[dict[str, Any]],
        poses_by_name: dict[str, tuple[CameraIntrinsics, CameraPose]],
    ) -> list[FusedObject3D]:
        """Batch fuse multiple tracks into 3D objects."""
        results: list[FusedObject3D] = []
        for t in tracks:
            track_id = str(t.get("track_id", "T0000"))
            class_name = str(t.get("class_name") or t.get("class", "object"))
            raw_dets = t.get("observations") or t.get("detections") or []
            if not raw_dets and "trajectory" in t:
                traj = t.get("trajectory") or []
                first_f = t.get("first_frame", "")
                conf = float(t.get("average_confidence", 0.5))
                raw_dets = [
                    {"frame_id": first_f, "bbox": [pt[0]-10, pt[1]-10, pt[0]+10, pt[1]+10], "confidence": conf, "timestamp": 0.0}
                    for pt in traj[:1]
                ]
            fused = self.fuse_track(track_id, class_name, raw_dets, poses_by_name)
            results.append(fused)
        return results
