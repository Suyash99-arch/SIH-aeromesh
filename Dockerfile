# ==============================================================================
# AeroMesh Backend Production Dockerfile
# Multi-stage Python 3.12 build with security hardening and non-root execution
# ==============================================================================

FROM python:3.12-slim AS builder

WORKDIR /install

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    git \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .

RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Final runtime image
FROM python:3.12-slim

# System dependencies for OpenCV, pycolmap, and spatial operations
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libpq5 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy python packages from builder
COPY --from=builder /install /usr/local

# Create non-root user and group
RUN groupadd -g 1001 aeromesh && \
    useradd -u 1001 -g aeromesh -s /bin/bash -m aeromesh

# Create data and storage directories
RUN mkdir -p /app/data/missions /app/data/objects /app/backend/models && \
    chown -R aeromesh:aeromesh /app

# Copy application source code
COPY backend/ /app/backend/
COPY alembic.ini /app/alembic.ini

RUN chown -R aeromesh:aeromesh /app

USER aeromesh

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OBJECT_STORAGE_ROOT=/app/data/objects \
    PORT=8000

EXPOSE 8000

# Healthcheck for container orchestration
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
