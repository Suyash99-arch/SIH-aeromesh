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