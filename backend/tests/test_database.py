from datetime import datetime
from contextlib import contextmanager
import json

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, insert
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


def test_mission_creation_db_failure_is_sanitized_and_never_falls_back_to_json(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "get_configured_engine", lambda: object())
    monkeypatch.setattr(main, "MISSIONS_DIR", tmp_path)

    @contextmanager
    def failing_session_scope(_engine):
        yield object()

    class FailingMissionRepository:
        def __init__(self, _session):
            pass

        def get(self, _mission_id):
            return None

        def create(self, _data):
            raise ValueError("sensitive SQL and database details")

    monkeypatch.setattr(main, "session_scope", failing_session_scope)
    monkeypatch.setattr(main, "MissionRepository", FailingMissionRepository)
    client = TestClient(main.app, raise_server_exceptions=False)

    response = client.post("/api/v1/missions", params={"name": "DB failure test"})
    body = response.json()

    assert response.status_code == 500
    assert set(body) == {"error", "request_id", "stage", "error_type"}
    assert body["error"] == "INTERNAL_ERROR"
    assert body["request_id"]
    assert body["stage"] == "db_create"
    assert body["error_type"] == "ValueError"
    assert "sensitive" not in response.text
    assert list(tmp_path.glob("*.json")) == []


def test_mission_creation_uses_json_fallback_when_database_is_unconfigured(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "get_configured_engine", lambda: None)
    monkeypatch.setattr(main, "MISSIONS_DIR", tmp_path)
    client = TestClient(main.app)

    response = client.post("/api/v1/missions", params={"name": "Local JSON mission"})

    assert response.status_code == 200
    mission_id = response.json()["mission"]["id"]
    mission_path = tmp_path / f"{mission_id}.json"
    assert mission_path.is_file()
    assert json.loads(mission_path.read_text(encoding="utf-8"))["name"] == "Local JSON mission"


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


def test_postgres_geometry_insert_binds_nullable_wkt_as_geometry():
    statement = insert(Mission).values(
        id="geometry-bind-test",
        name="Geometry bind",
        reference_location=None,
        payload={},
    )
    postgres_sql = str(statement.compile(dialect=postgresql.dialect()))
    sqlite_sql = str(statement.compile(dialect=create_engine("sqlite://").dialect))

    assert "ST_GeomFromText(CAST(" in postgres_sql
    assert ", 4326)" in postgres_sql
    assert "ST_GeomFromText" not in sqlite_sql


def test_database_url_normalization_all_three_schemes():
    from backend.database import normalize_database_url

    # Scheme 1: Render / Heroku legacy postgres://
    render_url = "postgres://aerouser:secretpassword123@dpg-abc123-a.oregon-postgres.render.com:5432/aeromesh_db"
    norm_1 = normalize_database_url(render_url)
    assert norm_1.startswith("postgresql+psycopg://")
    assert "aerouser:secretpassword123@dpg-abc123-a.oregon-postgres.render.com:5432/aeromesh_db" in norm_1

    # Scheme 2: Standard postgresql://
    standard_url = "postgresql://aerouser:secretpassword123@dpg-abc123-a.oregon-postgres.render.com:5432/aeromesh_db"
    norm_2 = normalize_database_url(standard_url)
    assert norm_2.startswith("postgresql+psycopg://")
    assert norm_2 == norm_1

    # Scheme 3: Explicit postgresql+psycopg://
    explicit_url = "postgresql+psycopg://aerouser:secretpassword123@dpg-abc123-a.oregon-postgres.render.com:5432/aeromesh_db"
    norm_3 = normalize_database_url(explicit_url)
    assert norm_3 == explicit_url
    assert norm_3 == norm_1

    # Non-postgres scheme (e.g. SQLite for testing) preserved
    sqlite_url = "sqlite:///local_test.db"
    assert normalize_database_url(sqlite_url) == sqlite_url

    # Empty / None handling
    assert normalize_database_url(None) is None
    assert normalize_database_url("   ") is None


def test_mask_database_url_safeguards_credentials():
    from backend.database import mask_database_url

    secret_url = "postgres://aerouser:UltraSecretPassword99!@db.render.com:5432/aeromesh_prod"
    masked = mask_database_url(secret_url)
    assert "UltraSecretPassword99!" not in masked
    assert "aerouser:***@db.render.com:5432/aeromesh_prod" in masked

    # URL without password
    no_pw_url = "postgresql://db.render.com:5432/aeromesh"
    assert mask_database_url(no_pw_url) == no_pw_url


def test_validate_production_database_url_scenarios():
    from backend.database import validate_production_database_url

    # Case 1: Missing DATABASE_URL
    is_valid, msg = validate_production_database_url("")
    assert is_valid is False
    assert "DATABASE_URL is missing" in msg

    # Case 2: Bad scheme (sqlite, mysql, redis)
    bad_url = "mysql://admin:TopSecretPassword@localhost:3306/aeromesh"
    is_valid, msg = validate_production_database_url(bad_url)
    assert is_valid is False
    assert "scheme 'mysql' is invalid" in msg
    assert "TopSecretPassword" not in msg
    assert "admin:***@localhost:3306" in msg

    # Case 3: Valid schemes (all normalize to postgresql+psycopg)
    for scheme_url in [
        "postgres://user:pass@host:5432/db",
        "postgresql://user:pass@host:5432/db",
        "postgresql+psycopg://user:pass@host:5432/db",
    ]:
        is_valid, msg = validate_production_database_url(scheme_url)
        assert is_valid is True
        assert msg == ""
