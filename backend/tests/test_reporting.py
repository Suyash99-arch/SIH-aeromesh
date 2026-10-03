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


def test_report_payload_structure(mock_mission_data):
    """Verify structured report contains authentic metrics from fixture without fabrication."""
    m_id = mock_mission_data["id"]
    report = build_mission_report(m_id, mock_mission_data)

    # 1. Base identifiers
    assert report["missionId"] == m_id
    assert "sections" in report

    # 2. Mission & Video
    assert report["mission"]["id"] == m_id
    assert report["video"]["resolution"] == "1920x1080"
    assert report["video"]["fps"] == 30.0

    # 3. Detection & Tracking
    det = report["detection"]
    assert det["total_detections"] == 10
    assert det["detections_by_class"]["vehicle"] == 8

    trk = report["tracking"]
    assert trk["unique_tracks"] == 4
    assert trk["tracks_by_class"]["vehicle"] == 3

    # 4. Reconstruction
    rec = report["reconstruction"]
    assert rec["registered_cameras"] == 5
    assert rec["sparse_point_count"] == 500

    # 5. Scientific disclosures
    assert report["spatial_fusion"]["coordinate_system"] == "LOCAL_ARBITRARY"


def test_pdf_generation(mock_mission_data):
    """Verify multi-page PDF generation."""
    m_id = mock_mission_data["id"]
    report = build_mission_report(m_id, mock_mission_data)
    pdf_buffer = io.BytesIO()
    generate_mission_pdf(report, pdf_buffer)

    pdf_bytes = pdf_buffer.getvalue()
    assert len(pdf_bytes) > 2000
    assert pdf_bytes.startswith(b"%PDF-")


def test_csv_generation(mock_mission_data):
    """Verify CSV export."""
    m_id = mock_mission_data["id"]
    report = build_mission_report(m_id, mock_mission_data)
    csv_str = generate_mission_csv(report)
    assert "object_id" in csv_str or "object_label" in csv_str or "class" in csv_str


def test_evidence_package_zip(mock_mission_data):
    """Verify evidence package zip structure."""
    m_id = mock_mission_data["id"]
    report = build_mission_report(m_id, mock_mission_data)
    zip_bytes = build_evidence_package(m_id, report)

    assert len(zip_bytes) > 500
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        file_list = zf.namelist()
        assert any(f.endswith(".pdf") for f in file_list)
        assert any(f.endswith(".csv") for f in file_list)
        assert any(f.endswith(".json") for f in file_list)


def test_api_report_and_export_endpoints(client, mock_mission_data):
    """Verify API reporting and export routes using mock_mission_data."""
    m_id = mock_mission_data["id"]
    res = client.get(f"/api/v1/missions/{m_id}/report")
    assert res.status_code == 200
    body = res.json()
    assert body["report"]["missionId"] == m_id

    res_pdf = client.get(f"/api/v1/missions/{m_id}/report/pdf")
    assert res_pdf.status_code == 200
    assert res_pdf.headers["content-type"] == "application/pdf"
