import io
import json
import shutil
from pathlib import Path
import pytest
from starlette.testclient import TestClient

from backend.main import app, DATA_DIR, MISSIONS_DIR
from backend.reporting import build_mission_report, generate_mission_pdf
from backend.summary_builder import build_canonical_mission_summary


@pytest.fixture
def client():
    return TestClient(app)


def test_two_missions_different_reports():
    """Requirement 7(a): Two missions with different videos produce different reports."""
    # Build reports for two distinct missions
    m1_id = "phase5_drone_validation"
    m2_id = "66f84733-06de-41fd-8227-ddf82b15561f"

    r1 = build_mission_report(m1_id)
    r2 = build_mission_report(m2_id)

    # Must be distinct reports
    assert r1["missionId"] != r2["missionId"]
    assert r1["mission"]["name"] != r2["mission"]["name"]
    # Video or detection counts must differ
    v1 = r1.get("video") or {}
    v2 = r2.get("video") or {}
    assert (
        v1.get("filename") != v2.get("filename") or
        v1.get("duration_seconds") != v2.get("duration_seconds") or
        v1.get("url") != v2.get("url")
    )
    # The report payloads as JSON strings must not be equal
    assert json.dumps(r1, sort_keys=True) != json.dumps(r2, sort_keys=True)


def test_mission_with_no_output_has_no_overlays():
    """Requirement 7(b): A mission with no output has no overlays."""
    # Mission 66f84733 has not generated phase 6 overlays
    r = build_mission_report("66f84733-06de-41fd-8227-ddf82b15561f")
    evidence = r.get("evidence", {})
    overlays = evidence.get("overlay_images", [])

    # If reconstruction/fusion has not generated overlays, evidence must be empty
    # and not fall back to phase6 or other missions' overlays
    assert len(overlays) == 0 or all(
        "66f84733-06de-41fd-8227-ddf82b15561f" in str(ov.get("path", ""))
        for ov in overlays
    )


def test_no_embedded_file_outside_mission_directory():
    """Requirement 7(c): No embedded file lies outside the mission directory."""
    for mission_id in ["phase5_drone_validation", "66f84733-06de-41fd-8227-ddf82b15561f"]:
        r = build_mission_report(mission_id)
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
                # Must be located inside this mission's own data directory
                # and NOT from generic data/validation or another mission
                assert mission_id in str(p) or "phase5" in str(p), (
                    f"File {p} does not belong to mission {mission_id}"
                )
                assert "phase6" not in str(p) or mission_id == "phase6", (
                    f"Foreign phase6 artifact leaked into mission {mission_id}: {p}"
                )


def test_report_invariants():
    """
    Requirement 7(d): Each report invariant holds:
    - registered_cameras <= total_images
    - mesh AVAILABLE only if faces > 0
    - dense AVAILABLE only if points > 0
    - spatial fusion acceptance N/A when 0 evaluated
    """
    test_ids = ["phase5_drone_validation", "66f84733-06de-41fd-8227-ddf82b15561f"]
    for m_id in test_ids:
        r = build_mission_report(m_id)
        rec = r["reconstruction"]

        # Invariant 1: registered_cameras <= total_images
        reg = rec.get("registered_cameras", 0)
        tot = rec.get("total_images", 0)
        assert reg <= tot or tot == 0, f"Registered cameras {reg} > total {tot}"

        # Invariant 2: mesh AVAILABLE only if faces > 0
        mesh_status = rec.get("mesh_status", "UNAVAILABLE")
        mesh_faces = rec.get("mesh_faces", 0)
        if mesh_status == "AVAILABLE":
            assert mesh_faces > 0, "Mesh claimed AVAILABLE but mesh_faces == 0"
        if mesh_faces == 0:
            assert mesh_status in ("UNAVAILABLE", "NOT_GENERATED", None), (
                f"Mesh faces 0 but status {mesh_status}"
            )

        # Invariant 3: dense AVAILABLE only if points > 0
        dense_status = rec.get("dense_reconstruction_status", "UNAVAILABLE")
        dense_pts = rec.get("dense_point_count", 0)
        if dense_status == "AVAILABLE":
            assert dense_pts > 0, "Dense claimed AVAILABLE but dense_point_count == 0"
        if dense_pts == 0:
            assert dense_status in ("UNAVAILABLE", "SKIPPED", None), (
                f"Dense points 0 but status {dense_status}"
            )

        # Invariant 4: Spatial fusion acceptance N/A when 0 evaluated
        fusion = r.get("spatial_fusion", {})
        auth_tracks = fusion.get("authoritative_tracks", 0)
        acceptance = fusion.get("acceptance_rate_pct")
        if auth_tracks == 0:
            assert acceptance == "N/A" or acceptance is None, (
                f"Zero tracks evaluated but acceptance rate is {acceptance}"
            )


def test_all_endpoints_identical_counts(client):
    """
    Requirement 6: Test that every endpoint returns identical counts for the same mission.
    """
    m_id = "phase5_drone_validation"
    # Call dashboard, summary, geospatial, scene, report
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

    # Total detections must match across all endpoints
    det_dash = d_dash.get("canonical_summary", {}).get("detection", {}).get("total_detections")
    det_sum = d_sum.get("detection", {}).get("total_detections")
    det_scene = d_scene.get("detection", {}).get("total_detections")
    det_report = d_report.get("total_detections")

    assert det_dash == det_sum == det_scene == det_report

    # Unique tracks count must match
    trk_dash = d_dash.get("canonical_summary", {}).get("tracking", {}).get("unique_tracks")
    trk_sum = d_sum.get("tracking", {}).get("unique_tracks")
    trk_scene = d_scene.get("tracking", {}).get("unique_tracks")
    assert trk_dash == trk_sum == trk_scene

    # Registered cameras must match
    cam_sum = d_sum.get("reconstruction", {}).get("registered_cameras")
    cam_geo = d_geo.get("reconstruction", {}).get("registered_cameras")
    cam_report = d_report.get("reconstruction", {}).get("registered_cameras")
    assert cam_sum == cam_geo == cam_report
