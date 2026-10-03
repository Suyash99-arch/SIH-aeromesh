"""
Regression test for cross-mission 3D reconstruction and mesh scoping.
Ensures that mission A and mission B serve strictly distinct reconstruction metadata,
point clouds, and surface meshes.
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


import pytest
from fastapi.testclient import TestClient
from backend import main

client = TestClient(main.app)


def test_reconstruction_metadata_distinct_per_mission():
    """Verify that different missions return distinct point counts, cameras, and mesh faces."""
    m1_res = client.post("/api/v1/missions?name=Scope_Test_1").json()["mission"]
    m2_res = client.post("/api/v1/missions?name=Scope_Test_2").json()["mission"]
    m3_res = client.post("/api/v1/missions?name=Scope_Test_3").json()["mission"]

    m1_id, m2_id, m3_id = m1_res["id"], m2_res["id"], m3_res["id"]

    # Write distinct reconstruction metadata
    for m_id, pts, faces in [(m1_id, 100, 50), (m2_id, 200, 100), (m3_id, 300, 150)]:
        m_data = main.MissionData(m_id)
        m_data.update({
            "reconstruction": {
                "status": "completed",
                "registered_cameras": 5,
                "sparse_point_count": pts,
                "point_count": pts,
                "mean_reprojection_error": float(pts) / 100.0,
                "mesh": {"face_count": faces},
            }
        })

    resp_m1 = client.get(f"/api/v1/missions/{m1_id}/reconstruction")
    assert resp_m1.status_code == 200
    meta_m1 = resp_m1.json()["reconstruction"]

    resp_m2 = client.get(f"/api/v1/missions/{m2_id}/reconstruction")
    assert resp_m2.status_code == 200
    meta_m2 = resp_m2.json()["reconstruction"]

    resp_m3 = client.get(f"/api/v1/missions/{m3_id}/reconstruction")
    assert resp_m3.status_code == 200
    meta_m3 = resp_m3.json()["reconstruction"]

    # Verify point counts are distinct
    assert meta_m1.get("sparse_point_count") == 100
    assert meta_m2.get("sparse_point_count") == 200
    assert meta_m3.get("sparse_point_count") == 300
    assert meta_m1.get("sparse_point_count") != meta_m2.get("sparse_point_count")

    # Verify mesh faces are distinct
    assert meta_m1.get("mesh", {}).get("face_count") == 50
    assert meta_m2.get("mesh", {}).get("face_count") == 100
    assert meta_m3.get("mesh", {}).get("face_count") == 150

    # Verify reprojection errors are distinct
    assert meta_m1["mean_reprojection_error"] != meta_m2["mean_reprojection_error"]


def test_reconstruction_mesh_bytes_distinct_per_mission():
    """Verify that GET /reconstruction/mesh returns distinct binary data for different missions."""
    m1_id = client.post("/api/v1/missions?name=Scope_Mesh_1").json()["mission"]["id"]
    m2_id = client.post("/api/v1/missions?name=Scope_Mesh_2").json()["mission"]["id"]
    m3_id = client.post("/api/v1/missions?name=Scope_Mesh_3").json()["mission"]["id"]

    for m_id, tag in [(m1_id, b"mesh_content_111"), (m2_id, b"mesh_content_222222"), (m3_id, b"mesh_content_333333333")]:
        m_dir = main.MISSIONS_DIR / m_id / "reconstruction"
        m_dir.mkdir(parents=True, exist_ok=True)
        (m_dir / "mesh.ply").write_bytes(b"ply\nformat ascii 1.0\nend_header\n" + tag)
        main.MissionData(m_id).update({"status": "completed"})

    resp_m1 = client.get(f"/api/v1/missions/{m1_id}/reconstruction/mesh")
    assert resp_m1.status_code == 200
    bytes_m1 = resp_m1.content

    resp_m2 = client.get(f"/api/v1/missions/{m2_id}/reconstruction/mesh")
    assert resp_m2.status_code == 200
    bytes_m2 = resp_m2.content

    resp_m3 = client.get(f"/api/v1/missions/{m3_id}/reconstruction/mesh")
    assert resp_m3.status_code == 200
    bytes_m3 = resp_m3.content

    assert bytes_m1 != bytes_m2
    assert bytes_m2 != bytes_m3
    assert len(bytes_m1) != len(bytes_m2)


def test_reconstruction_pointcloud_bytes_distinct_per_mission():
    """Verify that GET /reconstruction/pointcloud returns distinct binary point clouds."""
    m1_id = client.post("/api/v1/missions?name=Scope_PC_1").json()["mission"]["id"]
    m2_id = client.post("/api/v1/missions?name=Scope_PC_2").json()["mission"]["id"]

    for m_id, tag in [(m1_id, b"pc_content_111"), (m2_id, b"pc_content_222222")]:
        m_dir = main.MISSIONS_DIR / m_id / "reconstruction"
        m_dir.mkdir(parents=True, exist_ok=True)
        (m_dir / "point_cloud.ply").write_bytes(b"ply\nformat ascii 1.0\nend_header\n" + tag)
        main.MissionData(m_id).update({"status": "completed"})

    resp_m1 = client.get(f"/api/v1/missions/{m1_id}/reconstruction/pointcloud")
    assert resp_m1.status_code == 200
    bytes_m1 = resp_m1.content

    resp_m2 = client.get(f"/api/v1/missions/{m2_id}/reconstruction/pointcloud")
    assert resp_m2.status_code == 200
    bytes_m2 = resp_m2.content

    assert bytes_m1 != bytes_m2
    assert len(bytes_m1) != len(bytes_m2)
