from __future__ import annotations

import math
import numpy as np
import pytest
from starlette.testclient import TestClient

from backend.main import app
from backend.spatial_fusion import (
    CameraIntrinsics,
    CameraPose,
    CameraRay,
    SpatialFusionEngine,
    TriangleMesh,
    compute_reprojection_error,
    project_3d_to_pixel,
    triangulate_multiview_rays,
    unproject_pixel_to_ray,
)


def test_pinhole_ray_unprojection():
    intrinsics = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=500.0, cy=500.0, width=1000, height=1000)
    R = np.eye(3)
    t = np.array([0.0, 0.0, 0.0])
    pose = CameraPose(R=R, t=t)

    # Principal point (500, 500) unprojects along the optical Z axis [0, 0, 1]
    ray = unproject_pixel_to_ray((500.0, 500.0), intrinsics, pose)
    np.testing.assert_allclose(ray.origin, [0.0, 0.0, 0.0], atol=1e-6)
    np.testing.assert_allclose(ray.direction, [0.0, 0.0, 1.0], atol=1e-6)

    # Point to the right (1000, 500) -> xn = (1000-500)/1000 = 0.5, yn = 0.0
    ray_right = unproject_pixel_to_ray((1000.0, 500.0), intrinsics, pose)
    expected_dir = np.array([0.5, 0.0, 1.0]) / math.sqrt(0.5**2 + 1.0)
    np.testing.assert_allclose(ray_right.direction, expected_dir, atol=1e-6)


def test_reprojection_error_and_behind_camera():
    intrinsics = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=500.0, cy=500.0)
    R = np.eye(3)
    t = np.array([0.0, 0.0, 0.0])
    pose = CameraPose(R=R, t=t)

    # Point at [1.0, 2.0, 10.0] -> u = 1000*(1/10) + 500 = 600, v = 1000*(2/10) + 500 = 700
    p3d = [1.0, 2.0, 10.0]
    error_px, proj_uv, zc = compute_reprojection_error(p3d, (600.0, 700.0), intrinsics, pose)
    assert error_px is not None
    assert abs(error_px) < 1e-6
    assert abs(zc - 10.0) < 1e-6
    assert abs(proj_uv[0] - 600.0) < 1e-6
    assert abs(proj_uv[1] - 700.0) < 1e-6

    # Point with offset -> calculate Euclidean distance
    error_px2, _, _ = compute_reprojection_error(p3d, (603.0, 704.0), intrinsics, pose)
    assert error_px2 is not None
    assert abs(error_px2 - 5.0) < 1e-4  # 3-4-5 triangle

    # Point behind camera (Z_c = -5.0)
    behind_p = [0.0, 0.0, -5.0]
    err_behind, _, _ = compute_reprojection_error(behind_p, (500.0, 500.0), intrinsics, pose)
    assert err_behind is None


def test_vectorized_mesh_intersection():
    # Construct a simple square mesh in the XY plane at Z = 10
    # Two triangles: (0,0,10)-(2,0,10)-(2,2,10) and (0,0,10)-(2,2,10)-(0,2,10)
    verts = np.array([
        [0.0, 0.0, 10.0],
        [2.0, 0.0, 10.0],
        [2.0, 2.0, 10.0],
        [0.0, 2.0, 10.0],
    ])
    faces = np.array([
        [0, 1, 2],
        [0, 2, 3],
    ])
    mesh = TriangleMesh(verts, faces)

    # Ray from origin aiming at [1.0, 1.0, 10.0]
    target = np.array([1.0, 1.0, 10.0])
    ray_dir = target / np.linalg.norm(target)
    ray = CameraRay(origin=np.array([0.0, 0.0, 0.0]), direction=ray_dir)

    hit_pt, dist = mesh.intersect_ray(ray)
    assert hit_pt is not None
    np.testing.assert_allclose(hit_pt, [1.0, 1.0, 10.0], atol=1e-5)
    assert abs(dist - np.linalg.norm(target)) < 1e-5

    # Ray missing the mesh (aiming backwards or way off)
    miss_ray = CameraRay(origin=np.array([0.0, 0.0, 0.0]), direction=np.array([0.0, 0.0, -1.0]))
    hit_miss, dist_miss = mesh.intersect_ray(miss_ray)
    assert hit_miss is None
    assert dist_miss is None


def test_multiview_ray_triangulation():
    # Target 3D point in world coordinates: [5.0, 3.0, 20.0]
    target_p = np.array([5.0, 3.0, 20.0])

    # Camera 1 at [-5, 0, 0] looking at target
    c1 = np.array([-5.0, 0.0, 0.0])
    d1 = (target_p - c1) / np.linalg.norm(target_p - c1)
    ray1 = CameraRay(origin=c1, direction=d1)

    # Camera 2 at [5, 0, 0] looking at target
    c2 = np.array([5.0, 0.0, 0.0])
    d2 = (target_p - c2) / np.linalg.norm(target_p - c2)
    ray2 = CameraRay(origin=c2, direction=d2)

    # Camera 3 at [0, 5, 0] looking at target
    c3 = np.array([0.0, 5.0, 0.0])
    d3 = (target_p - c3) / np.linalg.norm(target_p - c3)
    ray3 = CameraRay(origin=c3, direction=d3)

    p_sol, baseline_angle = triangulate_multiview_rays([ray1, ray2, ray3])
    assert p_sol is not None
    assert baseline_angle > 10.0  # Wide baseline
    np.testing.assert_allclose(p_sol, target_p, atol=1e-5)


def test_spatial_fusion_track_and_reprojection_validation():
    # Set up synthetic reconstruction environment
    intrinsics = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=500.0, cy=500.0)

    # Real 3D static point
    true_pos = np.array([2.0, 1.0, 15.0])

    # Three cameras observing the point
    cam_centers = [np.array([-2.0, 0.0, 0.0]), np.array([0.0, 0.0, 0.0]), np.array([2.0, 0.0, 0.0])]
    poses_by_name = {}
    detections = []

    for i, c in enumerate(cam_centers):
        frame_name = f"frame_{i:04d}.jpg"
        R = np.eye(3)
        t = -R @ c
        pose = CameraPose(R=R, t=t, image_name=frame_name, camera_id=1)
        poses_by_name[frame_name] = (intrinsics, pose)

        # Compute exact projection
        proj = project_3d_to_pixel(true_pos, intrinsics, pose)
        assert proj is not None
        u, v, _ = proj

        detections.append({
            "frame_id": frame_name,
            "bbox": [u - 10, v - 10, u + 10, v + 10],
            "confidence": 0.85,
            "timestamp": i * 0.5,
        })

    # Add an outlier detection in frame 1 (e.g. spurious detection far away)
    detections.append({
        "frame_id": "unregistered_frame.jpg",
        "bbox": [100.0, 100.0, 120.0, 120.0],
        "confidence": 0.30,
        "timestamp": 1.5,
    })

    engine = SpatialFusionEngine(reprojection_threshold_px=25.0)
    fused = engine.fuse_track("T0001", "car", detections, poses_by_name)

    assert fused.association_status == "VALID"
    assert fused.motion_state == "STATIC"
    assert fused.evidence_count == 3
    assert fused.rejected_count == 1  # Unregistered frame rejected
    assert fused.position_3d is not None
    np.testing.assert_allclose(fused.position_3d, true_pos, atol=1e-3)
    assert fused.mean_reprojection_error_px is not None
    assert fused.mean_reprojection_error_px < 1.0
    assert fused.association_confidence > 0.70
    assert fused.coordinate_system == "LOCAL_ARBITRARY"


def test_spatial_fusion_moving_object():
    intrinsics = CameraIntrinsics(fx=1000.0, fy=1000.0, cx=500.0, cy=500.0)

    # Object moving along X from X=0 to X=10 at Z=20
    cam_centers = [np.array([0.0, 0.0, 0.0]), np.array([2.0, 0.0, 0.0]), np.array([4.0, 0.0, 0.0]), np.array([6.0, 0.0, 0.0])]
    poses_by_name = {}
    detections = []

    # Construct a ground mesh at Z=20
    verts = np.array([[-50.0, -50.0, 20.0], [50.0, -50.0, 20.0], [50.0, 50.0, 20.0], [-50.0, 50.0, 20.0]])
    faces = np.array([[0, 1, 2], [0, 2, 3]])
    mesh = TriangleMesh(verts, faces)

    for i, c in enumerate(cam_centers):
        frame_name = f"frame_{i:04d}.jpg"
        R = np.eye(3)
        t = -R @ c
        pose = CameraPose(R=R, t=t, image_name=frame_name, camera_id=1)
        poses_by_name[frame_name] = (intrinsics, pose)

        pos_at_t = np.array([i * 3.0, 0.0, 20.0])  # Moving 3 units each frame
        proj = project_3d_to_pixel(pos_at_t, intrinsics, pose)
        assert proj is not None
        u, v, _ = proj
        detections.append({
            "frame_id": frame_name,
            "bbox": [u - 15, v - 15, u + 15, v + 15],
            "confidence": 0.90,
            "timestamp": i * 1.0,
        })

    engine = SpatialFusionEngine(reprojection_threshold_px=25.0, mesh=mesh)
    fused = engine.fuse_track("T0002", "car", detections, poses_by_name)

    assert fused.motion_state == "MOVING"
    assert len(fused.trajectory_3d) == 4
    # Check that trajectory has increasing X positions
    xs = [pt["x"] for pt in fused.trajectory_3d]
    assert xs[0] < xs[1] < xs[2] < xs[3]


def test_api_spatial_fusion_endpoints():
    client = TestClient(app)
    # Create mission
    create_res = client.post(
        "/api/missions",
        params={
            "name": "Fusion Test Mission",
            "location": "Test Yard",
            "mission_type": "single-pass",
            "operator": "Test Operator",
        },
    )
    assert create_res.status_code == 200
    mission_id = create_res.json()["mission"]["id"]

    # Semantic scene on empty mission
    scene_res = client.get(f"/api/missions/{mission_id}/semantic-scene")
    assert scene_res.status_code == 200
    data = scene_res.json()
    assert data["success"] is True
    assert data["semantic_scene"]["coordinate_system"] == "LOCAL_ARBITRARY"
    assert data["semantic_scene"]["scale_status"] == "RELATIVE_SCALE"

    # Objects 3D on empty mission
    objs_res = client.get(f"/api/missions/{mission_id}/objects-3d")
    assert objs_res.status_code == 200
    assert objs_res.json()["coordinate_system"] == "LOCAL_ARBITRARY"

    # Non-existent object returns 404
    obj_res = client.get(f"/api/missions/{mission_id}/objects/nonexistent/3d")
    assert obj_res.status_code == 404
