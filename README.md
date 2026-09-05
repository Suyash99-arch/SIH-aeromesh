# AeroMesh — Single-Pass Drone Video to 3D Spatial Intelligence

AeroMesh is a professional photogrammetric and geospatial intelligence platform that transforms monocular drone video into 3D reconstructions, localized AI detections, metric measurements, and executive decision reports.

---

## Completed Architecture (Phases 1–10)

- **Phase 1–3**: Video ingestion, YOLO11n object detection, and ByteTrack multi-object tracking.
- **Phase 4**: pycolmap / COLMAP incremental photogrammetric reconstruction (sparse point clouds and Delaunay/Poisson surface mesh).
- **Phase 5**: Real-data drone validation benchmark (`phase5_drone_validation`).
- **Phase 6**: AI-to-3D multi-view spatial fusion and reprojection error validation.
- **Phase 7**: Metric scale calibration and geometric measurement engine (distance, area, elevation, watertight volume).
- **Phase 8**: Professional 3D/GIS mission-analysis viewer with layer controls, telemetry, and evidence inspection.
- **Phase 9**: Professional reporting system (executive PDF with embedded evidence, CSV, JSON, GeoJSON refusal for unreferenced scenes, and ZIP evidence packages).
- **Phase 10**: Production hardening, security, JWT authentication, RBAC (`ADMIN`, `ANALYST`, `OPERATOR`), file upload sanitization, rate limiting, Dockerization, Celery/Redis architecture, CI/CD, and monitoring.

---

## Quickstart (Local Evaluation & Demo)

### 1. Start the Backend API
```powershell
& "d:\SIH\SIH-aeromesh\.venv312\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

### 2. Start the Frontend Application
```powershell
cmd /c "npm --prefix frontend run dev"
```

Open `http://localhost:5173` in your browser.

### 3. Production Docker Deployment
```bash
docker compose -f docker-compose.yml up -d --build
```
For detailed production deployment instructions, see [DEPLOYMENT.md](file:///d:/SIH/SIH-aeromesh/DEPLOYMENT.md).

---

## Testing & Quality Assurance

### Run Backend Tests (75 tests including Phase 10 security)
```powershell
& "d:\SIH\SIH-aeromesh\.venv312\Scripts\python.exe" -m pytest backend/tests -v
```

### Run Frontend Production Build
```powershell
cmd /c "npm --prefix frontend run build"
```

### Run Playwright E2E Tests
```powershell
cmd /c "npx playwright test --config=frontend/playwright.config.js"
```

---

## Scientific Data Integrity & Truth in Advertising

AeroMesh preserves scientific disclosures at all times:
- Monocular camera models lacking absolute survey GCPs remain labeled `LOCAL_ARBITRARY`.
- Scenes without an active metric calibration baseline remain labeled `RELATIVE_SCALE`.
- Missions without external WGS84 coordinate reference systems remain labeled `UNREFERENCED`.
- GeoJSON export refuses unreferenced scenes rather than fabricating GPS coordinates.
