from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def test_pipeline_and_report_paths_honor_configured_data_dir(tmp_path):
    """Import pipeline modules with an isolated data root and verify report evidence resolution."""
    configured_data = tmp_path / "configured-data"
    configured_data.mkdir()
    repo_root = Path(__file__).resolve().parents[2]
    script = r"""
import os
from pathlib import Path

root = Path(os.environ["AEROMESH_DATA_DIR"]).resolve()
modules = [
    "backend.main",
    "backend.damage_detection",
    "backend.fuse_mission_3d",
    "backend.reconstruction",
    "backend.reporting",
    "backend.scenes",
    "backend.eta_engine",
    "backend.seeds",
]
for module_name in modules:
    module = __import__(module_name, fromlist=["DATA_DIR"])
    assert Path(module.DATA_DIR).resolve() == root, (module_name, module.DATA_DIR)
    if hasattr(module, "MISSIONS_DIR"):
        assert Path(module.MISSIONS_DIR).resolve() == root / "missions", (module_name, module.MISSIONS_DIR)

from backend.reporting import build_mission_report
mission_id = "isolated-evidence-test"
mission_dir = root / "missions" / mission_id
overlay_dir = mission_dir / "evidence"
overlay_dir.mkdir(parents=True)
(overlay_dir / "overlay_test.jpg").write_bytes(b"test evidence placeholder")
report = build_mission_report(mission_id, {"id": mission_id})
evidence = next(item for item in report["evidence"]["items"] if item["filename"] == "overlay_test.jpg")
resolved = root / evidence["relative_path"]
assert resolved.resolve() == (overlay_dir / "overlay_test.jpg").resolve()
assert str(resolved.resolve()).startswith(str(root))
"""
    env = os.environ.copy()
    env["AEROMESH_DATA_DIR"] = str(configured_data)
    env["PYTHONPATH"] = str(repo_root)
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=repo_root,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    repo_data = repo_root / "data"
    if repo_data.exists():
        assert not any(repo_data.rglob("isolated-evidence-test*"))
