"""
AeroMesh Model Weights Downloader & Validator
Ensures YOLO and other neural weights are available at runtime.
Downloads from MODEL_URL if weights are missing.
"""

from __future__ import annotations

import logging
import os
import shutil
import urllib.request
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def ensure_model_weights(
    target_path: Optional[Path | str] = None,
    model_url: Optional[str] = None,
    min_size_bytes: int = 1000,
) -> bool:
    """
    Ensure the YOLO detection model weights exist on disk.
    If missing and model_url (or env MODEL_URL) is provided, downloads them with streaming.
    
    Returns:
        bool: True if model file is present and valid, False otherwise.
    """
    if target_path is None:
        target_path = Path(os.getenv("YOLO_MODEL_PATH", "backend/models/aeromesh_yolo.pt"))
    else:
        target_path = Path(target_path)

    # 1. Check if model already exists and is non-empty
    if target_path.is_file():
        size = target_path.stat().st_size
        if size >= min_size_bytes:
            logger.info("YOLO model weights verified at %s (%d bytes).", target_path, size)
            return True
        else:
            logger.warning("Existing model file at %s is corrupt/empty (%d bytes). Will re-download.", target_path, size)
            target_path.unlink(missing_ok=True)

    # 2. Check for MODEL_URL
    if model_url is None:
        model_url = os.getenv("MODEL_URL", "").strip()

    if not model_url:
        logger.warning(
            "Model weights not found at %s and MODEL_URL environment variable is unset. "
            "YOLO detector will remain in NOT_LOADED state until weights are provided.",
            target_path,
        )
        return False

    # 3. Stream download to temporary file then atomically move
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_suffix(".tmp_download")
    if tmp_path.exists():
        tmp_path.unlink(missing_ok=True)

    logger.info("Downloading AeroMesh YOLO weights from %s to %s...", model_url, target_path)

    try:
        req = urllib.request.Request(
            model_url,
            headers={
                "User-Agent": "AeroMesh-HuggingFace-Space/1.0 (https://huggingface.co)",
            },
        )
        with urllib.request.urlopen(req, timeout=120) as resp, open(tmp_path, "wb") as out_f:
            shutil.copyfileobj(resp, out_f, length=64 * 1024)

        downloaded_size = tmp_path.stat().st_size
        if downloaded_size < min_size_bytes:
            raise ValueError(f"Downloaded model file is too small ({downloaded_size} bytes). Expected at least {min_size_bytes} bytes.")

        tmp_path.replace(target_path)
        logger.info(
            "Successfully downloaded and verified AeroMesh YOLO weights (%d bytes) at %s.",
            downloaded_size,
            target_path,
        )
        return True
    except Exception as exc:
        logger.error("Failed to download model weights from %s: %s", model_url, exc)
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        return False
