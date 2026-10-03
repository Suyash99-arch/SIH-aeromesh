import json
import os
import tempfile
from pathlib import Path
import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.main import app

@pytest.fixture(scope="session")
def synthetic_video_path(tmp_path_factory):
    """Generate a tiny valid synthetic MP4 video with OpenCV for tests."""
    tmp_dir = tmp_path_factory.mktemp("video_fixture")
    video_file = tmp_dir / "synthetic_flight.mp4"
    
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(str(video_file), fourcc, 10.0, (320, 240))
    for i in range(15):
        frame = np.zeros((240, 320, 3), dtype=np.uint8)
        # Draw moving rectangle to simulate scene motion
        cv2.rectangle(frame, (20 + i * 5, 40 + i * 2), (80 + i * 5, 100 + i * 2), (0, 255, 0), -1)
        out.write(frame)
    out.release()
    return video_file

@pytest.fixture(scope="session", autouse=True)
def init_test_db():
    from backend.database import get_configured_engine, init_database
    engine = get_configured_engine()
    if engine is not None:
        init_database(engine)

@pytest.fixture(autouse=True)
def isolate_test_missions(tmp_path, monkeypatch):
    """Ensure all tests use an isolated temporary missions directory, leaving data/missions untouched."""
    test_data_dir = tmp_path / "data"
    test_data_dir.mkdir(parents=True, exist_ok=True)
    test_missions_dir = tmp_path / "isolated_missions"
    test_missions_dir.mkdir(parents=True, exist_ok=True)
    
    monkeypatch.setenv("OBJECT_STORAGE_ROOT", str(test_data_dir / "objects"))
    
    import backend.main as b_main
    monkeypatch.setattr(b_main, "DATA_DIR", test_data_dir)
    monkeypatch.setattr(b_main, "MISSIONS_DIR", test_missions_dir)
    
    for mod_name in ["reconstruction", "reporting", "scenes", "seeds", "summary_builder", "tasks", "eta_engine", "exporters_3d", "storage", "fuse_mission_3d", "spatial_fusion"]:
        try:
            mod = __import__(f"backend.{mod_name}", fromlist=["MISSIONS_DIR", "DATA_DIR"])
            if hasattr(mod, "MISSIONS_DIR"):
                monkeypatch.setattr(mod, "MISSIONS_DIR", test_missions_dir)
            if hasattr(mod, "DATA_DIR"):
                monkeypatch.setattr(mod, "DATA_DIR", test_data_dir)
        except Exception:
            pass

    for test_mod_name in ["test_phase2_workflow", "test_part1_integrity"]:
        try:
            mod = __import__(f"backend.tests.{test_mod_name}", fromlist=["MISSIONS_DIR", "DATA_DIR"])
            if hasattr(mod, "MISSIONS_DIR"):
                monkeypatch.setattr(mod, "MISSIONS_DIR", test_missions_dir)
            if hasattr(mod, "DATA_DIR"):
                monkeypatch.setattr(mod, "DATA_DIR", test_data_dir)
        except Exception:
            pass


@pytest.fixture
def mock_mission_data(tmp_path, monkeypatch):
    """Fixture producing a clean, self-contained mission fixture in an isolated directory."""
    from backend.database import get_configured_engine, session_scope
    from backend.repository import MissionRepository
    import backend.main as b_main
    
    MISSIONS_DIR = b_main.MISSIONS_DIR
    m_id = "test_fixture_mission_01"
    m_dir = MISSIONS_DIR / m_id
    m_dir.mkdir(parents=True, exist_ok=True)
    
    data = {
        "id": m_id,
        "name": "Test Synthetic Mission",
        "type": "infrastructure",
        "location": "Test Location",
        "operator": "Test Operator",
        "status": "complete",
        "created_by": "test_user@aeromesh.internal",
        "video": {
            "filename": "synthetic_flight.mp4",
            "resolution": {"width": 1920, "height": 1080},
            "fps": 30.0,
            "total_frames": 100,
            "duration_seconds": 3.33,
        },
        "detections": {
            "total_detections": 10,
            "detections_by_class": {"vehicle": 8, "person": 2},
            "confidence_stats": {"min": 0.5, "max": 0.9, "mean": 0.75},
        },
        "tracking": {
            "unique_tracks": 4,
            "tracks_by_class": {"vehicle": 3, "person": 1},
        },
        "reconstruction": {
            "status": "COMPLETE",
            "registered_cameras": 5,
            "total_images": 5,
            "sparse_point_count": 500,
            "mean_reprojection_error": 0.45,
            "mesh": {"status": "AVAILABLE", "vertex_count": 1000, "face_count": 2000},
        },
        "objects_3d": [
            {
                "object_id": "OBJ_01",
                "track_id": "TRK_01",
                "class": "vehicle",
                "status": "VALID",
                "reprojection_error_px": 0.8,
            }
        ]
    }
    
    json_path = MISSIONS_DIR / f"{m_id}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        
    engine = get_configured_engine()
    if engine is not None:
        with session_scope(engine) as session:
            repo = MissionRepository(session)
            if repo.get(m_id) is None:
                repo.create(data)
            else:
                repo.update(m_id, data)
        
    yield data
    
    # Cleanup fixture files and db record
    try:
        if json_path.exists():
            json_path.unlink()
        if m_dir.exists():
            import shutil
            shutil.rmtree(m_dir, ignore_errors=True)
        if engine is not None:
            with session_scope(engine) as session:
                repo = MissionRepository(session)
                repo.delete(m_id)
    except Exception:
        pass

@pytest.fixture
def client():
    return TestClient(app)

