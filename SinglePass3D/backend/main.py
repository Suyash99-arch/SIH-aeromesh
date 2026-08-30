from pathlib import Path
import shutil
import uuid

import cv2

from inference import process_video

from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware


# ============================================================
# PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent.parent

INPUT_DIR = BASE_DIR / "input"
OUTPUT_DIR = BASE_DIR / "output"

INPUT_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="AeroMesh AI",
    description="Single-Pass Drone Video to 3D Reconstruction",
    version="1.0.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# ROOT
# ============================================================

@app.get("/")
def root():

    return {
        "system": "AeroMesh AI",
        "status": "online",
        "service": "Single-Pass 3D Reconstruction",
        "version": "1.0.0",
    }


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/health")
def health():

    return {
        "status": "healthy",
        "reconstruction_engine": "ready",
        "opencv": "ready",
        "colmap": "pending",
    }


# ============================================================
# UPLOAD VIDEO
# ============================================================

@app.post("/upload")
async def upload_video(
    file: UploadFile = File(...)
):

    # --------------------------------------------------------
    # Check filename
    # --------------------------------------------------------

    if not file.filename:

        return {
            "success": False,
            "message": "No file selected.",
        }


    # --------------------------------------------------------
    # Check extension
    # --------------------------------------------------------

    allowed_extensions = {
        ".mp4",
        ".mov",
        ".avi",
        ".mkv",
    }

    extension = Path(file.filename).suffix.lower()

    if extension not in allowed_extensions:

        return {
            "success": False,
            "message": (
                f"Unsupported video format: {extension}. "
                "Use MP4, MOV, AVI or MKV."
            ),
        }


    # --------------------------------------------------------
    # Create project ID
    # --------------------------------------------------------

    project_id = str(uuid.uuid4())[:8]


    # --------------------------------------------------------
    # Create project folders
    # --------------------------------------------------------

    project_dir = INPUT_DIR / project_id

    frames_dir = project_dir / "frames"

    project_dir.mkdir(
        parents=True,
        exist_ok=True
    )

    frames_dir.mkdir(
        parents=True,
        exist_ok=True
    )


    # --------------------------------------------------------
    # Save video
    # --------------------------------------------------------

    video_path = project_dir / f"flight{extension}"


    with video_path.open("wb") as buffer:

        shutil.copyfileobj(
            file.file,
            buffer
        )


    # --------------------------------------------------------
    # File size
    # --------------------------------------------------------

    file_size_mb = video_path.stat().st_size / (
        1024 * 1024
    )


    # --------------------------------------------------------
    # Response
    # --------------------------------------------------------

    return {

        "success": True,

        "project_id": project_id,

        "filename": file.filename,

        "saved_path": str(video_path),

        "frames_path": str(frames_dir),

        "file_size_mb": round(
            file_size_mb,
            2
        ),

        "status": "uploaded",

        "next_step": "frame_extraction",

        "message": (
            "Drone video uploaded successfully."
        ),

    }


# ============================================================
# EXTRACT FRAMES FROM VIDEO
# ============================================================

@app.post("/extract-frames/{project_id}")
def extract_frames(project_id: str):

    # --------------------------------------------------------
    # Find project
    # --------------------------------------------------------

    project_dir = INPUT_DIR / project_id


    if not project_dir.exists():

        return {
            "success": False,
            "message": "Project not found.",
        }


    # --------------------------------------------------------
    # Find uploaded video
    # --------------------------------------------------------

    video_files = list(
        project_dir.glob("flight.*")
    )


    if not video_files:

        return {
            "success": False,
            "message": "Flight video not found.",
        }


    video_path = video_files[0]


    # --------------------------------------------------------
    # Create frames directory
    # --------------------------------------------------------

    frames_dir = project_dir / "frames"

    frames_dir.mkdir(
        parents=True,
        exist_ok=True
    )


    # --------------------------------------------------------
    # Open video
    # --------------------------------------------------------

    cap = cv2.VideoCapture(
        str(video_path)
    )


    if not cap.isOpened():

        return {
            "success": False,
            "message": "Could not open video.",
        }


    # --------------------------------------------------------
    # Read video information
    # --------------------------------------------------------

    fps = cap.get(
        cv2.CAP_PROP_FPS
    )

    total_frames = int(
        cap.get(
            cv2.CAP_PROP_FRAME_COUNT
        )
    )


    duration = (
        total_frames / fps
        if fps > 0
        else 0
    )


    # --------------------------------------------------------
    # Sampling
    #
    # Extract approximately 2 frames per second.
    # --------------------------------------------------------

    sample_fps = 2


    frame_interval = max(
        int(fps / sample_fps),
        1
    )


    frame_index = 0

    saved_count = 0


    # --------------------------------------------------------
    # Extract frames
    # --------------------------------------------------------

    while True:

        success, frame = cap.read()


        if not success:

            break


        if frame_index % frame_interval == 0:

            filename = (
                f"{saved_count:06d}.jpg"
            )


            output_path = (
                frames_dir / filename
            )


            cv2.imwrite(
                str(output_path),
                frame
            )


            saved_count += 1


        frame_index += 1


    # --------------------------------------------------------
    # Release video
    # --------------------------------------------------------

    cap.release()


    # --------------------------------------------------------
    # Response
    # --------------------------------------------------------

    return {

        "success": True,

        "project_id": project_id,

        "video": video_path.name,

        "fps": round(
            fps,
            2
        ),

        "total_video_frames": total_frames,

        "duration_seconds": round(
            duration,
            2
        ),

        "sample_fps": sample_fps,

        "frames_extracted": saved_count,

        "frames_directory": str(
            frames_dir
        ),

        "next_step": "colmap",

        "message": (
            f"Successfully extracted "
            f"{saved_count} frames."
        ),

    }


@app.post("/process/{project_id}")
def process_uploaded_video(project_id: str):
    """Run real, sampled COCO-pretrained inference on an uploaded project."""
    project_dir = INPUT_DIR / project_id
    video_files = list(project_dir.glob("flight.*"))
    if not video_files:
        return {"success": False, "message": "Flight video not found."}
    try:
        result = process_video(video_files[0])
    except Exception as exc:
        return {"success": False, "message": f"Detector failed: {exc}"}
    result["missionId"] = project_id
    return {"success": True, "result": result}
