from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)
MISSION_ID = "72452997-c43e-40ca-8fa0-bace0476e4ee"


def test_api_object_detail():
    resp = client.get(f"/api/v1/missions/{MISSION_ID}/objects/T0001")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["track_id"] == "T0001"
    assert "class" in data
    assert "observations" in data
    assert len(data["observations"]) > 0


def test_api_object_detail_404():
    resp = client.get(f"/api/v1/missions/{MISSION_ID}/objects/UNKNOWN_99999")
    assert resp.status_code == 404
    data = resp.json()
    assert "not found" in data["detail"].lower()


def test_api_thumbnail():
    resp = client.get(f"/api/v1/missions/{MISSION_ID}/objects/T0001/thumbnails/thumb_T0001_f0.jpg")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/jpeg"
    assert len(resp.content) > 0


def test_api_entry_exit():
    resp = client.get(f"/api/v1/missions/{MISSION_ID}/entry-exit")
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "data" in data
    assert "entries" in data["data"]
    assert "exits" in data["data"]
