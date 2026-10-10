from sqlalchemy import Index, JSON, Column, MetaData, Table, create_engine, func, insert, select
from sqlalchemy.orm import Session

from backend.database import Base
from backend.models import Video
from backend.repository import MissionRepository


def test_record_video_is_idempotent_when_database_enforces_one_video_per_mission(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'video-retry.sqlite').as_posix()}")
    Base.metadata.create_all(engine)
    # Render's live constraint is not present in older SQLite schemas. Enforce
    # it here to reproduce the duplicate INSERT failure on a retried finalize.
    Index("uq_test_video_mission_id", Video.mission_id, unique=True).create(engine)

    mission_id = "retry_mission"
    mission = {
        "id": mission_id,
        "name": "Retry test",
        "createdAt": "2026-01-01T00:00:00",
        "status": "created",
    }
    first = {"filename": "first.mp4", "storage_key": "missions/retry/first.mp4", "sha256": "a" * 64}
    retry = {"filename": "retry.mp4", "storage_key": "missions/retry/retry.mp4", "sha256": "b" * 64}

    try:
        with Session(engine) as session:
            repository = MissionRepository(session)
            repository.create(mission)
            repository.record_video(mission_id, first)
            repository.record_video(mission_id, retry)
            session.commit()

        with Session(engine) as session:
            assert session.scalar(select(func.count()).select_from(Video).where(Video.mission_id == mission_id)) == 1
            stored = session.scalars(select(Video).where(Video.mission_id == mission_id)).one()
            assert stored.filename == "retry.mp4"
            assert stored.metadata_json == retry
    finally:
        engine.dispose()


def test_sqlite_accepts_nonstandard_nan_json_that_postgresql_rejects(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'nan-json.sqlite').as_posix()}")
    table = Table("json_payload", MetaData(), Column("payload", JSON))
    table.create(engine)
    try:
        with engine.begin() as connection:
            connection.execute(insert(table).values(payload={"fps": float("nan")}))
            stored = connection.execute(select(table.c.payload)).scalar_one()
        assert stored["fps"] != stored["fps"]  # SQLite accepted NaN in JSON text.
    finally:
        engine.dispose()
