import importlib.metadata
import logging
import os
import shutil
from typing import Any, Dict

logger = logging.getLogger(__name__)

OPENCV_PACKAGES = {
    "opencv-python",
    "opencv-python-headless",
    "opencv-contrib-python",
    "opencv-contrib-python-headless",
}


def check_opencv_environment(strict: bool = False) -> Dict[str, Any]:
    """Check OpenCV package status. Enforces single-package in worker/pipeline mode, warns in API mode."""
    try:
        import cv2
        version = cv2.__version__
        available = True
    except (ImportError, Exception):
        cv2 = None
        version = None
        available = False

    installed_opencv = []
    try:
        for dist in importlib.metadata.distributions():
            name = dist.metadata.get("Name")
            if name and name.lower() in OPENCV_PACKAGES:
                installed_opencv.append(name)
    except Exception:
        pass

    pipeline_enabled = os.getenv("PIPELINE_ENABLED", "false").lower() in ("true", "1", "yes")
    should_enforce = strict or pipeline_enabled

    if len(installed_opencv) > 1:
        msg = f"ENVIRONMENT ERROR: Multiple OpenCV packages installed: {installed_opencv}. Ensure only opencv-python-headless is installed."
        if should_enforce:
            logger.error(msg)
            raise RuntimeError(msg)
        else:
            logger.warning("API profile: Multiple OpenCV packages detected: %s. Recommended: opencv-python-headless only.", installed_opencv)

    return {
        "status": "ready" if available else "unavailable",
        "available": available,
        "packages": installed_opencv,
        "version": version,
    }


def check_ffmpeg_environment(strict: bool = False) -> Dict[str, Any]:
    """Check ffmpeg and ffprobe binary availability. Enforces in worker/pipeline mode, warns in API mode."""
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    is_available = bool(ffmpeg_path and ffprobe_path)

    pipeline_enabled = os.getenv("PIPELINE_ENABLED", "false").lower() in ("true", "1", "yes")
    should_enforce = strict or pipeline_enabled

    if not is_available:
        missing = []
        if not ffmpeg_path:
            missing.append("ffmpeg")
        if not ffprobe_path:
            missing.append("ffprobe")
        msg = f"ENVIRONMENT ERROR: Missing required video processing binaries from PATH: {', '.join(missing)}"
        if should_enforce:
            logger.error(msg)
            raise RuntimeError(msg)
        else:
            logger.warning("API profile: Missing video processing binaries: %s (video processing disabled in API mode)", ', '.join(missing))

    return {
        "status": "ready" if is_available else "unavailable",
        "available": is_available,
        "ffmpeg_path": ffmpeg_path,
        "ffprobe_path": ffprobe_path,
    }


def verify_environment(strict: bool = False) -> Dict[str, Any]:
    return {
        "opencv": check_opencv_environment(strict=strict),
        "ffmpeg": check_ffmpeg_environment(strict=strict),
    }
