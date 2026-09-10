from pathlib import Path

import cv2
import numpy as np

from backend.depth_anything import DepthAnythingV2Runner
from backend.reconstruction import build_pose_priors_for_frames, reconstruct_mesh_from_point_cloud


sys_path = Path(__file__).resolve().parents[1] / "SinglePass3D" / "backend"
import sys

sys.path.insert(0, str(sys_path))
from inference import select_keyframes


def _write_test_video(path: Path, total_frames: int = 90, width: int = 320, height: int = 240):
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        12.0,
        (width, height),
    )
    if not writer.isOpened():
        raise RuntimeError("Could not create synthetic validation video")

    for frame_index in range(total_frames):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        x = int((frame_index / max(total_frames - 1, 1)) * (width - 60))
        cv2.rectangle(frame, (x, 40), (x + 40, 140), (255, 255, 255), -1)
        writer.write(frame)
    writer.release()


def test_hybrid_pipeline_sections_validate(tmp_path):
    video_path = tmp_path / "hybrid_validation.mp4"
    _write_test_video(video_path)

    selected = select_keyframes(video_path, target_count=12, min_dist=4)
    assert len(selected) >= 8
    assert selected == sorted(selected)

    telemetry = {
        "samples": [
            {"frame": 0, "latitude": 12.0, "longitude": 13.0, "altitude": 90.0, "heading": 0.0},
            {"frame": 10, "latitude": 12.001, "longitude": 13.002, "altitude": 91.0, "heading": 15.0},
            {"frame": 20, "latitude": 12.003, "longitude": 13.005, "altitude": 92.0, "heading": 30.0},
            {"frame": 30, "latitude": 12.005, "longitude": 13.008, "altitude": 93.0, "heading": 45.0},
        ]
    }
    frame_paths = [tmp_path / f"frame_{i:05d}.jpg" for i in range(5)]
    for frame in frame_paths:
        frame.write_bytes(b"stub")

    bundle = build_pose_priors_for_frames(frame_paths, telemetry=telemetry, image_size=(1280, 720))
    assert len(bundle["poses"]) == len(frame_paths)
    assert len(bundle["poses"][0]["position"]) == 3
    assert bundle["poses"][-1]["position"][2] >= bundle["poses"][0]["position"][2]

    runner = object.__new__(DepthAnythingV2Runner)
    depth = np.array([[0.0, 2.0], [4.0, 6.0]], dtype=np.float32)
    normalized = runner._normalize_depth(depth)
    assert normalized.min() >= 0.0
    assert normalized.max() <= 1.0 + 1e-6

    points = np.array([
        [0.0, 0.0, 0.0],
        [0.5, 0.0, 0.0],
        [0.0, 0.5, 0.0],
        [0.0, 0.0, 0.5],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)
    mesh = reconstruct_mesh_from_point_cloud(points, octree_depth=6)
    assert mesh is None or len(mesh.vertices) > 0
