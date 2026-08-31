import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, Optional

import cv2

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def extract_frames_for_reconstruction(video_path: Path, mission_id: str, max_frames: int = 60) -> Dict[str, Any]:
    mission_dir = _ensure_dir(MISSIONS_DIR / mission_id / "reconstruction")
    frames_dir = _ensure_dir(mission_dir / "frames")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        return {"success": False, "frames_dir": str(frames_dir), "reason": "video_not_readable"}

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
    if total_frames <= 0:
        cap.release()
        return {"success": False, "frames_dir": str(frames_dir), "reason": "missing_frame_count"}

    if max_frames <= 0:
        max_frames = 60

    sample_step = max(1, total_frames // max_frames)
    saved = 0
    frame_index = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if frame_index % sample_step == 0 or frame_index == total_frames - 1:
            frame_path = frames_dir / f"frame_{frame_index:05d}.jpg"
            cv2.imwrite(str(frame_path), frame)
            saved += 1
        frame_index += 1

    cap.release()

    if saved == 0:
        return {"success": False, "frames_dir": str(frames_dir), "reason": "no_frames_saved"}

    return {
        "success": True,
        "frames_dir": str(frames_dir),
        "saved_frames": saved,
        "fps": round(fps, 2),
        "total_frames": total_frames,
        "sample_step": sample_step,
    }


def _count_ply_points(ply_path: Path) -> int:
    if not ply_path.exists():
        return 0
    count = 0
    in_body = False
    try:
        with ply_path.open("r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                stripped = line.strip()
                if stripped.startswith("end_header"):
                    in_body = True
                    continue
                if in_body and stripped and not stripped.startswith("comment"):
                    parts = stripped.split()
                    if len(parts) >= 3 and all(part.replace(".", "", 1).replace("-", "", 1).replace("e", "", 1).replace("E", "", 1).replace("+", "", 1).isdigit() or part.lower() in {"nan", "inf"} for part in parts[:3]):
                        count += 1
    except Exception:
        return 0
    return count


def _run_colmap_pipeline(frames_dir: Path, output_dir: Path) -> Dict[str, Any]:
    if shutil.which("colmap") is None:
        try:
            import pycolmap  # type: ignore
        except Exception as exc:  # pragma: no cover - fallback path
            return {
                "success": False,
                "status": "FAILED",
                "error": f"pycolmap/colmap not installed: {exc}",
                "point_count": 0,
            }

    database_path = output_dir / "database.db"
    sparse_dir = output_dir / "sparse" / "0"
    _ensure_dir(output_dir)
    _ensure_dir(sparse_dir)

    cmd_steps = [
        ["colmap", "feature_extractor", "--database_path", str(database_path), "--image_path", str(frames_dir), "--SiftExtraction.use_gpu", "0"],
        ["colmap", "exhaustive_matcher", "--database_path", str(database_path)],
        ["colmap", "mapper", "--database_path", str(database_path), "--image_path", str(frames_dir), "--output_path", str(output_dir), "--Mapper.num_threads", "1"],
        ["colmap", "model_converter", "--input_path", str(sparse_dir), "--output_path", str(output_dir / "point_cloud.ply"), "--output_type", "PLY"],
    ]

    for command in cmd_steps:
        try:
            subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        except subprocess.CalledProcessError as exc:
            error_text = exc.stderr.strip() or exc.stdout.strip() or str(exc)
            return {
                "success": False,
                "status": "FAILED",
                "error": error_text,
                "point_count": 0,
            }

    cloud_path = output_dir / "point_cloud.ply"
    if not cloud_path.exists():
        return {
            "success": False,
            "status": "FAILED",
            "error": "Colmap completed but no PLY cloud was created.",
            "point_count": 0,
        }

    point_count = _count_ply_points(cloud_path)
    return {
        "success": point_count >= 500,
        "status": "RECONSTRUCTED" if point_count >= 500 else "PARTIAL",
        "point_count": point_count,
        "point_cloud_path": str(cloud_path),
        "point_cloud_url": f"/api/missions/{output_dir.parent.name}/reconstruction/pointcloud" if output_dir.parent.name else None,
    }


def run_reconstruction_for_mission(mission_id: str, video_path: Path, max_frames: int = 60) -> Dict[str, Any]:
    started = time.time()
    extraction = extract_frames_for_reconstruction(video_path, mission_id, max_frames=max_frames)
    if not extraction.get("success"):
        return {
            "success": False,
            "status": "FAILED",
            "reason": extraction.get("reason", "No valid frames could be extracted"),
            "point_count": 0,
            "processing_time_s": round(time.time() - started, 2),
            "output_path": None,
            "method": "pycolmap",
        }

    recon_dir = _ensure_dir(MISSIONS_DIR / mission_id / "reconstruction")
    model_dir = _ensure_dir(recon_dir / "model")
    result = _run_colmap_pipeline(Path(extraction["frames_dir"]), model_dir)
    point_count = int(result.get("point_count", 0) or 0)

    final_status = result.get("status", "FAILED")
    if point_count < 500:
        final_status = "PARTIAL"

    payload = {
        "success": bool(result.get("success")) and point_count >= 500,
        "status": final_status,
        "method": "pycolmap",
        "processing_time_s": round(time.time() - started, 2),
        "point_count": point_count,
        "output_path": result.get("point_cloud_path"),
        "frames_extracted": extraction.get("saved_frames", 0),
        "frames_dir": extraction.get("frames_dir"),
        "error": result.get("error"),
    }
    return payload


def get_reconstruction_pointcloud_path(mission_id: str) -> Optional[Path]:
    recon_dir = MISSIONS_DIR / mission_id / "reconstruction"
    candidates = [
        recon_dir / "point_cloud.ply",
        recon_dir / "model" / "point_cloud.ply",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None
