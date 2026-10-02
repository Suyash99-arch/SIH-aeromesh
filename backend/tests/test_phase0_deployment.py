import io
from pathlib import Path
from fastapi.testclient import TestClient
import pytest

from backend import main
from backend.storage import LocalObjectStorage, get_storage

client = TestClient(main.app)


def test_health_endpoints_all_prefixes():
    """Verify health endpoints respond across /health, /api/health, and /api/v1/health."""
    for path in ["/health", "/api/health", "/api/v1/health"]:
        res = client.get(path)
        assert res.status_code == 200, f"Failed on path {path}: {res.status_code}"
        data = res.json()
        assert data.get("status") == "healthy"
        assert data.get("backend") == "ready"


def test_readiness_endpoints_all_prefixes():
    """Verify readiness endpoints respond across /ready, /api/ready, and /api/v1/ready."""
    for path in ["/ready", "/api/ready", "/api/v1/ready"]:
        res = client.get(path)
        assert res.status_code == 200, f"Failed on path {path}: {res.status_code}"
        data = res.json()
        assert "checks" in data or "ready" in data or "status" in data


def test_missions_endpoints_no_404():
    """Verify /missions is never a 404, working across /missions, /api/missions, and /api/v1/missions."""
    for path in ["/missions", "/api/missions", "/api/v1/missions"]:
        res = client.get(path)
        assert res.status_code == 200, f"Expected 200 on {path}, got {res.status_code}"
        data = res.json()
        assert data.get("success") is True
        assert isinstance(data.get("missions"), list)


def test_mission_lifecycle_and_delete():
    """Verify mission creation, retrieval, and deletion with /api/v1 prefix."""
    # Create mission
    create_res = client.post("/api/v1/missions", params={"name": "Phase 0 Verification Mission"})
    assert create_res.status_code == 200
    mission_id = create_res.json()["mission"]["id"]

    # Verify retrieval
    get_res = client.get(f"/api/v1/missions/{mission_id}")
    assert get_res.status_code == 200
    assert get_res.json()["mission"]["name"] == "Phase 0 Verification Mission"

    # Verify deletion
    del_res = client.delete(f"/api/v1/missions/{mission_id}")
    assert del_res.status_code == 200
    assert del_res.json().get("success") is True

    # Verify 404 after deletion
    after_del = client.get(f"/api/v1/missions/{mission_id}")
    assert after_del.status_code == 404


def test_video_http_range_streaming(tmp_path, monkeypatch):
    """Verify video streaming supports HTTP Range requests (RFC 7233)."""
    # Create a dummy video in a test mission directory
    test_mission_id = "test-range-vid"
    mission_dir = main.MISSIONS_DIR / test_mission_id
    mission_dir.mkdir(parents=True, exist_ok=True)
    video_path = mission_dir / "flight-video.mp4"
    video_data = b"0123456789" * 1000  # 10,000 bytes
    video_path.write_bytes(video_data)

    try:
        # Full content request (no range)
        res_full = client.get(f"/api/v1/missions/{test_mission_id}/video")
        assert res_full.status_code == 200
        assert res_full.headers["Accept-Ranges"] == "bytes"
        assert int(res_full.headers["Content-Length"]) == len(video_data)
        assert res_full.content == video_data

        # Partial content range request (bytes 100-199)
        res_range = client.get(
            f"/api/v1/missions/{test_mission_id}/video",
            headers={"Range": "bytes=100-199"},
        )
        assert res_range.status_code == 206
        assert res_range.headers["Content-Range"] == f"bytes 100-199/{len(video_data)}"
        assert int(res_range.headers["Content-Length"]) == 100
        assert res_range.content == video_data[100:200]
    finally:
        import shutil
        if mission_dir.exists():
            shutil.rmtree(mission_dir, ignore_errors=True)


def test_cors_headers_exposed():
    """Verify CORS headers expose Range and Content headers for video streaming."""
    res = client.get(
        "/api/v1/health",
        headers={
            "Origin": "http://localhost:5173",
        },
    )
    expose = res.headers.get("Access-Control-Expose-Headers", "")
    assert "Content-Range" in expose or "content-range" in expose.lower()
    assert "Accept-Ranges" in expose or "accept-ranges" in expose.lower()
