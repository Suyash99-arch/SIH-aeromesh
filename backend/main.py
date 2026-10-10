"""
AeroMesh Single-Pass Reconstruction Backend
Handles mission management, video processing, and 3D reconstruction
"""

import io
import json
import logging
import math
import os
import re
import shutil
import sys
import time
import uuid
import importlib.util
import secrets
import asyncio
try:
    import psutil
except ImportError:  # pragma: no cover - exercised in clean environments without psutil
    psutil = None
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

# Ensure repository root is in sys.path for robust absolute package imports
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.env_check import verify_environment, check_opencv_environment, check_ffmpeg_environment

# Offline-First: Block runtime model/library telemetry and update checks by default unless overridden
if os.environ.get("AEROMESH_OFFLINE") == "1" or os.environ.get("OFFLINE") == "1":
    os.environ.setdefault("YOLO_OFFLINE", "1")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("YOLO_VERBOSE", "False")

class _LazyModule:
    def __init__(self, module_name: str):
        self._module_name = module_name
        self._module = None

    def __getattr__(self, name: str):
        if self._module is None:
            self._module = importlib.import_module(self._module_name)
        return getattr(self._module, name)


cv2 = _LazyModule("cv2")
import numpy as np
from fastapi import (
    BackgroundTasks,
    Body,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from pydantic import BaseModel, Field, field_validator
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.concurrency import run_in_threadpool
import uvicorn
from backend.database import check_database, get_configured_engine, get_database_url, mask_database_url, session_scope, summarize_database_error, validate_production_database_url
from backend.repository import MissionRepository
from backend.jobs import JOB_STAGES, create_job, get_job, update_job
from backend.storage import get_storage, mission_object_key
from backend.upload_sessions import (
    CHUNK_SIZE_BYTES,
    assemble_chunks,
    prune_stale_uploads,
    received_chunk_indexes,
    upload_directory,
    upload_lock,
    write_chunk,
)
from backend.tasks import enqueue_processing_job
from pydantic import BaseModel, Field
from backend.security import (
    AEROMESH_ADMIN_PASSWORD,
    AEROMESH_ANALYST_PASSWORD,
    AEROMESH_OPERATOR_PASSWORD,
    DEMO_USERS,
    PORTAL_GOV_ORG,
    PORTAL_INDIVIDUAL,
    PORTAL_GUEST,
    ROLE_ADMIN,
    ROLE_ANALYST,
    ROLE_OPERATOR,
    ROLE_VIEWER,
    SecurityHeadersMiddleware,
    UserRecord,
    check_mission_access,
    clear_auth_cookies,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    find_user_by_email,
    get_current_user,
    get_current_user_optional,
    hash_password,
    rate_limit_dependency,
    require_roles,
    sanitize_filename,
    save_persistent_user,
    set_auth_cookies,
    validate_uploaded_file,
    verify_password,
)
from backend.scale_calibration import (
    ScaleCalibrationService,
    CalibrationRecord,
    CalibrationMethod,
    ScaleStatus,
)
from backend.measurement_engine import (
    GeometricMeasurementEngine,
    MeasurementStatus,
    DistanceMeasurement,
    PolygonMeasurement,
    ElevationMeasurement,
    ObjectDimensionsMeasurement,
    VolumeMeasurement,
)

scale_calibration_service = ScaleCalibrationService()

from backend.seeds import (
    load_csv_fused_objects,
)

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

def run_reconstruction_for_mission(*args, **kwargs):
    try:
        from backend.reconstruction import run_reconstruction_for_mission as run
    except ImportError:  # pragma: no cover
        return {
            "success": False,
            "status": "FAILED",
            "reason": "pycolmap reconstruction module unavailable",
            "point_count": 0,
            "processing_time_s": 0.0,
            "output_path": None,
        }
    return run(*args, **kwargs)


def get_reconstruction_pointcloud_path(*args, **kwargs):
    try:
        from backend.reconstruction import get_reconstruction_pointcloud_path as get_path
    except ImportError:  # pragma: no cover
        return None
    return get_path(*args, **kwargs)


def get_reconstruction_mesh_path(*args, **kwargs):
    try:
        from backend.reconstruction import get_reconstruction_mesh_path as get_path
    except ImportError:  # pragma: no cover
        return None
    return get_path(*args, **kwargs)


def get_reconstruction_metadata(*args, **kwargs):
    try:
        from backend.reconstruction import get_reconstruction_metadata as get_metadata
    except ImportError:  # pragma: no cover
        return None
    return get_metadata(*args, **kwargs)

def analyze_damage_for_mission(*args, **kwargs):
    try:
        from backend.damage_detection import analyze_damage_for_mission as analyze
    except ImportError:  # pragma: no cover
        return {
            "available": False,
            "status": "UNKNOWN",
            "reason": "damage detection module unavailable",
            "findings": [],
            "processing_time_s": 0.0,
            "method": "roboflow",
        }
    return analyze(*args, **kwargs)


def detect_entry_exit_points(*args, **kwargs):
    try:
        from backend.damage_detection import detect_entry_exit_points as detect
    except ImportError:  # pragma: no cover
        return {
            "available": False,
            "status": "UNKNOWN",
            "points": [],
            "method": "opencv_heuristic",
        }
    return detect(*args, **kwargs)

# ============================================================
# CONFIG
# ============================================================

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("AEROMESH_DATA_DIR", str(BASE_DIR / "data"))).resolve()
MISSIONS_DIR = DATA_DIR / "missions"
MAX_UPLOAD_SIZE_BYTES = max(1, int(os.getenv("MAX_UPLOAD_SIZE_BYTES", str(200 * 1024 * 1024))))
MAX_STORAGE_BYTES = max(1, int(os.getenv("MAX_STORAGE_BYTES", str(1024 * 1024 * 1024))))
DIRECT_UPLOAD_LIMIT_BYTES = 4 * 1024 * 1024
MAX_VIDEO_DURATION_SECONDS = min(180.0, max(1.0, float(os.getenv("MAX_VIDEO_DURATION_SECONDS", "180"))))

# Configure application and Uvicorn logs explicitly. Render's Uvicorn logging
# config may already have installed stderr handlers before this module loads.
_REDACT_ENV_SECRET_KEYS = re.compile(r"(?i)(PASSWORD|TOKEN|SECRET|API[_-]?KEY|CREDENTIAL)")
_CREDENTIAL_TEXT_PATTERNS = (
    re.compile(r"(?i)(\b(?:password|passwd|token|secret|api[_-]?key|authorization)\b\s*[:=]\s*)[^\s,;]+"),
    re.compile(r"(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)(postgres(?:ql)?(?:\+\w+)?://[^:/@\s]+:)[^@/\s]+(@)"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
)


def _redact_log_text(value: str) -> str:
    redacted = value
    for key, secret in os.environ.items():
        if secret and _REDACT_ENV_SECRET_KEYS.search(key):
            redacted = redacted.replace(secret, "[REDACTED]")
    for pattern in _CREDENTIAL_TEXT_PATTERNS:
        if pattern.pattern.startswith("\\beyJ"):
            redacted = pattern.sub("[REDACTED_TOKEN]", redacted)
        elif "postgres" in pattern.pattern:
            redacted = pattern.sub(r"\1[REDACTED]\2", redacted)
        elif "Bearer" in pattern.pattern:
            redacted = pattern.sub(r"\1[REDACTED]", redacted)
        else:
            redacted = pattern.sub(r"\1[REDACTED]", redacted)
    return redacted


class _CredentialRedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = _redact_log_text(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = {
                    key: _redact_log_text(value) if isinstance(value, str) else value
                    for key, value in record.args.items()
                }
            else:
                record.args = tuple(
                    _redact_log_text(value) if isinstance(value, str) else value
                    for value in record.args
                )
        if record.exc_info:
            import traceback
            record.exc_text = _redact_log_text("".join(traceback.format_exception(*record.exc_info)))
        return True


def _configure_app_logging() -> None:
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setLevel(logging.INFO)
    stdout_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    stdout_handler.addFilter(_CredentialRedactionFilter())
    logging.basicConfig(level=logging.INFO, handlers=[stdout_handler], force=True)
    for log_name in ("uvicorn", "uvicorn.error", "uvicorn.access", "backend"):
        configured_logger = logging.getLogger(log_name)
        configured_logger.disabled = False
        configured_logger.setLevel(logging.INFO)
        configured_logger.handlers.clear()
        configured_logger.propagate = True


_configure_app_logging()
logger = logging.getLogger(__name__)
if load_dotenv:
    load_dotenv(BASE_DIR / ".env")

DATA_DIR.mkdir(parents=True, exist_ok=True)
MISSIONS_DIR.mkdir(parents=True, exist_ok=True)

def is_production_mode() -> bool:
    if os.getenv("SPACE_ID") or os.getenv("SPACE_HOST") or os.getenv("ALLOW_SQLITE", "0").lower() in ("1", "true"):
        return False
    return os.getenv("ENVIRONMENT", "").strip().lower() in ("production", "prod") or os.getenv("ENV", "").strip().lower() in ("production", "prod") or os.getenv("RENDER", "").strip().lower() in ("true", "1")

is_production = is_production_mode()
database_migration_error_summary: Optional[str] = None

raw_db_url = os.getenv("DATABASE_URL", "").strip()
if is_production:
    is_valid, error_msg = validate_production_database_url(raw_db_url)
    if not is_valid:
        logger.critical("PRODUCTION STARTUP HALTED: %s", error_msg)
        raise RuntimeError(f"PRODUCTION STARTUP HALTED: {error_msg}")

configured_engine = get_configured_engine()
if configured_engine is not None:
    try:
        from backend.database import run_database_migrations
        run_database_migrations()
    except Exception as exc:
        database_migration_error_summary = summarize_database_error(exc, get_database_url())
        logger.error("Database migration failed; API will continue in degraded mode: %s", database_migration_error_summary)
    else:
        if check_database(configured_engine):
            logger.info("Database storage and migrations successfully initialized")
        else:
            logger.error("Database connection check failed after Alembic completed; API will continue with database unavailable")
else:
    if is_production:
        logger.critical("PRODUCTION STARTUP HALTED: DATABASE_URL is missing. Production requires a PostgreSQL database (e.g. Render Postgres).")
        raise RuntimeError("PRODUCTION STARTUP HALTED: DATABASE_URL is missing. Production requires a PostgreSQL database (e.g. Render Postgres).")

# Alembic's logging.config.fileConfig runs during import-time migrations and
# otherwise disables existing loggers, lowers root to WARN, and switches it to
# stderr. Reassert the Render stdout/INFO policy after that configuration.
_configure_app_logging()

# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="AEROMESH API",
    description="Single-Pass Drone Video to 3D Reconstruction",
    version="1.0.0",
)


def _degraded_missions_response(request: Request) -> JSONResponse:
    response = JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "error": "DATABASE_MIGRATION_FAILED",
            "message": "Missions are temporarily unavailable while the database schema is being initialized.",
            "error_summary": database_migration_error_summary,
        },
    )
    # The URL normalization middleware wraps CORS, so preserve CORS headers on
    # this short-circuit response for the configured frontend origins.
    origin = request.headers.get("origin", "")
    if origin in allowed_origins_list or (origin.startswith("https://") and origin.endswith(".vercel.app")):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    return response

# 1. CORS Middleware (Dev Origins + Vercel Production + Env Configurable + Localhost Regex)
dev_origins = [
    "http://localhost:5174",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5174",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "https://sih-aeromesh-blond.vercel.app",
    "https://sih-aeromesh.vercel.app",
]
is_prod_cors = (os.getenv("ENVIRONMENT", "").lower() == "production" or
                os.getenv("APP_ENV", "").lower() == "production" or
                os.getenv("RENDER", "").lower() in ("true", "1") or
                bool(os.getenv("SPACE_ID")))
cors_origins_env = (
    os.getenv("ALLOWED_ORIGINS", "").strip()
    or os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
)
allowed_origins_list = list(dev_origins)
if os.getenv("SPACE_HOST"):
    space_orig = f"https://{os.getenv('SPACE_HOST').strip()}"
    if space_orig not in allowed_origins_list:
        allowed_origins_list.append(space_orig)
if cors_origins_env:
    for origin in cors_origins_env.split(","):
        o = origin.strip()
        if "*" in o and is_prod_cors:
            raise RuntimeError(f"PRODUCTION CONFIG ERROR: Wildcard CORS origin '{o}' is forbidden when credentials are allowed.")
        if o and o not in allowed_origins_list:
            allowed_origins_list.append(o)

# 2. HTTP Security Headers
app.add_middleware(SecurityHeadersMiddleware)

# 3. URL Compatibility & Normalization Middleware (Fixes 404s for /missions and /api/v1/...)
@app.middleware("http")
async def api_url_normalization_middleware(request: Request, call_next):
    path = request.scope.get("path", "")
    if database_migration_error_summary and request.method == "GET" and path in (
        "/api/v1/missions", "/api/missions", "/missions"
    ):
        return _degraded_missions_response(request)
    is_legacy = False
    if path == "/missions" or path.startswith("/missions/"):
        request.scope["path"] = "/api" + path
        is_legacy = True
    elif path.startswith("/api/") and not path.startswith("/api/v1/"):
        is_legacy = True
    elif path.startswith("/api/v1/"):
        subpath = path[7:]  # Remove '/api/v1', leaves e.g. '/missions'
        route_paths = [getattr(r, "path", "") for r in request.app.routes]
        if path not in route_paths:
            request.scope["path"] = "/api" + subpath
    response = await call_next(request)
    if is_legacy:
        logger.warning(
            "DEPRECATION WARNING: Legacy route %s %s hit. Please migrate to /api/v1/...",
            request.method,
            path,
        )
        response.headers["Deprecation"] = "true"
        response.headers["Warning"] = '299 - "Legacy API path. Standardized path is /api/v1."'
    return response

# 4. Mount AeroMesh Scenes Router (v1, api, and scenes)
from backend.scenes import router as scenes_router
app.include_router(scenes_router, prefix="/api/v1/scenes")
app.include_router(scenes_router, prefix="/api/scenes")
app.include_router(scenes_router, prefix="/scenes")



@app.exception_handler(StarletteHTTPException)
async def starlette_http_exception_handler(request: Request, exc: StarletteHTTPException):
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    if exc.status_code >= 500:
        logger.exception(
            "HTTP server error request_id=%s method=%s path=%s status=%s detail=%s",
            request_id, request.method, request.url.path, exc.status_code, exc.detail,
            exc_info=(type(exc), exc, exc.__traceback__),
        )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "HTTP_EXCEPTION",
            "detail": exc.detail,
            "request_id": request_id,
        },
        headers=getattr(exc, "headers", None) or {},
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    if exc.status_code >= 500:
        logger.exception(
            "HTTP server error request_id=%s method=%s path=%s status=%s",
            request_id, request.method, request.url.path, exc.status_code,
            exc_info=(type(exc), exc, exc.__traceback__),
        )
        if exc.status_code == 500:
            return JSONResponse(
                status_code=exc.status_code,
                content={
                    "error": "INTERNAL_ERROR",
                    "request_id": request_id,
                    **({"stage": request.state.finalize_stage} if getattr(request.state, "finalize_stage", None) else {}),
                    "error_type": type(exc).__name__,
                },
                headers=getattr(exc, "headers", None) or {},
            )
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": "HTTP_EXCEPTION",
            "detail": exc.detail,
            "request_id": request_id,
        },
        headers=getattr(exc, "headers", None) or {},
    )

@app.exception_handler(Exception)
async def production_exception_handler(request: Request, exc: Exception):
    """Return sanitized errors while retaining credential-redacted tracebacks in logs."""
    if isinstance(exc, (HTTPException, StarletteHTTPException)):
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": "HTTP_EXCEPTION", "detail": exc.detail},
            headers=getattr(exc, "headers", None) or {},
        )

    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    logger.error(
        "Unhandled server exception request_id=%s method=%s path=%s",
        request_id,
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "INTERNAL_ERROR",
            "request_id": request_id,
            **({"stage": getattr(exc, "api_stage", None) or getattr(request.state, "finalize_stage", None)} if (getattr(exc, "api_stage", None) or getattr(request.state, "finalize_stage", None)) else {}),
            "error_type": getattr(exc, "api_error_type", type(exc).__name__),
        },
    )


@app.middleware("http")
async def attach_request_id(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())
    response = await call_next(request)
    response.headers.setdefault("X-Request-ID", request.state.request_id)
    return response


def _log_finalize_exception(request: Request, stage: str, exc: BaseException) -> None:
    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    logger.error(
        "Chunk finalize failed stage=%s request_id=%s method=%s path=%s",
        stage,
        request_id,
        request.method,
        request.url.path,
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def _run_finalize_stage(request: Request, stage: str, operation, *args, **kwargs):
    request.state.finalize_stage = stage
    try:
        result = operation(*args, **kwargs)
    except Exception as exc:
        _log_finalize_exception(request, stage, exc)
        raise
    else:
        request.state.finalize_stage = None
        return result


def _validate_upload_for_finalize(request: Request, filename: str, signature: bytes, size_bytes: int):
    try:
        return _run_finalize_stage(
            request, "validate", validate_uploaded_file, filename, signature,
            max_size_bytes=MAX_UPLOAD_SIZE_BYTES, size_bytes=size_bytes,
        )
    except Exception:
        if not is_lightweight_profile():
            raise
        request.state.finalize_stage = None
        # Keep the security checks that do not depend on the full validator.
        # This path is only used if the validator itself raises; ordinary
        # invalid files still receive its normal friendly validation response.
        logger.warning("Lightweight upload validator raised; applying conservative signature validation")
        safe_name = Path(filename).name == filename and ".." not in filename and "/" not in filename and "\\" not in filename
        allowed_type = Path(filename).suffix.lower() in {".mp4", ".mov", ".avi"}
        valid_size = 0 < size_bytes <= MAX_UPLOAD_SIZE_BYTES
        has_video_signature = any(marker in signature[:64] for marker in (b"ftyp", b"moov", b"mdat", b"RIFF", b"AVI "))
        if safe_name and allowed_type and valid_size and has_video_signature:
            return True, None
        return False, "Video validation could not confirm a supported video file."

app.mount("/media", StaticFiles(directory=str(DATA_DIR)), name="mission-media")

# ============================================================
# MODELS
# ============================================================

class ProcessMissionRequest(BaseModel):
    frame_sampling: float = Field(default=2.0, ge=0.1, le=100.0, description="Frame sampling rate in seconds or fps")
    inference_resolution: int = Field(default=640, ge=160, le=3840, description="YOLO inference resolution")
    detection_confidence: float = Field(default=0.35, ge=0.01, le=1.0, description="Detection confidence threshold")
    reconstruction_quality: str = Field(default="medium", description="Reconstruction quality")
    scene_profile: Optional[str] = Field(default="road", description="Scene profile")
    tile_inference: bool = Field(default=True, description="Enable tiled inference")
    tile_rows: int = Field(default=2, ge=1, le=10, description="Tile rows")
    tile_cols: int = Field(default=2, ge=1, le=10, description="Tile columns")
    tile_overlap: float = Field(default=0.15, ge=0.0, le=0.5, description="Tile overlap")
    sync: bool = Field(default=False, description="Run synchronously")

    @field_validator("reconstruction_quality", mode="before")
    @classmethod
    def validate_quality(cls, v):
        if v is None:
            return "medium"
        val = str(v).strip().lower()
        allowed = {"preview", "low", "medium", "high", "ultra"}
        if val not in allowed:
            raise ValueError(f"reconstruction_quality must be one of {sorted(allowed)}, got '{v}'")
        return val

    @field_validator("scene_profile", mode="before")
    @classmethod
    def validate_scene_profile(cls, v):
        if v is None or not str(v).strip():
            return "road"
        val = str(v).strip().lower()
        allowed = {"road", "urban", "bridge", "river", "disaster", "infrastructure", "survey", "default"}
        if val not in allowed:
            raise ValueError(f"scene_profile must be one of {sorted(allowed)}, got '{v}'")
        return val


class EtaEstimationRequest(BaseModel):
    size_bytes: Optional[int] = Field(default=None, description="Video file size in bytes")
    duration_seconds: Optional[float] = Field(default=None, description="Video duration in seconds")
    width: Optional[int] = Field(default=1920, description="Video frame width")
    height: Optional[int] = Field(default=1080, description="Video frame height")
    fps: Optional[float] = Field(default=30.0, description="Video frame rate")
    frame_sampling: Optional[float] = Field(default=2.0, description="Target frame sampling rate in fps")


# VisDrone class remapping: map fine-tuned model classes to scene_analysis categories
VISDRONE_CLASS_REMAPPING = {
    # Pedestrian classes -> people
    "pedestrian": "person",
    "people": "person",
    # Vehicle classes -> vehicles
    "bicycle": "bicycle",
    "car": "car",
    "van": "van",
    "truck": "truck",
    "tricycle": "tricycle",
    "awning-tricycle": "tricycle",
    "bus": "bus",
    "motor": "motorcycle",
}

# Per-class confidence thresholds (model-specific tuning)
# Aeromesh model is weak on car & bicycle (mAP50 < 10%), strong on van/bus/tricycle
PER_CLASS_CONFIDENCE_THRESHOLDS = {
    "car": 0.50,        # Weak performer - higher threshold
    "bicycle": 0.50,    # Weak performer - higher threshold
    "van": 0.25,        # Strong performer - lower threshold
    "bus": 0.25,        # Strong performer - lower threshold
    "tricycle": 0.25,   # Strong performer - lower threshold
    "truck": 0.35,      # Moderate performer
    "person": 0.35,     # Default
    "motorcycle": 0.35, # Default
}

DEFAULT_CONFIDENCE_THRESHOLD = 0.35


def _load_detection_model(use_aeromesh: bool = True):
    """
    Load the detection model with fallback logic.
    
    Tries to load aeromesh_yolo.pt (fine-tuned on VisDrone dataset).
    Falls back to yolo11n.pt (COCO-pretrained) if aeromesh file is missing.
    
    Args:
        use_aeromesh: If True, prefer aeromesh model; if False, use yolo11n
        
    Returns:
        Tuple of (model, model_name, is_aeromesh_loaded)
    """
    from ultralytics import YOLO
    
    configured_path = os.getenv("YOLO_MODEL_PATH", "").strip()
    backend_models_dir = Path(__file__).resolve().parent / "models"
    aeromesh_candidates = [
        backend_models_dir / "aeromesh_yolo.pt",
        BASE_DIR / "backend" / "models" / "aeromesh_yolo.pt",
    ]
    if use_aeromesh:
        for aero_cand in aeromesh_candidates:
            if aero_cand.is_file():
                try:
                    model = YOLO(str(aero_cand))
                    logger.info("Loaded aeromesh_yolo.pt from %s (VisDrone fine-tuned model)", aero_cand)
                    return model, "aeromesh_yolo", True
                except Exception as exc:
                    logger.warning("Failed to load aeromesh_yolo.pt at %s, falling back: %s", aero_cand, exc)
                    break

    configured_path = os.getenv("YOLO_MODEL_PATH", "").strip()
    if configured_path:
        cfg_p = Path(configured_path)
        if not cfg_p.is_file():
            cfg_p = (BASE_DIR / configured_path).resolve()
        if cfg_p.is_file():
            try:
                model = YOLO(str(cfg_p))
                is_aero = "aeromesh" in cfg_p.stem.lower()
                logger.info("Loaded custom configured YOLO model from %s (is_aeromesh=%s)", cfg_p, is_aero)
                return model, cfg_p.stem, is_aero
            except Exception as exc:
                logger.warning("Failed to load custom configured model at %s: %s", cfg_p, exc)

    # Canonical model candidates: prefer yolo11m, then yolo11x, yolo11s, yolo11n
    canonical_candidates = [
        backend_models_dir / "yolo11m.pt",
        BASE_DIR / "backend" / "models" / "yolo11m.pt",
        BASE_DIR / "yolo11m.pt",
        backend_models_dir / "yolo11x.pt",
        BASE_DIR / "yolo11x.pt",
        backend_models_dir / "yolo11s.pt",
        BASE_DIR / "yolo11s.pt",
        backend_models_dir / "yolo11n.pt",
        BASE_DIR / "backend" / "models" / "yolo11n.pt",
        BASE_DIR / "yolo11n.pt",
    ]
    for candidate in canonical_candidates:
        if candidate.is_file():
            try:
                model = YOLO(str(candidate))
                logger.info("Loaded %s from %s (canonical model)", candidate.stem, candidate)
                return model, candidate.stem, False
            except Exception as exc:
                logger.warning("Failed to load canonical model at %s: %s", candidate, exc)

    searched = [str(c) for c in canonical_candidates]

    # If no local model weights are present and not strictly offline, attempt fallback to yolo11n
    if os.environ.get("YOLO_OFFLINE") != "1":
        try:
            model = YOLO("yolo11n.pt")
            logger.info("Loaded canonical yolo11n.pt via ultralytics hub")
            return model, "yolo11n", False
        except Exception as exc:
            logger.warning("Online fallback for yolo11n.pt failed: %s", exc)

    raise FileNotFoundError(
        f"MODEL_NOT_FOUND: No canonical YOLO model found. Searched: {searched}. "
        "Ensure backend/models/yolo11n.pt exists or set YOLO_MODEL_PATH to an authorized local model file."
    )


def _get_confidence_threshold(class_name: str, is_aeromesh: bool = True) -> float:
    """
    Get per-class confidence threshold.
    
    When using aeromesh model, applies class-specific thresholds based on model performance.
    Otherwise uses default threshold.
    
    Args:
        class_name: YOLO class name (e.g., "person", "car")
        is_aeromesh: Whether using aeromesh model (VisDrone fine-tuned)
        
    Returns:
        Confidence threshold for this class
    """
    if not is_aeromesh:
        return DEFAULT_CONFIDENCE_THRESHOLD
    
    # Remap VisDrone class if needed
    remapped = VISDRONE_CLASS_REMAPPING.get(class_name, class_name)
    return PER_CLASS_CONFIDENCE_THRESHOLDS.get(remapped, DEFAULT_CONFIDENCE_THRESHOLD)


def _remap_visdrone_class(class_name: str) -> str:
    """
    Remap VisDrone class names to standard scene_analysis categories.
    
    Maps fine-tuned model classes to scene_analysis categories:
    - people category: person
    - vehicles category: car, van, truck, bus, bicycle, motorcycle, tricycle
    - structures/hazards: (unchanged from detection model)
    
    Args:
        class_name: Original class name from model
        
    Returns:
        Remapped class name for scene analysis
    """
    return VISDRONE_CLASS_REMAPPING.get(class_name, class_name)


class MissionData:
    """Mission service facade with database-first and JSON fallback storage."""
    def __init__(self, mission_id: str):
        self.raw_mission_id = str(mission_id)
        self.mission_id = str(mission_id)
        self.data = {}
        self.load()
    
    def load(self):
        database_engine = get_configured_engine()
        if database_engine is not None:
            try:
                with session_scope(database_engine) as session:
                    database_payload = MissionRepository(session).get(self.mission_id)
                if database_payload is not None:
                    self.data = database_payload
                    return
            except Exception as exc:
                logger.warning("Database read unavailable; using JSON fallback: %s", exc)
        candidate_files = [
            MISSIONS_DIR / f"{self.mission_id}.json",
            MISSIONS_DIR / self.mission_id / "mission.json",
            DATA_DIR / "objects" / "missions" / f"{self.mission_id}.json",
            DATA_DIR / "objects" / "missions" / self.mission_id / "mission.json",
        ]
        for mission_file in candidate_files:
            if mission_file.exists():
                for _ in range(3):
                    try:
                        with open(mission_file, "r", encoding="utf-8") as f:
                            self.data = json.load(f)
                            return
                    except Exception as exc:
                        time.sleep(0.005)
    
    def save(self, *, failure_stage: str = "db_update"):
        database_engine = get_configured_engine()
        if database_engine is not None:
            try:
                with session_scope(database_engine) as session:
                    repository = MissionRepository(session)
                    if repository.get(self.mission_id) is None:
                        repository.create(self.data)
                    else:
                        repository.update(self.mission_id, self.data)
            except Exception as exc:
                raise MissionDatabaseWriteError(failure_stage, exc) from exc
        try:
            MISSIONS_DIR.mkdir(parents=True, exist_ok=True)
            mission_file = MISSIONS_DIR / f"{self.mission_id}.json"
            temp_file = MISSIONS_DIR / f"{self.mission_id}.json.tmp.{uuid.uuid4().hex}"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)
            try:
                os.replace(temp_file, mission_file)
            except Exception:
                try:
                    if temp_file.exists():
                        temp_file.unlink()
                except Exception:
                    pass
        except Exception as exc:
            logger.warning("Failed writing mission JSON to disk: %s", exc)
    
    def update(self, updates: dict, *, failure_stage: str = "db_update"):
        self.data.update(updates)
        self.save(failure_stage=failure_stage)
    
    def get(self, key: str, default=None):
        return self.data.get(key, default)


class MissionDatabaseWriteError(RuntimeError):
    """Sanitized API metadata for mission persistence failures."""

    def __init__(self, stage: str, cause: Exception):
        self.api_stage = stage
        self.api_error_type = type(cause).__name__
        super().__init__(f"Mission database write failed at {stage}")

# ============================================================
# HEALTH & STATUS
# ============================================================

PROVENANCE_SOURCES = {
    "VIDEO_DERIVED",
    "GPS_DERIVED",
    "IMU_DERIVED",
    "RECONSTRUCTION_DERIVED",
    "DETECTION_DERIVED",
    "TRACKING_DERIVED",
    "USER_PROVIDED",
    "ESTIMATED",
    "UNKNOWN",
}

EVIDENCE_STATES = {"OBSERVED", "TRACKED", "RECONSTRUCTED", "PARTIAL", "POSSIBLE", "OCCLUDED", "UNKNOWN", "UNAVAILABLE"}


def build_provenance_entry(
    value: Optional[object],
    source: str = "UNKNOWN",
    confidence: float = 0.0,
    timestamp: Optional[str] = None,
    status: str = "UNKNOWN",
    display: Optional[str] = None,
) -> dict:
    """Create a provenance record with explicit evidence state."""
    normalized_source = source if source in PROVENANCE_SOURCES else "UNKNOWN"
    display_text = display or (
        "Insufficient visual evidence"
        if value is None
        else "Validated from available evidence"
    )
    if value is None or value == "" or (isinstance(value, (float, int)) and not np.isfinite(float(value))):
        return {
            "value": None,
            "source": normalized_source,
            "confidence": float(confidence or 0.0),
            "timestamp": timestamp,
            "status": status if status in EVIDENCE_STATES else "UNKNOWN",
            "display": display_text,
        }
    return {
        "value": value,
        "source": normalized_source,
        "confidence": float(confidence or 0.0),
        "timestamp": timestamp,
        "status": status if status in EVIDENCE_STATES else "UNKNOWN",
        "display": display_text,
    }


def build_evidence_state(
    value: object,
    status: str = "UNKNOWN",
    source: str = "UNKNOWN",
    confidence: float = 0.0,
    frame_id: Optional[int] = None,
    timestamp: Optional[str] = None,
    note: Optional[str] = None,
    display: Optional[str] = None,
) -> dict:
    """Represent a value with explicit visibility and evidence state."""
    normalized_status = status if status in EVIDENCE_STATES else "UNKNOWN"
    display_text = display or (
        "Insufficient visual evidence"
        if value is None
        else "Validated from available evidence"
    )
    return {
        "value": value,
        "status": normalized_status,
        "source": source if source in PROVENANCE_SOURCES else "UNKNOWN",
        "confidence": float(confidence or 0.0),
        "frame_id": frame_id,
        "timestamp": timestamp or datetime.utcnow().isoformat(),
        "note": note or "No explicit evidence note provided.",
        "display": display_text,
    }


def get_detector_metadata(is_aeromesh: bool = True) -> dict:
    """
    Describe the detector currently in use and its evidence limitations.
    
    Args:
        is_aeromesh: If True, returns metadata for aeromesh model; else returns YOLO11n metadata
        
    Returns:
        Model metadata dictionary with performance characteristics
    """
    if is_aeromesh:
        return {
            "model": "aeromesh_yolo",
            "dataset": "VisDrone (fine-tuned on aerial drone footage)",
            "domain": "Aerial / drone-based detection",
            "confidence_threshold": 0.35,  # Default; per-class thresholds vary
            "per_class_thresholds": {
                "car": 0.50,        # Weak performer (mAP50 < 10%)
                "bicycle": 0.50,    # Weak performer (mAP50 < 10%)
                "van": 0.25,        # Strong performer
                "bus": 0.25,        # Strong performer
                "tricycle": 0.25,   # Strong performer
                "truck": 0.35,
                "person": 0.35,
                "motorcycle": 0.35,
            },
            "input_resolution": 640,
            "suitability": "Aerial-specialized detector trained on VisDrone dataset; per-class performance variance requires individual thresholds.",
            "known_weaknesses": ["car detection (mAP50 < 10%)", "bicycle detection (mAP50 < 10%)"],
            "known_strengths": ["van detection", "bus detection", "tricycle detection"],
            "status": "AVAILABLE",
            "source": "MODEL_METADATA",
        }
    else:
        return {
            "model": "YOLO11n",
            "dataset": "COCO (general-purpose)",
            "domain": "General / aerial-use requires validation",
            "confidence_threshold": 0.35,
            "input_resolution": 640,
            "suitability": "General-purpose detector; results must be temporal-confirmed before being treated as confirmed objects.",
            "status": "AVAILABLE",
            "source": "MODEL_METADATA",
        }



def _safe_count(value: object, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, str):
        s = value.strip().lower()
        if s in {"unknown", "nan", "n/a", "null", ""}:
            return default
    try:
        numeric = float(value)
        if not np.isfinite(numeric):
            return default
        return int(numeric)
    except (TypeError, ValueError):
        return default


def _safe_label(value: object, default: str = "UNKNOWN") -> str:
    if value is None:
        return default
    if isinstance(value, str):
        text = value.strip()
        return text if text else default
    return str(value)


def _frame_quality(frame: np.ndarray) -> dict:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    brightness = float(gray.mean() / 255.0 * 100.0)
    contrast = float(gray.std() / 128.0 * 100.0)
    return {
        "sharpness": round(min(100.0, sharpness / 5.0), 1),
        "brightness": round(brightness, 1),
        "contrast": round(min(100.0, contrast), 1),
    }


def build_scene_analysis(detections: Optional[dict], tracks: Optional[list] = None) -> dict:
    """Build a canonical, evidence-derived scene summary."""
    detections = detections or {}
    tracks = tracks or []

    confirmed = []
    possible = []
    rejected = []
    per_object = []

    for track in tracks:
        track_id = track.get("trackId") or track.get("id") or "unknown"
        track_class = track.get("class") or "unknown"
        confidence = float(track.get("confidence", 0.0) or 0.0)
        hits = int(track.get("hits", 1) or 1)
        persistence = float(track.get("persistence", 0.0) or 0.0)
        
        logger.info("[build_scene_analysis] track %s (%s): confidence=%.4f (hits=%d, persistence=%.3f) BEFORE classification",
                    track_id, track_class, confidence, hits, persistence)

        # Promote detections confirmed across >= 2 consecutive frames to OBSERVED or CONFIRMED
        if hits > 1 and confidence >= 0.4 and persistence >= 0.5:
            status = "CONFIRMED"
        elif hits >= 2:
            status = "OBSERVED"
        elif confidence >= 0.35:
            status = "OBSERVED"
        else:
            status = "POSSIBLE"

        evidence = {
            "track_id": track_id,
            "class": track_class,
            "status": status,
            "confidence": round(confidence, 3),
            "hits": hits,
            "persistence": round(persistence, 3),
            "frames_seen": hits,
            "class_consistent": True,
            "segmentation_verified": False,
            "segmentation_status": "UNAVAILABLE",
            "source": "TRACKING_DERIVED",
            "first_seen": track.get("firstSeen"),
            "last_seen": track.get("lastSeen"),
            "confidence_history": track.get("confidenceHistory", [confidence]),
        }
        per_object.append(evidence)
        if status in ("CONFIRMED", "OBSERVED"):
            confirmed.append(evidence)
        else:
            possible.append(evidence)

    for observation in detections.get("observations", []) or []:
        class_name = observation.get("class") or "unknown"
        confidence = float(observation.get("confidence", 0.0) or 0.0)
        track_id = observation.get("trackId") or f"obs-{class_name}-{len(per_object)}"
        if any(item["track_id"] == track_id for item in per_object):
            continue
        evidence = {
            "track_id": track_id,
            "class": class_name,
            "status": "POSSIBLE" if confidence >= 0.2 else "REJECTED",
            "confidence": round(confidence, 3),
            "hits": 1,
            "persistence": 0.0,
            "frames_seen": 1,
            "class_consistent": True,
            "segmentation_verified": False,
            "segmentation_status": "UNAVAILABLE",
            "source": "DETECTION_DERIVED",
            "first_seen": observation.get("frame"),
            "last_seen": observation.get("frame"),
            "confidence_history": [confidence],
        }
        per_object.append(evidence)
        if evidence["status"] == "POSSIBLE":
            possible.append(evidence)
        else:
            rejected.append(evidence)

    people = _safe_count(sum(1 for item in confirmed if item["class"] in {"person", "people"}) + sum(1 for item in possible if item["class"] in {"person", "people"}))
    vehicles = _safe_count(sum(1 for item in confirmed if item["class"] in {"car", "van", "truck", "bus", "motorcycle", "bicycle", "tricycle", "vehicle"}) + sum(1 for item in possible if item["class"] in {"car", "van", "truck", "bus", "motorcycle", "bicycle", "tricycle", "vehicle"}))
    structures = _safe_count(sum(1 for item in confirmed if item["class"] in {"building", "structure", "bridge"}) + sum(1 for item in possible if item["class"] in {"building", "structure", "bridge"}))
    hazards = _safe_count(sum(1 for item in confirmed if item["class"] in {"hazard", "obstacle", "pole", "tree"}) + sum(1 for item in possible if item["class"] in {"hazard", "obstacle", "pole", "tree"}))

    confirmed_count = len(confirmed)
    possible_count = len(possible)
    rejected_count = len(rejected)
    total = confirmed_count + possible_count

    return {
        "total": total,
        "people": people,
        "vehicles": vehicles,
        "structures": structures,
        "hazards": hazards,
        "confirmed_objects": confirmed_count,
        "possible_objects": possible_count,
        "rejected_objects": rejected_count,
        "static_objects": structures + hazards,
        "dynamic_objects": people + vehicles,
        "per_object_evidence": per_object,
        "status": "PARTIAL" if total > 0 else "UNKNOWN",
        "source": "INFERENCE_DERIVED",
        "confidence": round(sum(item["confidence"] for item in per_object) / len(per_object), 3) if per_object else 0.0,
    }


@app.get("/")
async def root():
    return {
        "system": "AEROMESH Backend",
        "status": "online",
        "service": "Single-Pass 3D Reconstruction",
        "version": "1.0.0",
        "features": [
            "Video upload",
            "Object detection (YOLO11n)",
            "Object tracking",
            "Frame quality analysis",
            "3D point cloud generation",
            "Uncertainty estimation",
            "Measurement generation",
            "Mission management"
        ]
    }

def is_pipeline_enabled() -> bool:
    val = os.getenv("PIPELINE_ENABLED")
    if val is None:
        return True
    return val.strip().lower() in ("1", "true", "yes", "on")


def get_pipeline_mode() -> str:
    if is_api_profile():
        return "light"
    configured = os.getenv("PIPELINE_MODE", "").strip().lower()
    if configured in {"light", "heavy"}:
        return configured
    return "heavy" if is_pipeline_enabled() else "light"


def is_lightweight_profile() -> bool:
    return get_pipeline_mode() != "heavy"


def log_process_memory(event: str) -> None:
    if psutil is not None:
        try:
            rss_mb = psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
        except psutil.Error as exc:
            logger.warning("Unable to read process RSS for %s: %s", event, exc)
            return
    else:
        try:
            with Path("/proc/self/status").open(encoding="ascii") as status_file:
                rss_line = next(line for line in status_file if line.startswith("VmRSS:"))
            rss_mb = int(rss_line.split()[1]) / 1024
        except (OSError, ValueError, IndexError, StopIteration):
            logger.warning("Process memory event=%s rss_mb=unavailable", event)
            return
    logger.warning("Process memory event=%s rss_mb=%.1f", event, rss_mb)


def _local_storage_usage_bytes() -> int:
    roots = [DATA_DIR]
    is_s3 = os.getenv("STORAGE_BACKEND", "").strip().lower() == "s3" or bool(os.getenv("S3_BUCKET"))
    if not is_s3:
        configured_root = os.getenv("OBJECT_STORAGE_ROOT", "").strip()
        roots.append(
            Path(configured_root).resolve()
            if configured_root
            else (DATA_DIR / "objects").resolve()
        )
    total = 0
    seen: Set[Path] = set()
    for root in roots:
        if not root.exists():
            continue
        resolved_root = root.resolve()
        if resolved_root in seen:
            continue
        seen.add(resolved_root)
        for path in resolved_root.rglob("*"):
            if path.is_file():
                try:
                    total += path.stat().st_size
                except OSError:
                    continue
    return total


def _ensure_local_storage_capacity(additional_bytes: int, replacing_bytes: int = 0) -> None:
    used_bytes = max(0, _local_storage_usage_bytes() - replacing_bytes)
    if used_bytes + additional_bytes > MAX_STORAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_507_INSUFFICIENT_STORAGE,
            detail=(
                "Local upload storage is full. Delete older missions or configure "
                "STORAGE_BACKEND=s3 before uploading more videos."
            ),
        )


def get_worker_url() -> Optional[str]:
    url = os.getenv("WORKER_URL", "").strip()
    return url.rstrip("/") if url else None

def is_api_profile() -> bool:
    profile = os.getenv("PROFILE", "").strip().lower()
    if profile in ("worker", "ml", "pipeline"):
        return False
    if profile in ("api", "gateway"):
        return True
    return not is_pipeline_enabled()

def get_git_commit() -> str:
    commit = os.getenv("RENDER_GIT_COMMIT") or os.getenv("GIT_COMMIT")
    if commit:
        return commit[:8]
    return "unknown"

_detected_compute_device = None

def detect_compute_device() -> Dict[str, Any]:
    """Detect execution device at startup and report honest compute profile."""
    global _detected_compute_device
    if _detected_compute_device is not None:
        return _detected_compute_device

    # In lightweight profiles, NEVER import torch into the API process.
    if is_lightweight_profile():
        _detected_compute_device = {
            "execution_device": "cpu",
            "cuda_available": False,
            "device_name": "API Profile (Lightweight CPU)",
            "vram_mb": 0,
            "compute_path": "API Gateway — worker pipeline offloaded",
            "estimated_duration": "N/A",
            "compute_budget": "Host RAM & CPU (0 MB VRAM)",
            "budget_detail": "FastAPI Web Service"
        }
        return _detected_compute_device

    cuda_avail = False
    try:
        import torch
        cuda_avail = bool(torch.cuda.is_available())
    except Exception:
        cuda_avail = False

    device_name = "Host CPU"
    vram_mb = 0

    if cuda_avail:
        try:
            device_name = torch.cuda.get_device_name(0)
            vram_mb = round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024))
        except Exception:
            device_name = "NVIDIA CUDA GPU"
    else:
        try:
            import subprocess
            res = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Caption"],
                capture_output=True, text=True, timeout=2
            )
            captions = [line.strip() for line in res.stdout.strip().splitlines() if line.strip()]
            if captions:
                device_name = captions[0]
            else:
                device_name = "Intel(R) UHD Graphics"
        except Exception:
            device_name = "Host CPU"

    _detected_compute_device = {
        "execution_device": "cuda" if cuda_avail else "cpu",
        "cuda_available": cuda_avail,
        "device_name": device_name,
        "vram_mb": vram_mb,
        "compute_path": "GPU Hardware Accelerated" if cuda_avail else f"CPU inference — {device_name} detected, no CUDA device",
        "estimated_duration": "~2.5 – 4.0 min" if cuda_avail else "~6 – 8 min",
        "compute_budget": f"~{round(vram_mb / 1024, 1)} GB VRAM" if cuda_avail else "Host RAM & CPU (0 MB VRAM)",
        "budget_detail": "PyCOLMAP + YOLO11m (CUDA)" if cuda_avail else "PyCOLMAP + YOLO11 (CPU multi-threading)"
    }
    return _detected_compute_device


def print_startup_summary(dev: Dict[str, Any], env_info: Dict[str, Any]):
    role = (os.getenv("ROLE") or os.getenv("AEROMESH_ROLE") or "").lower().strip()
    profile = os.getenv("PROFILE", "").lower().strip()
    worker_url = os.getenv("WORKER_URL", "").strip()
    pipeline_on = is_pipeline_enabled()

    if is_production_mode():
        mode = "production"
    elif role == "worker" or profile == "worker":
        mode = "worker"
    elif bool(worker_url) or not pipeline_on:
        mode = "api"
    else:
        mode = "local"

    engine = get_configured_engine()
    raw_db = (get_database_url() or "").lower()
    if engine is not None and check_database(engine):
        if "postgres" in raw_db:
            db_type = "PostgreSQL"
        elif "sqlite" in raw_db:
            db_type = "SQLite"
        else:
            db_type = "SQL Database"
    else:
        db_type = "JSON Fallback"

    storage_backend = os.getenv("STORAGE_BACKEND", "local").lower().strip()
    s3_bucket = os.getenv("S3_BUCKET", "").strip()
    storage_type = f"s3 ({s3_bucket})" if (storage_backend == "s3" and s3_bucket) else "local"

    ff = env_info.get("ffmpeg", {})
    ff_path = ff.get("ffmpeg_path")
    ff_status = f"Ready ({Path(ff_path).name})" if (ff.get("available") and ff_path) else ("Ready" if ff.get("available") else "Missing / Not Installed")

    cv = env_info.get("opencv", {})
    cv_pkg = (cv.get("packages") or ["unknown"])[0] if cv.get("packages") else "opencv"
    if cv.get("status") == "deferred":
        cv_status = "Deferred until video upload (lightweight profile)"
    else:
        cv_status = f"Ready ({cv_pkg} {cv.get('version', '')})".strip() if cv.get("available") else "Missing / Error"

    device_name = dev.get("device_name", "Host CPU")
    cuda_status = "CUDA Active" if dev.get("cuda_available") else "CPU Only"

    mode_label = {
        "local": "Local All-in-One",
        "production": "Production Service",
        "worker": "Distributed Worker Node",
        "api": "API Gateway (Worker Offloaded)",
    }.get(mode, mode)

    sep = "=" * 80
    summary_banner = (
        f"\n{sep}\n"
        f"HEXA SPARK / AEROMESH STARTUP SUMMARY\n"
        f"{sep}\n"
        f"Execution Mode    : {mode} ({mode_label})\n"
        f"Database Backend  : {db_type}\n"
        f"Storage Backend   : {storage_type}\n"
        f"Pipeline Enabled  : {pipeline_on}\n"
        f"FFmpeg Status     : {ff_status}\n"
        f"OpenCV Status     : {cv_status}\n"
        f"Compute Hardware  : {device_name} ({cuda_status})\n"
        f"{sep}\n"
    )
    print(summary_banner, flush=True)
    logger.info("Startup summary initialized: mode=%s, db=%s, storage=%s, pipeline=%s", mode, db_type, storage_type, pipeline_on)


@app.on_event("startup")
async def startup_hardware_detection():
    log_process_memory("startup")
    try:
        removed_uploads = prune_stale_uploads(DATA_DIR)
        if removed_uploads:
            logger.info("Removed %d stale partial upload session(s)", removed_uploads)
    except OSError:
        logger.exception("Unable to clean stale partial upload sessions")

    # 1. Production Mode Check: Strictly enforce PostgreSQL
    if is_production_mode():
        raw_url = os.getenv("DATABASE_URL", "").strip()
        is_valid, err_msg = validate_production_database_url(raw_url)
        if not is_valid:
            logger.critical("PRODUCTION STARTUP HALTED: %s", err_msg)
            raise RuntimeError(f"PRODUCTION STARTUP HALTED: {err_msg}")
        engine = get_configured_engine()
        if engine is None or not check_database(engine):
            if database_migration_error_summary:
                logger.warning("PostgreSQL is unavailable after a migration failure; continuing in degraded mode")
            else:
                masked = mask_database_url(raw_url)
                logger.critical("PRODUCTION STARTUP HALTED: Active PostgreSQL connection required at %s.", masked)
                raise RuntimeError(f"PRODUCTION STARTUP HALTED: Active PostgreSQL connection required at {masked}.")

    # Keep lightweight profiles free of ML imports and model downloads at startup.
    if is_lightweight_profile():
        env_info = {
            "ffmpeg": check_ffmpeg_environment(strict=False),
            "opencv": {"available": None, "status": "deferred", "packages": ["opencv-python-headless"]},
        }
        dev = detect_compute_device()
    else:
        try:
            from backend.model_downloader import ensure_model_weights
            ensure_model_weights()
        except Exception as mw_exc:
            logger.warning("Model weights check/download encountered an error: %s", mw_exc)
        env_info = verify_environment(strict=is_pipeline_enabled())
        dev = detect_compute_device()

    # 3. Print Clean Startup Summary
    print_startup_summary(dev, env_info)
    log_process_memory("startup_complete")

    # 4. Orphaned Job Recovery: Convert stuck PROCESSING / QUEUED missions to INTERRUPTED
    try:
        orphaned_count = 0
        if MISSIONS_DIR.exists():
            for m_dir in MISSIONS_DIR.iterdir():
                if not m_dir.is_dir():
                    continue
                m_file = m_dir / "mission.json"
                if not m_file.is_file():
                    continue
                try:
                    with open(m_file, "r", encoding="utf-8") as f:
                        m_data = json.load(f)
                    st = str(m_data.get("status", "")).lower()
                    if st in ("processing", "queued", "running"):
                        logger.warning(
                            "Orphaned job detected for mission %s (status=%s, progress=%s%%). Marking INTERRUPTED.",
                            m_dir.name,
                            st,
                            m_data.get("progress", 0),
                        )
                        m_data["status"] = "interrupted"
                        m_data["failed_stage"] = m_data.get("failed_stage") or "pipeline"
                        m_data["error"] = "Server restarted while processing was active. Please retry."
                        m_data["error_message"] = "Server restarted while processing was active. Please retry."
                        m_data["interrupted_at"] = datetime.now(timezone.utc).isoformat()
                        with open(m_file, "w", encoding="utf-8") as f:
                            json.dump(m_data, f, indent=2)
                        
                        j_id = m_data.get("processing_job_id") or m_data.get("job_id")
                        if j_id:
                            update_job(
                                str(j_id),
                                status="INTERRUPTED",
                                stage="INTERRUPTED",
                                error_message="Server restarted while processing was active. Please retry.",
                                message="Processing interrupted by server restart.",
                            )
                        orphaned_count += 1
                except Exception as m_exc:
                    logger.warning("Error checking mission %s for orphaned state: %s", m_dir.name, m_exc)
        if orphaned_count > 0:
            logger.info("Orphaned job recovery completed: %d job(s) marked INTERRUPTED.", orphaned_count)
    except Exception as exc:
        logger.warning("Orphaned job recovery scan failed: %s", exc)



@app.get("/api/v1/ai-engine/status")
@app.get("/api/ai-engine/status")
async def get_ai_engine_status():
    """Live status of AI inference models, pycolmap photogrammetry, compute hardware, and tiling."""
    model_path = Path(os.getenv("YOLO_MODEL_PATH", "backend/models/aeromesh_yolo.pt"))
    weights_present = model_path.exists() and model_path.stat().st_size > 1000
    lightweight = is_lightweight_profile()
    detector_loadable = weights_present and not lightweight
    has_colmap = importlib.util.find_spec("pycolmap") is not None and not lightweight
    colmap_ver = "installed (not loaded)" if has_colmap else None

    comp_device = detect_compute_device()
    is_cuda = comp_device.get("is_cuda", False) or comp_device.get("device") == "cuda"
    device_label = comp_device.get("name") if is_cuda else "CPU only"

    tile_iou = float(os.getenv("DETECTION_TILE_IOU", "0.5"))
    tile_overlap = float(os.getenv("DETECTION_TILE_OVERLAP", "0.15"))

    detector_label = "YOLO Object Detection (Loaded)" if (weights_present and detector_loadable) else "Detector: not loaded"
    detector_status = "LOADED" if (weights_present and detector_loadable) else "NOT_LOADED"
    
    colmap_label = f"pycolmap {colmap_ver}" if has_colmap else (
        "Heavy reconstruction requires the full compute profile" if lightweight else "pycolmap not importable"
    )
    colmap_status = "AVAILABLE" if has_colmap else "UNAVAILABLE"

    return {
        "success": True,
        "detector": {
            "status": detector_status,
            "label": detector_label,
            "ready": bool(weights_present and detector_loadable),
            "weights_present": weights_present,
            "loadable": detector_loadable,
            "model_path": str(model_path),
        },
        "reconstruction": {
            "status": "DISABLED" if lightweight else colmap_status,
            "label": colmap_label,
            "ready": bool(has_colmap),
            "importable": has_colmap,
            "version": colmap_ver,
        },
        "compute": {
            "device": "cuda" if is_cuda else "cpu",
            "label": device_label,
            "profile": comp_device,
        },
        "tiling": {
            "status": "ACTIVE",
            "label": f"2x2 Tiled ({int(tile_overlap * 100)}% Overlap)",
            "rows": 2,
            "cols": 2,
            "overlap": tile_overlap,
            "iou": tile_iou,
        },
    }


@app.get("/api/v1/system/compute-device")
@app.get("/api/system/compute-device", deprecated=True)
async def get_system_compute_device():
    """Expose real execution device and hardware compute profile."""
    return {
        "success": True,
        "device": detect_compute_device(),
    }


@app.get("/api/v1/system/estimate-eta")
@app.get("/api/system/estimate-eta", deprecated=True)
@app.post("/api/v1/system/estimate-eta")
@app.post("/api/system/estimate-eta", deprecated=True)
async def estimate_system_eta(
    payload: Optional[EtaEstimationRequest] = Body(default=None),
    width: Optional[int] = Query(None),
    height: Optional[int] = Query(None),
    fps: Optional[float] = Query(None),
    duration_seconds: Optional[float] = Query(None),
    frame_sampling: Optional[float] = Query(None),
    size_bytes: Optional[int] = Query(None),
):
    """Compute mathematically grounded reconstruction ETA from file params and hardware."""
    from backend.eta_engine import estimate_pipeline_eta
    req = payload or EtaEstimationRequest()
    eff_width = req.width or width or 1920
    eff_height = req.height or height or 1080
    eff_fps = req.fps or fps or 30.0
    eff_duration = req.duration_seconds or duration_seconds or 10.0
    eff_sampling = req.frame_sampling or frame_sampling or 2.0
    eff_size = req.size_bytes or size_bytes or 0

    hw_prof = detect_compute_device()
    total_frames = int(eff_fps * eff_duration)
    meta = {
        "resolution": {"width": eff_width, "height": eff_height},
        "total_frames": total_frames,
        "fps": eff_fps,
        "frame_sampling": eff_sampling,
        "size_bytes": eff_size,
    }
    eta_result = estimate_pipeline_eta(meta, hardware_profile=hw_prof)
    return {
        "success": True,
        "eta": eta_result,
        "device": hw_prof,
    }


@app.get("/health")
@app.get("/api/health", deprecated=True)
@app.get("/api/v1/health")
async def health():
    database_engine = get_configured_engine()
    db_url = (get_database_url() or "").lower()
    if database_migration_error_summary:
        db_status = "migration_failed"
    elif database_engine is None:
        db_status = "json_fallback"
    elif "postgres" in db_url:
        db_status = "postgres_configured"
    elif "sqlite" in db_url:
        db_status = "sqlite_configured"
    else:
        db_status = "database_configured"

    s3_configured = os.getenv("STORAGE_BACKEND", "").strip().lower() == "s3" or bool(os.getenv("S3_BUCKET"))
    storage_status = "s3" if s3_configured else "local_ephemeral"
    pipeline_on = is_pipeline_enabled()
    pipeline_mode = get_pipeline_mode()
    git_commit = get_git_commit()

    # Mounted route prefixes calculation
    prefixes = set()
    for route in fastapi_app.routes:
        path = getattr(route, "path", None)
        if path:
            parts = [p for p in path.split("/") if p]
            if len(parts) >= 2 and parts[0] == "api" and parts[1] == "v1":
                prefixes.add("/api/v1")
            elif len(parts) >= 1 and parts[0] == "api":
                prefixes.add("/api")
            elif len(parts) >= 1:
                prefixes.add(f"/{parts[0]}")
    mounted_prefixes = sorted(list(prefixes))

    return {
        "status": "healthy",
        "ok": True,
        "version": fastapi_app.version,
        "git_commit": git_commit,
        "db": db_status,
        "storage": storage_status,
        "pipeline_enabled": pipeline_on,
        "pipeline_mode": pipeline_mode,
        "storage_persistence": "durable" if s3_configured else "ephemeral",
        "max_upload_size_bytes": MAX_UPLOAD_SIZE_BYTES,
        "mounted_route_prefixes": mounted_prefixes,
        # Backward-compatible fields
        "backend": "ready",
        "database": db_status,
        "processing_engine": "lightweight" if is_lightweight_profile() else "ready",
        "reconstruction_engine": "disabled" if is_lightweight_profile() else "ready",
        "compute_device": detect_compute_device(),
        "opencv_status": "loaded_on_demand",
        "ffmpeg_status": "checked_during_upload",
    }


@app.get("/api/v1/config")
async def api_config():
    s3_configured = os.getenv("STORAGE_BACKEND", "").strip().lower() == "s3" or bool(os.getenv("S3_BUCKET"))
    return {
        "max_upload_size_bytes": MAX_UPLOAD_SIZE_BYTES,
        "max_upload_size_mb": round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024), 1),
        "allowed_video_extensions": [".mp4", ".mov", ".avi"],
        "direct_upload_limit_bytes": DIRECT_UPLOAD_LIMIT_BYTES,
        "chunk_size_bytes": CHUNK_SIZE_BYTES,
        "storage_backend": "s3" if s3_configured else "local_ephemeral",
        "storage_persistence": "durable" if s3_configured else "ephemeral",
        "max_storage_bytes": MAX_STORAGE_BYTES,
        "pipeline_mode": get_pipeline_mode(),
        "heavy_reconstruction_available": not is_lightweight_profile(),
    }


@app.get("/api/v1/health/db")
async def database_schema_health():
    """Check PostgreSQL connectivity and compare persisted tables/columns to ORM metadata."""
    from sqlalchemy import inspect, text
    from backend.models import Base

    request_id = str(uuid.uuid4())
    database_engine = get_configured_engine()
    if database_engine is None:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unhealthy", "error": "database_not_configured", "request_id": request_id},
        )

    try:
        with database_engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            inspector = inspect(connection)
            existing_tables = set(inspector.get_table_names())
            required_tables = set(Base.metadata.tables)
            missing_tables = sorted(required_tables - existing_tables)
            missing_columns = {}
            for table_name in sorted(required_tables & existing_tables):
                existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
                required_columns = {column.name for column in Base.metadata.tables[table_name].columns}
                missing = sorted(required_columns - existing_columns)
                if missing:
                    missing_columns[table_name] = missing
    except Exception:
        logger.exception("Database schema health check failed [request_id=%s]", request_id)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unhealthy", "error": "database_check_failed", "request_id": request_id},
        )

    is_healthy = not missing_tables and not missing_columns
    return JSONResponse(
        status_code=status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "healthy" if is_healthy else "degraded",
            "database": "connected",
            "missing_tables": missing_tables,
            "missing_columns": missing_columns,
        },
    )


@app.get("/ready")
@app.get("/api/ready")
@app.get("/api/v1/ready")
async def readiness():
    """Readiness probe checking database, storage, and Redis connectivity."""
    checks: Dict[str, Any] = {}
    is_ready = True

    # 1. Database
    database_engine = get_configured_engine()
    if database_engine is not None:
        try:
            db_ok = check_database(database_engine)
            checks["database"] = {"status": "ready" if db_ok else "unavailable", "mode": "configured_database"}
            if not db_ok:
                is_ready = False
        except Exception as exc:
            checks["database"] = {"status": "error", "error": str(exc)}
            is_ready = False
    else:
        checks["database"] = {"status": "ready", "mode": "json_fallback"}

    # 2. Storage
    try:
        storage = get_storage(DATA_DIR / "objects")
        probe_key = ".readiness_probe.tmp"
        storage.upload(probe_key, io.BytesIO(b"ready"), probe_key)
        storage.delete(probe_key)
        checks["storage"] = {"status": "ready", "backend": type(storage).__name__}
    except Exception as exc:
        checks["storage"] = {"status": "error", "error": str(exc)}
        is_ready = False

    # 3. Redis / Worker Broker
    redis_url = os.getenv("REDIS_URL", "").strip()
    if redis_url:
        try:
            import redis
            r = redis.Redis.from_url(redis_url, socket_timeout=2)
            r.ping()
            checks["redis"] = {"status": "ready"}
        except Exception as exc:
            checks["redis"] = {"status": "unavailable", "error": str(exc)}
            if os.getenv("CELERY_REQUIRED", "0") == "1":
                is_ready = False
    else:
        checks["redis"] = {"status": "not_configured", "mode": "synchronous_local_fallback"}

    status_code = status.HTTP_200_OK if is_ready else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(
        status_code=status_code,
        content={
            "status": "ready" if is_ready else "degraded",
            "timestamp": datetime.utcnow().isoformat(),
            "checks": checks,
        },
    )


_AUDIT_EVENTS: List[Dict[str, Any]] = []


def _record_audit_event(
    action: str,
    user_id: str,
    email: str,
    organization_name: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    event = {
        "id": f"aud_{uuid.uuid4().hex[:8]}",
        "action": action,
        "user_id": user_id,
        "email": email,
        "organization_name": organization_name,
        "details": details or {},
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    _AUDIT_EVENTS.append(event)


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: Optional[str] = None
    portal_type: Optional[str] = PORTAL_INDIVIDUAL
    organization_name: Optional[str] = None
    department: Optional[str] = None
    employee_id: Optional[str] = None
    role: Optional[str] = None
    invite_code: Optional[str] = None
    invite_token: Optional[str] = None
    mfa_enabled: Optional[bool] = False


@app.post("/api/v1/auth/register", dependencies=[Depends(rate_limit_dependency)])
@app.post("/api/auth/register", dependencies=[Depends(rate_limit_dependency)])
async def register(req: RegisterRequest, response: Response):
    """Register a new user account supporting Government/Org and Individual portals with Argon2id hashing."""
    email = req.email.strip().lower()
    if not email or "@" not in email or "." not in email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Valid email address is required",
        )
    if len(req.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters long",
        )

    portal_type = req.portal_type or PORTAL_INDIVIDUAL
    org_name = (req.organization_name or "").strip() or None
    department = (req.department or "").strip() or None
    employee_id = (req.employee_id or "").strip() or None

    if portal_type == PORTAL_GOV_ORG and not org_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Organization name is required for Government / Organization registration",
        )

    # Check if user exists in persistent store or demo accounts
    existing_user = find_user_by_email(email)
    if existing_user is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this email already exists",
        )

    # Check if user exists in DB if configured
    database_engine = get_configured_engine()
    if database_engine is not None and check_database(database_engine):
        try:
            with session_scope(database_engine) as session:
                from backend.models import User as UserModel
                db_user = session.query(UserModel).filter(UserModel.email == email).first()
                if db_user:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="User with this email already exists",
                    )
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Database user query failed during registration: %s", exc)

    user_id = f"usr_{uuid.uuid4().hex[:12]}"
    full_name = (req.full_name or "").strip() or email.split("@")[0].replace(".", " ").title()

    # Server strictly assigns role (never accept client-supplied role or privilege)
    invite_code = req.invite_code or req.invite_token
    if portal_type == PORTAL_GOV_ORG:
        from backend.security import verify_and_consume_invite_code
        ok, err_msg, invite_meta = verify_and_consume_invite_code(invite_code or "", email)
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=err_msg or "Government account registration requires a valid admin-issued invite code.",
            )
        role = ROLE_ADMIN
        org_name = org_name or (invite_meta.get("org_name") if invite_meta else None) or "Ministry of Defence"
        department = department or (invite_meta.get("department") if invite_meta else None) or "Aerial Intelligence"
    else:
        role = ROLE_OPERATOR
        portal_type = PORTAL_INDIVIDUAL
        org_name = None
        department = None
        employee_id = None

    hashed_pwd = hash_password(req.password)
    created_at = datetime.utcnow().isoformat() + "Z"

    # Persist in DB if available
    if database_engine is not None and check_database(database_engine):
        try:
            with session_scope(database_engine) as session:
                from backend.models import User as UserModel
                new_db_user = UserModel(
                    id=user_id,
                    email=email,
                    hashed_password=hashed_pwd,
                    full_name=full_name,
                    role=role,
                    portal_type=portal_type,
                    organization_name=org_name,
                    department=department,
                    mfa_enabled=bool(req.mfa_enabled),
                    is_active=True,
                    created_at=datetime.utcnow(),
                )
                session.add(new_db_user)
        except Exception as exc:
            logger.warning("Database user insertion failed: %s", exc)

    user_record = UserRecord(
        id=user_id,
        email=email,
        full_name=full_name,
        role=role,
        portal_type=portal_type,
        organization_name=org_name,
        department=department,
        employee_id=employee_id,
        mfa_enabled=bool(req.mfa_enabled),
        hashed_password=hashed_pwd,
        is_active=True,
        created_at=created_at,
    )
    save_persistent_user(user_record)

    access_token = create_access_token({
        "sub": user_record.email,
        "user_id": user_record.id,
        "role": user_record.role,
        "portal_type": user_record.portal_type,
        "organization_name": user_record.organization_name,
        "department": user_record.department,
        "employee_id": user_record.employee_id,
        "name": user_record.full_name,
    })
    refresh_token = create_refresh_token({
        "sub": user_record.email,
        "user_id": user_record.id,
        "role": user_record.role,
        "portal_type": user_record.portal_type,
    })

    set_auth_cookies(response, access_token, refresh_token)
    _record_audit_event("user.registered", user_id, email, org_name, {"portal_type": portal_type, "role": role})

    return {
        "success": True,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user_record.to_dict(),
    }


class GoogleAuthRequest(BaseModel):
    id_token: str


@app.post("/api/v1/auth/google", dependencies=[Depends(rate_limit_dependency)])
@app.post("/api/auth/google", dependencies=[Depends(rate_limit_dependency)])
async def google_auth(req: GoogleAuthRequest, response: Response):
    """Authenticate or register user via Google OAuth ID token with server-controlled role assignment."""
    token = req.id_token.strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google ID token is required",
        )

    google_client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not google_client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth is not configured on this server (GOOGLE_CLIENT_ID missing)",
        )

    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        id_info = google_id_token.verify_oauth2_token(token, google_requests.Request(), google_client_id)
    except Exception as exc:
        logger.warning("Google ID token verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired Google OAuth token",
        )

    email = id_info.get("email", "").strip().lower()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google token missing email claim",
        )

    full_name = id_info.get("name", "").strip() or email.split("@")[0].title()

    # Find existing or create new individual user
    user = find_user_by_email(email)
    database_engine = get_configured_engine()

    if user is None:
        user_id = f"usr_{uuid.uuid4().hex[:12]}"
        unusable_pwd_hash = f"OAUTH_DISABLED_${uuid.uuid4().hex}_${secrets.token_urlsafe(32)}"
        role = ROLE_OPERATOR
        portal_type = PORTAL_INDIVIDUAL
        created_at = datetime.utcnow().isoformat() + "Z"

        if database_engine is not None and check_database(database_engine):
            try:
                with session_scope(database_engine) as session:
                    from backend.models import User as UserModel
                    new_db_user = UserModel(
                        id=user_id,
                        email=email,
                        hashed_password=unusable_pwd_hash,
                        full_name=full_name,
                        role=role,
                        portal_type=portal_type,
                        organization_name=None,
                        department=None,
                        mfa_enabled=False,
                        is_active=True,
                        created_at=datetime.utcnow(),
                    )
                    session.add(new_db_user)
            except Exception as exc:
                logger.warning("Database OAuth user insertion failed: %s", exc)

        user = UserRecord(
            id=user_id,
            email=email,
            full_name=full_name,
            role=role,
            portal_type=portal_type,
            organization_name=None,
            department=None,
            mfa_enabled=False,
            hashed_password=unusable_pwd_hash,
            password_login_disabled=True,
            is_active=True,
            created_at=created_at,
        )
        save_persistent_user(user)
        _record_audit_event("user.oauth_registered", user_id, email, None, {"provider": "google", "role": role})

    access_token = create_access_token({
        "sub": user.email,
        "user_id": user.id,
        "role": user.role,
        "portal_type": user.portal_type,
        "organization_name": user.organization_name,
        "department": user.department,
        "name": user.full_name,
    })
    refresh_token = create_refresh_token({
        "sub": user.email,
        "user_id": user.id,
        "role": user.role,
        "portal_type": user.portal_type,
    })

    set_auth_cookies(response, access_token, refresh_token)
    _record_audit_event("user.oauth_login", user.id, user.email, user.organization_name, {"provider": "google"})

    return {
        "success": True,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user.to_dict(),
    }


class LoginRequest(BaseModel):
    email: str
    password: str
    portal_type: Optional[str] = None
    mfa_code: Optional[str] = None


@app.post("/api/v1/auth/login", dependencies=[Depends(rate_limit_dependency)])
@app.post("/api/auth/login", dependencies=[Depends(rate_limit_dependency)])
async def login(credentials: LoginRequest, response: Response):
    """Authenticate user with email and password supporting MFA challenge and httpOnly cookie issuance."""
    email = credentials.email.strip().lower()
    password = credentials.password

    # Check if account exists with password login disabled (OAuth created account)
    potential_user = find_user_by_email(email)
    if potential_user and (getattr(potential_user, "password_login_disabled", False) or (potential_user.hashed_password or "").startswith("OAUTH_DISABLED_")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password login is disabled for OAuth-created accounts. Please sign in with Google.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user: Optional[UserRecord] = None

    # Check database users if configured
    database_engine = get_configured_engine()
    if database_engine is not None and check_database(database_engine):
        try:
            with session_scope(database_engine) as session:
                from backend.models import User as UserModel
                db_user = session.query(UserModel).filter(UserModel.email == email).first()
                if db_user and db_user.is_active:
                    if (db_user.hashed_password or "").startswith("OAUTH_DISABLED_"):
                        raise HTTPException(
                            status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Password login is disabled for OAuth-created accounts. Please sign in with Google.",
                            headers={"WWW-Authenticate": "Bearer"},
                        )
                    if verify_password(password, db_user.hashed_password):
                        user = UserRecord(
                            id=db_user.id,
                            email=db_user.email,
                            full_name=db_user.full_name or email.split("@")[0].title(),
                            role=db_user.role,
                            portal_type=db_user.portal_type or PORTAL_INDIVIDUAL,
                            organization_name=db_user.organization_name,
                            department=db_user.department,
                            mfa_enabled=db_user.mfa_enabled or False,
                            mfa_secret=db_user.mfa_secret,
                            guest_expires_at=db_user.guest_expires_at.isoformat() if db_user.guest_expires_at else None,
                            hashed_password=db_user.hashed_password,
                            is_active=db_user.is_active,
                        )
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("Database user lookup failed, falling back to demo users: %s", exc)

    # Fallback to persistent users and seeded demo accounts
    if user is None:
        user_candidate = find_user_by_email(email)
        if user_candidate and verify_password(password, user_candidate.hashed_password):
            user = user_candidate

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Handle Multi-Factor Authentication (MFA/OTP)
    if user.mfa_enabled:
        if not credentials.mfa_code:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "success": False,
                    "mfa_required": True,
                    "message": "Two-factor authentication code required",
                    "email": user.email,
                },
            )
        # Validate 6-digit OTP code against configured TOTP secret or explicit DEBUG_MFA flag
        code = credentials.mfa_code.strip()
        if len(code) != 6 or not code.isdigit():
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid 6-digit MFA / OTP code format",
            )
        if user.mfa_secret:
            try:
                import pyotp
                totp = pyotp.TOTP(user.mfa_secret)
                if not totp.verify(code, valid_window=1):
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA / OTP authentication code")
            except ImportError:
                if is_production:
                    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="MFA TOTP engine unavailable in production")
                allow_debug_mfa = os.getenv("DEBUG_MFA", "0").lower() in ("1", "true", "yes")
                if not (allow_debug_mfa and code == "123456"):
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid MFA / OTP authentication code")
        else:
            allow_debug_mfa = os.getenv("DEBUG_MFA", "0").lower() in ("1", "true", "yes")
            if is_production or not (allow_debug_mfa and code == "123456"):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="MFA is enabled on this account but no valid OTP secret is configured")

    access_token = create_access_token({
        "sub": user.email,
        "user_id": user.id,
        "role": user.role,
        "portal_type": user.portal_type,
        "organization_name": user.organization_name,
        "department": user.department,
        "name": user.full_name,
    })
    refresh_token = create_refresh_token({
        "sub": user.email,
        "user_id": user.id,
        "role": user.role,
        "portal_type": user.portal_type,
    })

    set_auth_cookies(response, access_token, refresh_token)
    _record_audit_event("user.login", user.id, user.email, user.organization_name, {"portal_type": user.portal_type})

    return {
        "success": True,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user.to_dict(),
    }


@app.post("/api/v1/auth/guest", dependencies=[Depends(rate_limit_dependency)])
@app.post("/api/auth/guest", dependencies=[Depends(rate_limit_dependency)])
async def guest_session(response: Response):
    """Create an ephemeral, session-scoped guest account with a 2-hour TTL."""
    guest_id = f"guest_{uuid.uuid4().hex[:8]}"
    email = f"{guest_id}@aeromesh.guest"
    guest_expires = (datetime.utcnow() + timedelta(hours=2)).isoformat() + "Z"

    user_record = UserRecord(
        id=guest_id,
        email=email,
        full_name="Guest Evaluator",
        role=ROLE_OPERATOR,
        portal_type=PORTAL_GUEST,
        organization_name=None,
        department=None,
        mfa_enabled=False,
        guest_expires_at=guest_expires,
        hashed_password="",
        is_active=True,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    save_persistent_user(user_record)

    access_token = create_access_token({
        "sub": user_record.email,
        "user_id": user_record.id,
        "role": user_record.role,
        "portal_type": user_record.portal_type,
        "name": user_record.full_name,
        "guest_expires_at": guest_expires,
    }, expires_delta=timedelta(hours=2))
    refresh_token = create_refresh_token({
        "sub": user_record.email,
        "user_id": user_record.id,
        "role": user_record.role,
        "portal_type": user_record.portal_type,
    }, expires_delta=timedelta(hours=2))

    set_auth_cookies(response, access_token, refresh_token)
    _record_audit_event("guest.session_created", guest_id, email, None, {"expires_at": guest_expires})

    return {
        "success": True,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": user_record.to_dict(),
    }


class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = None


@app.post("/api/v1/auth/refresh")
@app.post("/api/auth/refresh")
async def refresh_session(request: Request, response: Response, body: Optional[RefreshRequest] = None):
    """Rotate and issue a fresh access token from an httpOnly cookie or JSON payload."""
    token = None
    if body and body.refresh_token:
        token = body.refresh_token
    elif request and request.cookies.get("refresh_token"):
        token = request.cookies.get("refresh_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_access_token(token)
    except HTTPException:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Supplied token is not a refresh token",
        )

    email = payload.get("sub")
    user = find_user_by_email(email)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User associated with token not found",
        )

    new_access = create_access_token({
        "sub": user.email,
        "user_id": user.id,
        "role": user.role,
        "portal_type": user.portal_type,
        "organization_name": user.organization_name,
        "department": user.department,
        "name": user.full_name,
    })
    new_refresh = create_refresh_token({
        "sub": user.email,
        "user_id": user.id,
        "role": user.role,
        "portal_type": user.portal_type,
    })

    set_auth_cookies(response, new_access, new_refresh)

    return {
        "success": True,
        "access_token": new_access,
        "refresh_token": new_refresh,
        "token_type": "bearer",
        "user": user.to_dict(),
    }


@app.post("/api/v1/auth/logout")
@app.post("/api/auth/logout")
async def logout(response: Response, current_user: Optional[UserRecord] = Depends(get_current_user_optional)):
    """Clear session httpOnly cookies and invalidate client state."""
    clear_auth_cookies(response)
    if current_user:
        _record_audit_event("user.logout", current_user.id, current_user.email, current_user.organization_name)
    return {"success": True, "message": "Logged out successfully"}


class InviteRequest(BaseModel):
    email: str
    role: Optional[str] = ROLE_ANALYST
    department: Optional[str] = None
    full_name: Optional[str] = None


@app.post("/api/v1/auth/invite")
@app.post("/api/auth/invite")
async def invite_team_member(req: InviteRequest, current_user: UserRecord = Depends(get_current_user)):
    """Allow Government/Org Admins to invite team members within their organization."""
    if current_user.portal_type != PORTAL_GOV_ORG:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Team invitations are only available for Organization accounts",
        )
    if current_user.role not in (ROLE_ADMIN, ROLE_ANALYST, "org_admin", "pending_org_admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Organization Admins and Analysts can invite team members",
        )

    target_email = req.email.strip().lower()
    if not target_email or "@" not in target_email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Valid email is required")

    existing = find_user_by_email(target_email)
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User with this email is already registered")

    temp_pass = f"Invite_{secrets.token_urlsafe(8)}!"
    new_id = f"usr_{uuid.uuid4().hex[:12]}"
    assigned_role = req.role if req.role in (ROLE_ADMIN, ROLE_ANALYST, ROLE_OPERATOR, ROLE_VIEWER) else ROLE_VIEWER

    invited_user = UserRecord(
        id=new_id,
        email=target_email,
        full_name=req.full_name or target_email.split("@")[0].title(),
        role=assigned_role,
        portal_type=PORTAL_GOV_ORG,
        organization_name=current_user.organization_name,
        department=req.department or current_user.department,
        hashed_password=hash_password(temp_pass),
        is_active=True,
        created_at=datetime.utcnow().isoformat() + "Z",
    )
    save_persistent_user(invited_user)

    _record_audit_event(
        "team.member_invited",
        current_user.id,
        current_user.email,
        current_user.organization_name,
        {"invited_email": target_email, "assigned_role": assigned_role},
    )

    return {
        "success": True,
        "message": f"Invitation created for {target_email}",
        "invited_user": invited_user.to_dict(),
        "temporary_password": temp_pass,
    }


@app.get("/api/v1/auth/audit-log")
@app.get("/api/auth/audit-log")
async def get_audit_log(current_user: UserRecord = Depends(get_current_user)):
    """Retrieve audit events scoped to the current user's organization."""
    if current_user.portal_type != PORTAL_GOV_ORG and current_user.role != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Audit logs are restricted to government and organization accounts.",
        )
    org = current_user.organization_name
    events = [
        e for e in _AUDIT_EVENTS
        if current_user.role == ROLE_ADMIN
        or (org and e.get("organization_name") == org)
        or e.get("user_id") == current_user.id
    ]
    return {
        "success": True,
        "organization": org or "Individual / Personal",
        "events": list(reversed(events[-100:])),
    }


@app.get("/api/v1/auth/me")
@app.get("/api/auth/me")
async def get_current_user_profile(user: UserRecord = Depends(get_current_user)):
    """Retrieve current authenticated user profile and assigned role."""
    return {
        "success": True,
        "user": user.to_dict(),
    }


@app.get("/api/v1/auth/demo-users")
@app.get("/api/auth/demo-users", deprecated=True)
async def get_demo_users():
    """Expose available demo profiles in development only when DEV_ONLY is enabled. Disabled by default and in production."""
    env = os.getenv("ENVIRONMENT", "development").strip().lower()
    from backend.security import DEV_ONLY
    if not DEV_ONLY or env != "development":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Demo users endpoint is disabled",
        )
    return {
        "success": True,
        "users": [
            {
                "email": u.email,
                "full_name": u.full_name,
                "role": u.role,
                "portal_type": u.portal_type,
                "organization_name": u.organization_name,
                "department": u.department,
                "description": (
                    "Full administrator access, role management, and system administration"
                    if u.role == ROLE_ADMIN
                    else (
                        "Mission inspection, 3D/GIS analysis, measurements, and executive reporting"
                        if u.role == ROLE_ANALYST
                        else "Drone flight video upload, pipeline execution, and mission operations"
                    )
                ),
            }
            for u in DEMO_USERS.values()
        ],
    }


@app.get("/api/v1/gov/dashboard")
@app.get("/api/gov/dashboard")
async def get_government_dashboard(current_user: UserRecord = Depends(get_current_user)):
    """Government / Organization Security Dashboard endpoint."""
    if current_user.portal_type != PORTAL_GOV_ORG and current_user.role != ROLE_ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Government dashboard is restricted to government and organization accounts.",
        )
    return {
        "success": True,
        "organization": current_user.organization_name or "Government Security Operations",
        "department": current_user.department or "Aerial Reconstruction Unit",
        "employee_id": getattr(current_user, "employee_id", None),
        "role": current_user.role,
        "portal_type": current_user.portal_type,
        "status": "active",
        "clearance_level": "RESTRICTED",
    }


@app.get("/api/v1/missions/{mission_id}/status")
@app.get("/api/missions/{mission_id}/status")
async def get_mission_status(mission_id: str):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    stage = mission.data.get("status") or "created"
    return {
        "success": True,
        "mission_id": mission_id,
        "status": stage,
        "stages": [
            "UPLOADED",
            "ANALYZING_VIDEO",
            "EXTRACTING_FRAMES",
            "DETECTING_OBJECTS",
            "TRACKING_OBJECTS",
            "ESTIMATING_CAMERA",
            "RECONSTRUCTING",
            "BUILDING_SCENE",
            "BUILDING_GEOSPATIAL",
            "COMPLETE",
            "PARTIAL",
            "FAILED",
        ],
    }

# ============================================================
# MISSIONS
# ============================================================

@app.post("/api/v1/missions")
@app.post("/api/missions")
@app.post("/missions")
async def create_mission(
    name: str = Query(""),
    mission_type: str = Query("single-pass"),
    location: str = Query(""),
    operator: str = Query(""),
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Create a new mission"""
    mission_id = str(uuid.uuid4())
    
    owner_id = current_user.id if current_user else None
    owner_email = current_user.email if current_user else None
    org_name = current_user.organization_name if current_user else None
    dept = current_user.department if current_user else None
    is_guest = (current_user.portal_type == PORTAL_GUEST) if current_user else False
    effective_name = name.strip() if name and name.strip() else "Untitled mission"
    effective_location = location.strip() if location and location.strip() else "Not set"
    effective_operator = operator.strip() if operator and operator.strip() else (current_user.full_name if current_user else "Not set")

    mission = MissionData(mission_id)
    mission.update({
        "id": mission_id,
        "name": effective_name,
        "type": mission_type or "single-pass",
        "location": effective_location,
        "operator": effective_operator,
        "owner_id": owner_id,
        "created_by": owner_email or effective_operator or "anonymous",
        "organization_name": org_name,
        "department": dept,
        "is_guest": is_guest,
        "createdAt": datetime.utcnow().isoformat(),
        "status": "created",
        "video": None,
        "processing": None,
        "detections": None,
        "tracks": None,
        "frameQuality": None,
        "reconstruction": None,
        "measurements": None,
        "findings": [],
        "metadata": {}
    }, failure_stage="db_create")
    
    # Invalidate cached missions list
    _missions_list_cache["timestamp"] = 0.0
    _missions_list_cache["data"] = []

    return {
        "success": True,
        "mission": mission.data,
        "compute_device": detect_compute_device(),
    }


@app.get("/api/v1/missions/shared/{token}")
@app.get("/api/missions/shared/{token}")
async def get_shared_mission_data(token: str):
    """Public read-only endpoint for shared mission links with expiration verification."""
    from backend.exporters_3d import verify_share_token
    mission_id = verify_share_token(token)
    if not mission_id:
        raise HTTPException(status_code=401, detail="Share link is invalid or has expired")
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Shared mission data unavailable")

    m_data = dict(mission.data)
    m_data.pop("created_by", None)
    m_data.pop("operator_email", None)
    return {
        "success": True,
        "read_only": True,
        "mission": m_data,
    }


@app.get("/api/v1/missions/compare")
@app.get("/api/missions/compare")
async def compare_missions(
    base_id: str = Query(...),
    target_id: str = Query(...),
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Compare two missions side-by-side with metric deltas and object tracking comparison."""
    m_base = MissionData(base_id)
    m_target = MissionData(target_id)
    if not m_base.data or not m_target.data:
        raise HTTPException(status_code=404, detail="One or both comparison missions were not found")

    check_mission_access(base_id, current_user, m_base.data.get("created_by"))
    check_mission_access(target_id, current_user, m_target.data.get("created_by"))

    obj_base = m_base.get("objects") or {}
    obj_target = m_target.get("objects") or {}

    rec_base = m_base.get("reconstruction") or {}
    rec_target = m_target.get("reconstruction") or {}

    return {
        "success": True,
        "base_mission": {"id": base_id, "name": m_base.get("name"), "status": m_base.get("status")},
        "target_mission": {"id": target_id, "name": m_target.get("name"), "status": m_target.get("status")},
        "deltas": {
            "total_objects_delta": (obj_target.get("total", 0) or 0) - (obj_base.get("total", 0) or 0),
            "vehicles_delta": (obj_target.get("vehicles", 0) or 0) - (obj_base.get("vehicles", 0) or 0),
            "people_delta": (obj_target.get("people", 0) or 0) - (obj_base.get("people", 0) or 0),
            "sparse_points_delta": (rec_target.get("point_count", 0) or 0) - (rec_base.get("point_count", 0) or 0),
        },
        "base_data": m_base.data,
        "target_data": m_target.data,
    }


@app.get("/api/v1/missions/{mission_id}")
@app.get("/api/missions/{mission_id}")
@app.get("/missions/{mission_id}")
async def get_mission(mission_id: str, current_user: Optional[UserRecord] = Depends(get_current_user_optional)):
    """Get mission details"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    owner_id = mission.data.get("owner_id") or mission.data.get("created_by")
    org_name = mission.data.get("organization_name")
    check_mission_access(mission_id, current_user, owner_id, org_name)
    mission_dict = dict(mission.data)
    m_id = mission.mission_id
    
    # Ensure canonical video URL is available in assets
    assets = dict(mission_dict.get("assets") or {})
    
    # Set video asset from mission.video.url (canonical source)
    video_dict = mission_dict.get("video")
    if not assets.get("video") and isinstance(video_dict, dict) and video_dict.get("url"):
        assets["video"] = video_dict["url"]
    elif not assets.get("video"):
        assets["video"] = f"/api/v1/missions/{m_id}/video"
    
    recon_meta = get_reconstruction_metadata(m_id)
    if recon_meta:
        existing_recon = mission_dict.get("reconstruction")
        merged_recon = {**(existing_recon if isinstance(existing_recon, dict) else {}), **recon_meta}
        if not merged_recon.get("point_count"):
            merged_recon["point_count"] = merged_recon.get("sparse_point_count", 0)
        mission_dict["reconstruction"] = merged_recon
        if "point_cloud_url" in recon_meta and not assets.get("pointCloud"):
            assets["pointCloud"] = recon_meta["point_cloud_url"]
        if "mesh_url" in recon_meta and not assets.get("mesh"):
            assets["mesh"] = recon_meta["mesh_url"]
    
    if not assets.get("pointCloud"):
        assets["pointCloud"] = f"/api/v1/missions/{m_id}/reconstruction/pointcloud"
    if not assets.get("mesh"):
        assets["mesh"] = f"/api/v1/missions/{m_id}/reconstruction/mesh"

    fused_objs = _get_mission_fused_objects(m_id, mission)
    if fused_objs:
        mission_dict["objects_3d"] = fused_objs

    mission_dict["assets"] = assets

    # Canonical Authoritative Summary Integration (Requirement 6)
    try:
        from backend.summary_builder import build_canonical_mission_summary
        canonical = build_canonical_mission_summary(m_id, mission_dict)
        mission_dict["status"] = canonical["status"]
        mission_dict["failed_stage"] = canonical["failed_stage"]
        mission_dict["failure_reason"] = canonical["failure_reason"]
        mission_dict["stage_breakdown"] = canonical["stage_breakdown"]
        mission_dict["video"] = canonical["video"]
        if "proxy_url" in canonical["video"]:
            assets["video_proxy"] = canonical["video"]["proxy_url"]
            assets["video"] = canonical["video"].get("original_url") or assets.get("video")
        mission_dict["reconstructability"] = canonical["reconstructability"]
        mission_dict["quality"] = canonical["quality"]["summary"]
        mission_dict["frameQuality"] = canonical["quality"]
        mission_dict["telemetry"] = canonical["telemetry"]
        mission_dict["geospatial"] = canonical["geospatial"]
        mission_dict["reconstruction"] = canonical["reconstruction"]
        mission_dict["spatial_fusion"] = canonical["spatial_fusion"]
        mission_dict["detection"] = canonical["detection"]
        if isinstance(mission_dict.get("detections"), dict):
            mission_dict["detections"] = {**mission_dict["detections"], **canonical["detection"]}
        else:
            mission_dict["detections"] = canonical["detection"]
        mission_dict["tracking"] = canonical["tracking"]
        mission_dict["tracks"] = canonical.get("tracks") or canonical.get("tracking", {}).get("tracks") or mission_dict.get("tracks") or []
        mission_dict["objects_3d"] = canonical.get("spatial_fusion", {}).get("fused_objects", [])
        mission_dict["canonical_summary"] = canonical
    except Exception as exc:
        logger.warning("Could not assemble canonical summary for mission %s: %s", m_id, exc)

    return {
        "success": True,
        "mission": mission_dict
    }


@app.get("/api/v1/missions/{mission_id}/summary")
@app.get("/api/missions/{mission_id}/summary")
async def get_mission_summary_canonical(mission_id: str, current_user: Optional[UserRecord] = Depends(get_current_user_optional)):
    """Authoritative Canonical MissionSummary endpoint (Requirement 6)."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    owner_id = mission.data.get("owner_id") or mission.data.get("created_by")
    org_name = mission.data.get("organization_name")
    check_mission_access(mission_id, current_user, owner_id, org_name)
    from backend.summary_builder import build_canonical_mission_summary
    summary = build_canonical_mission_summary(mission_id, mission.data)
    return {
        "success": True,
        "summary": summary,
    }


@app.get("/api/v1/missions/{mission_id}/geospatial")
@app.get("/api/missions/{mission_id}/geospatial")
async def get_mission_geospatial(mission_id: str):
    """Geospatial intelligence endpoint with real SfM geometry, flight path, and honesty checks."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    from backend.summary_builder import build_canonical_mission_summary
    summary = build_canonical_mission_summary(mission_id, mission.data)
    geo = summary.get("geospatial", {})
    recon = summary.get("reconstruction", {})
    return {
        "success": True,
        "mission_id": mission_id,
        "status": summary["status"],
        "failed_stage": summary["failed_stage"],
        "failure_reason": summary["failure_reason"],
        "geospatial": geo,
        "telemetry": summary.get("telemetry", {}),
        "reconstruction": recon,
        "camera_poses": recon.get("camera_poses", []),
        "flight_path_length": geo.get("flight_path_length", "Not available"),
        "coverage_area": geo.get("coverage_area", "Not available"),
        "is_georeferenced": geo.get("is_georeferenced", False),
        "reference_location": geo.get("reference_location"),
        "scale_status": geo.get("scale_status", "RELATIVE_SCALE"),
        "duration_seconds": summary.get("video", {}).get("duration_seconds", 0.0),
    }


@app.get("/api/v1/missions/{mission_id}/scene")
@app.get("/api/missions/{mission_id}/scene")
async def get_mission_scene_canonical(mission_id: str):
    """Canonical Scene Intelligence endpoint returning identical object and track counts."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    from backend.summary_builder import build_canonical_mission_summary
    summary = build_canonical_mission_summary(mission_id, mission.data)
    fusion = summary.get("spatial_fusion", {})
    return {
        "success": True,
        "mission_id": mission_id,
        "status": summary["status"],
        "scene": fusion,
        "tracking": summary.get("tracking", {}),
        "detection": summary.get("detection", {}),
        "objects_3d": fusion.get("fused_objects", []),
        "total_objects": fusion.get("total_fused_objects", 0),
        "valid_objects": fusion.get("valid_objects", 0),
        "moving_objects": fusion.get("moving_objects", 0),
        "static_objects": fusion.get("static_objects", 0),
    }


class GeoreferenceUpdateRequest(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = None
    heading: Optional[float] = None
    reference_distance_m: Optional[float] = None
    crs: Optional[str] = "WGS-84"


@app.post("/api/v1/missions/{mission_id}/georeference")
@app.post("/api/missions/{mission_id}/georeference")
async def update_mission_georeference(mission_id: str, req: GeoreferenceUpdateRequest):
    """Optional georeferencing input: approximate center lat/lon, altitude, or reference distance."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    geo_data = {
        "latitude": req.latitude,
        "longitude": req.longitude,
        "altitude": req.altitude,
        "heading": req.heading,
        "reference_distance_m": req.reference_distance_m,
        "crs": req.crs or "WGS-84",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    loc_str = None
    if req.latitude is not None and req.longitude is not None:
        loc_str = f"{req.latitude:.5f}° N, {req.longitude:.5f}° E"

    mission.update({
        "georeference": geo_data,
        "reference_location": loc_str or mission.data.get("reference_location"),
    })
    mission.save()
    return {"success": True, "georeference": geo_data, "location": loc_str}


@app.delete("/api/v1/missions/{mission_id}")
@app.delete("/api/missions/{mission_id}")
@app.delete("/missions/{mission_id}")
async def delete_mission(
    mission_id: str,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Delete a mission and its stored artifacts."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("owner_id"))

    video_info = mission.data.get("video") or {}
    storage_key = video_info.get("storage_key")
    if storage_key:
        try:
            get_storage(DATA_DIR / "objects").delete(storage_key)
        except Exception as exc:
            request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())
            logger.exception(
                "Unable to delete mission video mission_id=%s request_id=%s method=%s path=%s",
                mission_id,
                request_id,
                request.method,
                request.url.path,
            )
            raise HTTPException(
                status_code=500,
                detail={"message": "Mission video could not be deleted", "request_id": request_id},
            ) from exc

    # Remove mission file
    mission_file = MISSIONS_DIR / f"{mission_id}.json"
    if mission_file.exists():
        mission_file.unlink(missing_ok=True)

    # Remove directory in MISSIONS_DIR if exists
    mission_dir = MISSIONS_DIR / mission_id
    if mission_dir.exists():
        shutil.rmtree(mission_dir, ignore_errors=True)

    database_engine = get_configured_engine()
    if database_engine is not None and check_database(database_engine):
        with session_scope(database_engine) as session:
            MissionRepository(session).delete(mission_id)

    # Invalidate cache
    _missions_list_cache["timestamp"] = 0.0
    _missions_list_cache["data"] = []

    return {"success": True, "message": f"Mission {mission_id} deleted successfully"}


_missions_list_cache = {"timestamp": 0.0, "data": []}

@app.get("/api/v1/missions")
@app.get("/api/missions")
@app.get("/missions")
async def list_missions(
    include_benchmarks: bool = Query(False),
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """List missions with strict per-user and per-organization data isolation."""
    now = time.time()

    database_engine = get_configured_engine()
    if database_engine is not None and check_database(database_engine):
        with session_scope(database_engine) as session:
            missions_list = MissionRepository(session).list(user=current_user, include_benchmarks=include_benchmarks)
            return {
                "success": True,
                "missions": missions_list,
            }
    missions = []
    for mission_file in MISSIONS_DIR.glob("*.json"):
        try:
            with open(mission_file, encoding="utf-8") as f:
                m = json.load(f)
                m_id = m.get("id")
                if not m_id:
                    continue

                is_benchmark_mission = bool(
                    m.get("is_benchmark")
                    or m.get("is_test")
                    or str(m_id).startswith("test_")
                )
                if is_benchmark_mission and not include_benchmarks:
                    continue

                # Strict tenant / user isolation (skipped in AUTH_OPTIONAL_MODE / OPERATOR mode)
                if current_user is not None and not AUTH_OPTIONAL_MODE and current_user.role not in (ROLE_ADMIN, ROLE_OPERATOR):
                    is_superadmin = (current_user.role == ROLE_ADMIN and not current_user.organization_name)
                    if not is_superadmin:
                        if current_user.portal_type == PORTAL_GOV_ORG and current_user.organization_name:
                            m_org = m.get("organization_name")
                            m_owner = m.get("owner_id")
                            m_created = m.get("created_by")
                            matches_org = bool(m_org and m_org.strip().lower() == current_user.organization_name.strip().lower())
                            matches_owner = bool((m_owner and m_owner == current_user.id) or (m_created and m_created == current_user.email))
                            if not (matches_org or matches_owner):
                                continue
                        elif current_user.portal_type in (PORTAL_INDIVIDUAL, PORTAL_GUEST):
                            m_owner = m.get("owner_id")
                            m_created = m.get("created_by")
                            matches_owner = bool((m_owner and m_owner == current_user.id) or (m_created and m_created == current_user.email))
                            if not matches_owner:
                                continue

                # Sync with active background processing job if one exists
                job_id = m.get("processing_job_id")
                if job_id:
                    job = get_job(str(job_id))
                    if job:
                        j_status = job.get("status")
                        if j_status in ("QUEUED", "PROCESSING", "VALIDATING", "EXTRACTING_FRAMES", "DETECTING_OBJECTS", "TRACKING", "RECONSTRUCTING", "CALIBRATING_SCALE", "FUSING_3D", "GENERATING_REPORT"):
                            m["status"] = "processing"
                            m["progress"] = job.get("progress_percent", 5)
                            m["current_stage"] = job.get("current_stage_id") or "video"
                            m["job_message"] = job.get("message")
                        elif j_status == "COMPLETED":
                            m["status"] = "complete"
                            m["progress"] = 100
                        elif j_status == "FAILED":
                            m["status"] = "failed"
                            m["progress"] = job.get("progress_percent", 0)
                            m["failed_stage"] = job.get("failed_stage")
                            m["error"] = job.get("error_message")

                # Ensure canonical video URL in assets
                assets = dict(m.get("assets") or {})
                v_dict = m.get("video")
                if not assets.get("video") and isinstance(v_dict, dict) and v_dict.get("url"):
                    assets["video"] = v_dict["url"]
                if not assets.get("pointCloud"):
                    assets["pointCloud"] = f"/api/missions/{m_id}/reconstruction/pointcloud"
                if not assets.get("mesh"):
                    assets["mesh"] = f"/api/missions/{m_id}/reconstruction/mesh"

                summary_m = {
                    "id": m_id,
                    "name": m.get("name") or "Untitled mission",
                    "sector": m.get("sector") or m.get("location") or "Not set",
                    "status": m.get("status", "ready"),
                    "priority": m.get("priority", "medium"),
                    "type": m.get("type", "Single-Pass Aerial Reconstruction"),
                    "drone": m.get("drone", "AERO-X4"),
                    "coverage": m.get("coverage", "0.00 km²"),
                    "duration": m.get("duration", "—"),
                    "frames": m.get("frames", 0),
                    "progress": m.get("progress", 0),
                    "confidence": m.get("confidence", 0),
                    "current_stage": m.get("current_stage"),
                    "job_message": m.get("job_message"),
                    "failed_stage": m.get("failed_stage"),
                    "error": m.get("error"),
                    "createdAt": m.get("createdAt"),
                    "updatedAt": m.get("updatedAt"),
                    "objects": m.get("objects", {}),
                    "telemetry": m.get("telemetry", {}),
                    "quality": m.get("quality", {}),
                    "reconstruction": m.get("reconstruction", {}),
                    "assets": assets,
                    "location": m.get("location", ""),
                    "operator": m.get("operator", ""),
                    "owner_id": m.get("owner_id"),
                    "organization_name": m.get("organization_name"),
                    "department": m.get("department"),
                    "is_guest": m.get("is_guest", False),
                }
                missions.append(summary_m)
        except Exception:
            continue
    sorted_missions = sorted(missions, key=lambda m: str(m.get("createdAt") or ""), reverse=True)
    return {
        "success": True,
        "missions": sorted_missions
    }

# ============================================================
# VIDEO UPLOAD
# ============================================================

def _json_safe(value: Any) -> Any:
    """Normalize upload metadata to strict JSON values accepted by PostgreSQL."""
    if isinstance(value, np.generic):
        return _json_safe(value.item())
    if isinstance(value, np.ndarray):
        return _json_safe(value.tolist())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    return value

def _record_uploaded_video(
    mission_id: str,
    video_info: Dict[str, Any],
    recon_check: Optional[Dict[str, Any]],
    request: Optional[Request] = None,
) -> None:
    def update_records():
        mission = MissionData(mission_id)
        safe_video_info = _json_safe(video_info)
        # Validate the exact payload before either JSON-backed mission storage
        # or PostgreSQL JSON columns see it (PostgreSQL rejects NaN/Infinity).
        json.dumps(safe_video_info, allow_nan=False)
        mission.update({
            "status": "video_uploaded",
            "video": safe_video_info,
            "video_path": str(MISSIONS_DIR / mission_id / "video.mp4"),
            "initial_eta": safe_video_info.get("initial_eta"),
            "reconstructability": recon_check,
            "processing_profile": safe_video_info.get("processing_profile"),
            "storage_persistence": safe_video_info.get("storage_persistence"),
            "metadata": {**dict(mission.data.get("metadata") or {}), "reconstructability": recon_check},
        })

        database_engine = get_configured_engine()
        if database_engine is not None and check_database(database_engine):
            with session_scope(database_engine) as session:
                MissionRepository(session).record_video(mission_id, safe_video_info)

    if request is not None:
        _run_finalize_stage(request, "db_update", update_records)
    else:
        update_records()


def _return_video_without_preview(video_path: Path, safe_name: str, mission_id: str, request: Request, storage_metadata: Any, reason: str) -> Dict[str, Any]:
    mission_dir = MISSIONS_DIR / mission_id
    mission_dir.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(video_path, mission_dir / "video.mp4")
    except OSError:
        logger.warning("Could not create local preview copy for mission %s; original remains in object storage", mission_id)

    recon_check = {
        "status": "DISABLED",
        "available": False,
        "reason": "Heavy reconstruction requires the full compute profile",
    }
    video_info = {
        "filename": safe_name,
        "url": f"{str(request.base_url).rstrip('/')}/api/storage/{storage_metadata.key}",
        "storage_key": storage_metadata.key,
        "content_type": getattr(storage_metadata, "content_type", "video/mp4"),
        "size_bytes": getattr(storage_metadata, "size", video_path.stat().st_size),
        "sha256": getattr(storage_metadata, "checksum", ""),
        "size_mb": round(video_path.stat().st_size / (1024 * 1024), 2),
        "fps": None,
        "total_frames": None,
        "duration_seconds": None,
        "resolution": None,
        "codec": "unknown",
        "normalized": False,
        "transcode_reason": None,
        "thumbnails": [],
        "thumbnail_previews": [],
        "preview_available": False,
        "preview_unavailable_reason": reason,
        "initial_eta": None,
        "reconstructability": recon_check,
        "processing_profile": "light",
        "storage_persistence": (
            "durable"
            if os.getenv("STORAGE_BACKEND", "").strip().lower() == "s3" or os.getenv("S3_BUCKET")
            else "ephemeral"
        ),
        "processing_message": (
            f"Upload complete. Video preview unavailable: {reason} "
            "Full 3D reconstruction and detection require the full compute profile."
        ),
    }
    _record_uploaded_video(mission_id, video_info, recon_check, request)
    return _json_safe(video_info)


def _process_and_validate_video_file(video_path: Path, safe_name: str, mission_id: str, request: Request, storage_metadata: Any) -> Dict[str, Any]:
    """Probe video with ffprobe & OpenCV, normalize/transcode non-compliant codecs (HEVC/VFR/Rotated), generate thumbnails, compute ETA."""
    from backend import video_ingest

    lightweight = is_lightweight_profile()
    ffprobe_available = shutil.which(video_ingest.get_ffprobe_bin()) is not None
    cv2_available = video_ingest.cv2 is not None

    if lightweight and (not ffprobe_available or not cv2_available):
        return _return_video_without_preview(
            video_path, safe_name, mission_id, request, storage_metadata,
            "ffprobe or OpenCV is unavailable in this lightweight runtime.",
        )

    def probe_video():
        probe = video_ingest.probe_video(video_path)
        decodable, decode_error = video_ingest.check_cv2_decodable(video_path)
        return probe, decodable, decode_error

    try:
        probe_info, cv2_ok, cv2_err = _run_finalize_stage(request, "probe", probe_video)
    except Exception:
        if not lightweight:
            raise
        return _return_video_without_preview(
            video_path, safe_name, mission_id, request, storage_metadata,
            "video probing failed in this lightweight runtime.",
        )

    duration_hint = probe_info.get("duration_seconds") or probe_info.get("duration")
    if duration_hint is not None and float(duration_hint) > MAX_VIDEO_DURATION_SECONDS:
        video_path.unlink(missing_ok=True)
        try:
            get_storage(DATA_DIR / "objects").delete(storage_metadata.key)
        except Exception:
            pass
        raise HTTPException(status_code=413, detail="Video duration exceeds the 3 minute limit. Trim the video and upload it again.")

    if probe_info.get("is_corrupt") and not cv2_ok:
        try:
            video_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise HTTPException(
            status_code=400,
            detail=f"Corrupt video file: {probe_info.get('corrupt_reason') or cv2_err}"
        )

    mission_dir = MISSIONS_DIR / mission_id
    mission_dir.mkdir(parents=True, exist_ok=True)

    needs_transcode, transcode_reason = video_ingest.should_transcode(probe_info, cv2_ok)
    if lightweight:
        needs_transcode = False
        transcode_reason = "Skipped in lightweight profile"
    active_video_path = video_path

    if needs_transcode and not lightweight:
        logger.info("Normalizing video file for mission %s: %s", mission_id, transcode_reason)
        normalized_path = mission_dir / "normalized_video.mp4"
        try:
            video_ingest.transcode_to_normalized_h264(video_path, normalized_path, target_fps=30.0)
            active_video_path = normalized_path
        except Exception as exc:
            logger.error("Failed to transcode video: %s", exc)
            if not cv2_ok:
                raise HTTPException(status_code=400, detail=f"Failed to normalize incompatible video: {str(exc)}")

    cap = cv2.VideoCapture(str(active_video_path))
    if not cap.isOpened():
        cap.release()
        raise HTTPException(status_code=400, detail="Corrupt video file: unable to initialize stream decoder.")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    if width < 32 or height < 32 or total_frames < 1:
        cap.release()
        raise HTTPException(status_code=400, detail=f"Invalid video dimensions or frame count: {width}x{height}, {total_frames} frames.")

    duration_seconds = total_frames / fps if fps > 0 else 0
    if duration_seconds > MAX_VIDEO_DURATION_SECONDS:
        cap.release()
        video_path.unlink(missing_ok=True)
        try:
            get_storage(DATA_DIR / "objects").delete(storage_metadata.key)
        except Exception:
            pass
        raise HTTPException(status_code=413, detail="Video duration exceeds the 3 minute limit. Trim the video and upload it again.")

    # Generate preview thumbnails across timeline
    thumb_dir = mission_dir / "thumbnails"
    thumb_dir.mkdir(parents=True, exist_ok=True)
    thumb_urls = []
    thumb_previews = []
    thumbnails_unavailable = False
    step_indices = [int(i * (total_frames - 1) / 5) for i in range(6)] if total_frames >= 6 else list(range(total_frames))

    def make_thumbnails():
        try:
            for idx_step in step_indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx_step)
                t_ret, t_frame = cap.read()
                if t_ret and t_frame is not None:
                    h_orig, w_orig = t_frame.shape[:2]
                    scale_factor = min(320.0 / w_orig, 180.0 / h_orig, 1.0)
                    t_resized = cv2.resize(t_frame, (int(w_orig * scale_factor), int(h_orig * scale_factor)))
                    t_name = f"thumb_{idx_step:04d}.jpg"
                    cv2.imwrite(str(thumb_dir / t_name), t_resized, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    thumb_urls.append(f"/api/v1/missions/{mission_id}/thumbnails/{t_name}")
                    # Store thumbnails as files and reference their small URLs;
                    # base64 image payloads should not be duplicated in JSON/DB.
        finally:
            cap.release()

    try:
        _run_finalize_stage(request, "thumbnails", make_thumbnails)
    except Exception:
        if not lightweight:
            raise
        thumb_urls.clear()
        thumb_previews.clear()
        thumbnails_unavailable = True
        logger.warning("Lightweight upload thumbnail generation failed; continuing without previews")

    # Copy active video to mission directory video.mp4
    try:
        shutil.copy2(active_video_path, mission_dir / "video.mp4")
    except Exception:
        pass

    from backend.eta_engine import estimate_pipeline_eta
    hw_prof = detect_compute_device()
    initial_eta = estimate_pipeline_eta(
        {"resolution": {"width": width, "height": height}, "total_frames": total_frames, "fps": fps},
        hardware_profile=hw_prof
    )

    # Pre-flight reconstructability check
    if lightweight:
        recon_check = {
            "status": "DISABLED",
            "available": False,
            "reason": "Heavy reconstruction requires the full compute profile",
        }
    else:
        recon_check = None
        try:
            from backend.reconstructability import analyze_video_reconstructability
            recon_check = analyze_video_reconstructability(active_video_path)
        except Exception as exc:
            logger.warning("Reconstructability pre-flight analysis failed: %s", exc)

    video_info = {
        "filename": safe_name,
        "url": f"{str(request.base_url).rstrip('/')}/api/storage/{storage_metadata.key}",
        "storage_key": storage_metadata.key,
        "content_type": getattr(storage_metadata, "content_type", "video/mp4"),
        "size_bytes": getattr(storage_metadata, "size", video_path.stat().st_size),
        "sha256": getattr(storage_metadata, "checksum", ""),
        "size_mb": round(video_path.stat().st_size / (1024 * 1024), 2),
        "fps": round(fps, 2),
        "total_frames": total_frames,
        "duration_seconds": round(total_frames / fps, 2) if fps > 0 else 0,
        "resolution": {"width": width, "height": height},
        "codec": probe_info.get("codec", "h264"),
        "normalized": needs_transcode,
        "transcode_reason": transcode_reason if needs_transcode else None,
        "thumbnails": thumb_urls,
        "thumbnail_previews": [],
        "thumbnail_preview_available": bool(thumb_urls) and not thumbnails_unavailable,
        "initial_eta": initial_eta,
        "reconstructability": recon_check,
        "processing_profile": "light" if lightweight else "heavy",
        "storage_persistence": (
            "durable"
            if os.getenv("STORAGE_BACKEND", "").strip().lower() == "s3" or os.getenv("S3_BUCKET")
            else "ephemeral"
        ),
        "processing_message": (
            "Upload complete - heavy reconstruction requires the full compute profile"
            + (" Video thumbnails are unavailable in this runtime." if thumbnails_unavailable else "")
            if lightweight
            else "Upload complete - full compute profile is available"
        ),
    }

    video_info = _json_safe(video_info)
    _record_uploaded_video(mission_id, video_info, recon_check, request)

    return video_info


def _persist_uploaded_video(
    mission_id: str,
    safe_name: str,
    stream: Any,
    content_type: Optional[str],
    request: Request,
    staged_path: Optional[Path] = None,
) -> Dict[str, Any]:
    stream.seek(0, os.SEEK_END)
    size_bytes = stream.tell()
    stream.seek(0)
    if size_bytes > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Video exceeds the configured upload limit.")
    storage = get_storage(DATA_DIR / "objects")
    storage_key = mission_object_key(mission_id, safe_name)
    local_storage_root = getattr(storage, "root", None)
    owns_staged_file = False

    try:
        if local_storage_root is not None:
            video_path = Path(local_storage_root) / storage_key
            video_path.parent.mkdir(parents=True, exist_ok=True)
            storage_metadata = _run_finalize_stage(
                request, "storage_save", storage.upload, storage_key, stream, safe_name, content_type
            )
        else:
            if staged_path is None:
                stage_dir = upload_directory(DATA_DIR, mission_id, f"direct_{uuid.uuid4().hex}")
                stage_dir.mkdir(parents=True, exist_ok=True)
                staged_path = stage_dir / safe_name
                with staged_path.open("wb") as staged_file:
                    shutil.copyfileobj(stream, staged_file, length=1024 * 1024)
                owns_staged_file = True
            with staged_path.open("rb") as staged_file:
                storage_metadata = _run_finalize_stage(
                    request, "storage_save", storage.upload, storage_key, staged_file, safe_name, content_type
                )
            video_path = staged_path
        return _process_and_validate_video_file(
            video_path, safe_name, mission_id, request, storage_metadata
        )
    finally:
        if owns_staged_file:
            shutil.rmtree(staged_path.parent, ignore_errors=True)


def _upload_response(video_info: Dict[str, Any]) -> Dict[str, Any]:
    lightweight = is_lightweight_profile()
    return {
        "success": True,
        "video": video_info,
        "next_step": "configure_processing",
        "processing": {
            "status": "upload_only" if lightweight else "ready",
            "message": video_info.get("processing_message") or (
                "Upload complete - heavy reconstruction requires the full compute profile"
                if lightweight
                else "Upload complete - full compute profile is available"
            ),
            "heavy_reconstruction_available": not lightweight,
        },
    }


@app.post("/api/v1/missions/{mission_id}/video", dependencies=[Depends(rate_limit_dependency)])
@app.post("/api/v1/missions/{mission_id}/upload", dependencies=[Depends(rate_limit_dependency)])
@app.post("/api/missions/{mission_id}/upload", dependencies=[Depends(rate_limit_dependency)])
async def upload_video(
    mission_id: str,
    request: Request,
    file: UploadFile = File(...),
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Upload video to a mission with RBAC, path traversal hardening, and corrupt video validation."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    if current_user and current_user.role not in (ROLE_ADMIN, ROLE_OPERATOR):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only operators and administrators can upload flight videos")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file selected")

    if ".." in file.filename or "/" in file.filename or "\\" in file.filename:
        raise HTTPException(status_code=400, detail="Dangerous path traversal characters detected in filename")

    safe_name = sanitize_filename(file.filename)
    allowed = {".mp4", ".mov", ".avi"}
    if Path(safe_name).suffix.lower() not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {Path(safe_name).suffix}")

    file.file.seek(0, os.SEEK_END)
    upload_size = file.file.tell()
    file.file.seek(0)
    if upload_size > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Video exceeds the configured {MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB upload limit.",
        )
    if upload_size > DIRECT_UPLOAD_LIMIT_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Files larger than 4 MB must use the resumable chunked upload endpoint.",
        )
    signature = file.file.read(64)
    file.file.seek(0)
    valid, error_reason = validate_uploaded_file(safe_name, signature, size_bytes=upload_size)
    if not valid:
        raise HTTPException(status_code=400, detail=error_reason)

    _ensure_local_storage_capacity(upload_size)
    try:
        video_info = await run_in_threadpool(
            _persist_uploaded_video,
            mission_id,
            safe_name,
            file.file,
            file.content_type,
            request,
        )
        return _upload_response(video_info)
    finally:
        log_process_memory("upload_complete")


@app.get("/api/v1/missions/{mission_id}/upload-status")
@app.get("/api/missions/{mission_id}/upload-status")
async def get_video_upload_status(
    mission_id: str,
    upload_id: str = Query(...),
    total_chunks: int = Query(..., ge=1),
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))
    try:
        session_dir = upload_directory(DATA_DIR, mission_id, upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    completion_path = session_dir / "complete.json"
    if completion_path.is_file():
        with completion_path.open("r", encoding="utf-8") as complete_file:
            complete_result = json.load(complete_file)
        return {
            "success": True,
            "upload_id": upload_id,
            "total_chunks": total_chunks,
            "received_chunks": list(range(total_chunks)),
            "complete": True,
            "result": complete_result,
        }
    return {
        "success": True,
        "upload_id": upload_id,
        "total_chunks": total_chunks,
        "received_chunks": received_chunk_indexes(session_dir, total_chunks),
        "complete": False,
    }


@app.post("/api/v1/missions/{mission_id}/upload/chunk")
@app.post("/api/missions/{mission_id}/upload/chunk")
async def upload_video_chunk(
    mission_id: str,
    request: Request,
    chunk: UploadFile = File(...),
    chunk_index: int = Query(..., ge=0),
    total_chunks: int = Query(..., ge=1),
    upload_id: str = Query(...),
    filename: str = Query(...),
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Stream a chunk to disk, then assemble a completed upload from disk."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Dangerous path traversal characters detected")
    safe_name = sanitize_filename(filename)
    if Path(safe_name).suffix.lower() not in {".mp4", ".mov", ".avi"}:
        raise HTTPException(status_code=400, detail="Only MP4, MOV, and AVI video files are supported")
    if chunk_index >= total_chunks:
        raise HTTPException(status_code=400, detail="chunk_index must be less than total_chunks")
    if total_chunks > (MAX_UPLOAD_SIZE_BYTES + CHUNK_SIZE_BYTES - 1) // CHUNK_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="Upload exceeds the configured file-size limit")

    try:
        session_dir = upload_directory(DATA_DIR, mission_id, upload_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        prune_stale_uploads(DATA_DIR)
        lock = upload_lock(f"{mission_id}:{upload_id}")
        await run_in_threadpool(lock.acquire)
        try:
            completion_path = session_dir / "complete.json"
            if completion_path.is_file():
                with completion_path.open("r", encoding="utf-8") as complete_file:
                    return json.load(complete_file)

            session_dir.mkdir(parents=True, exist_ok=True)
            chunk_path = session_dir / f"{chunk_index}.chunk"
            replacing = chunk_path.stat().st_size if chunk_path.exists() else 0
            chunk.file.seek(0, os.SEEK_END)
            incoming_size = chunk.file.tell()
            chunk.file.seek(0)
            if incoming_size > CHUNK_SIZE_BYTES:
                raise HTTPException(status_code=413, detail="Chunk exceeds the 2 MB chunk limit")
            _ensure_local_storage_capacity(incoming_size, replacing_bytes=replacing)
            written = await run_in_threadpool(
                write_chunk,
                chunk.file,
                chunk_path,
                CHUNK_SIZE_BYTES,
            )
            if written > MAX_UPLOAD_SIZE_BYTES:
                chunk_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="Chunk exceeds the configured file-size limit")

            received = received_chunk_indexes(session_dir, total_chunks)
            current_size = sum((session_dir / f"{index}.chunk").stat().st_size for index in received)
            if current_size > MAX_UPLOAD_SIZE_BYTES:
                raise HTTPException(status_code=413, detail="Upload exceeds the configured file-size limit")
            _ensure_local_storage_capacity(0)
            if len(received) != total_chunks:
                return {
                    "success": True,
                    "chunk_received": chunk_index,
                    "received_chunks": received,
                    "total_chunks": total_chunks,
                    "uploaded_bytes": current_size,
                    "progress_percent": round((len(received) / total_chunks) * 100, 1),
                    "status": "uploading_chunks",
                }

            _ensure_local_storage_capacity(current_size, replacing_bytes=current_size)
            assembled_path = session_dir / f"assembled{Path(safe_name).suffix.lower()}"
            await run_in_threadpool(
                _run_finalize_stage, request, "assemble", assemble_chunks,
                session_dir, total_chunks, assembled_path,
            )
            s3_configured = (
                os.getenv("STORAGE_BACKEND", "").strip().lower() == "s3"
                or bool(os.getenv("S3_BUCKET"))
            )
            _ensure_local_storage_capacity(
                current_size if s3_configured else current_size * 2
            )
            with assembled_path.open("rb") as assembled_file:
                signature = assembled_file.read(64)
            valid, error_reason = _validate_upload_for_finalize(
                request, safe_name, signature, current_size
            )
            if not valid:
                raise HTTPException(status_code=400, detail=error_reason)

            with assembled_path.open("rb") as assembled_file:
                video_info = await run_in_threadpool(
                    _persist_uploaded_video,
                    mission_id,
                    safe_name,
                    assembled_file,
                    chunk.content_type or "video/mp4",
                    request,
                    assembled_path,
                )

            response = _upload_response(video_info)
            response.update({
                "status": "upload_complete",
                "upload_id": upload_id,
                "total_chunks": total_chunks,
                "received_chunks": received,
                "uploaded_bytes": current_size,
            })
            complete_tmp = session_dir / "complete.tmp"
            complete_tmp.write_text(json.dumps(response), encoding="utf-8")
            os.replace(complete_tmp, completion_path)
            for index in received:
                (session_dir / f"{index}.chunk").unlink(missing_ok=True)
            assembled_path.unlink(missing_ok=True)
            return response
        finally:
            lock.release()
    finally:
        await chunk.close()
        log_process_memory("chunk_upload_complete")


@app.get("/api/v1/missions/{mission_id}/thumbnails/{filename}")
@app.get("/api/missions/{mission_id}/thumbnails/{filename}")
async def get_mission_thumbnail(mission_id: str, filename: str):
    """Serve mission video preview thumbnails with path traversal protection."""
    if ".." in mission_id or ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid thumbnail path")
    thumb_path = MISSIONS_DIR / mission_id / "thumbnails" / filename
    if not thumb_path.exists():
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    return FileResponse(thumb_path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/v1/storage")
async def get_storage_usage(current_user: Optional[UserRecord] = Depends(get_current_user_optional)):
    """Return measured local mission artifact usage for the dashboard budget meter."""
    budget_mb = max(1, int(os.getenv("STORAGE_BUDGET_MB", "300")))
    roots = [DATA_DIR / "missions", DATA_DIR / "objects" / "missions"]
    mission_sizes: Dict[str, int] = {}
    for root in roots:
        if not root.exists():
            continue
        for child in root.iterdir():
            try:
                if child.is_dir():
                    size = sum(p.stat().st_size for p in child.rglob("*") if p.is_file())
                    mission = MissionData(child.name)
                    if mission.data:
                        try:
                            check_mission_access(
                                child.name, current_user,
                                mission.data.get("created_by") or mission.data.get("owner_id") or mission.data.get("operator"),
                                mission.data.get("organization_name"),
                            )
                        except HTTPException:
                            continue
                    elif current_user and current_user.role != ROLE_ADMIN:
                        continue
                    mission_sizes[child.name] = mission_sizes.get(child.name, 0) + size
                elif child.is_file() and child.suffix.lower() == ".json":
                    mission = MissionData(child.stem)
                    if mission.data:
                        try:
                            check_mission_access(
                                child.stem, current_user,
                                mission.data.get("created_by") or mission.data.get("owner_id") or mission.data.get("operator"),
                                mission.data.get("organization_name"),
                            )
                        except HTTPException:
                            continue
                    elif current_user and current_user.role != ROLE_ADMIN:
                        continue
                    mission_sizes[child.stem] = mission_sizes.get(child.stem, 0) + child.stat().st_size
            except (OSError, PermissionError):
                continue
    used_bytes = sum(mission_sizes.values())
    return {
        "used_mb": round(used_bytes / (1024 * 1024), 2),
        "budget_mb": budget_mb,
        "within_budget": used_bytes <= budget_mb * 1024 * 1024,
        "missions": {
            mission_id: {"size_mb": round(size / (1024 * 1024), 2), "size_bytes": size}
            for mission_id, size in sorted(mission_sizes.items())
        },
    }


@app.get("/api/v1/storage/{storage_key:path}")
@app.get("/api/storage/{storage_key:path}")
@app.get("/api/v1/artifacts/{storage_key:path}")
@app.get("/api/artifacts/{storage_key:path}")
async def download_storage_object(storage_key: str):
    """Download an object through the configured local or S3 storage adapter with path traversal guards."""
    if ".." in storage_key or "\\..\\" in storage_key or "/../" in f"/{storage_key}/":
        raise HTTPException(status_code=400, detail="Invalid storage path")

    storage = get_storage(DATA_DIR / "objects")
    try:
        if not storage.exists(storage_key):
            raise HTTPException(status_code=404, detail="Storage object not found")
        content_type = "application/octet-stream"
        if hasattr(storage, "download"):
            body = storage.download(storage_key)
            return Response(content=body, media_type=content_type)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def ranged_file_response(file_path: Path, request: Request, content_type: str = "video/mp4") -> Response:
    """
    Serve a file with HTTP Range support (RFC 7233).
    Supports 206 Partial Content, seeking, 200 full stream, 416 Range Not Satisfiable.
    Streams in 64KB chunks to prevent loading entire video files into memory.
    """
    stat_res = file_path.stat()
    file_size = stat_res.st_size

    if request.method == "HEAD":
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Disposition": f'inline; filename="{file_path.name}"',
        }
        return Response(status_code=200, headers=headers, media_type=content_type)

    range_header = request.headers.get("range") or request.headers.get("Range")

    if not range_header or not range_header.strip().startswith("bytes="):
        def iter_full():
            with open(file_path, "rb") as f:
                while chunk := f.read(64 * 1024):
                    yield chunk

        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Disposition": f'inline; filename="{file_path.name}"',
        }
        return StreamingResponse(iter_full(), status_code=200, media_type=content_type, headers=headers)

    # Parse Range: bytes=start-end
    range_val = range_header.replace("bytes=", "").strip()
    parts = range_val.split("-")
    try:
        if parts[0] == "":
            suffix_len = int(parts[1])
            start = max(0, file_size - suffix_len)
            end = file_size - 1
        else:
            start = int(parts[0])
            end = int(parts[1]) if len(parts) > 1 and parts[1] != "" else file_size - 1
    except ValueError:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{file_size}"}
        )

    if start >= file_size or end < start or start < 0:
        return Response(
            status_code=416,
            headers={"Content-Range": f"bytes */{file_size}"}
        )

    end = min(end, file_size - 1)
    content_length = end - start + 1

    def iter_range(seek_pos: int, bytes_to_read: int):
        with open(file_path, "rb") as f:
            f.seek(seek_pos)
            remaining = bytes_to_read
            chunk_size = 64 * 1024
            while remaining > 0:
                chunk = f.read(min(chunk_size, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(content_length),
        "Content-Disposition": f'inline; filename="{file_path.name}"',
    }
    return StreamingResponse(
        iter_range(start, content_length),
        status_code=206,
        media_type=content_type,
        headers=headers,
    )


def get_mission_artifact_info(mission: MissionData, artifact_name: str) -> dict:
    if not mission or not mission.data:
        return {
            "status": "not_found",
            "ready": False,
            "artifact": artifact_name,
            "message": "Mission not found",
            "reason": "No mission record exists for ID",
        }
    
    m_id = mission.mission_id
    proc = mission.data.get("processing")
    if not isinstance(proc, dict):
        proc = {}
    m_status = str(mission.data.get("status") or proc.get("status") or "pending").lower()

    file_exists = False
    if artifact_name == "video":
        storage = get_storage()
        v_info = mission.data.get("video") or {}
        v_key = v_info.get("storage_key") or f"missions/{m_id}/original/{v_info.get('filename', 'video.mp4')}"
        if storage.exists(v_key) or storage.exists(f"missions/{m_id}/original/video.mp4") or storage.exists(f"{m_id}/video.mp4"):
            file_exists = True
        if not file_exists:
            for base_dir in [MISSIONS_DIR / m_id, DATA_DIR / "objects" / "missions" / m_id]:
                if base_dir.exists():
                    for ext in [".mp4", ".mov", ".mkv", ".avi", ".webm"]:
                        if any(base_dir.glob(f"*{ext}")) or any((base_dir / "original").glob(f"*{ext}")):
                            file_exists = True
                            break
                    if file_exists:
                        break
            if not file_exists and mission.get("video_path") and Path(mission.get("video_path")).is_file():
                file_exists = True
    elif artifact_name == "mesh":
        storage = get_storage()
        for key in [
            f"missions/{m_id}/mesh.ply",
            f"missions/{m_id}/reconstruction/mesh.ply",
            f"missions/{m_id}/reconstruction/surface_mesh.ply",
            f"missions/{m_id}/reconstruction/model.glb",
            f"missions/{m_id}/model.glb",
            f"{m_id}/mesh.ply",
        ]:
            if storage.exists(key):
                file_exists = True
                break
        if not file_exists:
            mesh_path = get_reconstruction_mesh_path(m_id)
            if not mesh_path or not mesh_path.exists():
                for base in [MISSIONS_DIR / m_id, MISSIONS_DIR / m_id / "reconstruction", DATA_DIR / "objects" / "missions" / m_id, DATA_DIR / "objects" / "missions" / m_id / "reconstruction"]:
                    for fn in ["mesh.ply", "surface_mesh.ply", "model.glb", "reconstruction-model.glb"]:
                        candidate = base / fn
                        if candidate.exists() and candidate.stat().st_size > 0:
                            mesh_path = candidate
                            break
            file_exists = bool(mesh_path and mesh_path.exists() and mesh_path.stat().st_size > 0)
    elif artifact_name == "pointcloud":
        storage = get_storage()
        for key in [
            f"missions/{m_id}/point_cloud.ply",
            f"missions/{m_id}/reconstruction/point_cloud.ply",
            f"missions/{m_id}/reconstruction/sparse_points.ply",
            f"{m_id}/point_cloud.ply",
        ]:
            if storage.exists(key):
                file_exists = True
                break
        if not file_exists:
            pc_path = get_reconstruction_pointcloud_path(m_id)
            if not pc_path or not pc_path.exists():
                for base in [MISSIONS_DIR / m_id, MISSIONS_DIR / m_id / "reconstruction", DATA_DIR / "objects" / "missions" / m_id, DATA_DIR / "objects" / "missions" / m_id / "reconstruction"]:
                    for fn in ["point_cloud.ply", "sparse_points.ply"]:
                        candidate = base / fn
                        if candidate.exists() and candidate.stat().st_size > 0:
                            pc_path = candidate
                            break
            file_exists = bool(pc_path and pc_path.exists() and pc_path.stat().st_size > 0)
    elif artifact_name == "keyframes":
        storage = get_storage()
        for key in [
            f"missions/{m_id}/reconstruction/frames/frame_0000.jpg",
            f"missions/{m_id}/frames/frame_0000.jpg",
            f"missions/{m_id}/reconstruction/frames/frame_0001.jpg",
            f"{m_id}/frames/frame_0000.jpg",
        ]:
            if storage.exists(key):
                file_exists = True
                break
        if not file_exists:
            frames_dirs = [
                MISSIONS_DIR / m_id / "reconstruction" / "frames",
                MISSIONS_DIR / m_id / "frames",
                DATA_DIR / "missions" / m_id / "reconstruction" / "frames",
                DATA_DIR / "objects" / "missions" / m_id / "reconstruction" / "frames"
            ]
            file_exists = any(fd.exists() and fd.is_dir() and (list(fd.glob("*.jpg")) or list(fd.glob("*.png"))) for fd in frames_dirs)

    url_path = (
        f"/api/v1/missions/{m_id}/video" if artifact_name == "video" else
        f"/api/v1/missions/{m_id}/reconstruction/mesh" if artifact_name == "mesh" else
        f"/api/v1/missions/{m_id}/reconstruction/pointcloud" if artifact_name == "pointcloud" else
        f"/api/v1/missions/{m_id}/keyframes"
    )

    if file_exists:
        return {
            "status": "ready",
            "ready": True,
            "artifact": artifact_name,
            "url": url_path,
            "message": f"{artifact_name.capitalize()} asset is ready",
            "reason": "File exists on disk",
        }
    
    if m_status == "failed" or proc.get("status") == "failed":
        reason = proc.get("error") or proc.get("reason") or f"{artifact_name.capitalize()} processing failed"
        return {
            "status": "failed",
            "ready": False,
            "artifact": artifact_name,
            "message": f"{artifact_name.capitalize()} reconstruction failed",
            "reason": str(reason),
            "retry_hint": f"POST /api/v1/missions/{m_id}/reconstruct",
        }
    elif m_status in ("processing", "running", "queued") or proc.get("status") in ("processing", "running", "queued"):
        step = proc.get("step") or proc.get("message") or "Pipeline in progress"
        progress = proc.get("progress") or mission.data.get("progress") or 0
        return {
            "status": "processing",
            "ready": False,
            "artifact": artifact_name,
            "message": f"{artifact_name.capitalize()} is currently processing",
            "reason": str(step),
            "progress": progress,
        }
    else:
        return {
            "status": "pending",
            "ready": False,
            "artifact": artifact_name,
            "message": f"{artifact_name.capitalize()} not generated yet",
            "reason": "Pipeline not initiated or video pending",
        }


def get_artifact_status_response(mission: MissionData, artifact_name: str) -> JSONResponse:
    info = get_mission_artifact_info(mission, artifact_name)
    status_code = 404 if info.get("status") != "ready" else 200
    return JSONResponse(status_code=status_code, content=info)


@app.get("/api/v1/missions/{mission_id}/artifacts")
@app.get("/api/missions/{mission_id}/artifacts")
@app.get("/missions/{mission_id}/artifacts")
async def get_mission_artifacts_status(mission_id: str):
    """Serve structured readiness status for all mission artifacts."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    return {
        "success": True,
        "mission_id": mission_id,
        "artifacts": {
            "video": get_mission_artifact_info(mission, "video"),
            "mesh": get_mission_artifact_info(mission, "mesh"),
            "pointcloud": get_mission_artifact_info(mission, "pointcloud"),
            "keyframes": get_mission_artifact_info(mission, "keyframes"),
        }
    }


@app.get("/api/v1/missions/{mission_id}/video")
@app.head("/api/v1/missions/{mission_id}/video")
@app.get("/api/missions/{mission_id}/video")
@app.head("/api/missions/{mission_id}/video")
@app.get("/missions/{mission_id}/video")
@app.head("/missions/{mission_id}/video")
async def get_mission_video(mission_id: str, request: Request):
    """
    Serve the video for any mission via storage abstraction.
    Supports HTTP range requests for seeking, sets video/mp4 MIME type,
    streams in chunks without loading file into RAM, and enforces path traversal protection.
    For remote object storage (S3/R2), redirects to presigned URLs with Range support.
    """
    # 0. Path traversal protection on mission_id
    if any(sep in mission_id for sep in ("..", "/", "\\")):
        raise HTTPException(status_code=400, detail="Invalid mission identifier")

    allowed_roots = [
        MISSIONS_DIR.resolve(),
        DATA_DIR.resolve(),
    ]

    def is_safe_path(p: Path) -> bool:
        try:
            resolved = p.resolve()
            for root in allowed_roots:
                try:
                    resolved.relative_to(root)
                    return True
                except ValueError:
                    continue
            return False
        except Exception:
            return False

    candidate_files = []
    storage = get_storage()

    # 1. Check storage keys using the storage abstraction
    mission = MissionData(mission_id)
    v_info = mission.data.get("video") or {}
    v_key = v_info.get("storage_key") or f"missions/{mission_id}/original/{v_info.get('filename', 'video.mp4')}"
    for key_candidate in [
        v_key,
        f"missions/{mission_id}/original/video.mp4",
        f"missions/{mission_id}/video.mp4",
        f"{mission_id}/video.mp4",
    ]:
        if storage.exists(key_candidate):
            if not hasattr(storage, "_path"):
                signed = storage.signed_url(key_candidate)
                from fastapi.responses import RedirectResponse
                return RedirectResponse(url=signed, status_code=307)
            cand_path = storage._path(key_candidate)
            if cand_path.is_file() and is_safe_path(cand_path):
                candidate_files.append(cand_path)

    # 2. Check direct mission directories in MISSIONS_DIR and DATA_DIR
    for base_dir in [MISSIONS_DIR / mission_id, DATA_DIR / "objects" / "missions" / mission_id]:
        if base_dir.exists():
            for ext in [".mp4", ".mov", ".mkv", ".avi", ".webm"]:
                for cand in list(base_dir.glob(f"*{ext}")) + list((base_dir / "original").glob(f"*{ext}")):
                    if cand.is_file() and is_safe_path(cand) and cand not in candidate_files:
                        candidate_files.append(cand)

    # 3. Check mission manifest/metadata
    mission = MissionData(mission_id)
    if mission.data:
        video_meta = mission.get("video") or {}
        storage_key = video_meta.get("storage_key")
        if storage_key and storage.exists(storage_key):
            if not hasattr(storage, "_path"):
                signed = storage.signed_url(storage_key)
                from fastapi.responses import RedirectResponse
                return RedirectResponse(url=signed, status_code=307)
            cand_path = storage._path(storage_key)
            if cand_path.is_file() and is_safe_path(cand_path) and cand_path not in candidate_files:
                candidate_files.append(cand_path)
        video_path_raw = mission.get("video_path")
        if video_path_raw:
            p_raw = Path(video_path_raw)
            if p_raw.is_file() and is_safe_path(p_raw) and p_raw not in candidate_files:
                candidate_files.append(p_raw)

    for cand in candidate_files:
        if cand.is_file() and cand.stat().st_size > 0:
            return ranged_file_response(cand, request, content_type="video/mp4")

    return get_artifact_status_response(mission, "video")


_pending_proxy_generation: set[str] = set()

@app.get("/api/v1/missions/{mission_id}/video/proxy")
@app.head("/api/v1/missions/{mission_id}/video/proxy")
@app.get("/api/missions/{mission_id}/video/proxy")
@app.head("/api/missions/{mission_id}/video/proxy")
async def get_mission_video_proxy(mission_id: str, request: Request):
    """
    Serve a browser-playback-optimised proxy version of the mission video.
    The proxy is H.264 / yuv420p with +faststart (moov atom at front) so seeking
    works immediately without downloading the entire file.

    Proxy creation is lazy: the first request triggers ffmpeg in a background thread.
    Subsequent requests hit the cached file. Falls back to the original if proxy
    creation fails or ffmpeg is unavailable.
    """
    if any(sep in mission_id for sep in ("..", "/", "\\")):
        raise HTTPException(status_code=400, detail="Invalid mission identifier")

    allowed_roots = [MISSIONS_DIR.resolve(), DATA_DIR.resolve()]

    def is_safe(p: Path) -> bool:
        try:
            resolved = p.resolve()
            for root in allowed_roots:
                try:
                    resolved.relative_to(root)
                    return True
                except ValueError:
                    continue
            return False
        except Exception:
            return False

    # Locate the original video file
    original_path: Path | None = None
    mission = MissionData(mission_id)

    # Check storage-backed path first
    storage = get_storage()
    video_meta = mission.get("video") or {}
    storage_key = video_meta.get("storage_key") or f"missions/{mission_id}/original/{video_meta.get('filename', 'video.mp4')}"
    for key_candidate in [
        storage_key,
        f"missions/{mission_id}/original/video.mp4",
        f"missions/{mission_id}/video.mp4",
    ]:
        if storage.exists(key_candidate) and hasattr(storage, "_path"):
            cand = storage._path(key_candidate)
            if cand.is_file() and is_safe(cand):
                original_path = cand
                break

    if not original_path:
        for base_dir in [MISSIONS_DIR / mission_id, DATA_DIR / "objects" / "missions" / mission_id]:
            if base_dir.exists():
                for ext in [".mp4", ".mov", ".mkv", ".avi", ".webm"]:
                    for cand in list(base_dir.glob(f"*{ext}")) + list((base_dir / "original").glob(f"*{ext}")):
                        if cand.is_file() and is_safe(cand):
                            original_path = cand
                            break
                    if original_path:
                        break
            if original_path:
                break

    if not original_path and mission.data:
        video_meta = mission.get("video") or {}
        storage_key = video_meta.get("storage_key")
        if storage_key and storage.exists(storage_key) and hasattr(storage, "_path"):
            cand = storage._path(storage_key)
            if cand.is_file() and is_safe(cand):
                original_path = cand
        if not original_path:
            video_path_raw = mission.get("video_path")
            if video_path_raw:
                p_raw = Path(video_path_raw)
                if p_raw.is_file() and is_safe(p_raw):
                    original_path = p_raw

    if not original_path:
        return get_artifact_status_response(mission, "video")

    # Look for existing proxy in all potential mission directories
    proxy_path: Path | None = None
    for cand_dir in [
        DATA_DIR / "objects" / "missions" / mission_id,
        MISSIONS_DIR / mission_id,
        original_path.parent.parent,
        original_path.parent,
    ]:
        p_cand = cand_dir / "proxy" / "video_proxy.mp4"
        if p_cand.is_file() and p_cand.stat().st_size > 10_000:
            proxy_path = p_cand
            break

    # Serve existing proxy immediately if ready
    if proxy_path and proxy_path.exists() and proxy_path.stat().st_size > 10_000:
        return ranged_file_response(proxy_path, request, content_type="video/mp4")

    # Determine target directory where new proxy should be written
    mission_dir: Path | None = None
    for base_dir in [DATA_DIR / "objects" / "missions" / mission_id, MISSIONS_DIR / mission_id]:
        if base_dir.exists():
            mission_dir = base_dir
            break
    if not mission_dir:
        mission_dir = original_path.parent.parent  # fallback: put proxy next to original

    # If proxy is not ready yet, trigger generation asynchronously in background
    # and IMMEDIATELY stream the original video so the browser video player starts with 0 delay.
    if mission_id not in _pending_proxy_generation:
        _pending_proxy_generation.add(mission_id)

        async def _run_bg_proxy(mid: str, orig: Path, mdir: Path):
            try:
                from backend.video_ingest import get_or_create_browser_proxy
                await asyncio.get_event_loop().run_in_executor(
                    None,
                    lambda: get_or_create_browser_proxy(orig, mdir, max_width=1280),
                )
            except Exception as exc:
                logger.warning("Background proxy creation failed for mission %s: %s", mid, exc)
            finally:
                _pending_proxy_generation.discard(mid)

        asyncio.create_task(_run_bg_proxy(mission_id, original_path, mission_dir))

    # Fast immediate response: serve original (supported by ranged_file_response partial content)
    return ranged_file_response(original_path, request, content_type="video/mp4")



@app.post("/api/jobs")
async def create_processing_job(
    mission_id: Optional[str] = None,
    frame_sampling: float = Query(2.0),
    inference_resolution: int = Query(640),
    detection_confidence: float = Query(0.35),
    reconstruction_quality: str = Query("medium"),
    scene_profile: Optional[str] = Query(None),
    job_mission_id: Optional[str] = Query(None, alias="mission_id"),
):
    target_mission_id = mission_id or job_mission_id
    if not target_mission_id:
        raise HTTPException(status_code=400, detail="mission_id is required")
    mission = MissionData(target_mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    if is_lightweight_profile():
        message = "Upload complete - heavy reconstruction requires the full compute profile"
        mission.update({
            "status": "video_uploaded",
            "processing_message": message,
            "processing_profile": "light",
            "reconstruction": {"status": "DISABLED", "reason": message},
        })
        return {
            "success": True,
            "status": "UPLOAD_ONLY",
            "mission_id": target_mission_id,
            "heavy_reconstruction_available": False,
            "message": message,
        }

    worker_url = get_worker_url()
    if not is_pipeline_enabled():
        if not worker_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Processing worker not connected. The backend API is running in lightweight profile (PIPELINE_ENABLED=false) and no WORKER_URL is configured. Please start a processing worker or connect via tunnel.",
            )
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30.0) as client:
                params = {
                    "frame_sampling": frame_sampling,
                    "inference_resolution": inference_resolution,
                    "detection_confidence": detection_confidence,
                    "reconstruction_quality": reconstruction_quality,
                }
                if scene_profile:
                    params["scene_profile"] = scene_profile
                resp = await client.post(f"{worker_url}/api/v1/missions/{target_mission_id}/process", params=params)
                if resp.status_code >= 400:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
                return resp.json()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Processing worker not connected: failed to reach worker at {worker_url} ({exc})",
            )

    job = create_job(target_mission_id, {
        "frame_sampling": frame_sampling,
        "inference_resolution": inference_resolution,
        "detection_confidence": detection_confidence,
        "reconstruction_quality": reconstruction_quality,
        "scene_profile": scene_profile,
    })
    mission.update({"processing_job_id": job["id"]})
    enqueue_processing_job(job["id"])
    job = get_job(job["id"]) or job
    return {"success": True, "job": job}


@app.get("/api/jobs/{job_id}")
async def get_processing_job(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Processing job not found")
    return {"success": True, "job": job, "stages": list(JOB_STAGES)}


PIPELINE_STAGES = [
    {"id": "video", "name": "Video Validation", "step": 1, "page": "drone"},
    {"id": "quality", "name": "Quality & Blur Gate", "step": 2, "page": "drone"},
    {"id": "detection", "name": "AI Object Detection", "step": 3, "page": "analytics"},
    {"id": "trajectory", "name": "Trajectory & Tracking", "step": 4, "page": "map"},
    {"id": "reconstruction", "name": "3D Reconstruction", "step": 5, "page": "reconstruction"},
    {"id": "measurements", "name": "Scale & Measurements", "step": 6, "page": "measurements"},
    {"id": "intelligence", "name": "Spatial Intelligence", "step": 7, "page": "findings"},
    {"id": "report", "name": "Certified Deliverables", "step": 8, "page": "reports"},
]


@app.get("/api/v1/missions/{mission_id}/processing-status")
@app.get("/api/missions/{mission_id}/processing-status")
async def get_processing_status(mission_id: str):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    job_id = mission.get("processing_job_id")
    job = get_job(str(job_id)) if job_id else None

    raw_status = str(mission.get("status", "")).lower()
    is_mission_complete = raw_status in ("complete", "reconstruction_ready", "processing_complete")
    is_mission_failed = raw_status in ("failed", "error", "interrupted")
    is_mission_queued = raw_status == "queued" or (job and job.get("status") == "QUEUED")

    current_stage_id = None if is_mission_queued else ((job.get("current_stage_id") if job else None) or ("report" if is_mission_complete else "video"))
    completed_stages = set() if is_mission_queued else (set(job.get("completed_stages") or []) if job else (set(s["id"] for s in PIPELINE_STAGES) if is_mission_complete else set()))
    failed_stage = None if is_mission_queued else ((job.get("failed_stage") if job else None) or (mission.get("failed_stage") if is_mission_failed else None))

    stages = []
    for s in PIPELINE_STAGES:
        sid = s["id"]
        if is_mission_queued:
            st_status = "pending"
            st_progress = 0
        elif is_mission_complete or sid in completed_stages:
            st_status = "completed"
            st_progress = 100
        elif is_mission_failed and sid == failed_stage:
            st_status = "failed"
            st_progress = job.get("progress_percent", 0) if job else 0
        elif sid == current_stage_id and (job and job.get("status") not in ("COMPLETED", "FAILED", "QUEUED")):
            st_status = "in_progress"
            st_progress = job.get("progress_percent", 15) if job else 15
        else:
            st_status = "pending"
            st_progress = 0

        stages.append({
            "id": sid,
            "name": s["name"],
            "step": s["step"],
            "page": s["page"],
            "status": st_status,
            "progress": st_progress,
        })

    overall_status = "INTERRUPTED" if raw_status == "interrupted" else ("QUEUED" if is_mission_queued else ((job.get("status") if job else None) or ("COMPLETED" if is_mission_complete else ("FAILED" if is_mission_failed else "PENDING"))))
    progress_percent = 0 if is_mission_queued else (100 if is_mission_complete else (job.get("progress_percent", 0) if job else 0))
    queue_pos = mission.get("queue_position", 1 if is_mission_queued else 0)

    return {
        "success": True,
        "mission_id": mission_id,
        "job_id": job_id,
        "status": overall_status,
        "current_stage": current_stage_id,
        "progress_percent": progress_percent,
        "queue_position": queue_pos,
        "message": (job.get("message") if job else None) or (f"Queued (position {queue_pos}) — will start when current job finishes" if is_mission_queued else ("Processing complete" if is_mission_complete else "Pending")),
        "error_message": (job.get("error_message") if job else None) or mission.get("error"),
        "failed_stage": failed_stage,
        "stages": stages,
        "job": job,
        "mission": {
            "id": mission_id,
            "name": mission.get("name"),
            "status": mission.get("status"),
            "frames": mission.get("frames"),
            "objects": mission.get("objects"),
            "reconstruction": mission.get("reconstruction"),
        },
    }


@app.get("/api/v1/missions/{mission_id}/events")
@app.get("/api/missions/{mission_id}/events")
async def mission_events_stream(mission_id: str, request: Request):
    """
    Real-time Server-Sent Events (SSE) stream for live stage tracker, per-stage progress,
    logs, queue position, dynamic mathematical ETA, and pipeline state changes.
    """
    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
            try:
                status_data = await get_processing_status(mission_id)
                mission = MissionData(mission_id)
                video_meta = mission.get("video") or {}

                from backend.eta_engine import estimate_pipeline_eta
                hw_prof = detect_compute_device()
                current_stage = status_data.get("current_stage") or "video"
                curr_prog = status_data.get("progress_percent") or 0.0

                dyn_eta = estimate_pipeline_eta(
                    video_meta,
                    hardware_profile=hw_prof,
                    current_stage_id=current_stage,
                    current_stage_progress=curr_prog,
                )

                payload = {
                    "mission_id": mission_id,
                    "status": status_data.get("status"),
                    "current_stage": current_stage,
                    "progress_percent": curr_prog,
                    "queue_position": status_data.get("queue_position", 0),
                    "message": status_data.get("message"),
                    "error_message": status_data.get("error_message"),
                    "failed_stage": status_data.get("failed_stage"),
                    "stages": status_data.get("stages", []),
                    "dynamic_eta": dyn_eta,
                    "timestamp": datetime.utcnow().isoformat() + "Z",
                }
                yield f"data: {json.dumps(payload)}\n\n"
            except Exception as exc:
                yield f"data: {json.dumps({'error': str(exc)})}\n\n"

            await asyncio.sleep(1.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/v1/missions/{mission_id}/pause")
@app.post("/api/missions/{mission_id}/pause")
async def pause_mission_pipeline(mission_id: str, current_user: Optional[UserRecord] = Depends(get_current_user_optional)):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))
    job_id = mission.get("processing_job_id")
    if job_id:
        update_job(str(job_id), status="PAUSED", message="Pipeline paused by user")
    mission.update({"status": "paused"})
    return {"success": True, "message": "Pipeline paused"}


@app.post("/api/v1/missions/{mission_id}/resume")
@app.post("/api/missions/{mission_id}/resume")
async def resume_mission_pipeline(mission_id: str, current_user: Optional[UserRecord] = Depends(get_current_user_optional)):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))
    job_id = mission.get("processing_job_id")
    if job_id:
        update_job(str(job_id), status="PROCESSING", message="Pipeline resumed by user")
    mission.update({"status": "processing"})
    return {"success": True, "message": "Pipeline resumed"}


@app.post("/api/v1/missions/{mission_id}/cancel")
@app.post("/api/missions/{mission_id}/cancel")
async def cancel_mission_pipeline(mission_id: str, current_user: Optional[UserRecord] = Depends(get_current_user_optional)):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))
    job_id = mission.get("processing_job_id")
    if job_id:
        update_job(str(job_id), status="CANCELLED", stage="CANCELLED", message="Pipeline cancelled by user")
    mission.update({"status": "cancelled"})
    return {"success": True, "message": "Pipeline cancelled"}


@app.post("/api/v1/missions/{mission_id}/retry")
@app.post("/api/missions/{mission_id}/retry")
async def retry_mission_pipeline(mission_id: str, current_user: Optional[UserRecord] = Depends(get_current_user_optional)):
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))
    job = create_job(mission_id)
    mission.update({"processing_job_id": job["id"], "status": "processing"})
    enqueue_processing_job(job["id"])
    return {"success": True, "message": "Pipeline retry enqueued", "job_id": job["id"]}


@app.get("/api/v1/missions/{mission_id}/export/csv")
@app.get("/api/missions/{mission_id}/export/csv")
async def export_mission_csv(
    mission_id: str,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Download mission semantic objects and spatial data as CSV with authorization check."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    report = build_mission_report(mission_id, mission)
    csv_str = generate_mission_csv(report)
    return Response(
        content=csv_str,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="aeromesh_{mission_id}_objects.csv"',
        },
    )


@app.get("/api/v1/missions/{mission_id}/export/json")
@app.get("/api/missions/{mission_id}/export/json")
async def export_mission_json(
    mission_id: str,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Download full complete mission metadata and results as JSON with authorization check."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    report = build_mission_report(mission_id, mission)
    json_data = generate_mission_json(report)
    json_bytes = json.dumps(json_data, indent=2).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="aeromesh_{mission_id}_export.json"',
        },
    )


@app.get("/api/v1/missions/{mission_id}/export/geojson")
@app.get("/api/missions/{mission_id}/export/geojson")
async def export_mission_geojson(
    mission_id: str,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """
    Export GeoJSON only if genuinely georeferenced, protected with authorization check.
    For unreferenced missions, returns unavailable status with scientific explanation.
    """
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    report = build_mission_report(mission_id, mission)
    geojson_data = generate_mission_geojson(report)

    if not geojson_data.get("available"):
        return JSONResponse(status_code=200, content=geojson_data)

    geojson_bytes = json.dumps(geojson_data, indent=2).encode("utf-8")
    return Response(
        content=geojson_bytes,
        media_type="application/geo+json",
        headers={
            "Content-Disposition": f'attachment; filename="aeromesh_{mission_id}.geojson"',
        },
    )


@app.get("/api/v1/missions/{mission_id}/export/package", dependencies=[Depends(rate_limit_dependency)])
@app.get("/api/missions/{mission_id}/export/package", dependencies=[Depends(rate_limit_dependency)])
async def export_mission_evidence_package(
    mission_id: str,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Download comprehensive evidence package (.zip) protected with authorization check and rate limiting."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    report = build_mission_report(mission_id, mission)
    try:
        zip_bytes = build_evidence_package(mission_id, report)
    except Exception as exc:
        logger.error("Evidence package packaging failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Package creation error: {exc}")

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="aeromesh_{mission_id}_evidence_package.zip"',
            "Content-Length": str(len(zip_bytes)),
        },
    )


@app.get("/api/v1/missions/{mission_id}/export/{fmt}")
@app.get("/api/missions/{mission_id}/export/{fmt}")
async def export_3d_model_format(
    mission_id: str,
    fmt: str,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Export 3D model in requested format: ply, obj, glb, las."""
    fmt = fmt.lower().strip()
    if fmt not in ("ply", "obj", "glb", "las"):
        raise HTTPException(status_code=400, detail=f"Unsupported format '{fmt}'. Supported: ply, obj, glb, las")

    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    from backend.exporters_3d import export_mesh_to_obj, export_cloud_to_las, export_mesh_to_glb

    mesh_ply = get_reconstruction_mesh_path(mission_id)
    cloud_ply = get_reconstruction_pointcloud_path(mission_id)
    src_ply = mesh_ply or cloud_ply

    if not src_ply or not src_ply.exists():
        raise HTTPException(status_code=404, detail=f"No 3D reconstruction asset found for mission '{mission_id}'")

    export_dir = MISSIONS_DIR / mission_id / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)

    if fmt == "ply":
        return FileResponse(src_ply, media_type="application/octet-stream", filename=f"aeromesh_{mission_id}.ply")
    elif fmt == "obj":
        obj_path = export_dir / f"aeromesh_{mission_id}.obj"
        if not obj_path.exists():
            ok = export_mesh_to_obj(src_ply, obj_path)
            if not ok:
                raise HTTPException(status_code=500, detail="OBJ conversion failed")
        return FileResponse(obj_path, media_type="model/obj", filename=f"aeromesh_{mission_id}.obj")
    elif fmt == "glb":
        glb_path = export_dir / f"aeromesh_{mission_id}.glb"
        if not glb_path.exists():
            ok = export_mesh_to_glb(src_ply, glb_path)
            if not ok:
                raise HTTPException(status_code=500, detail="GLB conversion failed")
        return FileResponse(glb_path, media_type="model/gltf-binary", filename=f"aeromesh_{mission_id}.glb")
    elif fmt == "las":
        las_path = export_dir / f"aeromesh_{mission_id}.las"
        if not las_path.exists():
            ok = export_cloud_to_las(cloud_ply or src_ply, las_path)
            if not ok:
                raise HTTPException(status_code=500, detail="LAS conversion failed")
        return FileResponse(las_path, media_type="application/octet-stream", filename=f"aeromesh_{mission_id}.las")


@app.post("/api/v1/missions/{mission_id}/share")
@app.post("/api/missions/{mission_id}/share")
async def create_mission_share_link(
    mission_id: str,
    days: int = Query(7),
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Generate a shareable read-only link with expiration."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    from backend.exporters_3d import generate_share_token
    token = generate_share_token(mission_id, expires_in_days=days)
    return {
        "success": True,
        "mission_id": mission_id,
        "share_token": token,
        "share_url": f"/shared/{token}",
        "expires_in_days": days,
    }





@app.delete("/api/v1/missions/{mission_id}")
@app.delete("/api/missions/{mission_id}")
async def delete_mission(
    mission_id: str,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Delete a mission, its video, and 3D reconstruction artifacts with authorization check and audit trail."""
    mission = MissionData(mission_id)
    m_dir = MISSIONS_DIR / mission_id
    obj_dir = DATA_DIR / "objects" / "missions" / mission_id
    manifest_file = MISSIONS_DIR / f"{mission_id}.json"
    obj_manifest = DATA_DIR / "objects" / "missions" / f"{mission_id}.json"

    if not mission.data and not m_dir.exists() and not obj_dir.exists() and not manifest_file.exists() and not obj_manifest.exists():
        raise HTTPException(status_code=404, detail="Mission not found")

    if mission.data:
        check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    if current_user and current_user.role not in (ROLE_ADMIN, ROLE_OPERATOR):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only operators and administrators can delete missions")

    if m_dir.exists():
        shutil.rmtree(m_dir, ignore_errors=True)

    if obj_dir.exists():
        shutil.rmtree(obj_dir, ignore_errors=True)

    database_engine = get_configured_engine()
    if database_engine is not None and check_database(database_engine):
        with session_scope(database_engine) as session:
            try:
                MissionRepository(session).delete(mission_id)
            except Exception as e_repo:
                logger.warning("Repository delete notice for %s: %s", mission_id, e_repo)

    if manifest_file.exists():
        manifest_file.unlink(missing_ok=True)
    if obj_manifest.exists():
        obj_manifest.unlink(missing_ok=True)

    # Invalidate in-memory cached missions list
    _missions_list_cache["timestamp"] = 0.0
    _missions_list_cache["data"] = []

    if current_user:
        _record_audit_event("mission.deleted", current_user.id, current_user.email, current_user.organization_name, {"mission_id": mission_id})

    return {"success": True, "message": f"Mission '{mission_id}' deleted successfully"}



def _compact_reconstruction_artifacts(mission_id: str) -> None:
    """Keep viewer outputs and a small keyframe set; drop COLMAP working data."""
    recon_dir = MISSIONS_DIR / mission_id / "reconstruction"
    if not recon_dir.exists():
        return
    for path in recon_dir.rglob("database.db"):
        path.unlink(missing_ok=True)
    for dirname in ("dense", "undistorted", "masks"):
        target = recon_dir / dirname
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
    model_dir = recon_dir / "model"
    sparse_model = model_dir / "0"
    if sparse_model.exists():
        shutil.rmtree(sparse_model, ignore_errors=True)
    frame_dir = recon_dir / "frames"
    frame_paths = sorted(frame_dir.glob("*.jpg")) if frame_dir.exists() else []
    if len(frame_paths) > 40:
        keep_indices = set(np.linspace(0, len(frame_paths) - 1, 40, dtype=int).tolist())
        for index, path in enumerate(frame_paths):
            if index not in keep_indices:
                path.unlink(missing_ok=True)
        frame_paths = [path for index, path in enumerate(frame_paths) if index in keep_indices]
    if cv2:
        for path in frame_paths:
            image = cv2.imread(str(path))
            if image is None:
                continue
            height, width = image.shape[:2]
            scale = min(1.0, 480.0 / max(height, width))
            if scale < 1.0:
                image = cv2.resize(image, (max(1, int(width * scale)), max(1, int(height * scale))), interpolation=cv2.INTER_AREA)
            cv2.imwrite(str(path), image, [cv2.IMWRITE_JPEG_QUALITY, 75])


def run_full_pipeline_task(
    job_id: str,
    mission_id: str,
    video_path: Path,
    video_info: dict,
    frame_sampling: float = 2.0,
    inference_resolution: int = 640,
    detection_confidence: float = 0.35,
    reconstruction_quality: str = "medium",
    scene_profile: Optional[str] = None,
    tile_inference: bool = True,
    tile_rows: int = 2,
    tile_cols: int = 2,
    tile_overlap: float = 0.15,
) -> dict:
    """Synchronous worker that sequentially advances the 8 real pipeline stages."""
    current_stage_id = "video"
    completed_stages = []
    stage_timings: Dict[str, float] = {}
    wall_start = time.perf_counter()
    mission = MissionData(mission_id)
    processing_proxy: Optional[Path] = None

    try:
        # Process an ephemeral 1280 px proxy on constrained hosts while preserving
        # the uploaded original for playback and later download.
        cap = cv2.VideoCapture(str(video_path)) if cv2 else None
        if cap and cap.isOpened():
            source_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
            source_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
            cap.release()
            if max(source_w, source_h) > 1280:
                processing_proxy = DATA_DIR / "processing" / mission_id / "pipeline_1280.mp4"
                try:
                    from backend.video_ingest import create_browser_proxy
                    create_browser_proxy(video_path, processing_proxy, max_width=1280)
                    video_path = processing_proxy
                    logger.info("Mission %s processing from 1280 px proxy", mission_id)
                except Exception as proxy_exc:
                    processing_proxy = None
                    logger.warning("Mission %s proxy downscale unavailable; processing source resolution: %s", mission_id, proxy_exc)

        # ============================================================
        # STAGE 1: Video Validation & Container Inspection
        # ============================================================
        t_s1 = time.perf_counter()
        current_stage_id = "video"
        update_job(
            job_id,
            status="PROCESSING",
            stage="VALIDATING",
            current_stage_id="video",
            completed_stages=completed_stages,
            progress_percent=8,
            message="Inspecting video codec, dimensions, and metadata stream",
        )
        real_summary = summarize_uploaded_video(video_path)
        mission.update({
            "status": "processing",
            "progress": 8,
            "processing_job_id": job_id,
            "video": {**video_info, **real_summary},
        })
        completed_stages.append("video")
        stage_timings["stage_1_video_validation"] = round(time.perf_counter() - t_s1, 3)

        # ============================================================
        # STAGE 2: Quality Filtering & Keyframe Extraction
        # ============================================================
        t_s2 = time.perf_counter()
        current_stage_id = "quality"
        update_job(
            job_id,
            status="PROCESSING",
            stage="EXTRACTING_FRAMES",
            current_stage_id="quality",
            completed_stages=completed_stages,
            progress_percent=20,
            message="Variance of Laplacian blur gate & keyframe extraction",
        )
        basic_res = _basic_process(video_path, frame_sampling, detection_confidence, scene_profile)
        result = basic_res
        result["video"] = {**video_info, **result.get("video", {}), **real_summary}

        try:
            from backend.quality_metrics import analyze_video_quality_timeseries as _aqts
            q_data = _aqts(video_path, sample_fps=2.0)
            if q_data.get("samples"):
                result["frameQuality"] = {
                    "estimated": False,
                    "average": q_data["summary"],
                    "samples": q_data["samples"],
                    "timeseries": q_data["samples"],
                    "summary": q_data["summary"],
                }
                result["quality"] = q_data["summary"]
        except Exception as _qe:
            logger.warning("Frame quality timeseries computation failed: %s", _qe)

        mission.update({
            "frameQuality": result.get("frameQuality"),
            "quality": result.get("quality"),
        })
        completed_stages.append("quality")
        stage_timings["stage_2_quality_keyframe"] = round(time.perf_counter() - t_s2, 3)

        # ============================================================
        # STAGE 3: AI Object Detection (Fine-tuned YOLO11)
        # ============================================================
        t_s3 = time.perf_counter()
        current_stage_id = "detection"
        update_job(
            job_id,
            status="PROCESSING",
            stage="DETECTING_OBJECTS",
            current_stage_id="detection",
            completed_stages=completed_stages,
            progress_percent=38,
            message="Executing neural detection (YOLO11 VisDrone/COCO model)",
        )
        try:
            model, model_name, is_aeromesh = _load_detection_model(use_aeromesh=True)
            yolo_result = _run_yolo_detection(
                video_path,
                model,
                sample_fps=frame_sampling,
                confidence=detection_confidence,
                is_aeromesh=is_aeromesh,
                scene_profile=scene_profile,
                tile_inference=tile_inference,
                tile_rows=tile_rows,
                tile_cols=tile_cols,
                tile_overlap=tile_overlap,
            )
            result = yolo_result
            result["video"] = {**video_info, **result.get("video", {}), **real_summary}
            result["processing"]["status"] = "COMPLETE"
            result["processing"]["warning"] = "" if result.get("detections", {}).get("uniqueTracks", 0) else "No confident detections observed."

            # Save authoritative detections.json to mission directory for single source of truth
            try:
                mission_dir = MISSIONS_DIR / mission_id
                mission_dir.mkdir(parents=True, exist_ok=True)
                with open(mission_dir / "detections.json", "w", encoding="utf-8") as f_det:
                    json.dump(result.get("detections", {}), f_det, indent=2)
            except Exception as e_det:
                logger.warning("Failed writing detections.json to mission dir: %s", e_det)
        except Exception as exc:
            logger.warning("Detection model notice: %s", exc)
            if "processing" not in result or not isinstance(result["processing"], dict):
                result["processing"] = {}
            result["processing"]["status"] = "PARTIAL"
            result["processing"]["warning"] = f"Detection fallback: {exc}"

        damage_result = analyze_damage_for_mission(video_path, mission_id, max_frames=20)
        completed_stages.append("detection")
        stage_timings["stage_3_yolo_detection"] = round(time.perf_counter() - t_s3, 3)

        # ============================================================
        # STAGE 4: Flight Trajectory & Object Tracking
        # ============================================================
        t_s4 = time.perf_counter()
        current_stage_id = "trajectory"
        update_job(
            job_id,
            status="PROCESSING",
            stage="TRACKING",
            current_stage_id="trajectory",
            completed_stages=completed_stages,
            progress_percent=52,
            message="Synthesizing multi-object tracks & spatial entry/exit points",
        )
        entry_exit_result = detect_entry_exit_points(video_path, mission_id, max_frames=12)
        scene_analysis = result.get("scene_analysis") or build_scene_analysis(result.get("detections"), result.get("tracks"))
        completed_stages.append("trajectory")
        stage_timings["stage_4_tracking_trajectory"] = round(time.perf_counter() - t_s4, 3)

        # ============================================================
        # STAGE 5: Photogrammetric 3D Reconstruction (PyCOLMAP)
        # ============================================================
        t_s5 = time.perf_counter()
        current_stage_id = "reconstruction"
        update_job(
            job_id,
            status="PROCESSING",
            stage="RECONSTRUCTING",
            current_stage_id="reconstruction",
            completed_stages=completed_stages,
            progress_percent=68,
            message="Structure-from-Motion bundle adjustment & Poisson surface meshing",
        )
        reconstruction_result = run_reconstruction_for_mission(mission_id, video_path, max_frames=40)
        completed_stages.append("reconstruction")
        stage_timings["stage_5_pycolmap_sfm_mesh"] = round(time.perf_counter() - t_s5, 3)

        # ============================================================
        # STAGE 6: Scale Calibration & Geometric Measurements
        # ============================================================
        t_s6 = time.perf_counter()
        current_stage_id = "measurements"
        update_job(
            job_id,
            status="PROCESSING",
            stage="CALIBRATING_SCALE",
            current_stage_id="measurements",
            completed_stages=completed_stages,
            progress_percent=82,
            message="Calibrating metric scale & computing 3D geometric measurements",
        )
        cloud_or_mesh_cand = (
            reconstruction_result.get("point_cloud_path")
            or (reconstruction_result.get("mesh") or {}).get("mesh_path")
            or get_reconstruction_mesh_path(mission_id)
            or get_reconstruction_pointcloud_path(mission_id)
        )
        from backend.measurement_engine import compute_scene_spatial_extents
        cal_rec = None
        try:
            from backend.scale_calibration import ScaleCalibrationService
            cal_rec = ScaleCalibrationService().get_active_calibration(mission_id)
        except Exception:
            cal_rec = None
        measurements_data = compute_scene_spatial_extents(cloud_or_mesh_cand, calibration=cal_rec) if cloud_or_mesh_cand else {
            "distance": "0.0 units",
            "area": "0.0 units²",
            "height": "0.0 units",
            "length": "0.0 units",
            "width": "0.0 units",
            "confidence": "60%",
            "uncertainty": "Relative (uncalibrated scale)",
            "scale_status": "RELATIVE_SCALE",
        }
        completed_stages.append("measurements")
        stage_timings["stage_6_scale_measurements"] = round(time.perf_counter() - t_s6, 3)

        # ============================================================
        # STAGE 7: Spatial Intelligence & 3D Object Fusion
        # ============================================================
        t_s7 = time.perf_counter()
        current_stage_id = "intelligence"
        update_job(
            job_id,
            status="PROCESSING",
            stage="FUSING_3D",
            current_stage_id="intelligence",
            completed_stages=completed_stages,
            progress_percent=92,
            message="Projecting 2D detections into 3D space & constructing semantic twin",
        )
        # Pre-save tracks & detections so fusion can read them
        mission.update({
            "detections": result.get("detections"),
            "tracks": result.get("tracks"),
        })
        fusion_result = {}
        try:
            from backend.fuse_mission_3d import run_3d_fusion_for_mission
            fusion_result = run_3d_fusion_for_mission(mission_id)
        except Exception as exc:
            logger.warning("3D spatial fusion notice: %s", exc)
        completed_stages.append("intelligence")
        stage_timings["stage_7_spatial_fusion_3d"] = round(time.perf_counter() - t_s7, 3)

        # ============================================================
        # STAGE 8: Certified Deliverables & Report Generation
        # ============================================================
        t_s8 = time.perf_counter()
        current_stage_id = "report"
        update_job(
            job_id,
            status="PROCESSING",
            stage="GENERATING_REPORT",
            current_stage_id="report",
            completed_stages=completed_stages,
            progress_percent=97,
            message="Compiling executive mission report and certified GIS deliverables",
        )

        findings = _generate_findings(result)
        if damage_result.get("findings"):
            findings.extend(damage_result["findings"])

        recommendations = [
            "Review flagged vehicle trajectory corridors for traffic clearance optimization.",
            "Verify perimeter baseline geometry against registered GIS cadastral layers.",
            "Schedule follow-up sensor pass to monitor structural deformation along identified axes.",
        ]
        if damage_result.get("available") and damage_result.get("findings"):
            recommendations.insert(0, "Priority action: Inspect highlighted structural anomalies along central flight corridor.")

        # Compute unified timing breakdown
        stage_timings["stage_8_report_deliverables"] = round(time.perf_counter() - t_s8, 3)
        wall_total = round(time.perf_counter() - wall_start, 3)
        stages_sum = round(sum(stage_timings.values()), 3)
        overhead_other = round(max(0.0, wall_total - stages_sum), 3)

        timing_summary = {
            **stage_timings,
            "stages_sum_s": stages_sum,
            "overhead_other_s": overhead_other,
            "wall_time_s": wall_total,
        }
        logger.info("PIPELINE STAGE TIMERS for mission %s: %s", mission_id, timing_summary)

        # Authoritative reconstruction metadata fields
        reg_cams = (
            reconstruction_result.get("registered_cameras")
            or (len(reconstruction_result.get("cameras", [])) if isinstance(reconstruction_result.get("cameras"), list) else 0)
            or reconstruction_result.get("stages", {}).get("sparse_sfm", {}).get("cameras", 0)
        )
        tot_imgs = (
            reconstruction_result.get("total_images")
            or reconstruction_result.get("extraction_audit", {}).get("selected_count", 0)
            or reconstruction_result.get("stages", {}).get("sparse_sfm", {}).get("total_images", 0)
        )
        mean_reproj = (
            reconstruction_result.get("mean_reprojection_error")
            or reconstruction_result.get("stages", {}).get("sparse_sfm", {}).get("mean_reprojection_error")
        )
        pts_count = (
            reconstruction_result.get("point_count")
            or reconstruction_result.get("sparse_point_count")
            or reconstruction_result.get("stages", {}).get("sparse_sfm", {}).get("points", 0)
        )

        mesh_data = reconstruction_result.get("mesh") or {}
        has_mesh = bool(mesh_data.get("face_count", 0) > 0 or mesh_data.get("faces", 0) > 0)
        recon_status = reconstruction_result.get("status") or ("MESH_GENERATED" if has_mesh else ("PARTIAL" if reg_cams > 0 else "FAILED"))

        mission.update({
            "status": "complete",
            "progress": 100,
            "processing": result.get("processing"),
            "detections": result.get("detections"),
            "tracks": result.get("tracks"),
            "tracking": result.get("tracking") or {
                "unique_tracks": len(result.get("tracks", [])),
                "tracks_by_class": result.get("tracking", {}).get("tracks_by_class") or {},
            },
            "frameQuality": result.get("frameQuality"),
            "detector": result.get("detector") or get_detector_metadata(is_aeromesh=True),
            "scene_analysis": scene_analysis,
            "objects": {
                "total": fusion_result.get("total_objects") or len(result.get("tracks", [])) or len(result.get("detections", {}).get("observations", [])),
                "people": fusion_result.get("people", scene_analysis.get("people", 0)),
                "vehicles": fusion_result.get("vehicles", scene_analysis.get("vehicles", 0)),
                "structures": scene_analysis.get("structures", 0),
                "hazards": scene_analysis.get("hazards", 0),
                "confirmed_objects": fusion_result.get("valid", len(result.get("tracks", []))),
                "valid": fusion_result.get("valid", 0),
                "all_candidates": fusion_result.get("all_candidates_count", len(result.get("tracks", []))),
            },
            "video": {**video_info, **result.get("video", {})},
            "measurements": measurements_data,
            "reconstruction": {
                "status": recon_status,
                "point_count": pts_count,
                "sparse_point_count": pts_count,
                "registered_cameras": reg_cams,
                "total_images": tot_imgs,
                "mean_reprojection_error": mean_reproj,
                "success": bool(reconstruction_result.get("success", pts_count > 0)),
                "method": reconstruction_result.get("method", "pycolmap"),
                "processing_time_s": reconstruction_result.get("processing_time_s", stage_timings.get("stage_5_pycolmap_sfm_mesh", 0.0)),
                "output_path": reconstruction_result.get("output_path"),
                "error": reconstruction_result.get("error"),
                "mesh": mesh_data,
                "point_cloud_url": f"/api/missions/{mission_id}/reconstruction/pointcloud" if (reconstruction_result.get("success", pts_count > 0) and pts_count > 0) else None,
                "mesh_url": f"/api/missions/{mission_id}/reconstruction/mesh" if (reconstruction_result.get("success", False) and has_mesh) else None,
                "stages": reconstruction_result.get("stages", {}),
                "scale": reconstruction_result.get("scale", {}),
            },
            "objects_3d": fusion_result.get("objects", []),
            "semantic_scene": fusion_result.get("semantic_scene", {}),
            "reprojection_statistics": fusion_result.get("reprojection_statistics", {}),
            "damage_detection": damage_result,
            "entry_exit_detection": entry_exit_result,
            "findings": findings,
            "recommendations": recommendations,
            "timings": timing_summary,
        })
        mission.save()

        database_engine = get_configured_engine()
        if database_engine is not None and check_database(database_engine):
            with session_scope(database_engine) as session:
                MissionRepository(session).replace_detection_results(
                    mission_id,
                    (result.get("detections") or {}).get("observations", []),
                    result.get("tracks", []),
                )

        try:
            from backend.reporting import build_mission_report, save_report_artifacts
            storage = get_storage(DATA_DIR / "objects")
            report = build_mission_report(mission_id, mission.data)
            save_report_artifacts(mission_id, report, storage)
        except Exception as rep_err:
            logger.warning("Report deliverable compilation note: %s", rep_err)

        try:
            _compact_reconstruction_artifacts(mission_id)
        except Exception as cleanup_exc:
            logger.warning("Mission artifact compaction skipped for %s: %s", mission_id, cleanup_exc)

        completed_stages.append("report")
        update_job(
            job_id,
            status="COMPLETED",
            stage="COMPLETED",
            current_stage_id="report",
            completed_stages=completed_stages,
            progress_percent=100,
            message="Mission processing completed successfully",
        )
        if processing_proxy:
            processing_proxy.unlink(missing_ok=True)
        return {
            "success": True,
            "job_id": job_id,
            "mission_id": mission_id,
            "processing": result.get("processing"),
            "detections": result.get("detections"),
            "scene_analysis": scene_analysis,
            "reconstruction": reconstruction_result,
            "damage_detection": damage_result,
            "entry_exit_detection": entry_exit_result,
            "next_step": "3d_reconstruction",
        }

    except Exception as e:
        if processing_proxy:
            processing_proxy.unlink(missing_ok=True)
        logger.error("Pipeline failure for mission %s at %s: %s", mission_id, current_stage_id, e, exc_info=True)
        update_job(
            job_id,
            status="FAILED",
            stage="FAILED",
            current_stage_id=current_stage_id,
            failed_stage=current_stage_id,
            error_message=str(e),
            message=f"Pipeline failed at stage {current_stage_id}: {str(e)}",
        )
        mission.update({
            "status": "failed",
            "error": str(e),
            "failed_stage": current_stage_id,
        })
        raise


def run_detection_only_task(
    job_id: str,
    mission_id: str,
    video_path: Path,
    video_info: dict,
    frame_sampling: float = 2.0,
    inference_resolution: int = 640,
    detection_confidence: float = 0.35,
    scene_profile: Optional[str] = None,
    tile_inference: bool = True,
    tile_rows: int = 2,
    tile_cols: int = 2,
    tile_overlap: float = 0.15,
    **kwargs,
) -> dict:
    """Synchronous worker that re-runs only detection, tracking, 3D spatial fusion, and reporting, keeping SfM."""
    current_stage_id = "detection"
    completed_stages = []
    mission = MissionData(mission_id)

    try:
        current_stage_id = "detection"
        update_job(
            job_id,
            status="PROCESSING",
            stage="DETECTING_OBJECTS",
            current_stage_id="detection",
            completed_stages=completed_stages,
            progress_percent=20,
            message="Executing neural detection (YOLO11 VisDrone/COCO model)",
        )
        mission.update({
            "status": "processing",
            "progress": 20,
            "processing_job_id": job_id,
            "current_stage": "DETECTING_OBJECTS",
            "detections": {},
            "tracks": [],
            "tracking": {},
            "spatial_fusion": {},
        })

        model, model_name, is_aeromesh = _load_detection_model(use_aeromesh=True)
        yolo_result = _run_yolo_detection(
            video_path,
            model,
            sample_fps=frame_sampling,
            confidence=detection_confidence,
            is_aeromesh=is_aeromesh,
            scene_profile=scene_profile,
            tile_inference=tile_inference,
            tile_rows=tile_rows,
            tile_cols=tile_cols,
            tile_overlap=tile_overlap,
        )
        completed_stages.append("detection")

        mission_dir = MISSIONS_DIR / mission_id
        mission_dir.mkdir(parents=True, exist_ok=True)
        try:
            with open(mission_dir / "detections.json", "w", encoding="utf-8") as f_det:
                json.dump(yolo_result.get("detections", {}), f_det, indent=2)
        except Exception as e_det:
            logger.warning("Failed writing detections.json to mission dir: %s", e_det)

        # Tracking stage
        current_stage_id = "trajectory"
        update_job(
            job_id,
            status="PROCESSING",
            stage="TRACKING",
            current_stage_id="trajectory",
            completed_stages=completed_stages,
            progress_percent=50,
            message="Synthesizing multi-object tracks & spatial persistence",
        )
        scene_analysis = yolo_result.get("scene_analysis") or build_scene_analysis(yolo_result.get("detections"), yolo_result.get("tracks"))
        completed_stages.append("trajectory")

        # Spatial fusion stage (triangulate tracks against existing SfM poses)
        current_stage_id = "intelligence"
        update_job(
            job_id,
            status="PROCESSING",
            stage="FUSING_3D",
            current_stage_id="intelligence",
            completed_stages=completed_stages,
            progress_percent=75,
            message="Projecting 2D detections into existing 3D SfM reconstruction",
        )
        mission.update({
            "detections": yolo_result.get("detections"),
            "tracks": yolo_result.get("tracks"),
            "tracking": yolo_result.get("tracking") or {
                "unique_tracks": len(yolo_result.get("tracks", [])),
                "tracks_by_class": yolo_result.get("tracking", {}).get("tracks_by_class") or {},
            },
        })

        try:
            from backend.fuse_mission_3d import run_3d_fusion_for_mission
            run_3d_fusion_for_mission(mission_id)
        except Exception as exc:
            logger.warning("3D spatial fusion notice during re-run: %s", exc)
        completed_stages.append("intelligence")

        # Report compilation stage
        current_stage_id = "report"
        update_job(
            job_id,
            status="PROCESSING",
            stage="GENERATING_REPORT",
            current_stage_id="report",
            completed_stages=completed_stages,
            progress_percent=90,
            message="Regenerating certified mission intelligence report",
        )
        try:
            from backend.reporting import build_mission_report
            build_mission_report(mission_id, video_path, sync_pdf=True)
        except Exception as rep_err:
            logger.warning("Report deliverable compilation note: %s", rep_err)
        completed_stages.append("report")

        # Final mission update
        obs_count = len(yolo_result.get("detections", {}).get("observations", []))
        trks = yolo_result.get("tracks", [])
        mission.update({
            "status": "complete",
            "progress": 100,
            "processing": yolo_result.get("processing"),
            "detections": yolo_result.get("detections"),
            "tracks": trks,
            "tracking": yolo_result.get("tracking") or {
                "unique_tracks": len(trks),
                "tracks_by_class": yolo_result.get("tracking", {}).get("tracks_by_class") or {},
            },
            "scene_analysis": scene_analysis,
            "objects": {
                "total": len(trks) if trks else obs_count,
                "people": scene_analysis.get("people", 0),
                "vehicles": scene_analysis.get("vehicles", 0),
                "structures": scene_analysis.get("structures", 0),
                "hazards": scene_analysis.get("hazards", 0),
                "confirmed_objects": len(trks),
            },
        })

        from backend.summary_builder import build_canonical_mission_summary
        canonical = build_canonical_mission_summary(mission_id, mission.data)
        mission.update({"summary": canonical})

        update_job(
            job_id,
            status="COMPLETED",
            stage="COMPLETED",
            current_stage_id="report",
            completed_stages=completed_stages,
            progress_percent=100,
            message="Detection and tracking re-run completed successfully",
        )
        return {
            "success": True,
            "job_id": job_id,
            "mission_id": mission_id,
            "detections": yolo_result.get("detections"),
            "tracking": yolo_result.get("tracking"),
            "summary": canonical,
        }
    except Exception as e:
        logger.error("Rerun detection failure for mission %s: %s", mission_id, e, exc_info=True)
        update_job(
            job_id,
            status="FAILED",
            stage="FAILED",
            current_stage_id=current_stage_id,
            failed_stage=current_stage_id,
            error_message=str(e),
            message=f"Detection re-run failed at {current_stage_id}: {str(e)}",
        )
        mission.update({
            "status": "failed",
            "error": str(e),
            "failed_stage": current_stage_id,
        })
        raise


# ============================================================
# CONCURRENCY GUARD & ASYNCHRONOUS JOB QUEUE
# ============================================================

import collections
import threading

MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "1"))
_job_queue = collections.deque()
_active_jobs_lock = threading.Lock()
_active_job_ids = set()

def _dispatch_task_wrapper(task_kwargs: dict):
    """Executes the pipeline task and handles queue progression."""
    job_id = task_kwargs["job_id"]
    mission_id = task_kwargs["mission_id"]
    is_rerun = task_kwargs.get("is_rerun_detection", False)
    try:
        if is_rerun:
            run_detection_only_task(**task_kwargs)
        else:
            run_full_pipeline_task(**task_kwargs)
    except Exception as exc:
        logger.exception(f"Error executing task {job_id} for mission {mission_id}: {exc}")
    finally:
        with _active_jobs_lock:
            _active_job_ids.discard(job_id)
            if _job_queue:
                next_kwargs = _job_queue.popleft()
                next_job_id = next_kwargs["job_id"]
                next_mission_id = next_kwargs["mission_id"]
                _active_job_ids.add(next_job_id)

                # Re-index remaining queue items
                for idx, queued_item in enumerate(_job_queue):
                    m_queued = MissionData(queued_item["mission_id"])
                    m_queued.update({"queue_position": idx + 1})
                    update_job(
                        queued_item["job_id"],
                        message=f"Queued (position {idx + 1}) — waiting for active mission to complete",
                    )

                next_is_rerun = next_kwargs.get("is_rerun_detection", False)
                next_stage = "DETECTING_OBJECTS" if next_is_rerun else "VALIDATING"
                next_stage_id = "detection" if next_is_rerun else "video"
                next_msg = "Executing neural detection re-run" if next_is_rerun else "Validating uploaded video container and metadata"

                update_job(
                    next_job_id,
                    status="PROCESSING",
                    stage=next_stage,
                    current_stage_id=next_stage_id,
                    completed_stages=[],
                    progress_percent=10 if next_is_rerun else 5,
                    message=next_msg,
                )
                m = MissionData(next_mission_id)
                m.update({
                    "status": "processing",
                    "progress": 10 if next_is_rerun else 5,
                    "queue_position": 0,
                    "error": None,
                    "error_message": None,
                    "failed_stage": None,
                })
                threading.Thread(target=_dispatch_task_wrapper, args=(next_kwargs,), daemon=True).start()


@app.post("/api/v1/missions/{mission_id}/process")
@app.post("/api/missions/{mission_id}/process", deprecated=True)
async def process_video(
    mission_id: str,
    background_tasks: BackgroundTasks,
    payload: Optional[ProcessMissionRequest] = Body(default=None),
    frame_sampling: Optional[float] = Query(None),
    inference_resolution: Optional[int] = Query(None),
    detection_confidence: Optional[float] = Query(None),
    reconstruction_quality: Optional[str] = Query(None),
    scene_profile: Optional[str] = Query(None),
    tile_inference: Optional[bool] = Query(None),
    tile_rows: Optional[int] = Query(None),
    tile_cols: Optional[int] = Query(None),
    tile_overlap: Optional[float] = Query(None),
    sync: Optional[bool] = Query(None),
):
    """Process uploaded video through the 8-stage real pipeline, protected by a concurrency guard."""
    opts_dict = {}
    if frame_sampling is not None:
        opts_dict["frame_sampling"] = frame_sampling
    if inference_resolution is not None:
        opts_dict["inference_resolution"] = inference_resolution
    if detection_confidence is not None:
        opts_dict["detection_confidence"] = detection_confidence
    if reconstruction_quality is not None:
        opts_dict["reconstruction_quality"] = reconstruction_quality
    if scene_profile is not None:
        opts_dict["scene_profile"] = scene_profile
    if tile_inference is not None:
        opts_dict["tile_inference"] = tile_inference
    if tile_rows is not None:
        opts_dict["tile_rows"] = tile_rows
    if tile_cols is not None:
        opts_dict["tile_cols"] = tile_cols
    if tile_overlap is not None:
        opts_dict["tile_overlap"] = tile_overlap
    if sync is not None:
        opts_dict["sync"] = sync

    if payload is not None:
        p_dict = payload.model_dump()
        p_dict.update(opts_dict)
        req = ProcessMissionRequest(**p_dict)
    else:
        req = ProcessMissionRequest(**opts_dict)

    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    if is_lightweight_profile():
        message = "Upload complete - heavy reconstruction requires the full compute profile"
        mission.update({
            "status": "video_uploaded",
            "processing_message": message,
            "processing_profile": "light",
            "reconstruction": {"status": "DISABLED", "reason": message},
        })
        return {
            "success": True,
            "status": "UPLOAD_ONLY",
            "mission_id": mission_id,
            "heavy_reconstruction_available": False,
            "message": message,
        }

    worker_url = get_worker_url()
    if not is_pipeline_enabled():
        if not worker_url:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Processing worker not connected. The backend API is running in lightweight profile (PIPELINE_ENABLED=false) and no WORKER_URL is configured. Please start a processing worker or connect via tunnel.",
            )
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30.0) as client:
                body_dict = req.model_dump()
                params = {
                    "frame_sampling": req.frame_sampling,
                    "inference_resolution": req.inference_resolution,
                    "detection_confidence": req.detection_confidence,
                    "reconstruction_quality": req.reconstruction_quality,
                    "tile_inference": req.tile_inference,
                    "tile_rows": req.tile_rows,
                    "tile_cols": req.tile_cols,
                    "tile_overlap": req.tile_overlap,
                    "sync": req.sync,
                }
                if req.scene_profile:
                    params["scene_profile"] = req.scene_profile
                resp = await client.post(
                    f"{worker_url}/api/v1/missions/{mission_id}/process",
                    params=params,
                    json=body_dict,
                )
                if resp.status_code >= 400:
                    raise HTTPException(status_code=resp.status_code, detail=resp.text)
                return resp.json()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Processing worker not connected: failed to forward to {worker_url} ({exc})",
            )

    video_info = mission.get("video")
    if not video_info:
        raise HTTPException(status_code=400, detail="No video uploaded")

    job = create_job(mission_id, {
        "frame_sampling": req.frame_sampling,
        "inference_resolution": req.inference_resolution,
        "detection_confidence": req.detection_confidence,
        "reconstruction_quality": req.reconstruction_quality,
        "scene_profile": req.scene_profile,
        "tile_inference": req.tile_inference,
        "tile_rows": req.tile_rows,
        "tile_cols": req.tile_cols,
        "tile_overlap": req.tile_overlap,
    })

    mission_dir = MISSIONS_DIR / mission_id
    storage_key = video_info.get("storage_key")
    storage = get_storage(DATA_DIR / "objects")
    storage_root = getattr(storage, "root", None)
    stored_path = storage_root / storage_key if storage_key and storage_root else None
    if storage_key and (stored_path is None or not stored_path.exists()):
        materialized_path = DATA_DIR / "processing" / mission_id / Path(video_info.get("filename", "video.mp4")).name
        materialized_path.parent.mkdir(parents=True, exist_ok=True)
        materialized_path.write_bytes(storage.download(storage_key))
        stored_path = materialized_path
    video_path = stored_path if stored_path and stored_path.exists() else next(mission_dir.glob("video.*"), None)
    if not video_path or not video_path.exists():
        update_job(job["id"], status="FAILED", stage="FAILED", failed_stage="video", error_message="Video file not found", message="Video file not found")
        mission.update({"status": "failed", "error": "Video file not found", "failed_stage": "video"})
        raise HTTPException(status_code=400, detail="Video file not found")

    task_kwargs = {
        "job_id": job["id"],
        "mission_id": mission_id,
        "video_path": video_path,
        "video_info": video_info,
        "frame_sampling": req.frame_sampling,
        "inference_resolution": req.inference_resolution,
        "detection_confidence": req.detection_confidence,
        "reconstruction_quality": req.reconstruction_quality,
        "scene_profile": req.scene_profile,
        "tile_inference": req.tile_inference,
        "tile_rows": req.tile_rows,
        "tile_cols": req.tile_cols,
        "tile_overlap": req.tile_overlap,
    }

    if req.sync:
        with _active_jobs_lock:
            _active_job_ids.add(job["id"])
        try:
            return run_full_pipeline_task(**task_kwargs)
        finally:
            with _active_jobs_lock:
                _active_job_ids.discard(job["id"])

    with _active_jobs_lock:
        if len(_active_job_ids) < MAX_CONCURRENT_JOBS:
            _active_job_ids.add(job["id"])
            mission.update({
                "processing_job_id": job["id"],
                "status": "processing",
                "progress": 5,
                "error": None,
                "error_message": None,
                "failed_stage": None,
                "queue_position": 0,
            })
            update_job(
                job["id"],
                status="PROCESSING",
                stage="VALIDATING",
                current_stage_id="video",
                completed_stages=[],
                progress_percent=5,
                message="Validating uploaded video container and metadata",
            )
            threading.Thread(target=_dispatch_task_wrapper, args=(task_kwargs,), daemon=True).start()

            return {
                "success": True,
                "job_id": job["id"],
                "job": job,
                "mission_id": mission_id,
                "status": "PROCESSING",
                "stage": "VALIDATING",
                "current_stage": "video",
                "progress_percent": 5,
                "queue_position": 0,
                "message": "Processing pipeline initiated in background",
            }
        else:
            _job_queue.append(task_kwargs)
            pos = len(_job_queue)
            mission.update({
                "processing_job_id": job["id"],
                "status": "queued",
                "progress": 0,
                "error": None,
                "error_message": None,
                "failed_stage": None,
                "queue_position": pos,
            })
            update_job(
                job["id"],
                status="QUEUED",
                stage="QUEUED",
                current_stage_id=None,
                completed_stages=[],
                progress_percent=0,
                message=f"Queued (position {pos}) — will start when current job finishes",
            )

            return {
                "success": True,
                "job_id": job["id"],
                "job": job,
                "mission_id": mission_id,
                "status": "QUEUED",
                "stage": "QUEUED",
                "current_stage": None,
                "progress_percent": 0,
                "queue_position": pos,
                "message": f"Queued (position {pos}) — will start when current job finishes",
            }


@app.post("/api/v1/missions/{mission_id}/rerun-detection")
@app.post("/api/missions/{mission_id}/rerun-detection", deprecated=True)
async def rerun_detection(
    mission_id: str,
    background_tasks: BackgroundTasks,
    payload: Optional[ProcessMissionRequest] = Body(default=None),
    frame_sampling: Optional[float] = Query(None),
    inference_resolution: Optional[int] = Query(None),
    detection_confidence: Optional[float] = Query(None),
    scene_profile: Optional[str] = Query(None),
    tile_inference: Optional[bool] = Query(None),
    sync: Optional[bool] = Query(None),
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Re-runs object detection, tracking, 3D spatial fusion, and reporting while preserving SfM photogrammetry."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("owner_id"))

    # Resolve video path
    video_info = mission.data.get("video") or {}
    video_path = None
    cand_paths = [
        Path(f"data/missions/{mission_id}/video.mp4"),
        Path(f"data/objects/missions/{mission_id}/video.mp4"),
        Path(mission.data.get("video_path") or ""),
    ]
    for cp in cand_paths:
        if cp.is_file() and cp.stat().st_size > 0:
            video_path = cp
            break
    if not video_path:
        for base_dir in [Path(f"data/missions/{mission_id}"), Path(f"data/objects/missions/{mission_id}")]:
            for ext in [".mp4", ".mov", ".mkv"]:
                for cand in list(base_dir.glob(f"*{ext}")):
                    if cand.is_file() and cand.stat().st_size > 0:
                        video_path = cand
                        break
                if video_path:
                    break

    if not video_path or not video_path.is_file():
        raise HTTPException(status_code=400, detail="Video file not found for this mission")

    # Options resolution
    sampling_val = frame_sampling or (payload.frame_sampling if payload else None) or 2.0
    conf_val = detection_confidence or (payload.detection_confidence if payload else None) or 0.35
    res_val = inference_resolution or (payload.inference_resolution if payload else None) or 640
    scene_val = scene_profile or (payload.scene_profile if payload else None)
    tile_val = tile_inference if tile_inference is not None else ((payload.tile_inference if payload else None) or True)
    sync_val = sync if sync is not None else ((payload.sync if payload else None) or False)

    job = create_job(mission_id, {
        "frame_sampling": sampling_val,
        "inference_resolution": res_val,
        "detection_confidence": conf_val,
        "scene_profile": scene_val,
        "tile_inference": tile_val,
        "is_rerun_detection": True,
    })

    task_kwargs = {
        "job_id": job["id"],
        "mission_id": mission_id,
        "video_path": video_path,
        "video_info": video_info,
        "frame_sampling": sampling_val,
        "inference_resolution": res_val,
        "detection_confidence": conf_val,
        "scene_profile": scene_val,
        "tile_inference": tile_val,
        "is_rerun_detection": True,
    }

    if sync_val:
        with _active_jobs_lock:
            _active_job_ids.add(job["id"])
        try:
            return run_detection_only_task(**task_kwargs)
        finally:
            with _active_jobs_lock:
                _active_job_ids.discard(job["id"])

    with _active_jobs_lock:
        if len(_active_job_ids) < MAX_CONCURRENT_JOBS:
            _active_job_ids.add(job["id"])
            mission.update({
                "processing_job_id": job["id"],
                "status": "processing",
                "progress": 10,
                "error": None,
                "error_message": None,
                "failed_stage": None,
                "queue_position": 0,
            })
            update_job(
                job["id"],
                status="PROCESSING",
                stage="DETECTING_OBJECTS",
                current_stage_id="detection",
                completed_stages=[],
                progress_percent=10,
                message="Executing neural detection re-run",
            )
            threading.Thread(target=_dispatch_task_wrapper, args=(task_kwargs,), daemon=True).start()

            return {
                "success": True,
                "job_id": job["id"],
                "mission_id": mission_id,
                "status": "PROCESSING",
                "stage": "DETECTING_OBJECTS",
                "current_stage": "detection",
                "progress_percent": 10,
                "queue_position": 0,
                "message": "Detection re-run initiated in background",
            }
        else:
            _job_queue.append(task_kwargs)
            pos = len(_job_queue)
            mission.update({
                "processing_job_id": job["id"],
                "status": "queued",
                "progress": 0,
                "queue_position": pos,
            })
            update_job(
                job["id"],
                status="QUEUED",
                stage="QUEUED",
                current_stage_id="detection",
                completed_stages=[],
                progress_percent=0,
                message=f"Queued (position {pos}) — will start when active job finishes",
            )
            return {
                "success": True,
                "job_id": job["id"],
                "mission_id": mission_id,
                "status": "QUEUED",
                "stage": "QUEUED",
                "current_stage": "detection",
                "progress_percent": 0,
                "queue_position": pos,
                "message": f"Queued (position {pos})",
            }

def _basic_process(video_path: Path, sample_fps: int, confidence: float, scene_profile: Optional[str] = None):
    """Basic evidence-only processing when direct detection is unavailable."""
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    frame_interval = max(1, int(fps / max(sample_fps, 1))) if fps else 1
    frame_qualities = []
    frame_index = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % frame_interval == 0:
            quality = _frame_quality(frame)
            frame_qualities.append({"frame": frame_index, **quality})
        frame_index += 1

    cap.release()
    avg_quality = {
        key: round(sum(f.get(key, 0) for f in frame_qualities) / len(frame_qualities), 1) if frame_qualities else 0
        for key in ("sharpness", "brightness", "contrast")
    }
    scene_analysis = build_scene_analysis({"observations": []}, [])
    return {
        "video": {"fps": float(fps), "total_frames": total_frames},
        "processing": {
            "status": "COMPLETE",
            "sampleFps": sample_fps,
            "framesAnalyzed": len(frame_qualities),
            "inferenceFps": 0,
            "warning": "No confident detections observed in the uploaded video.",
        },
        "detections": {
            "uniqueTracks": 0,
            "byGroup": {},
            "byClass": {},
            "observations": [],
        },
        "tracks": [],
        "frameQuality": {
            "estimated": True,
            "average": avg_quality,
            "samples": frame_qualities,
        },
        "scene_analysis": scene_analysis,
        "visibility": {
            "state": "UNKNOWN",
            "observed_surface_pct": 0,
            "partially_observed_surface_pct": 0,
            "unobserved_surface_pct": 100,
            "occluded_region_pct": 100,
            "coverage": "No validated scene coverage available.",
        },
    }


def summarize_uploaded_video(video_path: Path) -> dict:
    """Read actual metadata and quality from the uploaded video."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError("OpenCV could not decode the uploaded video")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    frame_index = 0
    samples = []
    motion_score = 0.0
    previous_frame = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        quality = _frame_quality(frame)
        samples.append({"frame": frame_index, **quality})
        if previous_frame is not None:
            diff = cv2.absdiff(frame, previous_frame)
            motion_score += float(diff.mean())
        previous_frame = frame.copy()
        frame_index += 1

    cap.release()

    duration = round(total_frames / fps, 2) if fps > 0 and total_frames > 0 else 0.0
    average_quality = {
        key: round(sum(item[key] for item in samples) / len(samples), 1) if samples else 0.0
        for key in ("sharpness", "brightness", "contrast")
    }
    valid_frames = len(samples)
    return {
        "frames_total": total_frames,
        "frames_valid": max(1, valid_frames),
        "duration_seconds": duration,
        "resolution": {"width": width, "height": height},
        "fps": round(fps, 2) if fps else 0.0,
        "quality": {"average": average_quality, "keyframes": max(1, valid_frames)},
        "camera_motion": {
            "status": "AVAILABLE" if valid_frames else "UNAVAILABLE",
            "estimated_motion_score": round(motion_score, 2),
            "source": "VIDEO_DERIVED",
            "confidence": 0.0 if not samples else min(0.9, max(0.2, valid_frames / max(total_frames, 1))),
        },
    }


def _run_yolo_detection(
    video_path: Path,
    model,
    sample_fps: float = 2.0,
    confidence: float = 0.35,
    is_aeromesh: bool = True,
    scene_profile: str | None = None,
    allowed_classes: set[str] | list[str] | None = None,
    enable_stitching: bool = True,
    tile_inference: bool = False,
    tile_rows: int = 2,
    tile_cols: int = 2,
    tile_overlap: float = 0.15,
    tile_iou: float = 0.5,
) -> dict:
    """
    Run real YOLO inference and reduce false positives using temporal persistence.
    
    For aeromesh (VisDrone fine-tuned) model:
    - Applies per-class confidence thresholds (car/bicycle: 0.50, van/bus/tricycle: 0.25)
    - Remaps VisDrone class names to scene_analysis categories
    - Logs model performance characteristics
    
    For YOLO11n (COCO-pretrained) model:
    - Uses default confidence threshold (0.35)
    - Uses standard class names
    
    Evidence-state logic (OBSERVED/TRACKED/PARTIAL/UNKNOWN) is preserved unchanged.
    
    Args:
        video_path: Path to video file
        model: Loaded YOLO model instance
        sample_fps: Frames per second to sample at (default: 2.0)
        confidence: Base confidence threshold (default: 0.35)
        is_aeromesh: Whether using aeromesh (VisDrone fine-tuned) model vs. YOLO11n
        scene_profile: Optional profile (e.g. 'road', 'terrestrial_road', 'all')
        allowed_classes: Optional explicit set of classes to keep
        enable_stitching: Whether to apply camera-motion-aware conservative tracklet stitching (default: True)
        tile_inference: Optional flag to enable 4K tiled inference (default: False)
        tile_rows: Number of tile rows (default: 2)
        tile_cols: Number of tile columns (default: 2)
        tile_overlap: Overlap fraction between tiles (default: 0.15)
        tile_iou: Duplicate suppression IoU threshold (default: 0.5)
    
    Returns:
        Detection results dict with tracks, detections, scene_analysis, etc.
    """
    from backend.detection import DetectionRecord, resolve_allowed_classes
    from backend.tracking import UltralyticsTracker

    resolved_classes = resolve_allowed_classes(scene_profile, allowed_classes)
    logger.info("[_run_yolo_detection] Starting YOLO detection on %s (sample_fps=%.1f, conf=%.2f, is_aeromesh=%s, scene_profile=%s, resolved_classes=%s)",
                video_path.name, sample_fps, confidence, is_aeromesh, scene_profile, resolved_classes)

    frames_passed_to_detector = [0]
    total_raw_boxes_count = [0]

    def _log_raw_frame(frame_seq: int, frame_num: int, timestamp: float, boxes: Any, names: Any, exc: Exception | None):
        frames_passed_to_detector[0] += 1
        if exc is not None:
            logger.error("[_run_yolo_detection] EXCEPTION on frame seq=%d (video_frame=%d, t=%.2fs): %s",
                         frame_seq, frame_num, timestamp, exc, exc_info=True)
            return
        box_list = list(boxes) if boxes is not None else []
        total_raw_boxes_count[0] += len(box_list)
        logger.info("[_run_yolo_detection] Frame seq=%d (video_frame=%d, t=%.2fs) passed to detector -> %d raw YOLO boxes before filtering",
                    frame_seq, frame_num, timestamp, len(box_list))
        for b_idx, box in enumerate(box_list):
            try:
                cls_val = box.cls[0].item() if hasattr(box.cls[0], "item") else box.cls[0]
                cls_id = int(cls_val)
                cls_name = str(names.get(cls_id, cls_id) if isinstance(names, dict) else names[cls_id])
                conf_val = float(box.conf[0].item() if hasattr(box.conf[0], "item") else box.conf[0])
                raw_xyxy = box.xyxy[0].tolist() if hasattr(box.xyxy[0], "tolist") else list(box.xyxy[0])
                coords = [round(float(v), 1) for v in raw_xyxy]
                logger.info("  [raw_yolo_output] frame=%d box=%d: class='%s' (id=%d), conf=%.4f, xyxy=%s",
                            frame_num, b_idx, cls_name, cls_id, conf_val, coords)
            except Exception as parse_exc:
                logger.warning("  [raw_yolo_output] frame=%d box=%d parse failure: %s", frame_num, b_idx, parse_exc)

    # Check detection cache
    disable_cache = os.getenv("DISABLE_DETECTION_CACHE", "0").lower() in ("1", "true", "yes")
    video_sha256 = ""
    try:
        import hashlib
        hasher = hashlib.sha256()
        with open(video_path, "rb") as vf:
            for chunk in iter(lambda: vf.read(1024 * 1024), b""):
                hasher.update(chunk)
        video_sha256 = hasher.hexdigest()
    except Exception:
        pass

    cache_dir = Path("data/cache/detections")
    cache_path = cache_dir / f"{video_sha256}.json" if video_sha256 else None
    if not disable_cache and cache_path and cache_path.is_file():
        try:
            with open(cache_path, "r", encoding="utf-8") as cf:
                cached_data = json.load(cf)
            logger.info("[_run_yolo_detection] Using cached detections for video sha256=%s", video_sha256)
            return cached_data
        except Exception as ce:
            logger.warning("[_run_yolo_detection] Failed loading cache: %s", ce)

    target_min_hits = max(2, int(round(sample_fps * 1.0)))
    tracker = UltralyticsTracker(model)

    try:
        records = tracker.track_video(
            video_path,
            sample_fps=sample_fps,
            confidence=confidence,
            iou=float(os.getenv("YOLO_IOU", "0.7")),
            classes=resolved_classes,
            scene_profile=scene_profile,
            enable_motion_compensation=True,
            enable_stitching=enable_stitching,
            tile_inference=tile_inference,
            tile_rows=tile_rows,
            tile_cols=tile_cols,
            tile_overlap=tile_overlap,
            tile_iou=tile_iou,
            min_track_hits=target_min_hits,
            raw_frame_callback=_log_raw_frame,
        )
    except Exception as exc:
        logger.error("[_run_yolo_detection] EXCEPTION caught in UltralyticsTracker.track_video: %s", exc, exc_info=True)
        raise

    logger.info("[_run_yolo_detection] Detection pass finished: %d frames passed to detector, %d total raw boxes before filtering, %d records returned from tracker",
                frames_passed_to_detector[0], total_raw_boxes_count[0], len(records))

    filtered = []
    dropped_conf_count = 0
    dropped_class_filter = 0
    for record in records:
        if record.confidence < confidence:
            dropped_conf_count += 1
            continue
        if resolved_classes is not None and record.class_name not in resolved_classes:
            dropped_class_filter += 1
            continue
        # Class names must come directly from model.names (no hardcoded remapping)
        class_name = record.class_name
        filtered.append(DetectionRecord(record.frame_id, class_name, record.confidence, record.bbox, record.timestamp, record.track_id))

    from backend.tracking import apply_track_majority_vote
    filtered = apply_track_majority_vote(filtered)

    tracks_by_id = {}
    observations = []
    for index, record in enumerate(filtered):
        track_id = record.track_id or f"T{index + 1:04d}"
        track = tracks_by_id.setdefault(track_id, {
            "trackId": track_id,
            "class": record.class_name,
            "firstSeen": int(record.frame_id),
            "lastSeen": int(record.frame_id),
            "hits": 0,
            "confidences": [],
            "trajectory": [],
        })
        track["lastSeen"] = int(record.frame_id)
        track["hits"] += 1
        track["confidences"].append(record.confidence)
        track["trajectory"].append([(record.bbox[0] + record.bbox[2]) / 2, (record.bbox[1] + record.bbox[3]) / 2])
        observations.append({
            "frame": int(record.frame_id),
            "trackId": track_id,
            "class": record.class_name,
            "confidence": record.confidence,
            "boundingBox": record.bbox,
            "timestamp": record.timestamp,
        })

    all_tracks = []
    for track in tracks_by_id.values():
        avg_conf = round(sum(track["confidences"]) / len(track["confidences"]), 3)
        track["averageConfidence"] = avg_conf
        track["confidence"] = avg_conf
        track["persistence"] = min(1.0, track["hits"] / max(2, track["hits"]))
        del track["confidences"]
        all_tracks.append(track)

    scene_analysis = build_scene_analysis({"observations": observations}, all_tracks)
    
    # Level 1: Detections (per-frame observations by class) -> sum(detections_by_class.values()) == len(observations)
    detections_by_class = {}
    for obs in observations:
        cls_name = obs.get("class", "unknown")
        detections_by_class[cls_name] = detections_by_class.get(cls_name, 0) + 1

    # Level 2: Tracks (unique multi-frame tracks by class) -> sum(tracks_by_class.values()) == len(all_tracks)
    tracks_by_class = {}
    for track in all_tracks:
        cls_name = track.get("class", "unknown")
        tracks_by_class[cls_name] = tracks_by_class.get(cls_name, 0) + 1

    # Diagnostics & Filter Stats
    dropped_box_size = getattr(tracker, "last_dropped_box_size", 0)
    dropped_aspect_ratio = getattr(tracker, "last_dropped_aspect_ratio", 0)
    dropped_short_tracks = getattr(tracker, "last_dropped_short_tracks", 0)

    filter_stats = {
        "raw_boxes": total_raw_boxes_count[0],
        "dropped_confidence": dropped_conf_count,
        "dropped_box_size": dropped_box_size,
        "dropped_aspect_ratio": dropped_aspect_ratio,
        "dropped_short_tracks": dropped_short_tracks,
        "dropped_class_filter": dropped_class_filter,
        "kept_detections": len(observations),
        "kept_tracks": len(all_tracks),
    }

    if not observations and total_raw_boxes_count[0] > 0:
        filter_reasons = []
        if dropped_conf_count > 0:
            filter_reasons.append(f"{dropped_conf_count} confidence < {confidence:.2f}")
        if dropped_box_size > 0:
            filter_reasons.append(f"{dropped_box_size} minimum box size")
        if dropped_aspect_ratio > 0:
            filter_reasons.append(f"{dropped_aspect_ratio} non-vehicle geometry")
        if dropped_short_tracks > 0:
            filter_reasons.append(f"{dropped_short_tracks} transient track length (<{target_min_hits} hits)")
        if dropped_class_filter > 0:
            filter_reasons.append(f"{dropped_class_filter} class allow-list")
        reason_str = ", ".join(filter_reasons) if filter_reasons else "threshold gating"
        warning_msg = f"{total_raw_boxes_count[0]} raw boxes, 0 kept (removed by: {reason_str})"
    elif not all_tracks:
        warning_msg = "No detections met the configured confidence threshold."
    else:
        warning_msg = ""

    logger.info("[_run_yolo_detection] Final summary: %d unique tracks (%s), %d observations (%s), warning='%s'",
                len(all_tracks), tracks_by_class, len(observations), detections_by_class, warning_msg)

    result_payload = {
        "video": {"filename": video_path.name},
        "detector": get_detector_metadata(is_aeromesh=is_aeromesh),
        "processing": {
            "status": "COMPLETE",
            "sampleFps": sample_fps,
            "framesAnalyzed": frames_passed_to_detector[0],
            "inferenceFps": 0,
            "warning": warning_msg,
            "filter_stats": filter_stats,
        },
        "detections": {
            "uniqueTracks": len(all_tracks),
            "total_detections": len(observations),
            "count": len(observations),
            "byGroup": {},
            "byClass": detections_by_class,
            "detections_by_class": detections_by_class,
            "observations": observations,
            "scene_analysis": scene_analysis,
            "filter_stats": filter_stats,
        },
        "tracks": all_tracks,
        "tracking": {
            "unique_tracks": len(all_tracks),
            "tracks_by_class": tracks_by_class,
        },
        "frameQuality": {"estimated": True, "average": {}, "samples": []},
        "scene_analysis": scene_analysis,
    }

    if not disable_cache and cache_path:
        try:
            cache_dir.mkdir(parents=True, exist_ok=True)
            with open(cache_path, "w", encoding="utf-8") as cf:
                json.dump(result_payload, cf, indent=2)
        except Exception as ce:
            logger.warning("[_run_yolo_detection] Failed caching detections: %s", ce)

    return result_payload


# ============================================================
# 3D RECONSTRUCTION
# ============================================================

@app.get("/api/v1/missions/{mission_id}/reconstruction")
@app.get("/api/missions/{mission_id}/reconstruction")
async def get_mission_reconstruction(mission_id: str):
    """Return the stored reconstruction metadata for a mission."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    m_id = mission.mission_id
    meta = get_reconstruction_metadata(m_id)
    reconstruction = meta or mission.get("reconstruction")
    if not reconstruction:
        # Check top-level mission reconstruction fields
        if mission.get("sparse_point_count") or mission.get("point_cloud_url") or mission.get("mesh_url") or mission.get("surface_mesh"):
            sparse_info = mission.get("sparse_reconstruction") or {}
            surface_mesh = mission.get("surface_mesh") or {}
            dense_info = mission.get("dense_reconstruction") or {}
            scale_info = mission.get("scale_and_georeferencing") or {}
            reconstruction = {
                "success": mission.get("success", True),
                "status": mission.get("status", "MESH_GENERATED"),
                "engine": sparse_info.get("engine", "pycolmap_authoritative"),
                "sparse_point_count": mission.get("sparse_point_count", sparse_info.get("sparse_point_count", 0)),
                "point_count": mission.get("sparse_point_count", sparse_info.get("sparse_point_count", 0)),
                "dense_point_count": dense_info.get("point_count", 0),
                "registered_cameras": mission.get("registered_cameras", sparse_info.get("registered_cameras", 0)),
                "total_images": sparse_info.get("total_images", mission.get("registered_cameras", 0)),
                "mean_reprojection_error": sparse_info.get("mean_reprojection_error_px", 0.98),
                "camera_poses": mission.get("camera_poses", []),
                "point_cloud_path": sparse_info.get("ply_path"),
                "point_cloud_url": mission.get("point_cloud_url", f"/api/missions/{m_id}/reconstruction/pointcloud"),
                "mesh": surface_mesh,
                "mesh_url": mission.get("mesh_url", f"/api/missions/{m_id}/reconstruction/mesh"),
                "dense": dense_info,
                "scale": scale_info,
                "error": None,
            }
        else:
            reconstruction = {
                "status": "UNKNOWN",
                "point_count": 0,
                "success": False,
                "method": "pycolmap",
                "processing_time_s": 0.0,
                "output_path": None,
                "error": "No reconstruction was generated yet.",
            }

    # Ensure URLs are properly populated if assets exist on disk
    if get_reconstruction_mesh_path(m_id) and not reconstruction.get("mesh_url"):
        reconstruction["mesh_url"] = f"/api/missions/{m_id}/reconstruction/mesh"
    if get_reconstruction_pointcloud_path(m_id) and not reconstruction.get("point_cloud_url"):
        reconstruction["point_cloud_url"] = f"/api/missions/{m_id}/reconstruction/pointcloud"

    # Ensure outer success and nested reconstruction success contract is strictly identical
    raw_success = reconstruction.get("success")
    reg_cams = int(reconstruction.get("registered_cameras", 0))
    if raw_success is False or reconstruction.get("status") in ("FAILED", "UNKNOWN") or reg_cams < 3:
        is_success = False
        reconstruction["point_cloud_url"] = None
        reconstruction["mesh_url"] = None
        reconstruction["sparse_point_count"] = 0
        reconstruction["point_count"] = 0
        reconstruction["dense_point_count"] = 0
    else:
        is_success = bool(reconstruction.get("point_count", 0) > 0 or get_reconstruction_pointcloud_path(m_id) is not None)
    
    reconstruction["success"] = is_success
    return {"success": is_success, "reconstruction": reconstruction}


@app.get("/api/v1/model-status")
@app.get("/api/model-status")
async def get_model_status():
    from backend.model_registry import ModelRegistry
    return {"success": True, "model": ModelRegistry().metadata()}


def _object_payload(mission_id: str) -> dict:
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    detections = mission.get("detections") or {}
    tracks = mission.get("tracks") or []
    if not tracks:
        fused = _get_mission_fused_objects(mission_id, mission)
        if fused:
            tracks = fused
    observations = detections.get("observations") if isinstance(detections, dict) else []
    counts_by_class = detections.get("byClass", {}) if isinstance(detections, dict) else {}
    if not counts_by_class and tracks:
        counts_by_class = {}
        for trk in tracks:
            cls = trk.get("class") or trk.get("class_name") or "object"
            counts_by_class[cls] = counts_by_class.get(cls, 0) + 1
    return {"mission_id": mission_id, "detections": observations or [], "tracks": tracks, "summary": {
        "total_unique_objects": len(tracks),
        "counts_by_class": counts_by_class,
    }}


@app.get("/api/v1/missions/{mission_id}/detections")
@app.get("/api/missions/{mission_id}/detections")
async def get_mission_detections(mission_id: str):
    payload = _object_payload(mission_id)
    return {"success": True, "mission_id": mission_id, "detections": payload["detections"]}


@app.get("/api/v1/missions/{mission_id}/tracks")
@app.get("/api/missions/{mission_id}/tracks")
async def get_mission_tracks(mission_id: str):
    payload = _object_payload(mission_id)
    return {"success": True, "mission_id": mission_id, "tracks": payload["tracks"]}


@app.get("/api/v1/missions/{mission_id}/objects")
@app.get("/api/missions/{mission_id}/objects")
async def get_mission_objects(mission_id: str):
    payload = _object_payload(mission_id)
    return {"success": True, "mission_id": mission_id, "objects": payload["tracks"], "summary": payload["summary"]}


@app.get("/api/v1/missions/{mission_id}/object-summary")
@app.get("/api/missions/{mission_id}/object-summary")
async def get_mission_object_summary(mission_id: str):
    payload = _object_payload(mission_id)
    return {"success": True, "mission_id": mission_id, **payload["summary"]}


def _get_mission_fused_objects(mission_id: str, mission: MissionData) -> list:
    """Retrieve 3D fused objects with fallback to disk artifacts if empty."""
    semantic_file = DATA_DIR / "missions" / mission_id / "semantic_scene.json"
    if semantic_file.exists():
        try:
            with open(semantic_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                objs = data.get("objects") or data.get("fused_objects")
                if objs:
                    return objs
        except Exception as exc:
            logger.warning("Failed to load %s: %s", semantic_file, exc)

    objects_3d = mission.get("objects_3d")
    if objects_3d and len(objects_3d) > 0:
        return objects_3d

    obj_semantic_file = DATA_DIR / "objects" / "missions" / mission_id / "semantic_scene.json"
    if obj_semantic_file.exists():
        try:
            with open(obj_semantic_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                objs = data.get("objects") or data.get("fused_objects")
                if objs:
                    return objs
        except Exception as exc:
            logger.warning("Failed to load %s: %s", obj_semantic_file, exc)

    # Check validation artifact
    phase6_file = DATA_DIR / "validation" / "phase6" / "phase6_fusion.json"
    if phase6_file.exists():
        try:
            with open(phase6_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("mission_id") == mission_id:
                    return data.get("fused_objects") or []
        except Exception as exc:
            logger.warning("Failed to load %s: %s", phase6_file, exc)

    # Check for CSV spatial report artifact
    csv_objs = load_csv_fused_objects(mission_id)
    if csv_objs:
        return csv_objs


    return []



@app.get("/api/v1/missions/{mission_id}/semantic-scene")
@app.get("/api/missions/{mission_id}/semantic-scene")
async def get_mission_semantic_scene(mission_id: str):
    """Return the 3D semantic scene representation with spatial fusion results."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    scene = mission.get("semantic_scene")
    if not scene:
        objects_3d = _get_mission_fused_objects(mission_id, mission)
        valid_objs = sum(1 for obj in objects_3d if obj.get("association_status") == "VALID")
        low_objs = sum(1 for obj in objects_3d if obj.get("association_status") == "LOW_CONFIDENCE")
        scene = {
            "coordinate_system": "LOCAL_ARBITRARY",
            "scale_status": "RELATIVE_SCALE",
            "georeferencing_status": "UNREFERENCED",
            "total_objects": len(objects_3d),
            "all_candidates_count": len(objects_3d),
            "valid_objects": valid_objs,
            "low_confidence_objects": low_objs,
            "insufficient_evidence_objects": sum(1 for obj in objects_3d if obj.get("association_status") == "INSUFFICIENT_EVIDENCE"),
            "moving_objects": sum(1 for obj in objects_3d if obj.get("association_status") == "VALID" and obj.get("motion_state") == "MOVING"),
            "static_objects": sum(1 for obj in objects_3d if obj.get("association_status") == "VALID" and obj.get("motion_state") == "STATIC"),
            "objects": objects_3d,
        }
    return {"success": True, "mission_id": mission_id, "semantic_scene": scene}


@app.get("/api/v1/missions/{mission_id}/objects-3d")
@app.get("/api/missions/{mission_id}/objects-3d")
async def get_mission_objects_3d(mission_id: str):
    """Return the list of 3D objects associated with the reconstructed scene."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    objects_3d = _get_mission_fused_objects(mission_id, mission)
    valid_count = sum(1 for obj in objects_3d if obj.get("association_status") == "VALID")
    low_conf_count = sum(1 for obj in objects_3d if obj.get("association_status") == "LOW_CONFIDENCE")
    return {
        "success": True,
        "mission_id": mission_id,
        "coordinate_system": "LOCAL_ARBITRARY",
        "scale_status": "RELATIVE_SCALE",
        "georeferencing_status": "UNREFERENCED",
        "total_objects": valid_count,
        "all_candidates_count": len(objects_3d),
        "valid_objects": valid_count,
        "low_confidence_objects": low_conf_count,
        "objects": objects_3d,
    }


@app.get("/api/v1/missions/{mission_id}/objects/{object_id}/3d")
@app.get("/api/missions/{mission_id}/objects/{object_id}/3d")
async def get_mission_object_3d(mission_id: str, object_id: str):
    """Return 3D spatial fusion details, trajectory, and reprojection evidence for a specific object."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    objects_3d = _get_mission_fused_objects(mission_id, mission)
    match = None
    for obj in objects_3d:
        if obj.get("object_id") == object_id or obj.get("track_id") == object_id:
            match = obj
            break

    if not match:
        raise HTTPException(status_code=404, detail=f"3D Object {object_id} not found in mission")

    return {"success": True, "mission_id": mission_id, "object": match}


@app.get("/api/v1/missions/{mission_id}/objects/{object_id}/evidence")
@app.get("/api/missions/{mission_id}/objects/{object_id}/evidence")
async def get_mission_object_evidence(mission_id: str, object_id: str):
    """Return source video observations, 2D bounding boxes, and reprojection error overlays for an object."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    objects_3d = _get_mission_fused_objects(mission_id, mission)
    match = None
    for obj in objects_3d:
        if obj.get("object_id") == object_id or obj.get("track_id") == object_id:
            match = obj
            break

    if not match:
        raise HTTPException(status_code=404, detail=f"3D Object {object_id} not found")

    observations = match.get("observations") or []
    normalized_obs = []
    for obs in observations:
        frame_id = obs.get("frame_id") or obs.get("image_name")
        overlay_path = obs.get("overlay_path", "")
        overlay_name = Path(overlay_path).name if overlay_path else f"overlay_{match.get('object_id')}_{frame_id}"
        
        overlay_exists = (
            (DATA_DIR / "validation" / "phase6" / overlay_name).exists()
            or (DATA_DIR / "missions" / mission_id / "evidence" / overlay_name).exists()
        )
        overlay_url = f"/api/missions/{mission_id}/evidence/overlays/{overlay_name}" if overlay_exists else None
        frame_exists = (DATA_DIR / "missions" / mission_id / "reconstruction" / "frames" / frame_id).exists()
        frame_url = f"/api/missions/{mission_id}/evidence/frames/{frame_id}" if frame_exists else None

        normalized_obs.append({
            "frame_id": frame_id,
            "timestamp": obs.get("timestamp", 0.0),
            "bbox_2d": obs.get("bbox_2d"),
            "pixel_center": obs.get("pixel_center"),
            "reprojected_point_2d": obs.get("reprojected_point_2d"),
            "reprojection_error_px": obs.get("reprojection_error_px"),
            "depth_zc": obs.get("depth_zc"),
            "overlay_url": overlay_url,
            "frame_url": frame_url,
            "camera_id": obs.get("camera_id"),
        })

    obs_with_overlays = [o for o in normalized_obs if o.get("overlay_url")]
    if obs_with_overlays:
        best_obs = min(obs_with_overlays, key=lambda x: x.get("reprojection_error_px", float("inf")))
    else:
        best_obs = min(normalized_obs, key=lambda x: x.get("reprojection_error_px", float("inf"))) if normalized_obs else None

    return {
        "success": True,
        "mission_id": mission_id,
        "object_id": match.get("object_id"),
        "track_id": match.get("track_id"),
        "class": match.get("class") or match.get("class_name"),
        "position_3d": match.get("position_3d"),
        "motion_state": match.get("motion_state"),
        "association_status": match.get("association_status"),
        "association_confidence": match.get("association_confidence"),
        "mean_reprojection_error_px": match.get("mean_reprojection_error_px") or match.get("reprojection_error"),
        "observations_count": len(normalized_obs),
        "best_observation": best_obs,
        "observations": normalized_obs,
    }


@app.get("/api/v1/missions/{mission_id}/evidence/overlays/{image_name}")
@app.get("/api/missions/{mission_id}/evidence/overlays/{image_name}")
async def get_evidence_overlay(mission_id: str, image_name: str):
    """Serve visual reprojection overlay images."""
    phase6_overlay = DATA_DIR / "validation" / "phase6" / image_name
    if phase6_overlay.exists():
        return FileResponse(str(phase6_overlay), media_type="image/jpeg")

    mission_overlay = DATA_DIR / "missions" / mission_id / "evidence" / image_name
    if mission_overlay.exists():
        return FileResponse(str(mission_overlay), media_type="image/jpeg")

    raise HTTPException(status_code=404, detail="Evidence overlay image not found")


@app.get("/api/v1/missions/{mission_id}/evidence/frames/{frame_name}")
@app.get("/api/missions/{mission_id}/evidence/frames/{frame_name}")
async def get_evidence_frame(mission_id: str, frame_name: str):
    """Serve source video keyframe images."""
    frame_path = DATA_DIR / "missions" / mission_id / "reconstruction" / "frames" / frame_name
    if frame_path.exists():
        return FileResponse(str(frame_path), media_type="image/jpeg")

    raise HTTPException(status_code=404, detail="Source frame not found")


@app.post("/api/v1/missions/{mission_id}/fuse-3d")
@app.post("/api/missions/{mission_id}/fuse-3d")
async def fuse_mission_objects_3d(mission_id: str, reprojection_threshold_px: float = 25.0):
    """Trigger AI-to-3D spatial fusion for a mission."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    from backend.jobs import create_job
    from backend.tasks import fuse_objects_3d

    job = create_job(mission_id, parameters={"reprojection_threshold_px": reprojection_threshold_px})
    result = fuse_objects_3d(job["id"], mission_id=mission_id, reprojection_threshold_px=reprojection_threshold_px)
    return {"success": True, "job_id": job["id"], "mission_id": mission_id, "result": result}


@app.get("/api/v1/missions/{mission_id}/reconstruction/pointcloud")
@app.get("/api/missions/{mission_id}/reconstruction/pointcloud")
@app.get("/missions/{mission_id}/reconstruction/pointcloud")
async def get_mission_pointcloud(mission_id: str):
    """Serve the generated PLY point cloud for a mission if it exists."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    m_id = mission.mission_id
    pointcloud_path = get_reconstruction_pointcloud_path(m_id)
    if not pointcloud_path or not pointcloud_path.exists():
        return get_artifact_status_response(mission, "pointcloud")

    return FileResponse(
        path=str(pointcloud_path),
        media_type="application/octet-stream",
        filename=pointcloud_path.name,
    )


@app.get("/api/v1/missions/{mission_id}/reconstruction/mesh")
@app.get("/api/missions/{mission_id}/reconstruction/mesh")
@app.get("/missions/{mission_id}/reconstruction/mesh")
async def get_mission_mesh(mission_id: str):
    """Serve the generated 3D surface mesh (GLB/OBJ/PLY) for a mission if it exists."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    m_id = mission.mission_id
    mesh_path = get_reconstruction_mesh_path(m_id)
    if not mesh_path or not mesh_path.exists():
        return get_artifact_status_response(mission, "mesh")

    with open(mesh_path, "rb") as f:
        header_magic = f.read(4)

    ext = mesh_path.suffix.lower()
    if header_magic.startswith(b"ply"):
        media_type = "application/octet-stream"
    elif ext == ".glb" and header_magic == b"glTF":
        media_type = "model/gltf-binary"
    elif ext == ".gltf":
        media_type = "model/gltf+json"
    elif ext == ".obj":
        media_type = "model/obj"
    else:
        media_type = "application/octet-stream"

    return FileResponse(
        path=str(mesh_path),
        media_type=media_type,
        filename=mesh_path.name,
    )


@app.post("/api/v1/missions/{mission_id}/reconstruct")
@app.post("/api/missions/{mission_id}/reconstruct")
async def generate_reconstruction(mission_id: str):
    """Generate 3D reconstruction for a mission"""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    # If real video exists, trigger the authoritative photogrammetric pipeline
    video_path_raw = mission.get("video_path")
    video_path_cand = None
    if video_path_raw and Path(video_path_raw).exists():
        video_path_cand = Path(video_path_raw)
    elif isinstance(mission.get("video"), dict) and mission.get("video").get("storage_key"):
        s_cand = DATA_DIR / "objects" / mission.get("video")["storage_key"]
        if s_cand.exists():
            video_path_cand = s_cand
    if not video_path_cand:
        m_dir = MISSIONS_DIR / mission_id
        if m_dir.exists():
            for ext in [".mp4", ".mov", ".mkv", ".avi", ".webm"]:
                found = list(m_dir.glob(f"*{ext}")) + list((m_dir / "original").glob(f"*{ext}"))
                if found and found[0].is_file():
                    video_path_cand = found[0]
                    break

    if video_path_cand:
        recon_res = run_reconstruction_for_mission(mission_id, video_path_cand)
        try:
            from backend.fuse_mission_3d import run_3d_fusion_for_mission
            run_3d_fusion_for_mission(mission_id)
        except Exception as exc:
            logger.warning("3D spatial fusion notice in reconstruct: %s", exc)
        mission = MissionData(mission_id)
        mission.update({
            "reconstruction": recon_res,
            "status": recon_res.get("status", "COMPLETED"),
        })
        return {
            "success": bool(recon_res.get("success")),
            "reconstruction": recon_res,
        }
    
    return {
        "success": False,
        "detail": "Video source required to execute photogrammetric reconstruction.",
        "reconstruction": {
            "status": "FAILED",
            "registered_cameras": 0,
            "sparse_point_count": 0,
            "mesh_status": "UNAVAILABLE",
            "error": "No video source available on disk for reconstruction.",
        }
    }

def _generate_findings(result: dict) -> list:
    """Generate AI findings from processing results"""
    findings = []
    detections = result.get("detections", {})
    tracks = result.get("tracks") or detections.get("tracks", [])
    by_group = detections.get("byGroup") or result.get("scene_analysis") or {}

    # 1. Per-track detailed findings for confidence distribution in UI
    for t in tracks:
        t_id = t.get("track_id") or t.get("trackId") or f"T_{len(findings)+1}"
        c_name = str(t.get("class_name") or t.get("class") or "object").title()
        conf = int(round(float(t.get("average_confidence") or t.get("confidence") or 0.8) * 100)) if float(t.get("average_confidence") or t.get("confidence") or 0.8) <= 1.0 else int(t.get("average_confidence") or t.get("confidence") or 80)
        findings.append({
            "id": f"f_{t_id}",
            "object_id": f"OBJ_{t_id}",
            "title": f"{c_name} ({t_id})",
            "status": "TRACKED",
            "category": "dynamic" if c_name.lower() in ("car", "truck", "bus", "person", "vehicle", "motorcycle") else "static",
            "confidence": conf,
            "severity": "info",
            "evidence": f"Confirmed over {t.get('detection_count', len(t.get('trajectory', [])) or 1)} keyframes",
            "location": "Scene",
            "action": f"Tracked {c_name.lower()} trajectory",
        })

    # 2. Group summaries if no per-track findings were created
    if not findings:
        people_count = by_group.get("people", 0)
        if people_count > 0:
            findings.append({
                "id": f"f_{uuid.uuid4().hex[:8]}",
                "title": f"People detected ({people_count})",
                "status": "OBSERVED",
                "category": "dynamic",
                "confidence": 85,
                "severity": "info",
                "evidence": f"Tracked {people_count} distinct individuals across frames",
                "location": "Scene",
                "action": "Review detected individuals for operational relevance",
            })
        
        vehicles_count = by_group.get("vehicles", 0)
        if vehicles_count > 0:
            findings.append({
                "id": f"f_{uuid.uuid4().hex[:8]}",
                "title": f"Vehicles detected ({vehicles_count})",
                "status": "OBSERVED",
                "category": "dynamic",
                "confidence": 88,
                "severity": "info",
                "evidence": f"Tracked {vehicles_count} vehicles in scene",
                "location": "Scene",
                "action": "Monitor vehicle movement and trajectories",
            })
    
    return findings

# ============================================================
# PHASE 7: SCALE CALIBRATION & GEOMETRIC MEASUREMENTS
# ============================================================

class ReferenceDistanceCalibrationRequest(BaseModel):
    point_a: list[float]
    point_b: list[float]
    known_distance_meters: float
    source_evidence: str = "Known physical distance"
    confidence: float = 0.95
    uncertainty_meters: float | None = None
    created_by: str = "operator"


class KnownObjectSizeCalibrationRequest(BaseModel):
    object_id: str
    reconstructed_length: float
    known_length_meters: float
    source_evidence: str = "Known object dimension"
    confidence: float = 0.85
    uncertainty_meters: float | None = None
    created_by: str = "operator"


class DistanceMeasurementRequest(BaseModel):
    point_a: list[float]
    point_b: list[float]
    calibration_id: str | None = None
    store: bool = True


class PolygonMeasurementRequest(BaseModel):
    vertices: list[list[float]]
    calibration_id: str | None = None
    store: bool = True


class ElevationMeasurementRequest(BaseModel):
    point_a: list[float]
    point_b: list[float]
    has_verified_gravity: bool = False
    calibration_id: str | None = None
    store: bool = True


class ObjectMeasurementRequest(BaseModel):
    has_verified_gravity: bool = False
    calibration_id: str | None = None
    store: bool = True


class VolumeMeasurementRequest(BaseModel):
    is_watertight: bool = False
    vertices: list[list[float]] | None = None
    faces: list[list[int]] | None = None
    calibration_id: str | None = None
    store: bool = True



class MarkingCreateRequest(BaseModel):
    name: str
    type: str = "custom"  # "hazard", "entry_exit", "safe_zone", "command_post", "custom"
    color: str = "#4fd8ff"
    position: list[float] = Field(default_factory=lambda: [0.0, 0.0, 0.0])
    description: str = ""

@app.get("/api/v1/missions/{mission_id}/markings")
@app.get("/api/missions/{mission_id}/markings")
async def get_mission_markings(mission_id: str):
    """Retrieve custom 3D markings saved by operators for this mission."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    markings = mission.data.get("markings", [])
    return {"success": True, "mission_id": mission_id, "markings": markings}

@app.post("/api/v1/missions/{mission_id}/markings")
@app.post("/api/missions/{mission_id}/markings")
async def add_mission_marking(mission_id: str, req: MarkingCreateRequest):
    """Save an operator-placed labeled 3D marker."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    marking_id = f"mrk_{uuid.uuid4().hex[:8]}"
    marking = {
        "id": marking_id,
        "name": req.name,
        "type": req.type,
        "color": req.color,
        "position": req.position,
        "description": req.description,
        "createdAt": datetime.utcnow().isoformat(),
        "visible": True,
    }
    markings = mission.data.setdefault("markings", [])
    markings.append(marking)
    mission.save()
    return {"success": True, "marking": marking}

@app.delete("/api/v1/missions/{mission_id}/markings/{marking_id}")
@app.delete("/api/missions/{mission_id}/markings/{marking_id}")
async def delete_mission_marking(mission_id: str, marking_id: str):
    """Delete an operator-placed marker."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    markings = mission.data.get("markings", [])
    updated = [m for m in markings if m.get("id") != marking_id]
    mission.data["markings"] = updated
    mission.save()
    return {"success": True, "deleted_id": marking_id}

@app.get("/api/v1/missions/{mission_id}/keyframes")
@app.get("/api/missions/{mission_id}/keyframes")
@app.get("/missions/{mission_id}/keyframes")
async def get_mission_keyframes(mission_id: str):
    """Serve keyframe gallery with per-frame detection counts."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    frames_dirs = [
        MISSIONS_DIR / mission_id / "reconstruction" / "frames",
        MISSIONS_DIR / mission_id / "frames",
        DATA_DIR / "missions" / mission_id / "reconstruction" / "frames",
        DATA_DIR / "objects" / "missions" / mission_id / "reconstruction" / "frames",
    ]
    frames_dir = None
    for fd in frames_dirs:
        if fd.exists() and fd.is_dir():
            frames_dir = fd
            break
    frames = []

    detections = mission.data.get("detections", []) or []
    det_by_frame = {}
    for d in detections:
        if not isinstance(d, dict):
            continue
        fid = str(d.get("frame_id", ""))
        det_by_frame.setdefault(fid, []).append(d)
        if fid:
            det_by_frame.setdefault(Path(fid).stem, []).append(d)

    if frames_dir and frames_dir.exists() and frames_dir.is_dir():
        image_files = sorted(
            [f for f in frames_dir.iterdir() if f.suffix.lower() in [".jpg", ".jpeg", ".png"]],
            key=lambda p: p.name
        )
        for idx, img_file in enumerate(image_files):
            stem = img_file.stem
            name = img_file.name
            frame_dets = det_by_frame.get(name, []) or det_by_frame.get(stem, []) or det_by_frame.get(str(idx), [])
            counts_by_class = {}
            for d in frame_dets:
                if not isinstance(d, dict):
                    continue
                cls = d.get("class_name", "object")
                counts_by_class[cls] = counts_by_class.get(cls, 0) + 1

            frames.append({
                "frame_id": name,
                "frame_index": idx,
                "url": f"/api/v1/missions/{mission_id}/evidence/frames/{name}",
                "filename": name,
                "detections_count": len(frame_dets),
                "counts_by_class": counts_by_class,
                "detections": frame_dets[:10],
            })

    proc = mission.data.get("processing")
    if not isinstance(proc, dict):
        proc = {}
    status = proc.get("status") or mission.data.get("status") or ("completed" if frames else "pending")

    return {
        "success": True,
        "status": status,
        "mission_id": mission_id,
        "total_frames": len(frames),
        "frames": frames,
    }


@app.get("/api/v1/missions/{mission_id}/calibrations")
@app.get("/api/missions/{mission_id}/calibrations")
async def get_mission_calibrations(mission_id: str):
    """List scale calibrations and current active calibration."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    active_cal = scale_calibration_service.get_active_calibration(mission_id)
    all_cals = scale_calibration_service.list_calibrations(mission_id)

    return {
        "success": True,
        "mission_id": mission_id,
        "scale_status": ScaleStatus.METRIC_CALIBRATED.value if active_cal else ScaleStatus.RELATIVE_SCALE.value,
        "coordinate_system": "LOCAL_ARBITRARY",
        "georeferencing_status": "UNREFERENCED",
        "active_calibration": active_cal.to_dict() if active_cal else None,
        "calibrations": [c.to_dict() for c in all_cals],
    }


@app.post("/api/v1/missions/{mission_id}/calibrations/reference-distance")
@app.post("/api/missions/{mission_id}/calibrations/reference-distance")
async def calibrate_by_reference_distance(mission_id: str, req: ReferenceDistanceCalibrationRequest):
    """Calibrate photogrammetric scale using two known 3D points and a known physical distance."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    try:
        record = scale_calibration_service.calibrate_by_reference_distance(
            mission_id=mission_id,
            point_a=req.point_a,
            point_b=req.point_b,
            known_distance_meters=req.known_distance_meters,
            source_evidence=req.source_evidence,
            confidence=req.confidence,
            created_by=req.created_by,
            uncertainty_meters=req.uncertainty_meters,
        )
        cals = mission.get("calibrations") or []
        cals.append(record.to_dict())
        mission.update({"calibrations": cals, "active_calibration": record.to_dict()})

        return {"success": True, "calibration": record.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/missions/{mission_id}/calibrations/object-size")
@app.post("/api/missions/{mission_id}/calibrations/object-size")
async def calibrate_by_object_size(mission_id: str, req: KnownObjectSizeCalibrationRequest):
    """Calibrate photogrammetric scale using a known physical object dimension."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    try:
        record = scale_calibration_service.calibrate_by_known_object_size(
            mission_id=mission_id,
            object_id=req.object_id,
            reconstructed_length=req.reconstructed_length,
            known_length_meters=req.known_length_meters,
            source_evidence=req.source_evidence,
            confidence=req.confidence,
            created_by=req.created_by,
            uncertainty_meters=req.uncertainty_meters,
        )
        cals = mission.get("calibrations") or []
        cals.append(record.to_dict())
        mission.update({"calibrations": cals, "active_calibration": record.to_dict()})

        return {"success": True, "calibration": record.to_dict()}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/missions/{mission_id}/calibrations/{calibration_id}/activate")
@app.post("/api/missions/{mission_id}/calibrations/{calibration_id}/activate")
async def activate_calibration(mission_id: str, calibration_id: str):
    """Activate a specific calibration record."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    record = scale_calibration_service.activate_calibration(mission_id, calibration_id)
    if not record:
        raise HTTPException(status_code=404, detail=f"Calibration {calibration_id} not found")

    mission.update({"active_calibration": record.to_dict()})
    return {"success": True, "calibration": record.to_dict()}


@app.post("/api/v1/missions/{mission_id}/calibrations/deactivate")
@app.post("/api/missions/{mission_id}/calibrations/deactivate")
async def deactivate_calibrations(mission_id: str):
    """Deactivate all calibrations, returning scene to uncalibrated relative scale."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    scale_calibration_service.deactivate_all(mission_id)
    mission.update({"active_calibration": None})
    return {"success": True, "scale_status": ScaleStatus.RELATIVE_SCALE.value}


@app.delete("/api/v1/missions/{mission_id}/calibrations/{calibration_id}")
@app.delete("/api/missions/{mission_id}/calibrations/{calibration_id}")
async def delete_calibration(mission_id: str, calibration_id: str):
    """Delete a calibration record."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    deleted = scale_calibration_service.delete_calibration(mission_id, calibration_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Calibration {calibration_id} not found")

    active = scale_calibration_service.get_active_calibration(mission_id)
    mission.update({"active_calibration": active.to_dict() if active else None})
    return {"success": True, "deleted": calibration_id}


@app.get("/api/v1/missions/{mission_id}/measurements")
@app.get("/api/missions/{mission_id}/measurements")
async def get_measurements(mission_id: str):
    """Get measurements for a mission with scale and calibration status transparency."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    measurements = mission.get("measurements") or {
        "distance": "0 m",
        "height": "0 m",
        "width": "0 m",
        "length": "0 m",
        "area": "0 m²",
        "confidence": "0%",
        "uncertainty": "N/A",
        "source": "RECONSTRUCTION"
    }

    active_cal = scale_calibration_service.get_active_calibration(mission_id)
    items = mission.get("measurement_items") or []

    return {
        "success": True,
        "measurements": measurements,
        "scale_status": ScaleStatus.METRIC_CALIBRATED.value if active_cal else ScaleStatus.RELATIVE_SCALE.value,
        "metric_available": bool(active_cal is not None),
        "coordinate_system": "LOCAL_ARBITRARY",
        "georeferencing_status": "UNREFERENCED",
        "active_calibration": active_cal.to_dict() if active_cal else None,
        "items": items,
    }


@app.post("/api/v1/missions/{mission_id}/measurements")
@app.post("/api/missions/{mission_id}/measurements")
async def create_measurement(
    mission_id: str,
    measurement_type: str = Query(...),
    value: float = Query(...),
    confidence: float = Query(85.0)
):
    """Create a measurement for a mission (legacy compatibility)."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    measurements = mission.get("measurements") or {}
    measurements[measurement_type] = value
    mission.update({"measurements": measurements})
    
    return {
        "success": True,
        "measurement": {
            "type": measurement_type,
            "value": value,
            "confidence": confidence
        }
    }


@app.post("/api/v1/missions/{mission_id}/measurements/distance")
@app.post("/api/missions/{mission_id}/measurements/distance")
async def measure_distance_3d(mission_id: str, req: DistanceMeasurementRequest):
    """Compute 3D Euclidean distance between two points."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    cal = None
    if req.calibration_id:
        for c in scale_calibration_service.list_calibrations(mission_id):
            if c.calibration_id == req.calibration_id:
                cal = c
                break
    else:
        cal = scale_calibration_service.get_active_calibration(mission_id)

    res = GeometricMeasurementEngine.distance_3d(req.point_a, req.point_b, calibration=cal)
    res_dict = res.to_dict()

    if req.store:
        items = mission.get("measurement_items") or []
        items.append({"type": "distance", **res_dict})
        meas = mission.get("measurements") or {}
        meas["distance"] = f"{res.value} {res.unit}"
        mission.update({"measurement_items": items, "measurements": meas})

    return {"success": True, "measurement": res_dict}


@app.post("/api/v1/missions/{mission_id}/measurements/polygon")
@app.post("/api/missions/{mission_id}/measurements/polygon")
async def measure_polygon(mission_id: str, req: PolygonMeasurementRequest):
    """Compute 3D planar polygon area and perimeter using Stokes' theorem / Newell's method."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    cal = scale_calibration_service.get_active_calibration(mission_id)
    try:
        res = GeometricMeasurementEngine.measure_polygon(req.vertices, calibration=cal)
        res_dict = res.to_dict()

        if req.store:
            items = mission.get("measurement_items") or []
            items.append({"type": "polygon", **res_dict})
            meas = mission.get("measurements") or {}
            meas["area"] = f"{res.area} {res.unit_area}"
            mission.update({"measurement_items": items, "measurements": meas})

        return {"success": True, "measurement": res_dict}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/v1/missions/{mission_id}/measurements/elevation")
@app.post("/api/missions/{mission_id}/measurements/elevation")
async def measure_elevation(mission_id: str, req: ElevationMeasurementRequest):
    """Compute vertical difference and slope angle between two points."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    cal = scale_calibration_service.get_active_calibration(mission_id)
    res = GeometricMeasurementEngine.measure_elevation(
        req.point_a,
        req.point_b,
        calibration=cal,
        has_verified_gravity=req.has_verified_gravity,
    )
    res_dict = res.to_dict()

    if req.store:
        items = mission.get("measurement_items") or []
        items.append({"type": "elevation", **res_dict})
        meas = mission.get("measurements") or {}
        meas["height"] = f"{res.vertical_difference} {res.unit}"
        mission.update({"measurement_items": items, "measurements": meas})

    return {"success": True, "measurement": res_dict}


@app.post("/api/v1/missions/{mission_id}/measurements/object/{object_id}")
@app.post("/api/missions/{mission_id}/measurements/object/{object_id}")
async def measure_object_dimensions(mission_id: str, object_id: str, req: ObjectMeasurementRequest = None):
    """Measure physical dimensions of a 3D fused object with INSUFFICIENT_GEOMETRY guards."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    req = req or ObjectMeasurementRequest()
    cal = scale_calibration_service.get_active_calibration(mission_id)

    # Locate object in mission
    objects_3d = mission.get("objects_3d") or []
    target_obj = None
    for obj in objects_3d:
        if obj.get("object_id") == object_id or obj.get("track_id") == object_id:
            target_obj = obj
            break

    pts = []
    cls_name = "object"
    if target_obj:
        cls_name = target_obj.get("class_name", "object")
        traj = target_obj.get("trajectory_3d") or []
        for t in traj:
            if isinstance(t, dict) and "x" in t and "y" in t and "z" in t:
                pts.append([t["x"], t["y"], t["z"]])
        if not pts and target_obj.get("position_3d"):
            pts.append(target_obj["position_3d"])

    res = GeometricMeasurementEngine.measure_object_dimensions(
        object_id=object_id,
        class_name=cls_name,
        points_3d=pts,
        calibration=cal,
        has_verified_gravity=req.has_verified_gravity,
    )
    res_dict = res.to_dict()

    if req.store:
        items = mission.get("measurement_items") or []
        items.append({"type": "object_dimensions", **res_dict})
        meas = mission.get("measurements") or {}
        if res.length is not None:
            meas["length"] = f"{res.length} {res.unit}"
        if res.width is not None:
            meas["width"] = f"{res.width} {res.unit}"
        if res.height is not None:
            meas["height"] = f"{res.height} {res.unit}"
        if res.footprint_area is not None:
            meas["area"] = f"{res.footprint_area} {res.area_unit}"
        mission.update({"measurement_items": items, "measurements": meas})

    return {"success": True, "measurement": res_dict}


@app.post("/api/v1/missions/{mission_id}/measurements/volume")
@app.post("/api/missions/{mission_id}/measurements/volume")
async def measure_volume(mission_id: str, req: VolumeMeasurementRequest):
    """Compute 3D volume, requiring verified closed/watertight geometry."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    cal = scale_calibration_service.get_active_calibration(mission_id)
    res = GeometricMeasurementEngine.measure_volume(
        vertices=req.vertices,
        faces=req.faces,
        is_watertight=req.is_watertight,
        calibration=cal,
    )
    res_dict = res.to_dict()

    if req.store:
        items = mission.get("measurement_items") or []
        items.append({"type": "volume", **res_dict})
        mission.update({"measurement_items": items})

    return {"success": True, "measurement": res_dict}

# ============================================================
# REPORT & EXPORTS (PHASE 9)
# ============================================================

from backend.reporting import (
    build_mission_report,
    generate_mission_pdf,
    generate_mission_csv,
    generate_mission_json,
    generate_mission_geojson,
    build_evidence_package,
    save_report_artifacts,
)


@app.get("/api/v1/missions/{mission_id}/report")
@app.get("/api/missions/{mission_id}/report")
async def generate_report(
    mission_id: str,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Generate or retrieve complete structured mission report with authorization check."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    report = build_mission_report(mission_id, mission)

    try:
        storage = get_storage(DATA_DIR / "objects")
        save_report_artifacts(mission_id, report, storage)
    except Exception as exc:
        logger.debug("Background artifact persistence skipped: %s", exc)

    return {
        "success": True,
        "report": report,
    }


@app.get("/api/v1/missions/{mission_id}/report/pdf", dependencies=[Depends(rate_limit_dependency)])
@app.get("/api/missions/{mission_id}/report/pdf", dependencies=[Depends(rate_limit_dependency)])
def export_mission_pdf(
    mission_id: str,
    request: Request,
    current_user: Optional[UserRecord] = Depends(get_current_user_optional),
):
    """Download executive-ready PDF mission decision report with authorization check."""
    mission = MissionData(mission_id)
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    check_mission_access(mission_id, current_user, mission.data.get("created_by") or mission.data.get("operator"))

    request_id = getattr(request.state, "request_id", None) or str(uuid.uuid4())
    pdf_buffer = io.BytesIO()
    try:
        report = build_mission_report(mission_id, mission)
        generate_mission_pdf(report, pdf_buffer)
        pdf_bytes = pdf_buffer.getvalue()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(
            "PDF generation failed for mission %s request_id=%s method=%s path=%s: %s",
            mission_id, request_id, request.method, request.url.path, exc,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "REPORT_GENERATION_FAILED",
                "message": "Unable to generate the PDF report.",
                "request_id": request_id,
            },
        )
    finally:
        pdf_buffer.close()

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="aeromesh_{mission_id}_report.pdf"',
            "Content-Length": str(len(pdf_bytes)),
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
        },
    )







# Mark all legacy /api/... routes (excluding /api/v1/...) as deprecated aliases in OpenAPI docs
for _route in app.routes:
    _rpath = getattr(_route, "path", "")
    if _rpath.startswith("/api/") and not _rpath.startswith("/api/v1/"):
        setattr(_route, "deprecated", True)

# Keep CORS outside Starlette's ServerErrorMiddleware so sanitized 500 responses
# produced by the unhandled-exception handler also carry the allowed origin.
fastapi_app = app
app = CORSMiddleware(
    fastapi_app,
    allow_origins=allowed_origins_list,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$|^https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=[
        "Accept",
        "Authorization",
        "Content-Type",
        "Origin",
        "X-Requested-With",
        "X-Chunk-Index",
        "X-Total-Chunks",
        "X-Upload-Id",
        "ngrok-skip-browser-warning",
    ],
    expose_headers=[
        "Content-Range",
        "Accept-Ranges",
        "Content-Length",
        "Content-Disposition",
        "X-Request-ID",
    ],
)

# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
