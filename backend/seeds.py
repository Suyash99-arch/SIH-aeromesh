"""
AeroMesh Fused Objects Data Loader
Phase 10 — Spatial Fusion Utility
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"


def load_csv_fused_objects(mission_id: str) -> List[Dict[str, Any]]:
    """Parse real 3D spatial object data from data_{mission_id}.csv if available."""
    csv_paths = [
        DATA_DIR / "objects" / "missions" / mission_id / "reports" / f"data_{mission_id}.csv",
        MISSIONS_DIR / mission_id / "reports" / f"data_{mission_id}.csv",
    ]
    for csv_path in csv_paths:
        if csv_path.exists():
            try:
                objects = []
                with open(csv_path, "r", encoding="utf-8") as f:
                    reader = csv.DictReader(f)
                    for r in reader:
                        cls_name = r.get("class", "vehicle")
                        objects.append({
                            "object_id": r.get("object_id", ""),
                            "track_id": r.get("track_id", ""),
                            "class": cls_name,
                            "class_name": cls_name,
                            "category": "vehicle" if cls_name in ("car", "van", "truck", "bus", "vehicle") else "general",
                            "motion_state": r.get("motion_state", "STATIC"),
                            "coordinate_system": r.get("coordinate_system", "LOCAL_ARBITRARY"),
                            "position_3d": [
                                float(r.get("pos_x_local", 0.0)),
                                float(r.get("pos_y_local", 0.0)),
                                float(r.get("pos_z_local", 0.0)),
                            ],
                            "confidence": float(r.get("confidence", 0.8)),
                        })
                return objects
            except Exception as exc:
                logger.warning("Failed parsing CSV fused objects for %s: %s", mission_id, exc)
    return []
