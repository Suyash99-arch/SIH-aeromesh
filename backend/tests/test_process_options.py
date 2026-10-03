import pytest
from fastapi.testclient import TestClient
import backend.main as main
from pathlib import Path


@pytest.fixture
def test_app():
    return TestClient(main.app)


def _setup_mock_video_for_mission(mission_id: str):
    mission_dir = main.MISSIONS_DIR / mission_id
    mission_dir.mkdir(parents=True, exist_ok=True)
    dummy_video = mission_dir / "video.mp4"
    dummy_video.write_bytes(b"fake video content")
    
    mission = main.MissionData(mission_id)
    mission.update({"video": {"filename": "video.mp4", "storage_key": None}})
    return dummy_video


def test_process_valid_options_json_body(test_app, monkeypatch):
    """POST /api/v1/missions/{id}/process accepts typed Pydantic options in JSON body."""
    monkeypatch.setattr(main, "_dispatch_task_wrapper", lambda kwargs: None)
    
    # Create mission
    created = test_app.post("/api/v1/missions", params={"name": "JSON Body Options Test"})
    assert created.status_code == 200
    mission_id = created.json()["mission"]["id"]

    _setup_mock_video_for_mission(mission_id)

    payload = {
        "frame_sampling": 3.0,
        "inference_resolution": 1280,
        "detection_confidence": 0.5,
        "reconstruction_quality": "high",
        "scene_profile": "urban",
    }

    res = test_app.post(f"/api/v1/missions/{mission_id}/process", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["status"] in ("PROCESSING", "QUEUED")
    assert data["mission_id"] == mission_id
    assert "job_id" in data


def test_process_missing_options_uses_defaults(test_app, monkeypatch):
    """Missing request body or empty options correctly defaults all parameters."""
    monkeypatch.setattr(main, "_dispatch_task_wrapper", lambda kwargs: None)
    
    created = test_app.post("/api/v1/missions", params={"name": "Defaults Test"})
    assert created.status_code == 200
    mission_id = created.json()["mission"]["id"]

    _setup_mock_video_for_mission(mission_id)

    # Post with empty json
    res = test_app.post(f"/api/v1/missions/{mission_id}/process", json={})
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True

    job = main.get_job(data["job_id"])
    assert job is not None
    params = job.get("parameters", {})
    assert params.get("frame_sampling") == 2.0
    assert params.get("inference_resolution") == 640
    assert params.get("detection_confidence") == 0.35
    assert params.get("reconstruction_quality") == "medium"
    assert params.get("scene_profile") == "road"


def test_process_invalid_confidence_returns_clear_422(test_app):
    """Detection confidence > 1.0 or < 0.01 triggers 422 with clear validation message."""
    created = test_app.post("/api/v1/missions", params={"name": "Confidence 422 Test"})
    mission_id = created.json()["mission"]["id"]

    res = test_app.post(f"/api/v1/missions/{mission_id}/process", json={"detection_confidence": 2.5})
    assert res.status_code == 422
    data = res.json()
    assert "detail" in data
    errors = data["detail"]
    assert any("detection_confidence" in err.get("loc", []) for err in errors)


def test_process_invalid_resolution_returns_clear_422(test_app):
    """Resolution below 160 or above 3840 triggers 422 with clear field validation message."""
    created = test_app.post("/api/v1/missions", params={"name": "Resolution 422 Test"})
    mission_id = created.json()["mission"]["id"]

    res = test_app.post(f"/api/v1/missions/{mission_id}/process", json={"inference_resolution": 50})
    assert res.status_code == 422
    data = res.json()
    assert "detail" in data
    errors = data["detail"]
    assert any("inference_resolution" in err.get("loc", []) for err in errors)


def test_process_invalid_quality_returns_clear_422(test_app):
    """Unrecognized reconstruction quality returns clear 422 validation message."""
    created = test_app.post("/api/v1/missions", params={"name": "Quality 422 Test"})
    mission_id = created.json()["mission"]["id"]

    res = test_app.post(f"/api/v1/missions/{mission_id}/process", json={"reconstruction_quality": "ultra_extreme"})
    assert res.status_code == 422
    data = res.json()
    assert "detail" in data
    errors = data["detail"]
    assert any("reconstruction_quality" in err.get("loc", []) for err in errors)


def test_process_legacy_route_alias(test_app, monkeypatch):
    """Legacy alias /api/missions/{id}/process accepts json body and functions identically."""
    monkeypatch.setattr(main, "_dispatch_task_wrapper", lambda kwargs: None)
    
    created = test_app.post("/api/v1/missions", params={"name": "Legacy Alias Test"})
    mission_id = created.json()["mission"]["id"]

    _setup_mock_video_for_mission(mission_id)

    res = test_app.post(f"/api/missions/{mission_id}/process", json={"frame_sampling": 1.5})
    assert res.status_code == 200
    assert res.json()["success"] is True
