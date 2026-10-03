from io import BytesIO

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend import main
from backend.database import init_database
from backend.jobs import create_job, get_job, update_job
from backend.models import Mission, ProcessingJob, Video
from backend.storage import LocalObjectStorage, mission_object_key
from backend.tasks import celery_app, run_processing_pipeline
from backend.tasks import detect_objects, track_objects


def test_local_storage_upload_download_exists_and_delete(tmp_path):
    storage = LocalObjectStorage(tmp_path)
    key = mission_object_key("mission-1", "video.mp4")

    metadata = storage.upload(key, BytesIO(b"video bytes"), "video.mp4", "video/mp4")

    assert metadata.key == "missions/mission-1/original/video.mp4"
    assert metadata.size == 11
    assert storage.exists(key)
    assert storage.download(key) == b"video bytes"
    assert storage.signed_url(key).endswith(key)
    storage.delete(key)
    assert not storage.exists(key)


def test_job_creation_status_and_failure_state(monkeypatch):
    monkeypatch.setattr(main, "get_configured_engine", lambda: None)
    job = create_job("mission-1")
    assert job["status"] == "QUEUED"
    assert get_job(job["id"])["progress_percent"] == 0

    failed = update_job(job["id"], status="FAILED", stage="FAILED", error_message="test failure")
    assert failed["status"] == "FAILED"
    assert failed["error_message"] == "test failure"
    assert failed["completed_at"] is not None


def test_celery_task_is_registered_or_fallback_exists():
    assert run_processing_pipeline is not None
    if celery_app is not None:
        assert "aeromesh.run_processing_pipeline" in celery_app.tasks
        assert "aeromesh.detect_objects" in celery_app.tasks
        assert "aeromesh.track_objects" in celery_app.tasks


def test_detection_task_records_missing_model_failure(monkeypatch):
    monkeypatch.setattr(main, "get_configured_engine", lambda: None)
    monkeypatch.setenv("YOLO_MODEL_PATH", "missing_model.pt")
    job = create_job("mission-3")

    detect_objects(job["id"])

    result = get_job(job["id"])
    assert result["status"] == "FAILED"
    assert result["stage"] == "FAILED"
    assert result["error_message"].startswith("MODEL_NOT_FOUND:")


def test_tracking_task_updates_progress(monkeypatch):
    monkeypatch.setattr(main, "get_configured_engine", lambda: None)
    job = create_job("mission-4")

    track_objects(job["id"])

    result = get_job(job["id"])
    assert result["stage"] == "TRACKING"
    assert result["progress_percent"] == 85


def test_database_stores_object_metadata_without_bytes(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'objects.db'}")
    init_database(engine)
    with Session(engine) as session:
        mission = Mission(id="mission-2", name="Storage", payload={})
        session.add(mission)
        session.add(Video(mission=mission, filename="video.mp4", storage_path="missions/mission-2/original/video.mp4", sha256="abc", metadata_json={"size_bytes": 11}))
        session.commit()
        video = session.query(Video).one()
        assert video.storage_path.endswith("video.mp4")
        assert video.sha256 == "abc"
        assert video.metadata_json["size_bytes"] == 11
        assert not hasattr(video, "content")


def test_worker_shared_state_startup_checks(monkeypatch):
    """
    Startup check on worker node must fail clearly if not using shared Postgres and S3 storage.
    """
    from backend.env_check import check_worker_shared_state
    import pytest

    monkeypatch.setenv("PROFILE", "worker")

    # Case 1: Missing DATABASE_URL
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="DATABASE_URL environment variable is missing"):
        check_worker_shared_state(strict=True)

    # Case 2: Non-postgres DATABASE_URL (e.g. SQLite)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///worker.db")
    with pytest.raises(RuntimeError, match="Worker DATABASE_URL scheme is invalid"):
        check_worker_shared_state(strict=True)

    # Case 3: Valid postgres DATABASE_URL but local storage
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@db:5432/aeromesh")
    monkeypatch.delenv("STORAGE_BACKEND", raising=False)
    monkeypatch.delenv("S3_BUCKET", raising=False)
    with pytest.raises(RuntimeError, match="Shared S3/R2 object storage"):
        check_worker_shared_state(strict=True)

    # Case 4: Valid postgres DATABASE_URL AND shared S3 storage
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("S3_BUCKET", "aeromesh-artifacts")
    res = check_worker_shared_state(strict=True)
    assert res["status"] == "ready"
    assert res["database"] == "postgres"
    assert res["storage"] == "s3"
    assert res["shared_state"] is True


def test_worker_forwarding_path_with_fake_worker(monkeypatch):
    """
    When PIPELINE_ENABLED=false and WORKER_URL is set, the API forwards processing requests
    to the worker via httpx.
    """
    from unittest.mock import AsyncMock, patch
    from fastapi.testclient import TestClient
    import httpx

    monkeypatch.setenv("PIPELINE_ENABLED", "false")
    monkeypatch.setenv("WORKER_URL", "https://remote-worker.example.com")

    client = TestClient(main.app)

    # Create dummy mission
    created = client.post("/api/v1/missions", params={"name": "Worker Forwarding Test"})
    assert created.status_code == 200
    mission_id = created.json()["mission"]["id"]

    mock_response = httpx.Response(
        status_code=200,
        json={"success": True, "job_id": "job-remote-999", "status": "QUEUED", "node": "worker-gpu-1"},
        request=httpx.Request("POST", f"https://remote-worker.example.com/api/v1/missions/{mission_id}/process"),
    )

    with patch.object(httpx.AsyncClient, "post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = mock_response

        resp = client.post(f"/api/v1/missions/{mission_id}/process?frame_sampling=2.0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["job_id"] == "job-remote-999"
        assert data["status"] == "QUEUED"

        # Verify correct URL and parameters forwarded
        mock_post.assert_called_once()
        args, kwargs = mock_post.call_args
        assert args[0] == f"https://remote-worker.example.com/api/v1/missions/{mission_id}/process"
        assert kwargs["params"]["frame_sampling"] == 2.0


def test_worker_artifacts_visible_through_api(tmp_path, monkeypatch):
    """
    Artifacts written by the worker to shared object storage (video, keyframes, mesh, pointcloud)
    are immediately visible and downloadable through the API's artifacts and storage endpoints.
    """
    from fastapi.testclient import TestClient
    from backend.storage import LocalObjectStorage
    from io import BytesIO

    # Simulate shared object storage between worker and API
    shared_storage = LocalObjectStorage(tmp_path / "shared_objects")
    monkeypatch.setattr(main, "get_storage", lambda *args, **kwargs: shared_storage)
    monkeypatch.setattr("backend.storage.get_storage", lambda *args, **kwargs: shared_storage)

    client = TestClient(main.app)

    # Create mission
    created = client.post("/api/v1/missions", params={"name": "Shared Artifacts Test"})
    assert created.status_code == 200
    mission_id = created.json()["mission"]["id"]

    # 1. Worker writes artifacts to shared storage
    shared_storage.upload(f"missions/{mission_id}/original/video.mp4", BytesIO(b"fake-drone-video-bytes"), "video.mp4", "video/mp4")
    shared_storage.upload(f"missions/{mission_id}/reconstruction/mesh.ply", BytesIO(b"ply\nformat ascii 1.0\nelement vertex 3\nend_header\n0 0 0\n"), "mesh.ply", "application/octet-stream")
    shared_storage.upload(f"missions/{mission_id}/reconstruction/point_cloud.ply", BytesIO(b"ply\npointcloud_bytes"), "point_cloud.ply", "application/octet-stream")
    shared_storage.upload(f"missions/{mission_id}/reconstruction/frames/frame_0000.jpg", BytesIO(b"jpeg-bytes"), "frame_0000.jpg", "image/jpeg")

    # 2. Query API /artifacts readiness endpoint
    resp = client.get(f"/api/v1/missions/{mission_id}/artifacts")
    assert resp.status_code == 200
    artifacts_data = resp.json()["artifacts"]
    assert artifacts_data["video"]["ready"] is True
    assert artifacts_data["mesh"]["ready"] is True
    assert artifacts_data["pointcloud"]["ready"] is True
    assert artifacts_data["keyframes"]["ready"] is True

    # 3. Query API direct artifact download endpoints
    mesh_resp = client.get(f"/api/v1/artifacts/missions/{mission_id}/reconstruction/mesh.ply")
    assert mesh_resp.status_code == 200
    assert mesh_resp.content.startswith(b"ply\nformat ascii 1.0")

    video_resp = client.get(f"/api/v1/storage/missions/{mission_id}/original/video.mp4")
    assert video_resp.status_code == 200
    assert video_resp.content == b"fake-drone-video-bytes"