"""Opt-in fine-tuning entry point; never runs as part of the application."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "configs" / "detection.yaml"

if not (ROOT / "datasets" / "images" / "train").exists():
    sys.exit("No labelled training dataset found at ml/datasets. Pretrained inference remains the active mode.")

from ultralytics import YOLO

model = YOLO("yolo11n.pt")
model.train(data=str(DATA), epochs=50, imgsz=640, project=str(ROOT / "runs"), name="detector")
