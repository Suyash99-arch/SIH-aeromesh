from pathlib import Path

import numpy as np

from backend.depth_anything import DepthAnythingV2Runner, _resize_to_max_long_edge


def test_resize_to_max_long_edge_keeps_ratio():
    image = np.zeros((1000, 1500, 3), dtype=np.uint8)
    resized = _resize_to_max_long_edge(image, 960)
    assert max(resized.shape[:2]) <= 960
    assert resized.shape[0] > 0
    assert resized.shape[1] > 0


def test_depth_runner_normalizes_prediction():
    runner = DepthAnythingV2Runner()
    depth = np.array([[0.0, 2.0], [4.0, 6.0]], dtype=np.float32)
    normalized = runner._normalize_depth(depth)
    assert normalized.min() >= 0.0
    assert normalized.max() <= 1.0 + 1e-6
    assert normalized[0, 0] <= normalized[-1, -1]
