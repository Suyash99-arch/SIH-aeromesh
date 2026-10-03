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



def is_split_worker_mode() -> bool:
    """
    Check if the current process is configured as a split/distributed worker or delegating API.
    A process is a split worker ONLY when ROLE=worker, AEROMESH_ROLE=worker, PROFILE=worker,
    WORKER_MODE=1, or WORKER_URL is explicitly set.
    """
    role = (os.getenv("ROLE") or os.getenv("AEROMESH_ROLE") or "").lower().strip()
    profile = os.getenv("PROFILE", "").lower().strip()
    worker_mode = os.getenv("WORKER_MODE", "").lower() in ("true", "1")
    worker_url = os.getenv("WORKER_URL", "").strip()
    return role == "worker" or profile == "worker" or worker_mode or bool(worker_url)


def check_worker_shared_state(strict: bool = False, force_enforce: bool = False) -> Dict[str, Any]:
    """
    Ensure background worker and API share the same PostgreSQL DB and S3/R2 storage.
    The shared-state check must run ONLY when the process is a split worker (ROLE=worker and/or WORKER_URL set).
    In a single-machine local run (ENVIRONMENT=development, PIPELINE_ENABLED=true, no WORKER_URL) the app
    must start with SQLite or the JSON fallback, with no Postgres needed.
    """
    from backend.database import get_database_url, mask_database_url

    db_url = get_database_url() or ""
    is_postgres = bool(
        db_url.startswith("postgresql+psycopg://")
        or db_url.startswith("postgresql://")
        or db_url.startswith("postgres://")
    )

    storage_type = os.getenv("STORAGE_BACKEND", "local").lower().strip()
    s3_bucket = os.getenv("S3_BUCKET", "").strip()
    is_shared_storage = storage_type == "s3" and bool(s3_bucket)

    is_split = is_split_worker_mode() or force_enforce

    if is_split:
        env_raw_db = os.getenv("DATABASE_URL", "").strip()
        if not env_raw_db:
            msg = "WORKER STARTUP HALTED: DATABASE_URL environment variable is missing. Worker requires shared PostgreSQL database to synchronize with API."
            logger.critical(msg)
            raise RuntimeError(msg)
        if not is_postgres:
            masked = mask_database_url(db_url)
            msg = f"WORKER STARTUP HALTED: Worker DATABASE_URL scheme is invalid ({masked}). Shared PostgreSQL database is required."
            logger.critical(msg)
            raise RuntimeError(msg)
        if not is_shared_storage:
            msg = "WORKER STARTUP HALTED: Shared S3/R2 object storage (STORAGE_BACKEND=s3 and S3_BUCKET) is required for distributed worker. Local storage cannot be accessed by the remote API."
            logger.critical(msg)
            raise RuntimeError(msg)

    return {
        "status": "ready" if (is_postgres and is_shared_storage) else ("split_worker_ready" if is_split else "local_standalone"),
        "database": "postgres" if is_postgres else ("sqlite" if db_url.startswith("sqlite") else "json_fallback"),
        "storage": "s3" if is_shared_storage else storage_type,
        "shared_state": is_postgres and is_shared_storage,
        "is_split_worker": is_split,
    }


def check_production_config(strict: bool = False, force_enforce: bool = False) -> Dict[str, Any]:
    """
    Validate production safety constraints:
    1. In production, AEROMESH_AUTH_OPTIONAL must NOT be 1/true.
    2. In production with allow_credentials=True, CORS_ALLOWED_ORIGINS cannot contain wildcards (*).
    """
    env_name = (os.getenv("ENVIRONMENT") or os.getenv("APP_ENV") or "").lower().strip()
    is_prod = env_name == "production" or os.getenv("RENDER", "").lower() in ("true", "1")
    should_enforce = is_prod or force_enforce

    auth_opt = os.getenv("AEROMESH_AUTH_OPTIONAL", "0").lower().strip() in ("1", "true", "yes")
    if should_enforce and auth_opt:
        msg = "PRODUCTION CONFIG ERROR: AEROMESH_AUTH_OPTIONAL is enabled (1). Production deployments require strict authentication (AEROMESH_AUTH_OPTIONAL=0)."
        logger.critical(msg)
        raise RuntimeError(msg)

    cors_origins_env = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
    if cors_origins_env:
        origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
        for origin in origins:
            if "*" in origin:
                msg = f"PRODUCTION CONFIG ERROR: Wildcard CORS origin '{origin}' is forbidden when credentials are allowed. Specify exact origin URLs."
                if should_enforce:
                    logger.critical(msg)
                    raise RuntimeError(msg)
                else:
                    logger.warning(msg)

    return {
        "status": "ready",
        "is_production": is_prod,
        "auth_optional": auth_opt,
    }


def verify_environment(strict: bool = False) -> Dict[str, Any]:
    return {
        "opencv": check_opencv_environment(strict=strict),
        "ffmpeg": check_ffmpeg_environment(strict=strict),
        "worker_shared_state": check_worker_shared_state(strict=strict),
        "production_config": check_production_config(strict=strict),
    }

