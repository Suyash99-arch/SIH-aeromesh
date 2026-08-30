# Quick Start Guide: Single-Pass Reconstruction

## Prerequisites

- Python 3.9+ installed
- Node.js 16+ installed
- 4GB+ RAM recommended
- NVIDIA GPU optional (speeds up inference)

## Installation & Running

### 1. Backend Setup (One Time)

```bash
cd backend

# Create virtual environment (recommended)
python -m venv venv
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run server
python -m uvicorn main:app --reload --port 8000
```

Server will start at `http://localhost:8000`

### 2. Frontend Setup (One Time)

```bash
cd frontend

# Install dependencies (if not already done)
npm install

# Run development server
npm run dev
```

Frontend will start at `http://localhost:5173` or `http://localhost:5175`

## Testing the Workflow

### Step 1: Verify Backend is Running

```bash
# Test endpoint
curl http://localhost:8000/health

# Should return:
# {"status":"healthy","backend":"ready","processing_engine":"ready",...}
```

### Step 2: Create Test Mission

```bash
# Create mission
curl -X POST "http://localhost:8000/api/missions?name=Test%20Mission&mission_type=single-pass&location=Test%20Location"

# Should return mission object with ID
# Note the mission ID: something like "abc12345"
```

### Step 3: Test Video Upload

```bash
# Use any MP4 file, or create a small test video
# curl -X POST -F "file=@test.mp4" "http://localhost:8000/api/missions/YOUR_MISSION_ID/upload"

# Example with sample video (if available)
curl -X POST -F "file=@sample.mp4" "http://localhost:8000/api/missions/abc12345/upload"
```

### Step 4: Process Video

```bash
curl -X POST "http://localhost:8000/api/missions/abc12345/process?frame_sampling=1&detection_confidence=0.35"

# This will:
# 1. Extract frames (1 fps)
# 2. Run YOLO detection on each frame
# 3. Track objects
# 4. Analyze frame quality
# 5. Generate findings
```

### Step 5: Generate Reconstruction

```bash
curl -X POST "http://localhost:8000/api/missions/abc12345/reconstruct"

# Will add 3D point cloud and uncertainty data
```

### Step 6: Get Report

```bash
curl http://localhost:8000/api/missions/abc12345/report

# Returns complete mission report with all sections
```

## Frontend Testing

### In Browser

1. Go to `http://localhost:5173` or `http://localhost:5175`
2. Look for "Create New Mission" button (in sidebar or top)
3. Step through workflow:
   - **Step 1**: Enter mission name, select location
   - **Step 2**: Upload any MP4 video
   - **Step 3**: Configure processing (leave defaults)
   - **Step 4**: Start processing
4. Watch progress on dashboard
5. View results in:
   - Video player
   - 3D viewer
   - Measurements
   - Intelligence findings
   - Reports

## Troubleshooting

### Backend Won't Start

```bash
# Check Python version
python --version  # Should be 3.9+

# Check port in use
netstat -ano | findstr :8000

# Try different port
python -m uvicorn main:app --port 8001

# Check dependencies
pip list | grep fastapi  # Should show fastapi installed
```

### Frontend Can't Connect

```bash
# Check backend is running
curl http://localhost:8000/

# Check CORS - should see message like:
# {"system":"AeroMesh Backend", "status":"online"}

# In browser console, check for errors
# If CORS error, ensure backend CORS config includes your frontend URL
```

### Video Upload Fails

- Video format must be: MP4, MOV, WebM, or AVI
- File must be readable by OpenCV
- Test with known-good video file first

### Processing Seems Stuck

- Check backend console for errors
- Reduce `frame_sampling` to 1 (faster)
- Smaller video file processes faster
- Takes ~30 seconds per 30 seconds of 30fps video (at 2fps sampling)

## Sample Test Videos

### Create Minimal Test Video

```bash
# Using ffmpeg (if installed):
ffmpeg -f lavfi -i color=black:s=640x480:d=5 -pix_fmt yuv420p test_video.mp4

# This creates a 5-second black video, suitable for testing
```

### Or Use Real Sample

If you have existing drone video, place it in:

```
frontend/public/videos/
```

Then upload via the UI.

## Development Commands

### Frontend

```bash
# Start dev server
npm run dev

# Lint code
npm run lint

# Fix linting issues
npm run lint -- --fix

# Build for production
npm run build

# Preview production build
npm run preview
```

### Backend

```bash
# Run with auto-reload
python -m uvicorn main:app --reload --port 8000

# Run without auto-reload (faster)
python -m uvicorn main:app --port 8000

# Run with specific log level
python -m uvicorn main:app --log-level debug --port 8000
```

## API Documentation

### Interactive Docs

Once backend running, visit:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

These show all endpoints with request/response examples.

## Key Endpoints

```
GET  /                                - Welcome & feature list
GET  /health                          - Health check
GET  /api/missions                    - List all missions
POST /api/missions                    - Create new mission
GET  /api/missions/{id}               - Get mission details
POST /api/missions/{id}/upload        - Upload video
POST /api/missions/{id}/process       - Process video
POST /api/missions/{id}/reconstruct   - Generate 3D reconstruction
GET  /api/missions/{id}/measurements  - Get measurements
GET  /api/missions/{id}/report        - Generate report
```

## Mission Data Files

Missions are saved as JSON in:

```
backend/data/missions/{mission_id}.json
```

Each contains:

- Basic info (name, type, status)
- Video metadata
- Processing results
- Detections and tracks
- Frame quality
- 3D reconstruction
- Findings and recommendations

## Performance Notes

| Operation         | Time | Notes                           |
| ----------------- | ---- | ------------------------------- |
| Upload 50MB video | 5s   | Network dependent               |
| Extract frames    | 10s  | 1280 frames @ 30fps             |
| YOLO inference    | 30s  | 412 frames @ 2fps, 30 fps video |
| Tracking          | 5s   | IoU-based matching              |
| Reconstruction    | 5s   | Point cloud generation          |
| Total             | ~60s | Full pipeline for 1-2 min video |

GPU significantly speeds up inference (3-5x faster).

## Common Workflows

### Quick Test (2 mins)

1. Create mission
2. Upload small video (< 30s)
3. Process with 1fps sampling
4. View results

### Full Demo (10 mins)

1. Create mission with location
2. Upload 2-3 minute video
3. Process at 2fps sampling
4. Inspect detections
5. View 3D reconstruction
6. Review findings
7. Generate report

### Training/Development (ongoing)

1. Use same test video
2. Experiment with different settings
3. Test UI components
4. Check accuracy of detections

## Next Steps

Once everything works:

1. **Integrate into UI**: Add mission modal to App.jsx
2. **Real Data**: Test with actual drone video
3. **Fine-tuning**: Adjust confidence thresholds for your use case
4. **Production**: Deploy backend separately from frontend
5. **Scale**: Add database for mission storage (currently JSON)

## Support Files

- `IMPLEMENTATION_GUIDE.md` - Detailed architecture & next steps
- `backend/requirements.txt` - Python dependencies
- `frontend/package.json` - Node dependencies
- `backend/data/missions/` - Saved mission data

## Success Checklist

- [x] Backend starts without errors
- [x] Frontend loads at localhost:5173
- [x] Can create new mission via API or UI
- [x] Can upload video without errors
- [x] Video processing runs and completes
- [x] Object detection shows results
- [x] Can view processing progress
- [x] Results display in dashboard
- [ ] 3D viewer shows point cloud
- [ ] Measurements can be taken
- [ ] Report can be generated
- [ ] All pages show real data (not hardcoded)

---

**Estimated Setup Time**: 10 minutes
**Estimated First Test**: 5 minutes
**Full Workflow Test**: 15-20 minutes
