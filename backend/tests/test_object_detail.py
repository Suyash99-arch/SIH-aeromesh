import pytest
from backend.object_detail import get_object_detail, generate_thumbnail

MISSION_ID = "72452997-c43e-40ca-8fa0-bace0476e4ee"


def test_get_object_detail_existing():
    obj = get_object_detail(MISSION_ID, "T0001")
    assert obj is not None
    assert obj["track_id"] == "T0001"
    assert "class" in obj
    assert "motion_state" in obj
    assert "position_3d" in obj
    assert len(obj["observations"]) > 0
    obs0 = obj["observations"][0]
    assert "frame_idx" in obs0
    assert "bbox" in obs0
    assert "thumb_url" in obs0


def test_get_object_detail_unknown_404():
    obj = get_object_detail(MISSION_ID, "NONEXISTENT_TRACK_9999")
    assert obj is None


def test_generate_thumbnail():
    obj = get_object_detail(MISSION_ID, "T0001")
    assert obj is not None
    obs = obj["observations"][0]
    thumb = generate_thumbnail(MISSION_ID, obj["track_id"], obs["frame_idx"], obs["bbox"])
    assert thumb is not None
    assert thumb.exists()
    assert thumb.stat().st_size > 0
