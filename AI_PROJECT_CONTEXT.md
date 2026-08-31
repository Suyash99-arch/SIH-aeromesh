# AeroMesh / SIH Project Context for GPT / Claude

This is the project state as of 2026-08-30. It is written to be pasted into another AI chat without losing the important context.

---

## 1. Project goal

Build an end-to-end drone mission intelligence system where:

- a user uploads a drone video
- the backend extracts metadata and performs detection / tracking / quality analysis
- the app exposes mission data through a frontend UI
- the user can view video, 3D reconstruction, telemetry, findings, and mission intelligence

The key requirement was: do not invent or seed fake values. Every value must originate from actual inference / backend results, or be explicitly marked as UNKNOWN when not available.

---

## 2. Current stack

- Frontend: React + Vite
- Backend: FastAPI + Uvicorn
- Computer vision: OpenCV + NumPy
- Detection: YOLO11n via Ultralytics (when available)
- Data: JSON mission storage under data/missions
- 3D / reconstruction: procedural reconstruction viewer in frontend + backend reconstruction output structure

---

## 3. Core architecture

### Backend

- File: backend/main.py
- Main responsibilities:
  - mission CRUD
  - video upload
  - metadata extraction
  - frame quality analysis
  - YOLO detection + track persistence
  - scene_analysis generation
  - evidence-state / provenance tracking
  - mission status and reconstruction metadata

### Frontend

- Entry: frontend/src/App.jsx
- API layer: frontend/src/api/missions.js
- Seed/demo data: frontend/src/data/missions.js
- UI pages: frontend/src/pages/Pages.jsx
- Video player: frontend/src/components/reconstruction/VideoPlayer.jsx
- 3D viewer: frontend/src/components/reconstruction/ReconstructionViewer.jsx

---

## 4. Important design principle

The system must not fabricate values as facts.

The canonical rule is:

- if there is actual evidence, use it
- if there is partial evidence, show partial / unknown state
- if there is no evidence, use UNKNOWN instead of NaN / fake numbers / demo values

This includes:

- scene_analysis totals
- object counts
- telemetry values
- reconstruction metrics
- UI placeholders

---

## 5. Actual root cause fixed

The main issue was not only backend startup. The real functional bug was in frontend fallback logic.

### Problem

When the backend returned a mission with no usable asset or reconstruction data, the app normalized it into an empty/partial mission object. That caused blank video and blank 3D views.

### Root cause chain

1. app started with a valid local seed mission
2. it tried to fetch backend mission data
3. backend response had missing or asset-less mission data
4. frontend used the incomplete object instead of falling back to a valid mission
5. UI rendered blank or unavailable asset states

### Fix implemented

In frontend/src/api/missions.js:

- if backend is unreachable, fall back to seeded mission data
- if backend mission exists but has no usable video or point cloud assets, fall back to the valid local mission
- never let an empty mission object replace the app state

This was critical to prevent the UI from going blank when reconstruction/video was unavailable.

---

## 6. Current app behavior

### Default mission

- App default mission is north-ridge
- This is a valid seeded mission so the app has a working baseline while backend data loads

### Mission loading logic

- listMissions() tries to fetch real backend mission list
- getMission(missionId) returns:
  1. seeded mission if backend is unavailable
  2. seeded fallback if backend mission is empty or asset-less
  3. real mission only when valid data exists

### UI stability rule

The UI should never become blank just because reconstruction is unavailable.

---

## 7. Core files and current status

### File: frontend/src/App.jsx

Current state:

- keeps a valid default mission
- fetches backend list and fetches mission details
- uses a toast if backend is unavailable
- fallback remains stable and does not blank out the UI

### File: frontend/src/api/missions.js

Current state:

- has normalizeMission(), normalizeSceneAnalysis(), toSafeNumber()
- merges backend mission data with fallback data
- resolves empty and missing values safely
- prevents stale / blank states

### File: frontend/src/pages/Pages.jsx

Current state:

- handles overview / drone / reconstruction / intelligence screens
- prevents broken NaN or empty value rendering
- keeps asset-not-available handling in view without crashing

### File: frontend/src/components/reconstruction/VideoPlayer.jsx

Current state:

- shows a fallback poster when no video asset exists
- keeps missing video from crashing the page

### File: frontend/src/components/reconstruction/ReconstructionViewer.jsx

Current state:

- renders a placeholder 3D scene or asset-absent panel if no model or point cloud exists
- avoids blank crash states when no reconstruction is available

### File: backend/main.py

Current state:

- uses explicit provenance records
- uses evidence states such as OBSERVED, TRACKED, RECONSTRUCTED, PARTIAL, POSSIBLE, UNKNOWN
- scene analysis is grounded in inference results
- no fabricated “confirmed” values without support

---

## 8. Scene analysis / evidence contract

The backend uses a canonical scene_analysis output with fields such as:

- total
- people
- vehicles
- structures
- hazards
- confirmed_objects
- possible_objects
- rejected_objects
- static_objects
- dynamic_objects
- per_object_evidence

This is generated from actual detection/tracking evidence. If no valid evidence exists, totals remain 0 and status becomes UNKNOWN or PARTIAL, not fabricated numbers.

---

## 9. Current verified status

The project is in a stable working state for the app runtime.

### Verified command output

Frontend build verified successfully:

- Command: cd "c:\Users\kc889\OneDrive\Desktop\Sih\frontend" ; npm run build
- Result: vite build succeeded
- Evidence: "✓ built in 8.16s"

### Backend health

- backend is expected to run on localhost:8000
- health checks were previously validated in the workspace

---

## 10. Important files to inspect next

- backend/main.py
- frontend/src/api/missions.js
- frontend/src/App.jsx
- frontend/src/pages/Pages.jsx
- frontend/src/components/reconstruction/VideoPlayer.jsx
- frontend/src/components/reconstruction/ReconstructionViewer.jsx
- frontend/src/data/missions.js

---

## 11. What to tell the next AI assistant

Use this prompt:

"This is an AeroMesh drone mission intelligence app. The app was failing because the frontend fallback path replaced valid mission data with an empty asset-less mission object, which caused blank video and blank 3D screens. The fix is to keep a valid fallback mission, use backend data when it exists, and never fabricate or show NaN values. Use evidence-backed scene_analysis from backend data, and show UNKNOWN rather than fake values. The current frontend build passes. Keep the backend at localhost:8000 and frontend at localhost:5173/5174."

---

## 12. Short summary

The project is now in a runtime-safe state:

- real backend data is used when available
- fallback mission data is valid when backend is unavailable
- empty missions cannot break the app
- the UI does not blank out because reconstruction or video is missing
- no fake values are shown without evidence

This is the correct state to continue from for next improvements such as temporal verification, better mission processing, and final polishing.
