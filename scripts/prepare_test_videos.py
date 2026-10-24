#!/usr/bin/env python3
"""
Prepares the 5 required test videos from tests/test.mp4 using ffmpeg:
(a) video_a_landscape_60s.mp4: ~60s landscape drone video
(b) video_b_shaky_lowtexture.mp4: ~10s low-texture / blurry shaky clip
(c) video_c_portrait_phone.mp4: portrait aspect ratio (720x1280)
(d) video_d_long_2min.mp4: >2 minute video (~130s)
(e) video_e_no_objects.mp4: video with few or no detectable objects (uniform grass/sky texture)
"""
import subprocess
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_VIDEO = ROOT / "tests" / "test.mp4"
OUT_DIR = ROOT / "scratch" / "test_videos"
OUT_DIR.mkdir(parents=True, exist_ok=True)

ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"

def run_cmd(cmd):
    print("Running:", " ".join(cmd))
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print("Error:", res.stderr[-500:])
        raise RuntimeError(f"FFmpeg failed: {res.stderr[-200:]}")

def make_videos():
    assert SRC_VIDEO.exists(), f"Source {SRC_VIDEO} does not exist"

    # (a) Landscape drone video ~60s
    vid_a = OUT_DIR / "video_a_landscape_60s.mp4"
    if not vid_a.exists():
        run_cmd([
            ffmpeg_bin, "-y", "-i", str(SRC_VIDEO),
            "-t", "60",
            "-vf", "scale=1280:720",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "copy",
            str(vid_a)
        ])

    # (b) Short shaky/low-texture clip (~8s)
    vid_b = OUT_DIR / "video_b_shaky_lowtexture.mp4"
    if not vid_b.exists() or vid_b.stat().st_size == 0:
        run_cmd([
            ffmpeg_bin, "-y", "-i", str(SRC_VIDEO),
            "-t", "8",
            "-vf", "scale=640:360,boxblur=5:2,scale=1280:720",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-an",
            str(vid_b)
        ])

    # (c) Portrait phone video (720x1280, 9:16, 15s)
    vid_c = OUT_DIR / "video_c_portrait_phone.mp4"
    if not vid_c.exists() or vid_c.stat().st_size == 0:
        run_cmd([
            ffmpeg_bin, "-y", "-i", str(SRC_VIDEO),
            "-t", "15",
            "-vf", "crop=ih*9/16:ih:0:0,scale=720:1280",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-an",
            str(vid_c)
        ])

    # (d) >2 minute video (~125s)
    vid_d = OUT_DIR / "video_d_long_2min.mp4"
    if not vid_d.exists() or vid_d.stat().st_size == 0:
        run_cmd([
            ffmpeg_bin, "-y", "-stream_loop", "3", "-i", str(SRC_VIDEO),
            "-t", "125",
            "-vf", "scale=960:540",
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "26", "-an",
            str(vid_d)
        ])

    # (e) Video with few or no detectable objects (clean sky/plain ground)
    vid_e = OUT_DIR / "video_e_no_objects.mp4"
    if not vid_e.exists() or vid_e.stat().st_size == 0:
        run_cmd([
            ffmpeg_bin, "-y", "-f", "lavfi",
            "-i", "color=c=0x1e3a5f:s=1280x720:d=10,noise=alls=10:allf=t+u",
            "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
            str(vid_e)
        ])

    print("All 5 test videos prepared successfully in", OUT_DIR)

if __name__ == "__main__":
    make_videos()
