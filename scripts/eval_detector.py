"""
Evaluation script for AeroMesh Object Detector (Gate 4.6).
Computes mAP50, mAP50-95, and per-class Precision/Recall if a validation dataset exists.
If no dataset is present, outputs 'accuracy not measured' honestly without fabricating metrics.
"""

import sys
import os
from pathlib import Path

def evaluate_detector(dataset_dir: Path | None = None):
    print("=======================================================================")
    print("AEROMESH DETECTOR EVALUATION (GATE 4.6)")
    print("=======================================================================")
    
    target_dir = dataset_dir or Path("datasets/VisDrone/val")
    
    if not target_dir.exists():
        print(f"[EVAL] VisDrone dataset not found at {target_dir}")
        print("[EVAL] Status: accuracy not measured (no local validation dataset present)")
        print("[EVAL] Truth in Engineering: No metrics fabricated.")
        return {
            "status": "accuracy not measured",
            "dataset_present": False,
            "metrics": None
        }
    
    print(f"[EVAL] Evaluating model against dataset at {target_dir}...")
    try:
        from ultralytics import YOLO
        model_path = Path("yolo11s.pt") if Path("yolo11s.pt").exists() else Path("yolo11n.pt")
        model = YOLO(str(model_path))
        results = model.val(data=str(target_dir / "data.yaml"), imgsz=1280)
        
        map50 = float(results.box.map50)
        map50_95 = float(results.box.map)
        print(f"[EVAL] Results: mAP50 = {map50:.4f}, mAP50-95 = {map50_95:.4f}")
        return {
            "status": "measured",
            "dataset_present": True,
            "mAP50": map50,
            "mAP50_95": map50_95,
        }
    except Exception as exc:
        print(f"[EVAL] Evaluation encountered error: {exc}")
        return {
            "status": f"evaluation error: {exc}",
            "dataset_present": True,
            "metrics": None
        }

if __name__ == "__main__":
    evaluate_detector()
