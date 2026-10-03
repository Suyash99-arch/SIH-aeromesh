# Hexa Spark (AeroMesh) — 5-Minute Evaluation & Demo Guide

This guide provides an end-to-end walkthrough for evaluators, judges, and operators conducting a live demonstration of the Hexa Spark aerial intelligence and photogrammetry platform.

---

## 1. Preparing the Demo Environment

### Quick Preparation
1. Ensure the development environment is running via the one-command runner:
   ```powershell
   .\scripts\dev.ps1
   ```
2. Navigate to `http://localhost:5173`.
3. The platform includes pre-processed high-resolution validation missions (`4K High-Res Infrastructure Survey` and `Drone Area Sweep Validation`) with complete sparse point clouds, Poisson surface meshes, multi-object tracks, and 3D spatial fusion rays.

---

## 2. Five-Minute Click-Path Demo Script

### Step 1: Landing Page & Live Telemetry (0:00 - 0:45)
- **Action**: Open `http://localhost:5173`.
- **Narrative**:
  - *"Hexa Spark provides an end-to-end tactical platform converting raw monocular UAV video feeds into full 3D spatial intelligence."*
  - Point to the live hero telemetry: camera counts, point cloud resolution, and dynamic spatial coordinates updated in real-time from active missions.
- **Action**: Click **Explore Interactive Demo** or **Access Tactical Portal**.

### Step 2: Guest Authentication & Ephemeral Workspace (0:45 - 1:15)
- **Action**: In the Auth modal, click **Continue as Guest**.
- **Narrative**:
  - *"For evaluators, our secure guest sandboxing generates an ephemeral JWT session with a strict 2-hour TTL (configurable via `GUEST_TTL_HOURS`)."*
  - Show the guest banner displaying session expiration countdown.

### Step 3: Command Dashboard & Multi-Mission Overview (1:15 - 2:00)
- **Action**: View the Mission Command Dashboard.
- **Narrative**:
  - *"The dashboard provides mission statuses, pipeline stages, and quick access to 3D scenes."*
  - Click into the pre-processed mission: `4K High-Res Infrastructure Survey` (`233381f5-0e03-4d48-aa6c-50de3017e593`).

### Step 4: 3D Scene Reconstruction & Spatial Fusion (2:00 - 3:30)
- **Action**: Navigate to the **3D Scene Viewer** tab.
- **Narrative**:
  - Orbit, pan, and zoom around the 3D scene (18,802 sparse points, 46,520 mesh vertices).
  - Toggle between **Point Cloud Mode** and **Surface Mesh Mode**.
  - Show the **Registered Camera Frustums** displaying the exact optical flight path of the UAV (23/23 cameras registered at 0.386 px mean reprojection error).
  - Select an identified 3D object (`OBJ_T0001` - Van) to reveal its 3D spatial coordinate `[7.98, -4.40, 16.83]` and ray projection intersection.

### Step 5: Geospatial Tactical Map & Trajectories (3:30 - 4:15)
- **Action**: Click the **Geospatial Tactical Map** tab.
- **Narrative**:
  - Show the 2D bounding boxes and continuous ByteTrack trajectories plotted over time.
  - Explain the motion classification (26 static vehicles, 11 dynamic tracks).

### Step 6: Executive Decision Report & PDF Export (4:15 - 5:00)
- **Action**: Click **Export Executive Report** (or view the **Report** tab).
- **Narrative**:
  - *"The platform produces a cryptographically sealed, tamper-evident PDF report complete with camera registration metrics, per-class AI breakdowns, visual evidence overlays, and scientific integrity disclosures."*
  - Show the generated 3-page PDF with multi-view overlays of the sandstone facade.

---

## 3. Q&A Cheat Sheet for Evaluators & Technical Judges

### Q1: Why are coordinates labeled `LOCAL_ARBITRARY` and scale `RELATIVE_SCALE`?
**A**: Monocular video photogrammetry (a single moving camera without stereo baseline or differential RTK-GPS) has an inherent mathematical scale ambiguity. Rather than fabricating arbitrary metric units, Hexa Spark truthfully operates in normalized relative optical units (`LOCAL_ARBITRARY`) until a physical Ground Control Point (GCP) or known laser distance baseline is calibrated.

### Q2: Why is sparse Structure-from-Motion (SfM) used instead of dense MVS?
**A**: Multi-View Stereo (MVS) depth map fusion requires dedicated high-end GPU hardware (CUDA / HIP). On CPU or standard web server environments, Hexa Spark executes high-precision sparse bundle adjustment and Screened Poisson surface meshing, guaranteeing 100% truthful geometry without creating synthetic hallucinated points.

### Q3: How does the AI-to-3D Spatial Fusion work, and what was the resolution scaling fix?
**A**: The 2D bounding boxes detected by YOLOv11 and tracked by ByteTrack are projected as 3D optical rays through the reconstructed camera matrices onto the Poisson surface mesh. When 4K video (`4096x2160`) is downsampled for SfM (`1920x1012`), pixel coordinates must be scaled by `sx = cam_w / video_w` and `sy = cam_h / video_h`. Correcting this coordinate normalization reduced reprojection error from 14.28 px down to 0.386 px.

### Q4: Why is Render deployed as API-only while heavy compute runs locally?
**A**: Free and basic cloud tiers on Render provide CPU-only containers with limited RAM (512 MB - 2 GB) and execution timeouts. PyCOLMAP bundle adjustment on 4K imagery requires multi-threaded SIFT extraction and significant memory. The architecture decouples the lightweight cloud REST/Auth API on Render from heavy GPU compute workers connected securely via Cloudflare tunnels.

### Q5: What are the limits of the YOLOv11 detector?
**A**: YOLOv11 excels at tactical vehicle and pedestrian classes. Extreme oblique angles, motion blur from high-speed UAV turns, or low-light conditions can reduce confidence, which is why ByteTrack Kalman filtering is used to maintain track persistence through temporary occlusions.
