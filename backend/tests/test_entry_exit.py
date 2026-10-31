import pytest
from backend.entry_exit import is_near_frame_border, compute_mission_entry_exit

def test_is_near_frame_border():
    # 1000x1000 frame, margin is 120px (12%)
    # Bbox in corner [10, 10, 50, 50] center is (30, 30) -> near border
    assert is_near_frame_border([10, 10, 50, 50], 1000, 1000, border_margin_pct=0.12) is True

    # Bbox in center [450, 450, 550, 550] center is (500, 500) -> not near border
    assert is_near_frame_border([450, 450, 550, 550], 1000, 1000, border_margin_pct=0.12) is False

    # Normalized bbox [0.05, 0.5, 0.1, 0.6] center cx = 0.075 -> near border
    assert is_near_frame_border([0.05, 0.5, 0.1, 0.6], 1, 1, border_margin_pct=0.12) is True

def test_entry_exit_computation_mock_data():
    mock_data = {
        "video": {"duration": 10.0, "fps": 30.0, "width": 1000, "height": 1000},
        "detections": {
            "observations": [
                # Track 1 enters from border at t=1.0s and exits at border at t=8.0s
                {"trackId": "T1", "frame": 30, "timestamp": 1.0, "boundingBox": [10, 10, 30, 30], "class": "car"},
                {"trackId": "T1", "frame": 120, "timestamp": 4.0, "boundingBox": [500, 500, 550, 550], "class": "car"},
                {"trackId": "T1", "frame": 240, "timestamp": 8.0, "boundingBox": [950, 950, 980, 980], "class": "car"},
                # Track 2 starts at t=0.0s (already in scene) -> NOT an entry event!
                {"trackId": "T2", "frame": 0, "timestamp": 0.0, "boundingBox": [10, 10, 30, 30], "class": "van"},
                {"trackId": "T2", "frame": 150, "timestamp": 5.0, "boundingBox": [500, 500, 550, 550], "class": "van"},
            ]
        },
        "objects_3d": [
            {"track_id": "T1", "class": "car", "position_3d": [1.0, 2.0, 3.0]},
            {"track_id": "T2", "class": "van", "position_3d": [4.0, 5.0, 6.0]},
        ]
    }
    res = compute_mission_entry_exit("test_mock", mock_data)
    assert res["entry_count"] == 1
    assert res["entry_events"][0]["track_id"] == "T1"
    assert res["entry_events"][0]["position_3d"] == [1.0, 2.0, 3.0]
    # T1 exits at border before duration - 0.5s (8.0 < 9.5) -> exit event
    # T2 last seen at t=5.0s in center (not border) -> appeared/disappeared (occlusion), NOT an exit!
    assert res["exit_count"] == 1
    assert res["exit_events"][0]["track_id"] == "T1"
