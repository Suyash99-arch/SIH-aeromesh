from pathlib import Path
import builtins

import numpy as np

from backend import reconstruction as recon


def test_reconstruct_mesh_from_point_cloud_does_not_fake_mesh_when_open3d_missing(monkeypatch):
    points = np.array([
        [0.0, 0.0, 0.0],
        [0.5, 0.0, 0.0],
        [0.0, 0.5, 0.0],
        [0.0, 0.0, 0.5],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    ], dtype=np.float64)

    monkeypatch.setattr(recon, "_is_open3d_available", lambda: False)
    mesh = recon.reconstruct_mesh_from_point_cloud(points, octree_depth=6)
    assert mesh is None


def test_run_colmap_pipeline_reports_degraded_status_when_colmap_missing(monkeypatch):
    monkeypatch.setattr(recon.shutil, "which", lambda name: None)
    original_import = builtins.__import__

    def fail_import(name, *args, **kwargs):
        if name == "pycolmap":
            raise ImportError("No module named 'pycolmap'")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fail_import)
    result = recon._run_colmap_pipeline(Path("frames"), Path("out"))

    assert result["success"] is False
    assert result["status"] == "RECONSTRUCTED_DEGRADED_NO_SCALE_CALIBRATION"
    assert "pycolmap" in result["error"] or "colmap CLI" in result["error"]
