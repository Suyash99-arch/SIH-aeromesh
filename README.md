# Hexa Spark (AeroMesh) — Aerial Intelligence & 3D Photogrammetry Platform

Hexa Spark is an aerial intelligence and photogrammetry platform that transforms raw monocular drone video into interactive 3D spatial reconstructions, object detections, ByteTrack trajectories, and tactical mission intelligence reports.

---

## What Hexa Spark Does

- **Deterministic Fallback Pipeline**: Accepts monocular UAV video of any length, resolution, codec, or orientation, always completing to produce an interactive 3D scene and detections.
- **Incremental Structure-from-Motion (SfM)**: Reconstructs camera poses and 3D geometry using PyCOLMAP and Poisson surface meshing.
- **Tactical AI Perception**: Detects tactical categories (vehicles, persons, infrastructure) with YOLOv11 and tracks targets continuously with ByteTrack.
- **2D-to-3D Multi-View Spatial Fusion**: Unprojects detected bounding boxes through estimated camera rays to estimate 3D spatial coordinates and ground footprints.
- **Interactive Mission Command**: Three.js 3D viewer, trajectory map, timeline playback, and automated PDF executive decision reports.

---

## Requirements

- **Python**: 3.11.x (PyCOLMAP Windows wheels are precompiled for Python 3.11)
- **Node.js**: 18.x or 20.x
- **FFmpeg & FFprobe**: Must be available on system `PATH`
- **COLMAP / pycolmap**: PyCOLMAP 3.11+ library for incremental Structure-from-Motion

---

## Setup Steps

### 1. Backend Setup

```bash
# From repository root:
python -m venv backend/.venv

# Activate virtual environment
# Windows PowerShell:
.\backend\.venv\Scripts\Activate.ps1
# Linux / macOS:
source backend/.venv/bin/activate

# Install backend dependencies
pip install -r backend/requirements.txt
```

### 2. Frontend Setup

```bash
# Navigate to frontend and install dependencies
cd frontend
npm install
cd ..
```

### 3. Environment Configuration

Copy the example configuration files:
- Root / Backend: Copy `backend/.env.example` to `backend/.env` (or configure via environment variables).
- Frontend: Copy `frontend/.env.example` to `frontend/.env` (contains `VITE_API_BASE_URL=/api/v1` and `VITE_UPLOAD_BASE_URL=/api/v1`).

---

## How to Run

To run the complete verified local demo with a single command (launches both the FastAPI backend and Vite frontend dev server with health checks):

```powershell
.\scripts\run_demo.ps1
```

- **Backend API**: `http://127.0.0.1:8000` (docs at `http://127.0.0.1:8000/docs`)
- **Frontend App**: `http://localhost:5173`

Alternatively, to run the preflight verification check beforehand:
```powershell
python scripts/preflight.py
```

---

## Hardware & Reconstruction Notice (Honesty Note)

Full 3D reconstruction runs locally on the machine. 
- **CPU Mode**: Incremental Structure-from-Motion (PyCOLMAP) runs on CPU to extract camera poses and generate an authoritative sparse point cloud and Poisson mesh.
- **Dense Stereo (MVS)**: Dense Multi-View Stereo requires an NVIDIA CUDA GPU. Without a CUDA GPU, CPU-only execution produces sparse point clouds without synthesizing unverified geometry.

---

## The 4 Reconstruction Tiers

Hexa Spark employs a 4-tier deterministic fallback chain to guarantee a valid 3D result for any input video:

1. **Tier 1 — High-Quality Incremental SfM**: Full PyCOLMAP incremental reconstruction with strict geometric verification and bundle adjustment. Yields high-precision camera poses and point clouds for textured flights.
2. **Tier 2 — Relaxed Corridor SfM**: Sequential matching with relaxed parallax thresholds and feature caps optimized for forward-moving linear drone sweeps.
3. **Tier 3 — Monocular Depth Fallback**: Utilizes monocular depth estimation backprojection when feature matching yields insufficient inliers (e.g. low-texture terrain or water).
4. **Tier 4 — Geometric Proxy & Camera Path**: When 3D reconstruction cannot converge (e.g. extreme blur, dark conditions, or near-stationary video), the pipeline constructs a geometric ground proxy along the estimated camera trajectory. This tier is honestly disclosed with a dedicated amber warning banner in the UI: *"3D reconstruction failed for this video; showing camera path and geometric proxy."*

---

## Model Weights

Tactical neural detection weights are located at:
- **Path**: `backend/models/aeromesh_yolo.pt`
- **Size**: ~20.26 MB (21,246,435 bytes)
- **Target Classes**: Vehicles, pedestrians, infrastructure, bicycles, motorcycles.
- Note: Model weights (`*.pt`, `*.onnx`) are excluded from git tracking. The pre-trained weights file is placed in `backend/models/` for local runs, or will automatically fall back to Ultralytics YOLO models if not present.

---

## Verification & Testing

- **Backend Tests**: Run unit and integration tests with `pytest`.
- **Preflight Check**: Run `python scripts/preflight.py` to verify all dependencies and paths.
