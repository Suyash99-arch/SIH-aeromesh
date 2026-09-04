from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable
from sqlalchemy.orm import Session

from backend.models import (
    AuditEvent,
    Detection,
    Frame,
    FrameQuality,
    Finding,
    Measurement,
    Mission,
    ProcessingJob,
    ReconstructionAsset,
    Report,
    Track,
    Video,
)
from backend.repository import MissionRepository
from backend.database import Base, check_database, init_database
from backend import main


def test_database_initialization_and_health():
    engine = create_engine("sqlite:///:memory:")

    init_database(engine)

    assert check_database(engine) is True
    assert "missions" in Base.metadata.tables
    assert "audit_events" in Base.metadata.tables


def test_mission_creation_retrieval_and_listing():
    engine = create_engine("sqlite:///:memory:")
    init_database(engine)
    mission_data = {
        "id": "db-test-1",
        "name": "Database mission",
        "type": "single-pass",
        "location": "Test location",
        "operator": "Test operator",
        "createdAt": datetime.utcnow().isoformat(),
        "status": "created",
        "findings": [],
    }

    with Session(engine) as session:
        repository = MissionRepository(session)
        repository.create(mission_data)
        session.commit()
        assert repository.get("db-test-1")["name"] == "Database mission"
        assert repository.list()[0]["id"] == "db-test-1"


def test_mission_api_uses_database_when_configured(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'aeromesh.db'}")
    init_database(engine)
    monkeypatch.setattr(main, "get_configured_engine", lambda: engine)
    client = TestClient(main.app)

    created = client.post("/api/missions", params={"name": "API database mission"})
    mission_id = created.json()["mission"]["id"]

    retrieved = client.get(f"/api/missions/{mission_id}")
    listed = client.get("/api/missions")

    assert created.status_code == 200
    assert retrieved.json()["mission"]["name"] == "API database mission"
    assert any(item["id"] == mission_id for item in listed.json()["missions"])


def test_required_relationships_are_persisted():
    engine = create_engine("sqlite:///:memory:")
    init_database(engine)

    with Session(engine) as session:
        mission = Mission(id="db-rel-1", name="Relationships", payload={})
        video = Video(mission=mission, filename="flight.mp4")
        job = ProcessingJob(mission=mission, status="created")
        frame = Frame(mission=mission, video_id=None, frame_number=1, camera_position="POINT(1 2)")
        frame.quality = FrameQuality(sharpness=80.0, accepted=True)
        track = Track(mission=mission, external_id="T0001", trajectory="LINESTRING(1 2,3 4)")
        detection = Detection(mission=mission, track_id=None, class_name="car", object_position="POINT(1 2)")
        asset = ReconstructionAsset(mission=mission, asset_type="point_cloud", footprint="POLYGON((0 0,1 0,1 1,0 0))")
        measurement = Measurement(mission=mission, measurement_type="distance", value=12.5, geometry="LINESTRING(0 0,1 1)")
        report = Report(mission=mission, format="json", payload={})
        finding = Finding(mission=mission, category="damage", payload={})
        audit = AuditEvent(mission=mission, action="mission.created", payload={})
        session.add_all([video, job, frame, track, detection, asset, measurement, report, finding, audit])
        session.commit()

        stored = session.get(Mission, "db-rel-1")
        assert len(stored.videos) == 1
        assert len(stored.processing_jobs) == 1
        assert stored.frames[0].quality.sharpness == 80.0
        assert stored.tracks[0].trajectory == "LINESTRING(1 2,3 4)"
        assert stored.detections[0].object_position == "POINT(1 2)"
        assert stored.reconstruction_assets[0].footprint.startswith("POLYGON")
        assert stored.measurements[0].geometry.startswith("LINESTRING")
        assert len(stored.reports) == 1
        assert len(stored.findings) == 1
        assert len(stored.audit_events) == 1


def test_geometry_columns_are_postgis_compatible():
    sql = str(CreateTable(Mission.__table__).compile(dialect=postgresql.dialect()))

    assert "geometry(POINT,4326)" in sql
    assert "reference_location" in sql
