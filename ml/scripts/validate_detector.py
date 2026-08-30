"""Validate an existing fine-tuned model only when data and weights exist."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
WEIGHTS = ROOT / "models" / "best.pt"
DATA = ROOT / "configs" / "detection.yaml"
if not WEIGHTS.exists() or not (ROOT / "datasets" / "images" / "val").exists():
    sys.exit("Validation unavailable: add a real validation dataset and ml/models/best.pt first.")

from ultralytics import YOLO

metrics = YOLO(str(WEIGHTS)).val(data=str(DATA), project=str(ROOT / "runs"), name="validation")
print({"precision": metrics.box.mp, "recall": metrics.box.mr, "mAP50": metrics.box.map50, "mAP50-95": metrics.box.map})
