import importlib.metadata
import logging
import shutil
import cv2

logger = logging.getLogger(__name__)

OPENCV_PACKAGES = {
    "opencv-python",
    "opencv-python-headless",
    "opencv-contrib-python",
    "opencv-contrib-python-headless",
}

def check_opencv_environment():
    installed_opencv = []
    for dist in importlib.metadata.distributions():
        name = dist.metadata.get("Name")
        if name and name.lower() in OPENCV_PACKAGES:
            installed_opencv.append(name)
    
    if len(installed_opencv) > 1:
        msg = f"ENVIRONMENT ERROR: Multiple OpenCV packages installed: {installed_opencv}. Ensure only opencv-python-headless is installed."
        logger.error(msg)
        raise RuntimeError(msg)
    
    return {
        "status": "ready",
        "packages": installed_opencv,
        "version": cv2.__version__
    }

def check_ffmpeg_environment():
    ffmpeg_path = shutil.which("ffmpeg")
    ffprobe_path = shutil.which("ffprobe")
    
    if not ffmpeg_path or not ffprobe_path:
        missing = []
        if not ffmpeg_path:
            missing.append("ffmpeg")
        if not ffprobe_path:
            missing.append("ffprobe")
        msg = f"ENVIRONMENT ERROR: Missing required video processing binaries from PATH: {', '.join(missing)}"
        logger.error(msg)
        raise RuntimeError(msg)
    
    return {
        "status": "ready",
        "ffmpeg_path": ffmpeg_path,
        "ffprobe_path": ffprobe_path
    }

def verify_environment():
    cv_info = check_opencv_environment()
    ff_info = check_ffmpeg_environment()
    return {
        "opencv": cv_info,
        "ffmpeg": ff_info
    }
