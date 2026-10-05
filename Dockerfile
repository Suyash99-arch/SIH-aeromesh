# ==============================================================================
# AeroMesh Hugging Face Space Dockerfile
# Python 3.11-slim, CPU-optimized PyTorch & PyCOLMAP, non-root UID 1000
# Target: Free Hugging Face Docker Space (16 GB RAM, 2 vCPU, Port 7860)
# ==============================================================================

FROM python:3.11-slim

# Prevent interactive prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

# 1. System packages for FFmpeg video ingest, OpenCV, and networking
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Create non-root user with UID 1000 (Hugging Face Spaces requirement)
RUN useradd -m -u 1000 user

ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=7860 \
    APP_PORT=7860 \
    MAX_CONCURRENT_JOBS=1 \
    COLMAP_MATCHER=sequential \
    COLMAP_OVERLAP=10 \
    RECONSTRUCTION_MAX_FRAMES=40 \
    RECONSTRUCTION_IMAGE_MAX_SIZE=1280 \
    OBJECT_STORAGE_ROOT=/home/user/app/data/objects \
    DATA_DIR=/home/user/app/data

WORKDIR /home/user/app

# 3. Pre-install lightweight CPU-only PyTorch & Torchvision (<200MB vs >2GB CUDA wheel)
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# 4. Install backend runtime requirements (manylinux wheels for cp311)
COPY --chown=user:user backend/requirements-space.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# 5. Enforce single headless OpenCV to avoid window/display conflicts
RUN pip uninstall -y opencv-python opencv-contrib-python || true && \
    pip install --no-cache-dir --force-reinstall --no-deps opencv-python-headless==4.11.0.86

# 6. Setup writable application and data directories
RUN mkdir -p /home/user/app/data/missions \
             /home/user/app/data/objects \
             /home/user/app/data/staging \
             /home/user/app/backend/models && \
    chown -R user:user /home/user/app

# 7. Copy application code
COPY --chown=user:user backend/ /home/user/app/backend/
COPY --chown=user:user alembic.ini /home/user/app/alembic.ini
COPY --chown=user:user .env.example /home/user/app/.env.example

# 8. Switch to non-root user
USER user

# 9. Expose Hugging Face Space default port
EXPOSE 7860

# 10. Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD curl -f http://localhost:7860/api/v1/health || exit 1

# 11. Run FastAPI via single-worker uvicorn
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]
