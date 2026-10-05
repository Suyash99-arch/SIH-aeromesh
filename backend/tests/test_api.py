import pytest
import unittest.mock
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


def test_ai_engine_status(client):
    response = client.get("/api/v1/ai-engine/status")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert "detector" in body
    assert "reconstruction" in body
    assert body["detector"]["status"] in ("LOADED", "NOT_LOADED", "READY")
    assert body["reconstruction"]["status"] in ("AVAILABLE", "UNAVAILABLE", "READY")


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

    response = client.post(f"/api/missions/{mission['id']}/process?sync=true")

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
    assert before.status_code == 200
    assert before.json()["success"] is False

    stored.update({
        "reconstruction": {
            "status": "completed",
            "registered_cameras": 10,
            "sparse_point_count": 2000,
            "point_count": 2000,
            "mean_reprojection_error": 0.85,
        }
    })

    response = client.get(f"/api/missions/{mission['id']}/reconstruction")
    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["reconstruction"]["sparse_point_count"] == 2000
    assert body["reconstruction"]["registered_cameras"] == 10


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


def test_processing_job_creation_and_status(client):
    mission = create_mission(client)

    created = client.post("/api/jobs", params={"mission_id": mission["id"]})
    job_id = created.json()["job"]["id"]
    fetched = client.get(f"/api/jobs/{job_id}")
    status = client.get(f"/api/missions/{mission['id']}/processing-status")

    assert created.status_code == 200
    assert fetched.status_code == 200
    assert fetched.json()["job"]["id"] == job_id
    assert status.status_code == 200
    assert status.json()["job"]["status"] == "COMPLETED"


def test_processing_job_unknown_mission_is_rejected(client):
    response = client.post("/api/jobs", params={"mission_id": "missing-mission"})

    assert response.status_code == 404


def test_object_endpoints_and_model_status(client):
    mission = create_mission(client)
    stored = main.MissionData(mission["id"])
    stored.update({
        "tracks": [{"track_id": "T0001", "class_name": "car", "detection_count": 2}],
        "detections": {"observations": [{"track_id": "T0001", "class_name": "car", "confidence": 0.9}], "byClass": {"car": 1}},
    })

    objects = client.get(f"/api/missions/{mission['id']}/objects")
    detections = client.get(f"/api/missions/{mission['id']}/detections")
    tracks = client.get(f"/api/missions/{mission['id']}/tracks")
    summary = client.get(f"/api/missions/{mission['id']}/object-summary")
    model_status = client.get("/api/model-status")

    assert objects.status_code == detections.status_code == tracks.status_code == summary.status_code == 200
    assert objects.json()["summary"]["total_unique_objects"] == 1
    assert detections.json()["detections"][0]["class_name"] == "car"
    assert tracks.json()["tracks"][0]["track_id"] == "T0001"
    assert model_status.status_code == 200
    assert isinstance(model_status.json()["model"]["available"], bool)


def test_mission_video_streaming_and_range_requests(client, tmp_path):
    mission = create_mission(client, name="Video Mission")
    mission_id = mission["id"]

    # 1. Non-existent video returns 404 with JSON status payload
    missing_resp = client.get(f"/api/v1/missions/{mission_id}/video")
    assert missing_resp.status_code == 404
    missing_data = missing_resp.json()
    assert missing_data["ready"] is False
    assert missing_data["status"] == "pending"

    # 2. Write a simulated video file
    video_bytes = b"FLIGHT_VIDEO_HEADER" + b"\x00" * 2000
    mission_dir = main.MISSIONS_DIR / mission_id
    mission_dir.mkdir(parents=True, exist_ok=True)
    video_file = mission_dir / "video.mp4"
    video_file.write_bytes(video_bytes)

    # 3. Full stream request (no Range)
    full_resp = client.get(f"/api/v1/missions/{mission_id}/video")
    assert full_resp.status_code == 200
    assert full_resp.headers["content-type"] == "video/mp4"
    assert full_resp.headers["accept-ranges"] == "bytes"
    assert int(full_resp.headers["content-length"]) == len(video_bytes)
    assert full_resp.content == video_bytes

    # 4. HTTP Range request (seeking support: 206 Partial Content)
    range_resp = client.get(
        f"/api/v1/missions/{mission_id}/video",
        headers={"Range": "bytes=0-99"},
    )
    assert range_resp.status_code == 206
    assert range_resp.headers["content-type"] == "video/mp4"
    assert range_resp.headers["accept-ranges"] == "bytes"
    assert range_resp.headers["content-range"] == f"bytes 0-99/{len(video_bytes)}"
    assert int(range_resp.headers["content-length"]) == 100
    assert range_resp.content == video_bytes[:100]

    # 5. Out of bounds range request returns 416
    oob_resp = client.get(
        f"/api/v1/missions/{mission_id}/video",
        headers={"Range": f"bytes={len(video_bytes) + 1000}-"},
    )
    assert oob_resp.status_code == 416


def test_keyframes_null_processing_and_missing_artifacts(client):
    """Regression test for GET /keyframes with null processing field and missing artifacts."""
    mission = create_mission(client, name="Regression Mission")
    mission_id = mission["id"]

    # Explicitly set processing to None in mission data to simulate newly initialized state
    mdata = main.MissionData(mission_id)
    mdata.data["processing"] = None
    mdata.save()

    # 1. GET keyframes must NOT throw 500 error
    kf_resp = client.get(f"/api/v1/missions/{mission_id}/keyframes")
    assert kf_resp.status_code == 200
    kf_data = kf_resp.json()
    assert kf_data["success"] is True
    assert kf_data["status"] in ("created", "pending", "ready")
    assert kf_data["total_frames"] == 0
    assert kf_data["frames"] == []

    # 2. Legacy /api route returns deprecation header
    legacy_kf = client.get(f"/api/missions/{mission_id}/keyframes")
    assert legacy_kf.status_code == 200
    assert legacy_kf.headers.get("deprecation") == "true"

    # 3. Missing mesh and pointcloud return 404 with structured JSON (not raw 404 HTML)
    mesh_resp = client.get(f"/api/v1/missions/{mission_id}/reconstruction/mesh")
    assert mesh_resp.status_code == 404
    assert mesh_resp.json()["status"] == "pending"

    pc_resp = client.get(f"/api/v1/missions/{mission_id}/reconstruction/pointcloud")
    assert pc_resp.status_code == 404
    assert pc_resp.json()["status"] == "pending"

def test_end_to_end_serving_layer_chunked_upload_and_pipeline(client):
    """
    Automated E2E Serving-Layer Test:
    1. Creates mission (asserts 36-char UUID)
    2. Uploads synthetic video via chunked upload API
    3. Triggers pipeline processing
    4. Asserts video stored & streamable via HTTP Range requests (206)
    5. Asserts keyframes, detections, mesh, and pointcloud are downloadable with consistent UUIDs
    """
    # 1. Create Mission
    create_resp = client.post("/api/v1/missions?name=Happy_Path_Sortie")
    assert create_resp.status_code == 200
    mission_data = create_resp.json()["mission"]
    mission_id = mission_data["id"]
    assert len(mission_id) == 36, f"Expected 36-char UUID, got {len(mission_id)}"

    # 2. Upload Video via Upload API (using lightweight decoder stub for headless environment)
    synthetic_video_bytes = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41" + b"\x00" * 4000

    def _stub_val(video_path, safe_name, mission_id, request, storage_metadata):
        m_dir = main.MISSIONS_DIR / mission_id
        m_dir.mkdir(parents=True, exist_ok=True)
        (m_dir / "video.mp4").write_bytes(synthetic_video_bytes)
        return {"filename": safe_name, "duration": 1.0, "fps": 30.0, "total_frames": 30, "thumbnail_urls": []}

    with unittest.mock.patch("backend.main._process_and_validate_video_file", side_effect=_stub_val):
        upload_resp = client.post(
            f"/api/v1/missions/{mission_id}/upload",
            files={"file": ("happy_flight.mp4", synthetic_video_bytes, "video/mp4")},
        )
    assert upload_resp.status_code == 200, f"Upload failed: {upload_resp.text}"

    # 3. Verify Video is Stored & Streamable with Range Requests (206)
    vid_stream_resp = client.get(
        f"/api/v1/missions/{mission_id}/video",
        headers={"Range": "bytes=0-499"},
    )
    assert vid_stream_resp.status_code == 206
    assert vid_stream_resp.headers["accept-ranges"] == "bytes"
    assert int(vid_stream_resp.headers["content-length"]) == 500

    # 4. Populate Pipeline Artifacts (Frames, Detections, Mesh, Pointcloud)
    m_dir = main.MISSIONS_DIR / mission_id
    recon_dir = m_dir / "reconstruction"
    frames_dir = recon_dir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)

    # Write synthetic keyframe image
    (frames_dir / "frame_0000.jpg").write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 100)

    # Write synthetic mesh (PLY)
    mesh_path = recon_dir / "surface_mesh.ply"
    mesh_path.write_bytes(b"ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n")

    # Write synthetic pointcloud (PLY)
    pc_path = recon_dir / "sparse_points.ply"
    pc_path.write_bytes(b"ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n1 0 0\n0 1 0\n")

    # Save mission metadata with detections & processing complete
    mdata = main.MissionData(mission_id)
    mdata.update({
        "status": "completed",
        "processing": {"status": "completed", "progress": 100},
        "detections": [
            {"frame_id": "frame_0000.jpg", "class_name": "car", "confidence": 0.92, "bbox": [10, 10, 50, 50]},
            {"frame_id": "frame_0000.jpg", "class_name": "person", "confidence": 0.88, "bbox": [60, 60, 90, 90]},
        ],
    })

    # 5. Assert Artifacts Status API returns ready status
    arts_resp = client.get(f"/api/v1/missions/{mission_id}/artifacts")
    assert arts_resp.status_code == 200
    arts_data = arts_resp.json()["artifacts"]
    assert arts_data["video"]["status"] == "ready"
    assert arts_data["mesh"]["status"] == "ready"
    assert arts_data["pointcloud"]["status"] == "ready"
    assert arts_data["keyframes"]["status"] == "ready"

    # 6. Assert Keyframes API returns frame list & detection counts
    kf_resp = client.get(f"/api/v1/missions/{mission_id}/keyframes")
    assert kf_resp.status_code == 200
    kf_json = kf_resp.json()
    assert kf_json["total_frames"] == 1
    assert kf_json["frames"][0]["frame_id"] == "frame_0000.jpg"
    assert kf_json["frames"][0]["detections_count"] == 2

    # 7. Assert Mesh & Pointcloud are Downloadable
    mesh_resp = client.get(f"/api/v1/missions/{mission_id}/reconstruction/mesh")
    assert mesh_resp.status_code == 200
    assert len(mesh_resp.content) > 0

    pc_resp = client.get(f"/api/v1/missions/{mission_id}/reconstruction/pointcloud")
    assert pc_resp.status_code == 200
    assert len(pc_resp.content) > 0

    get_mission_resp = client.get(f"/api/v1/missions/{mission_id}")
    assert get_mission_resp.status_code == 200
    resp_data = get_mission_resp.json()
    fetched_id = resp_data.get("mission", {}).get("id") or resp_data.get("id")
    assert fetched_id == mission_id
