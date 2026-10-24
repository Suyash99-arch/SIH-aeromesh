#!/usr/bin/env python3
"""
SIH AeroMesh — Preflight Environment Check
Validates all required tools, models, and configurations before running the pipeline.
"""
import importlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"

results = []


def check(name: str, status: str, detail: str = ""):
    results.append((name, status, detail))
    icon = {"PASS": "[OK]", "FAIL": "[XX]", "WARN": "[!!]"}.get(status, "[??]")
    print(f"  {icon} {name}: {detail}" if detail else f"  {icon} {name}")


def main():
    print("=" * 60)
    print("SIH AeroMesh — Preflight Environment Check")
    print("=" * 60)
    print()

    root = Path(__file__).resolve().parent.parent
    backend_dir = root / "backend"
    frontend_dir = root / "frontend"

    # --- Python ---
    print("--- Python ---")
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if sys.version_info >= (3, 10):
        check("Python version", PASS, py_ver)
    else:
        check("Python version", FAIL, f"{py_ver} (need >= 3.10)")

    venv_path = backend_dir / ".venv"
    if venv_path.exists():
        check("Virtual environment", PASS, str(venv_path))
    else:
        check("Virtual environment", WARN, "No .venv found in backend/")

    # --- FFmpeg / FFprobe ---
    print("\n--- Video Tools ---")
    for tool in ("ffmpeg", "ffprobe"):
        path = shutil.which(tool)
        if path:
            try:
                ver = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=5)
                first_line = ver.stdout.split("\n")[0] if ver.stdout else ""
                check(tool, PASS, first_line[:80])
            except Exception as e:
                check(tool, WARN, f"Found but error: {e}")
        else:
            # Check winget path
            winget = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
            matches = list(winget.glob(f"**/{tool}.exe")) if winget.exists() else []
            if matches:
                check(tool, PASS, f"Found via WinGet: {matches[0]}")
            else:
                check(tool, FAIL, "Not found in PATH")

    # --- COLMAP / pycolmap ---
    print("\n--- 3D Reconstruction ---")
    try:
        import pycolmap
        check("pycolmap", PASS, f"Version: {getattr(pycolmap, '__version__', 'installed')}")
    except ImportError:
        check("pycolmap", FAIL, "Not installed - reconstruction will use monocular fallback only")

    try:
        import open3d
        check("Open3D", PASS, f"Version: {open3d.__version__}")
    except ImportError:
        check("Open3D", WARN, "Not installed - mesh generation may be limited")

    # --- YOLO ---
    print("\n--- AI Detection ---")
    try:
        from ultralytics import YOLO
        check("ultralytics (YOLO)", PASS, "Installed")
    except ImportError:
        check("ultralytics (YOLO)", FAIL, "Not installed")

    # Check for model weights
    model_dirs = [
        root / "backend" / "models",
        root / "aeromesh_yolo",
        root / "backend" / "aeromesh_yolo",
        root / "models",
    ]
    found_model = False
    for md in model_dirs:
        if md.exists():
            weights = list(md.glob("*.pt"))
            if weights:
                check("YOLO weights", PASS, f"{len(weights)} model(s) in {md.name}/")
                found_model = True
                break
    if not found_model:
        # Check for yolo11m.pt or similar in common locations
        yolo_default = Path.home() / ".cache" / "ultralytics"
        if yolo_default.exists():
            check("YOLO weights", PASS, f"Using ultralytics cache: {yolo_default}")
        else:
            check("YOLO weights", WARN, "No custom weights found; will use default yolo11m.pt")

    # --- GPU ---
    print("\n--- GPU / Compute ---")
    try:
        import torch
        cuda = torch.cuda.is_available()
        if cuda:
            gpu_name = torch.cuda.get_device_name(0)
            check("CUDA GPU", PASS, f"{gpu_name} (CUDA {torch.version.cuda})")
        else:
            check("CUDA GPU", WARN, "Not available — pipeline will run on CPU (slower)")
        check("PyTorch", PASS, f"Version: {torch.__version__}")
    except ImportError:
        check("PyTorch", WARN, "Not installed — detection will attempt CPU fallback")

    # --- OpenCV ---
    print("\n--- Computer Vision ---")
    try:
        import cv2
        check("OpenCV", PASS, f"Version: {cv2.__version__}")
    except ImportError:
        check("OpenCV", FAIL, "Not installed")

    try:
        import numpy
        check("NumPy", PASS, f"Version: {numpy.__version__}")
    except ImportError:
        check("NumPy", FAIL, "Not installed")

    # --- Disk Space ---
    print("\n--- System Resources ---")
    try:
        usage = shutil.disk_usage(str(root))
        free_gb = usage.free / (1024 ** 3)
        if free_gb >= 5.0:
            check("Free disk space", PASS, f"{free_gb:.1f} GB")
        elif free_gb >= 1.0:
            check("Free disk space", WARN, f"{free_gb:.1f} GB (recommend >= 5 GB)")
        else:
            check("Free disk space", FAIL, f"{free_gb:.1f} GB (need >= 1 GB)")
    except Exception:
        check("Free disk space", WARN, "Could not determine")

    try:
        import psutil
        ram = psutil.virtual_memory()
        ram_gb = ram.total / (1024 ** 3)
        check("System RAM", PASS if ram_gb >= 4 else WARN, f"{ram_gb:.1f} GB total, {ram.available / (1024 ** 3):.1f} GB available")
    except ImportError:
        check("System RAM", WARN, "psutil not installed")

    # --- Ports ---
    print("\n--- Network ---")
    import socket
    for port, name in [(8000, "Backend API"), (5173, "Vite Dev Server")]:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(1)
        result_port = sock.connect_ex(("127.0.0.1", port))
        sock.close()
        if result_port == 0:
            check(f"Port {port} ({name})", PASS, "Listening")
        else:
            check(f"Port {port} ({name})", WARN, "Not listening (will need to start)")

    # --- Project Structure ---
    print("\n--- Project Structure ---")
    for path, desc in [
        (backend_dir / "main.py", "Backend entry point"),
        (backend_dir / "reconstruction.py", "Reconstruction module"),
        (backend_dir / "detection.py", "Detection module"),
        (frontend_dir / "package.json", "Frontend package.json"),
        (frontend_dir / "vite.config.js", "Vite config"),
        (root / "alembic.ini", "Alembic config"),
    ]:
        if path.exists():
            check(desc, PASS, path.name)
        else:
            check(desc, FAIL, f"Missing: {path}")

    # --- Summary ---
    print("\n" + "=" * 60)
    passes = sum(1 for _, s, _ in results if s == PASS)
    fails = sum(1 for _, s, _ in results if s == FAIL)
    warns = sum(1 for _, s, _ in results if s == WARN)
    print(f"Results: {passes} PASS, {warns} WARN, {fails} FAIL")
    if fails > 0:
        print("\nCritical failures:")
        for name, status, detail in results:
            if status == FAIL:
                print(f"  - {name}: {detail}")
    print("=" * 60)
    return 1 if fails > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
