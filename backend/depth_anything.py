from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch
from PIL import Image


MODEL_CANDIDATES = [
    "depth-anything/Depth-Anything-V2-Small-hf",
    "depth-anything/Depth-Anything-V2-Base-hf",
]


def _resize_to_max_long_edge(image: np.ndarray, max_long_edge: int = 960) -> np.ndarray:
    if image.size == 0:
        return image
    h, w = image.shape[:2]
    if max(h, w) <= max_long_edge:
        return image
    scale = max_long_edge / float(max(h, w))
    new_w = max(1, int(round(w * scale)))
    new_h = max(1, int(round(h * scale)))
    return cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_LINEAR)


class DepthAnythingV2Runner:
    """Thin, reusable wrapper around the Depth Anything V2 pretrained model."""

    def __init__(self, model_name: str | None = None, device: str | None = None, cache_dir: str | None = None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model_name = model_name or MODEL_CANDIDATES[0]
        self.cache_dir = cache_dir or str(Path(__file__).resolve().parent.parent / ".hf_cache")
        self.model = None
        self.processor = None
        self._load_model()

    def _load_model(self):
        os.makedirs(self.cache_dir, exist_ok=True)
        from transformers import AutoImageProcessor, AutoModelForDepthEstimation
        
        # Check for local snapshot in cache_dir
        snapshot_candidate = None
        cache_path = Path(self.cache_dir)
        snapshots = list(cache_path.glob("models--depth-anything--Depth-Anything-V2-Small-hf/snapshots/*"))
        if snapshots and (snapshots[0] / "model.safetensors").exists():
            snapshot_candidate = str(snapshots[0])
            
        load_path = snapshot_candidate or self.model_name
        local_only = bool(snapshot_candidate)
        
        self.processor = AutoImageProcessor.from_pretrained(
            load_path,
            cache_dir=self.cache_dir if not local_only else None,
            local_files_only=local_only
        )
        self.model = AutoModelForDepthEstimation.from_pretrained(
            load_path,
            cache_dir=self.cache_dir if not local_only else None,
            local_files_only=local_only
        )
        self.model.to(self.device)
        self.model.eval()

    def _normalize_depth(self, depth_map: np.ndarray) -> np.ndarray:
        depth = np.asarray(depth_map, dtype=np.float32)
        if depth.size == 0:
            return depth
        min_d = float(np.nanmin(depth))
        max_d = float(np.nanmax(depth))
        if not np.isfinite(min_d) or not np.isfinite(max_d) or max_d <= min_d:
            return np.clip(depth, 0.0, 1.0)
        out = (depth - min_d) / (max_d - min_d + 1e-6)
        return np.clip(out, 0.0, 1.0)

    def estimate_depth(self, image: np.ndarray, max_long_edge: int = 960) -> np.ndarray:
        resized = _resize_to_max_long_edge(image, max_long_edge=max_long_edge)
        pil_image = Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB))
        inputs = self.processor(images=pil_image, return_tensors="pt").to(self.device)
        with torch.no_grad():
            outputs = self.model(**inputs)
            pred = outputs.predicted_depth
            if isinstance(pred, (list, tuple)):
                pred = pred[0]
            pred = torch.nn.functional.interpolate(
                pred.unsqueeze(1),
                size=(resized.shape[0], resized.shape[1]),
                mode="bicubic",
                align_corners=False,
            ).squeeze(1)
            depth = pred.cpu().numpy()[0]
        return self._normalize_depth(depth)

    def estimate_depth_for_file(self, image_path: str | os.PathLike[str], max_long_edge: int = 960) -> np.ndarray:
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise FileNotFoundError(f"Could not read image: {image_path}")
        return self.estimate_depth(image, max_long_edge=max_long_edge)
