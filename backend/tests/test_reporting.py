from __future__ import annotations

import io
import json
import re
import zipfile
from starlette.testclient import TestClient

from backend.main import app
from backend.reporting import (
    build_evidence_package,
    build_mission_report,
    generate_mission_csv,
    generate_mission_geojson,
    generate_mission_json,
    generate_mission_pdf,
)


def test_report_payload_structure():
    """Verify the structured report contains authentic metrics from Phases 4.5 through 8 without fabrication."""
    report = build_mission_report("phase5_drone_validation")

    # 1. Backwards compatibility
    assert report["missionId"] == "phase5_drone_validation"
    assert "sections" in report
    assert {"summary", "video", "processing", "detections", "reconstruction", "measurements", "findings", "limitations"}.issubset(report["sections"])

    # 2. Mission & Video
    assert report["mission"]["id"] == "phase5_drone_validation"
    assert report["video"]["resolution"] == "3840x2160"
    assert report["video"]["fps"] == 24.0

    # 3. Detection & Tracking (Phase 4.5)
    det = report["detection"]
    assert det["model"] == "yolo11n"
    assert det["total_detections"] == 399
    assert det["detections_by_class"]["car"] == 383
    assert det["confidence_stats"]["mean"] > 0.45

    trk = report["tracking"]
    assert trk["unique_tracks"] == 23
    assert trk["tracks_by_class"]["car"] == 21

    # 4. Reconstruction (Phase 5)
    rec = report["reconstruction"]
    assert rec["status"] == "MESH_GENERATED"
    assert rec["registered_cameras"] == 20
    assert rec["sparse_points_count"] == 12916
    assert rec["mesh_vertices"] == 28139
    assert rec["mesh_faces"] == 56120
    assert rec["mean_reprojection_error_px"] < 1.0
    # Truthful dense reconstruction status
    assert rec["dense_reconstruction_status"] == "UNAVAILABLE"
    assert rec["dense_point_count"] == 0

    # 5. Scientific disclosures
    assert rec["coordinate_system"] == "LOCAL_ARBITRARY"
    assert rec["scale_status"] == "RELATIVE_SCALE"
    assert rec["georeferencing_status"] == "UNREFERENCED"

    # 6. AI-to-3D Spatial Fusion (Phase 6)
    fusion = report["spatial_fusion"]
    assert fusion["authoritative_tracks"] == 23
    assert fusion["status_breakdown"]["VALID"] >= 1
    assert fusion["status_breakdown"]["LOW_CONFIDENCE"] >= 1
    assert fusion["reprojection_statistics"]["mean_px"] < 3.0
    assert len(fusion["fused_objects"]) >= 3

    # 7. Measurements & Scale Calibration (Phase 7)
    meas = report["measurements"]
    cal = meas["active_calibration"]
    assert cal["is_active"] is True
    assert cal["method"] == "KNOWN_REFERENCE_DISTANCE"
    assert abs(cal["known_value"] - 15.0) < 1e-4

    items = meas["items"]
    assert any(i["type"] == "point_to_point_distance" and i["status"] == "METRIC_CALIBRATED" for i in items)
    assert any(i["type"] == "object_dimensions" for i in items)
    assert any(i["type"] == "volume" and i["status"] == "REFUSED_NON_WATERTIGHT" for i in items)

    # 8. Evidence & Limitations
    assert report["evidence"]["total_items"] > 0
    assert any("LOCAL_ARBITRARY" in lim for lim in report["limitations"])
    assert any("UNREFERENCED" in lim for lim in report["limitations"])
    assert any("DENSE_MVS_UNAVAILABLE" in lim for lim in report["limitations"])


def test_pdf_generation():
    """Verify real multi-page PDF generation with proper PDF header, size, and structure."""
    report = build_mission_report("phase5_drone_validation")
    pdf_buffer = io.BytesIO()
    generate_mission_pdf(report, pdf_buffer)

    pdf_bytes = pdf_buffer.getvalue()
    assert len(pdf_bytes) > 50000  # Non-empty, real document with embedded images
    assert pdf_bytes.startswith(b"%PDF-")
    assert b"%%EOF" in pdf_bytes

    # Page count check
    pages = len(re.findall(rb'/Type\s*/Page\b', pdf_bytes))
    assert pages >= 2


def test_csv_generation():
    """Verify downloadable CSV generation with one row per fused object."""
    report = build_mission_report("phase5_drone_validation")
    csv_str = generate_mission_csv(report)
    lines = [line.strip() for line in csv_str.strip().split("\n") if line.strip()]

    # Header + 3 objects
    assert len(lines) >= 4
    header = lines[0].split(",")
    assert "object_id" in header
    assert "track_id" in header
    assert "pos_x_local" in header
    assert "reprojection_error_px" in header
    assert "metric_length_m" in header

    # Ensure OBJ_T0001 is present
    assert any("OBJ_T0001" in line for line in lines)


def test_json_generation():
    """Verify complete JSON export artifact format."""
    report = build_mission_report("phase5_drone_validation")
    json_data = generate_mission_json(report)

    assert json_data["format"] == "AEROMESH_MISSION_EXPORT_V2"
    assert "mission" in json_data
    assert "reconstruction" in json_data
    assert "spatial_fusion" in json_data
    assert "measurements" in json_data
    assert "provenance" in json_data


def test_geojson_refusal_for_unreferenced_scene():
    """Verify GeoJSON refusal response for unreferenced mission (no fake GPS/WGS84)."""
    report = build_mission_report("phase5_drone_validation")
    geo = generate_mission_geojson(report)

    assert geo["available"] is False
    assert "Scene is not georeferenced" in geo["reason"]
    assert geo["coordinate_system"] == "LOCAL_ARBITRARY"
    assert geo["georeferencing_status"] == "UNREFERENCED"


def test_evidence_package_zip():
    """Verify evidence package ZIP contains PDF, CSV, JSON, GeoJSON info, and overlays."""
    report = build_mission_report("phase5_drone_validation")
    zip_bytes = build_evidence_package("phase5_drone_validation", report)

    assert len(zip_bytes) > 50000
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    file_list = zf.namelist()

    assert "README.txt" in file_list
    assert "report_phase5_drone_validation.pdf" in file_list
    assert "data_phase5_drone_validation.csv" in file_list
    assert "mission_phase5_drone_validation.json" in file_list
    assert "geojson_phase5_drone_validation.json" in file_list

    # Ensure overlays are packed
    overlays = [f for f in file_list if f.startswith("evidence/")]
    assert len(overlays) > 0


def test_api_report_and_export_endpoints():
    """Verify FastAPI endpoints serve correct content types and headers."""
    client = TestClient(app)

    # 1. JSON Report endpoint
    res = client.get("/api/missions/phase5_drone_validation/report")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["report"]["missionId"] == "phase5_drone_validation"

    # 2. PDF Download endpoint
    res_pdf = client.get("/api/missions/phase5_drone_validation/report/pdf")
    assert res_pdf.status_code == 200
    assert res_pdf.headers["content-type"] == "application/pdf"
    assert "attachment" in res_pdf.headers["content-disposition"]
    assert res_pdf.content.startswith(b"%PDF-")

    # 3. CSV Download endpoint
    res_csv = client.get("/api/missions/phase5_drone_validation/export/csv")
    assert res_csv.status_code == 200
    assert res_csv.headers["content-type"].startswith("text/csv")
    assert "object_id" in res_csv.text

    # 4. JSON Export endpoint
    res_json = client.get("/api/missions/phase5_drone_validation/export/json")
    assert res_json.status_code == 200
    assert res_json.headers["content-type"].startswith("application/json")
    export_obj = res_json.json()
    assert export_obj["format"] == "AEROMESH_MISSION_EXPORT_V2"

    # 5. GeoJSON endpoint (Refusal for unreferenced scene)
    res_geo = client.get("/api/missions/phase5_drone_validation/export/geojson")
    assert res_geo.status_code == 200
    geo_body = res_geo.json()
    assert geo_body["available"] is False
    assert "not georeferenced" in geo_body["reason"]

    # 6. Evidence Package ZIP endpoint
    res_pkg = client.get("/api/missions/phase5_drone_validation/export/package")
    assert res_pkg.status_code == 200
    assert res_pkg.headers["content-type"] == "application/zip"
    assert "attachment" in res_pkg.headers["content-disposition"]
    zf = zipfile.ZipFile(io.BytesIO(res_pkg.content))
    assert "README.txt" in zf.namelist()

    # 7. Nonexistent mission returns 404
    assert client.get("/api/missions/nonexistent_mission_id/report").status_code == 404
    assert client.get("/api/missions/nonexistent_mission_id/report/pdf").status_code == 404
    assert client.get("/api/missions/nonexistent_mission_id/export/csv").status_code == 404
    assert client.get("/api/missions/nonexistent_mission_id/export/json").status_code == 404
    assert client.get("/api/missions/nonexistent_mission_id/export/geojson").status_code == 404
    assert client.get("/api/missions/nonexistent_mission_id/export/package").status_code == 404
