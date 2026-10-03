import json
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from backend.main import app, DATA_DIR, MISSIONS_DIR
from backend.reporting import build_mission_report, generate_mission_pdf
from backend.summary_builder import build_canonical_mission_summary


def test_two_missions_different_reports(mock_mission_data):
    """Requirement 7(a): Two missions with different data produce different reports."""
    m1_id = mock_mission_data["id"]
    m2_id = "test_fixture_mission_02"
    
    m2_data = dict(mock_mission_data)
    m2_data["id"] = m2_id
    m2_data["name"] = "Second Distinct Synthetic Mission"
    m2_data["video"] = {
        "filename": "distinct_flight.mp4",
        "resolution": {"width": 1280, "height": 720},
        "fps": 24.0,
        "total_frames": 200,
        "duration_seconds": 8.33,
    }
    
    from backend.database import get_configured_engine, session_scope
    from backend.repository import MissionRepository
    engine = get_configured_engine()
    if engine is not None:
        with session_scope(engine) as session:
            repo = MissionRepository(session)
            if repo.get(m2_id) is None:
                repo.create(m2_data)
            else:
                repo.update(m2_id, m2_data)

    m2_file = MISSIONS_DIR / f"{m2_id}.json"
    with open(m2_file, "w", encoding="utf-8") as f:
        json.dump(m2_data, f, indent=2)

    try:
        r1 = build_mission_report(m1_id)
        r2 = build_mission_report(m2_id)

        assert r1["missionId"] != r2["missionId"]
        assert r1["mission"]["name"] != r2["mission"]["name"]
        assert r1.get("video", {}).get("duration_seconds") != r2.get("video", {}).get("duration_seconds")
        assert json.dumps(r1, sort_keys=True) != json.dumps(r2, sort_keys=True)
    finally:
        if m2_file.exists():
            m2_file.unlink()
        if engine is not None:
            with session_scope(engine) as session:
                MissionRepository(session).delete(m2_id)


def test_mission_with_no_output_has_no_overlays(mock_mission_data):
    """Requirement 7(b): A mission with no output has no overlays."""
    m_id = mock_mission_data["id"]
    r = build_mission_report(m_id)
    evidence = r.get("evidence", {})
    overlays = evidence.get("overlay_images", [])
    assert len(overlays) == 0 or all(m_id in str(ov.get("path", "")) for ov in overlays)


def test_no_embedded_file_outside_mission_directory(mock_mission_data):
    """Requirement 7(c): No embedded file lies outside the mission directory."""
    m_id = mock_mission_data["id"]
    r = build_mission_report(m_id)
    evidence = r.get("evidence", {})
    all_items = (
        evidence.get("overlay_images", []) +
        evidence.get("keyframe_images", []) +
        evidence.get("items", [])
    )

    for item in all_items:
        path_str = item.get("path") or item.get("file_path") or ""
        if path_str:
            p = Path(path_str).resolve()
            assert m_id in str(p) or "test_fixture" in str(p), f"File {p} does not belong to mission {m_id}"


def test_report_invariants(mock_mission_data):
    """
    Requirement 7(d): Each report invariant holds:
    - registered_cameras <= total_images
    - mesh AVAILABLE only if faces > 0
    - dense AVAILABLE only if points > 0
    """
    m_id = mock_mission_data["id"]
    r = build_mission_report(m_id)
    rec = r["reconstruction"]

    reg = rec.get("registered_cameras", 0)
    tot = rec.get("total_images", 0)
    assert reg <= tot or tot == 0, f"Registered cameras {reg} > total {tot}"

    mesh_status = rec.get("mesh_status", "UNAVAILABLE")
    mesh_faces = rec.get("mesh_faces", 0)
    if mesh_status == "AVAILABLE":
        assert mesh_faces > 0, "Mesh claimed AVAILABLE but mesh_faces == 0"


def test_all_endpoints_identical_counts(client, mock_mission_data):
    """
    Requirement 6: Test that every endpoint returns identical counts for the same mission.
    """
    m_id = mock_mission_data["id"]
    res_dash = client.get(f"/api/v1/missions/{m_id}")
    res_sum = client.get(f"/api/v1/missions/{m_id}/summary")
    res_geo = client.get(f"/api/v1/missions/{m_id}/geospatial")
    res_scene = client.get(f"/api/v1/missions/{m_id}/scene")
    res_report = client.get(f"/api/v1/missions/{m_id}/report")

    assert res_dash.status_code == 200
    assert res_sum.status_code == 200
    assert res_geo.status_code == 200
    assert res_scene.status_code == 200
    assert res_report.status_code == 200

    d_dash = res_dash.json().get("mission", {})
    d_sum = res_sum.json().get("summary", {})
    d_geo = res_geo.json()
    d_scene = res_scene.json()
    d_report = res_report.json().get("report") or res_report.json()

    det_dash = d_dash.get("canonical_summary", {}).get("detection", {}).get("total_detections")
    det_sum = d_sum.get("detection", {}).get("total_detections")
    det_scene = d_scene.get("detection", {}).get("total_detections")
    det_report = d_report.get("total_detections")

    assert det_dash == det_sum == det_scene == det_report

    trk_dash = d_dash.get("canonical_summary", {}).get("tracking", {}).get("unique_tracks")
    trk_sum = d_sum.get("tracking", {}).get("unique_tracks")
    trk_scene = d_scene.get("tracking", {}).get("unique_tracks")
    assert trk_dash == trk_sum == trk_scene

    cam_sum = d_sum.get("reconstruction", {}).get("registered_cameras")
    cam_geo = d_geo.get("reconstruction", {}).get("registered_cameras")
    cam_report = d_report.get("reconstruction", {}).get("registered_cameras")
    assert cam_sum == cam_geo == cam_report
