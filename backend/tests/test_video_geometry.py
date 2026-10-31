import pytest
from backend.video_geometry import compute_rendered_video_rect, map_bbox_to_rendered_rect


def test_compute_rendered_video_rect_contain_pillarbox():
    # Video is 16:9 (1920x1080), container is 21:9 (2560x1080) -> pillarbox (left/right black bars)
    rect = compute_rendered_video_rect(1920, 1080, 2560, 1080, "contain")
    assert pytest.approx(rect["height"], rel=1e-3) == 1080.0
    assert pytest.approx(rect["width"], rel=1e-3) == 1920.0
    assert pytest.approx(rect["left"], rel=1e-3) == (2560 - 1920) / 2.0  # 320.0
    assert rect["top"] == 0.0


def test_compute_rendered_video_rect_contain_letterbox():
    # Video is 16:9 (1920x1080), container is 4:3 (1440x1080) -> letterbox (top/bottom black bars)
    rect = compute_rendered_video_rect(1920, 1080, 1440, 1080, "contain")
    assert pytest.approx(rect["width"], rel=1e-3) == 1440.0
    assert pytest.approx(rect["height"], rel=1e-3) == 810.0
    assert rect["left"] == 0.0
    assert pytest.approx(rect["top"], rel=1e-3) == (1080 - 810) / 2.0  # 135.0


def test_map_bbox_pixel_coordinates():
    # 1920x1080 video inside 960x540 element (exact scale 0.5)
    rect = compute_rendered_video_rect(1920, 1080, 960, 540, "contain")
    bbox = [100.0, 200.0, 300.0, 400.0]
    mapped = map_bbox_to_rendered_rect(bbox, rect)

    assert mapped is not None
    assert pytest.approx(mapped["x"], rel=1e-3) == 50.0
    assert pytest.approx(mapped["y"], rel=1e-3) == 100.0
    assert pytest.approx(mapped["w"], rel=1e-3) == 100.0
    assert pytest.approx(mapped["h"], rel=1e-3) == 100.0


def test_map_bbox_normalized_coordinates():
    rect = compute_rendered_video_rect(1920, 1080, 1920, 1080, "contain")
    bbox = [0.1, 0.2, 0.3, 0.4]
    mapped = map_bbox_to_rendered_rect(bbox, rect)

    assert mapped is not None
    assert pytest.approx(mapped["x"], rel=1e-3) == 192.0
    assert pytest.approx(mapped["y"], rel=1e-3) == 216.0
    assert pytest.approx(mapped["w"], rel=1e-3) == 384.0
    assert pytest.approx(mapped["h"], rel=1e-3) == 216.0
