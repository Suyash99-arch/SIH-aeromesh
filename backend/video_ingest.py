import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple
import cv2

logger = logging.getLogger(__name__)

def get_ffmpeg_bin() -> str:
    bin_path = shutil.which("ffmpeg")
    if not bin_path:
        # Fallback check standard winget path if environment variable PATH hasn't refreshed
        winget_path = Path(os.environ.get("LOCALAPPDATA", "")) / r"Microsoft\WinGet\Packages"
        if winget_path.exists():
            matches = list(winget_path.glob("**/ffmpeg.exe"))
            if matches:
                return str(matches[0])
    return bin_path or "ffmpeg"

def get_ffprobe_bin() -> str:
    bin_path = shutil.which("ffprobe")
    if not bin_path:
        winget_path = Path(os.environ.get("LOCALAPPDATA", "")) / r"Microsoft\WinGet\Packages"
        if winget_path.exists():
            matches = list(winget_path.glob("**/ffprobe.exe"))
            if matches:
                return str(matches[0])
    return bin_path or "ffprobe"

def probe_video(video_path: Path) -> Dict[str, Any]:
    ffprobe_bin = get_ffprobe_bin()
    cmd = [
        ffprobe_bin,
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        str(video_path)
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        probe_data = json.loads(res.stdout)
    except Exception as e:
        return {
            "is_corrupt": True,
            "corrupt_reason": f"ffprobe failed to parse video container: {str(e)}",
            "codec": "unknown",
            "is_hevc": False,
            "is_vfr": False,
            "rotation": 0,
            "width": 0,
            "height": 0,
            "fps": 0.0,
            "duration": 0.0
        }

    streams = probe_data.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    if not video_stream:
        return {
            "is_corrupt": True,
            "corrupt_reason": "No video stream found in media file.",
            "codec": "none",
            "is_hevc": False,
            "is_vfr": False,
            "rotation": 0,
            "width": 0,
            "height": 0,
            "fps": 0.0,
            "duration": 0.0
        }

    codec_name = video_stream.get("codec_name", "").lower()
    is_hevc = codec_name in ["hevc", "h265"]

    # Check frame rates for VFR
    r_fps_str = video_stream.get("r_frame_rate", "0/0")
    avg_fps_str = video_stream.get("avg_frame_rate", "0/0")
    
    def eval_fps(fps_s):
        try:
            num, den = map(float, fps_s.split('/'))
            return num / den if den > 0 else 0.0
        except Exception:
            return 0.0

    r_fps = eval_fps(r_fps_str)
    avg_fps = eval_fps(avg_fps_str)
    is_vfr = abs(r_fps - avg_fps) > 0.5 if (r_fps > 0 and avg_fps > 0) else False

    # Check rotation in stream tags, format tags, and side_data_list
    rotation = 0
    tags = video_stream.get("tags", {})
    if "rotate" in tags:
        try:
            rotation = int(tags["rotate"])
        except ValueError:
            pass

    for sd in video_stream.get("side_data_list", []):
        if "rotation" in sd:
            try:
                rotation = int(float(sd["rotation"]))
            except (ValueError, TypeError):
                pass
        elif sd.get("side_data_type") == "Display Matrix" and "rotation" in sd:
            try:
                rotation = int(float(sd["rotation"]))
            except (ValueError, TypeError):
                pass

    width = int(video_stream.get("width", 0))
    height = int(video_stream.get("height", 0))
    duration = float(probe_data.get("format", {}).get("duration", 0.0))
    fps = avg_fps if avg_fps > 0 else (r_fps if r_fps > 0 else 30.0)

    # If width < height (portrait video), flag rotation if rotation metadata was 0
    if width > 0 and height > 0 and width < height and rotation == 0:
        rotation = 90

    return {
        "is_corrupt": False,
        "corrupt_reason": "",
        "codec": codec_name,
        "is_hevc": is_hevc,
        "is_vfr": is_vfr,
        "rotation": rotation % 360,
        "width": width,
        "height": height,
        "fps": fps,
        "duration": duration,
        "r_fps": r_fps,
        "avg_fps": avg_fps
    }

def check_cv2_decodable(video_path: Path) -> Tuple[bool, str]:
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        cap.release()
        return False, "cv2.VideoCapture failed to open file stream"
    ret, frame = cap.read()
    cap.release()
    if not ret or frame is None or frame.size == 0:
        return False, "cv2 failed to decode first frame"
    return True, ""

def should_transcode(probe_info: Dict[str, Any], cv2_ok: bool) -> Tuple[bool, str]:
    if not cv2_ok:
        return True, "OpenCV direct frame decoding failed"
    if probe_info.get("is_hevc"):
        return True, "HEVC/H.265 codec detected; normalizing to H.264 yuv420p for universal browser playback"
    if probe_info.get("rotation", 0) != 0:
        return True, f"Rotation metadata ({probe_info['rotation']}°) detected; normalizing orientation"
    if probe_info.get("is_vfr"):
        return True, "Variable Frame Rate (VFR) detected; normalizing to Constant Frame Rate (CFR)"
    if probe_info.get("codec") not in ["h264", "avc1"]:
        return True, f"Non-H.264 codec ({probe_info.get('codec')}) detected; normalizing for web & photogrammetry"
    return False, "Video already compliant H.264 CFR"

def transcode_to_normalized_h264(
    input_path: Path,
    output_path: Path,
    target_fps: float = 30.0,
    progress_callback: Optional[Callable[[float], None]] = None
) -> Path:
    ffmpeg_bin = get_ffmpeg_bin()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", str(input_path),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", str(round(target_fps, 2)),
        "-fps_mode", "cfr",
        "-preset", "fast",
        "-crf", "22",
        "-an",
        str(output_path)
    ]

    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if progress_callback:
        progress_callback(10.0)

    stderr_output = []
    while True:
        line = process.stderr.readline() if process.stderr else ""
        if not line and process.poll() is not None:
            break
        if line:
            stderr_output.append(line)

    retcode = process.poll()
    if retcode != 0:
        err_msg = "".join(stderr_output)
        raise RuntimeError(f"FFmpeg transcode failed (code {retcode}): {err_msg[-500:]}")

    if progress_callback:
        progress_callback(100.0)

    return output_path
