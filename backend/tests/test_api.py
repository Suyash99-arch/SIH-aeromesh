import pytest
from fastapi.testclient import TestClient

from backend import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    missions_dir = tmp_path / "missions"
    missions_dir.mkdir()
    monkeypatch.setattr(main, "MISSIONS_DIR", missions_dir)
    return TestClient(main.app)


def create_mission(client, name="Baseline mission"):
    response = client.post(
        "/api/missions",
        params={
            "name": name,
            "mission_type": "single-pass",
            "location": "Test location",
            "operator": "Test operator",
        },
    )
    assert response.status_code == 200
    return response.json()["mission"]


def test_health(client):
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_mission_creation_retrieval_and_listing(client):
    created = create_mission(client)

    retrieved = client.get(f"/api/missions/{created['id']}")
    listed = client.get("/api/missions")

    assert retrieved.status_code == 200
    assert retrieved.json()["mission"]["name"] == "Baseline mission"
    assert listed.status_code == 200
    assert any(item["id"] == created["id"] for item in listed.json()["missions"])


def test_invalid_video_upload_is_rejected(client):
    mission = create_mission(client)

    response = client.post(
        f"/api/missions/{mission['id']}/upload",
        files={"file": ("notes.txt", b"not a video", "text/plain")},
    )

    assert response.status_code == 400
    assert "Unsupported format" in response.json()["detail"]


def test_cors_allows_current_vite_origin(client):
    response = client.options(
        "/api/missions",
        headers={
            "Origin": "http://127.0.0.1:5173",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:5173"


def test_processing_contract_without_model(client, monkeypatch, tmp_path):
    mission = create_mission(client)
    mission_dir = tmp_path / "missions" / mission["id"]
    mission_dir.mkdir()
    (mission_dir / "video.mp4").write_bytes(b"test video placeholder")
    main.MissionData(mission["id"]).update(
        {"video": {"filename": "video.mp4"}, "status": "video_uploaded"}
    )

    monkeypatch.setattr(main, "summarize_uploaded_video", lambda path: {"frames_total": 1})
    monkeypatch.setattr(main, "_basic_process", lambda *args: {
        "video": {},
        "processing": {"status": "COMPLETE", "framesAnalyzed": 1},
        "detections": {"uniqueTracks": 0, "observations": []},
        "tracks": [],
        "frameQuality": {"average": {}, "samples": []},
    })
    monkeypatch.setattr(main, "_load_detection_model", lambda **kwargs: (_ for _ in ()).throw(FileNotFoundError()))
    monkeypatch.setattr(main, "analyze_damage_for_mission", lambda *args, **kwargs: {"available": False, "status": "UNKNOWN", "findings": []})
    monkeypatch.setattr(main, "detect_entry_exit_points", lambda *args, **kwargs: {"available": False, "status": "UNKNOWN", "points": []})
    monkeypatch.setattr(main, "run_reconstruction_for_mission", lambda *args, **kwargs: {
        "success": False,
        "status": "FAILED",
        "point_count": 0,
        "processing_time_s": 0.0,
        "output_path": None,
        "error": "model unavailable",
    })

    response = client.post(f"/api/missions/{mission['id']}/process")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["processing"]["status"] == "PARTIAL"
    assert body["reconstruction"]["point_count"] == 0


def test_reconstruction_contract(client):
    mission = create_mission(client)
    stored = main.MissionData(mission["id"])
    stored.update({"detections": {"uniqueTracks": 2}, "processing": {"framesAnalyzed": 2}, "frameQuality": {"average": {}}})

    before = client.get(f"/api/missions/{mission['id']}/reconstruction")
    response = client.post(f"/api/missions/{mission['id']}/reconstruct")

    assert before.status_code == 200
    assert before.json()["success"] is False
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["reconstruction"]["pointCloud"]["points_count"] == 2000
    assert body["reconstruction"]["estimated"] is True


def test_measurement_contract(client):
    mission = create_mission(client)

    created = client.post(
        f"/api/missions/{mission['id']}/measurements",
        params={"measurement_type": "distance", "value": 12.5, "confidence": 0.8},
    )
    fetched = client.get(f"/api/missions/{mission['id']}/measurements")

    assert created.status_code == 200
    assert created.json()["measurement"] == {"type": "distance", "value": 12.5, "confidence": 0.8}
    assert fetched.status_code == 200
    assert fetched.json()["measurements"]["distance"] == 12.5


def test_report_contract(client):
    mission = create_mission(client)

    response = client.get(f"/api/missions/{mission['id']}/report")

    assert response.status_code == 200
    report = response.json()["report"]
    assert report["missionId"] == mission["id"]
    assert {"summary", "video", "processing", "detections", "reconstruction", "measurements", "findings", "limitations"}.issubset(report["sections"])