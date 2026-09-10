from pathlib import Path

import cv2
import numpy as np

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'SinglePass3D' / 'backend'))

from inference import select_keyframes


def _write_test_video(path: Path, total_frames: int = 120, width: int = 320, height: int = 240):
    writer = cv2.VideoWriter(
        str(path),
        cv2.VideoWriter_fourcc(*"mp4v"),
        12.0,
        (width, height),
    )
    if not writer.isOpened():
        raise RuntimeError("Could not create test video writer")

    for frame_index in range(total_frames):
        frame = np.zeros((height, width, 3), dtype=np.uint8)
        x = int((frame_index / total_frames) * (width - 60))
        cv2.rectangle(frame, (x, 40), (x + 40, 140), (255, 255, 255), -1)
        if frame_index % 8 == 0:
            cv2.circle(frame, (width // 2, height // 2), 12, (0, 255, 0), -1)
        writer.write(frame)
    writer.release()


def test_select_keyframes_returns_evenly_spaced_candidates(tmp_path):
    video_path = tmp_path / "synthetic_motion.mp4"
    _write_test_video(video_path)

    selected = select_keyframes(video_path, target_count=16, min_dist=4)

    assert len(selected) >= 8
    assert len(selected) <= 25
    assert selected[0] < selected[-1]
    assert selected == sorted(selected)
    assert abs(selected[0] - 0) <= 6
    assert abs(selected[-1] - 119) <= 8
