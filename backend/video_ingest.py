import json
import logging
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple
try:
    import cv2
except (ImportError, OSError):
    cv2 = None

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

    pix_fmt = video_stream.get("pix_fmt", "").lower()
    return {
        "is_corrupt": False,
        "corrupt_reason": "",
        "codec": codec_name,
        "pix_fmt": pix_fmt,
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
    w = probe_info.get("width", 0)
    h = probe_info.get("height", 0)
    pix_fmt = probe_info.get("pix_fmt", "")
    if max(w, h) > 1280:
        return True, f"Long edge {max(w, h)}px > 1280px; downscaling proxy required"
    if pix_fmt and pix_fmt not in ["yuv420p", "yuvj420p"]:
        return True, f"Non-yuv420p pixel format ({pix_fmt}); normalizing to yuv420p"
    return False, "Video already compliant H.264 yuv420p <=1280px"

def transcode_to_normalized_h264(
    input_path: Path,
    output_path: Path,
    target_fps: float = 30.0,
    max_dimension: int = 1280,
    progress_callback: Optional[Callable[[float], None]] = None
) -> Path:
    ffmpeg_bin = get_ffmpeg_bin()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Scale filter: cap long edge at max_dimension, maintain aspect ratio, ensure even dims
    vf = (
        f"scale=w='min({max_dimension},iw)':h='min({max_dimension},ih)':"
        "force_original_aspect_ratio=decrease:force_divisible_by=2"
    )

    probe = probe_video(input_path)
    w = probe.get("width", 0)
    h = probe.get("height", 0)
    codec = probe.get("codec", "")
    pix_fmt = probe.get("pix_fmt", "")
    is_vfr = probe.get("is_vfr", False)
    rot = probe.get("rotation", 0)

    # Stream copy if already compliant H.264/yuv420p and <= max_dimension
    if codec in ["h264", "avc1"] and pix_fmt in ["yuv420p", "yuvj420p"] and max(w, h) <= max_dimension and not is_vfr and rot == 0:
        cmd = [
            ffmpeg_bin,
            "-y",
            "-i", str(input_path),
            "-c", "copy",
            str(output_path)
        ]
    else:
        cmd = [
            ffmpeg_bin,
            "-y",
            "-i", str(input_path),
            "-c:v", "libx264",
            "-pix_fmt", "yuv420p",
            "-vf", vf,
            "-r", str(round(target_fps, 2)),
            "-fps_mode", "cfr",
            "-preset", "veryfast",
            "-crf", "20",
            "-threads", "0",
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


DEFAULT_PROXY_MAX_WIDTH = int(os.getenv("VIDEO_PROXY_MAX_WIDTH", "1280"))


def create_browser_proxy(
    input_path: Path,
    output_path: Path,
    max_width: int = DEFAULT_PROXY_MAX_WIDTH,
    progress_callback: Optional[Callable[[float], None]] = None,
) -> Path:
    """
    Create a browser-friendly playback proxy with:
    - H.264 / yuv420p (universal browser support)
    - Width capped at max_width (default 1280 or VIDEO_PROXY_MAX_WIDTH), height scaled proportionally
    - +faststart: moves moov atom to the FRONT of the file so seeking works immediately
    - Keyframe interval ~1s (for accurate seeking)
    - Audio preserved as AAC stereo

    The original file is NEVER modified; the proxy is a separate file.
    Browsers play the proxy; the pipeline uses the original.
    """
    ffmpeg_bin = get_ffmpeg_bin()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Probe to get real fps (used for keyframe interval)
    probe = probe_video(input_path)
    fps = probe.get("fps") or 25.0
    gop = max(1, round(fps))  # keyframe interval ~1 second

    # Scale inside a max_width x max_width box, preserve aspect ratio, and make
    # both output dimensions even for yuv420p/libx264 on Windows and Linux.
    vf = (
        f"scale=w={max_width}:h={max_width}:"
        "force_original_aspect_ratio=decrease:force_divisible_by=2"
    )
    proxy_threads = max(1, min(int(os.getenv("VIDEO_PROXY_THREADS", "1")), 2))

    tmp_output = output_path.with_name(f"{output_path.stem}.tmp_{os.getpid()}_{time.time_ns()}.mp4")
    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", str(input_path),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-threads", str(proxy_threads),
        "-crf", "24",
        "-vf", vf,
        "-g", str(gop),                 # keyframe interval
        "-keyint_min", str(gop),
        "-sc_threshold", "0",           # disable scene-cut keyframes for predictable seeking
        "-c:a", "aac",
        "-b:a", "128k",
        "-ac", "2",                     # stereo
        "-movflags", "+faststart",      # ← moves moov atom to front -> enables immediate seeking
        str(tmp_output),
    ]

    logger.info("Creating browser proxy: %s -> %s", input_path, output_path)
    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if progress_callback:
        progress_callback(5.0)

    stderr_output = []
    while True:
        line = process.stderr.readline() if process.stderr else ""
        if not line and process.poll() is not None:
            break
        if line:
            stderr_output.append(line)

    retcode = process.poll()
    if retcode != 0:
        if tmp_output.exists():
            try:
                tmp_output.unlink()
            except OSError:
                pass
        err_msg = "".join(stderr_output)
        raise RuntimeError(f"Browser proxy creation failed (code {retcode}): {err_msg[-800:]}")

    os.replace(tmp_output, output_path)

    if progress_callback:
        progress_callback(100.0)

    logger.info("Browser proxy created: %s (%.1f MB)", output_path, output_path.stat().st_size / 1e6)
    return output_path


def get_or_create_browser_proxy(
    original_path: Path,
    mission_dir: Path,
    max_width: int = DEFAULT_PROXY_MAX_WIDTH,
    progress_callback: Optional[Callable[[float], None]] = None,
) -> Optional[Path]:
    """
    Returns the path to the browser proxy, creating it if needed.
    Proxy is stored at mission_dir/proxy/video_proxy.mp4.
    Returns None on failure.
    """
    proxy_dir = mission_dir / "proxy"
    proxy_path = proxy_dir / "video_proxy.mp4"

    if proxy_path.exists() and proxy_path.stat().st_size > 10_000:
        logger.debug("Browser proxy already exists: %s", proxy_path)
        return proxy_path

    try:
        create_browser_proxy(original_path, proxy_path, max_width=max_width, progress_callback=progress_callback)
        return proxy_path
    except Exception as exc:
        logger.error("Failed to create browser proxy for %s: %s", original_path, exc)
        return None
