import os
import shutil
import subprocess
import pytest
from pathlib import Path
import cv2

from backend.video_ingest import (
    create_browser_proxy,
    probe_video,
    check_cv2_decodable,
    should_transcode,
    transcode_to_normalized_h264,
    get_ffmpeg_bin
)

@pytest.fixture(scope="module")
def sample_videos(tmp_path_factory):
    tmp_dir = tmp_path_factory.mktemp("video_samples")
    ffmpeg = get_ffmpeg_bin()
    
    files = {
        "h264": tmp_dir / "sample_h264.mp4",
        "hevc": tmp_dir / "sample_hevc.mp4",
        "rotated": tmp_dir / "sample_rotated.mp4",
        "mov": tmp_dir / "sample.mov",
        "avi": tmp_dir / "sample.avi",
        "vfr": tmp_dir / "sample_vfr.mp4",
        "corrupt": tmp_dir / "corrupt.mp4"
    }
    
    # 1. Standard H.264
    subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(files["h264"])], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 2. H.265 / HEVC
    subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30", "-c:v", "libx265", "-pix_fmt", "yuv420p", str(files["hevc"])], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 3. Rotated video (metadata display_rotation=90)
    subprocess.run([ffmpeg, "-y", "-display_rotation:v", "90", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(files["rotated"])], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 4. MOV container
    subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30", "-c:v", "mpeg4", str(files["mov"])], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 5. AVI container
    subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30", "-c:v", "mpeg4", str(files["avi"])], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 6. VFR
    subprocess.run([ffmpeg, "-y", "-f", "lavfi", "-i", "testsrc=duration=1:size=320x240:rate=30", "-vf", "mpdecimate", "-fps_mode", "vfr", "-c:v", "libx264", str(files["vfr"])], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    # 7. Corrupt file
    files["corrupt"].write_bytes(b"NOT_A_VIDEO_HEADER_RANDOM_CORRUPT_BYTES_12345")
    
    return files

def test_h264_decoding_and_probing(sample_videos):
    probe = probe_video(sample_videos["h264"])
    assert not probe["is_corrupt"]
    cv2_ok, err = check_cv2_decodable(sample_videos["h264"])
    assert cv2_ok

def test_hevc_decoding_and_transcoding(sample_videos):
    probe = probe_video(sample_videos["hevc"])
    assert not probe["is_corrupt"]
    assert probe["is_hevc"]
    cv2_ok, _ = check_cv2_decodable(sample_videos["hevc"])
    transcode_needed, reason = should_transcode(probe, cv2_ok)
    assert transcode_needed
    assert "HEVC" in reason or "H.265" in reason
    
    norm_path = sample_videos["hevc"].parent / "norm_hevc.mp4"
    transcode_to_normalized_h264(sample_videos["hevc"], norm_path)
    assert norm_path.exists()
    
    norm_cv2_ok, _ = check_cv2_decodable(norm_path)
    assert norm_cv2_ok

def test_rotated_video_ingest(sample_videos):
    probe = probe_video(sample_videos["rotated"])
    assert not probe["is_corrupt"]
    assert probe["rotation"] == 90
    cv2_ok, _ = check_cv2_decodable(sample_videos["rotated"])
    transcode_needed, reason = should_transcode(probe, cv2_ok)
    assert transcode_needed
    assert "Rotation" in reason

def test_mov_avi_decoding(sample_videos):
    for fmt in ["mov", "avi"]:
        probe = probe_video(sample_videos[fmt])
        assert not probe["is_corrupt"]
        cv2_ok, _ = check_cv2_decodable(sample_videos[fmt])
        assert cv2_ok

def test_vfr_video_ingest(sample_videos):
    probe = probe_video(sample_videos["vfr"])
    assert not probe["is_corrupt"]

def test_genuinely_corrupt_rejection(sample_videos):
    probe = probe_video(sample_videos["corrupt"])
    cv2_ok, _ = check_cv2_decodable(sample_videos["corrupt"])
    assert probe["is_corrupt"] or not cv2_ok


def test_browser_proxy_uses_even_yuv420p_dimensions(tmp_path):
    ffmpeg = get_ffmpeg_bin()
    source = tmp_path / "odd_scaled_height.mp4"
    proxy = tmp_path / "proxy.mp4"
    subprocess.run(
        [
            ffmpeg, "-y", "-f", "lavfi", "-i",
            "testsrc=duration=1:size=1920x1012:rate=10",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    create_browser_proxy(source, proxy, max_width=1280)
    probe = probe_video(proxy)

    assert not probe["is_corrupt"]
    assert probe["codec"] == "h264"
    assert probe["width"] % 2 == 0
    assert probe["height"] % 2 == 0
    assert probe["width"] <= 1280
    assert probe["height"] <= 1280
    ffprobe = shutil.which("ffprobe") or str(Path(get_ffmpeg_bin()).with_name("ffprobe.exe"))
    stream = subprocess.run(
        [ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt", "-of", "default=nw=1:nk=1", str(proxy)],
        check=True,
        capture_output=True,
        text=True,
    )
    assert stream.stdout.strip() == "yuv420p"
