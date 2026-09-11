"""
Regression test for cross-mission 3D reconstruction and mesh scoping.
Ensures that mission A and mission B serve strictly distinct reconstruction metadata,
point clouds, and surface meshes.
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_reconstruction_metadata_distinct_per_mission():
    """Verify that different seeded missions return distinct point counts, cameras, and mesh faces."""
    resp_nr = client.get("/api/missions/north-ridge/reconstruction")
    assert resp_nr.status_code == 200
    meta_nr = resp_nr.json()["reconstruction"]

    resp_ra = client.get("/api/missions/river-approach/reconstruction")
    assert resp_ra.status_code == 200
    meta_ra = resp_ra.json()["reconstruction"]

    resp_dg = client.get("/api/missions/downtown-grid/reconstruction")
    assert resp_dg.status_code == 200
    meta_dg = resp_dg.json()["reconstruction"]

    # Verify point counts are distinct and not hardcoded copy
    assert meta_nr["sparse_point_count"] == 5252
    assert meta_ra["sparse_point_count"] == 2612
    assert meta_dg["sparse_point_count"] == 4466
    assert meta_nr["sparse_point_count"] != meta_ra["sparse_point_count"]
    assert meta_ra["sparse_point_count"] != meta_dg["sparse_point_count"]

    # Verify mesh faces are distinct and not unavailable
    assert meta_nr.get("mesh", {}).get("face_count") == 25584
    assert meta_ra.get("mesh", {}).get("face_count") == 20092
    assert meta_dg.get("mesh", {}).get("face_count") == 22393

    # Verify reprojection errors are distinct
    assert meta_nr["mean_reprojection_error"] != meta_ra["mean_reprojection_error"]


def test_reconstruction_mesh_bytes_distinct_per_mission():
    """Verify that GET /reconstruction/mesh returns distinct binary data for different missions."""
    resp_nr = client.get("/api/missions/north-ridge/reconstruction/mesh")
    assert resp_nr.status_code == 200
    bytes_nr = resp_nr.content
    assert len(bytes_nr) > 0
    assert bytes_nr.startswith(b"ply")

    resp_ra = client.get("/api/missions/river-approach/reconstruction/mesh")
    assert resp_ra.status_code == 200
    bytes_ra = resp_ra.content
    assert len(bytes_ra) > 0
    assert bytes_ra.startswith(b"ply")

    resp_dg = client.get("/api/missions/downtown-grid/reconstruction/mesh")
    assert resp_dg.status_code == 200
    bytes_dg = resp_dg.content
    assert len(bytes_dg) > 0
    assert bytes_dg.startswith(b"ply")

    # Content must differ across all missions
    assert bytes_nr != bytes_ra
    assert bytes_ra != bytes_dg
    assert len(bytes_nr) != len(bytes_ra)


def test_reconstruction_pointcloud_bytes_distinct_per_mission():
    """Verify that GET /reconstruction/pointcloud returns distinct binary point clouds."""
    resp_nr = client.get("/api/missions/north-ridge/reconstruction/pointcloud")
    assert resp_nr.status_code == 200
    bytes_nr = resp_nr.content

    resp_ra = client.get("/api/missions/river-approach/reconstruction/pointcloud")
    assert resp_ra.status_code == 200
    bytes_ra = resp_ra.content

    assert bytes_nr != bytes_ra
    assert len(bytes_nr) == 78968
    assert len(bytes_ra) == 39368
