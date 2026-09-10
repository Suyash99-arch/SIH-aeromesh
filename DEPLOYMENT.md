# AeroMesh Production Deployment & Security Guide
**Phase 10 — Production Hardening, Security & Deployment**

---

## 1. System Architecture Overview

AeroMesh is a single-pass drone aerial reconstruction and AI-to-3D spatial intelligence platform. The production deployment stack consists of:

```
                          ┌───────────────────────────┐
                          │   Nginx Reverse Proxy     │
                          │   Port 80 (SPA & API)     │
                          └─────────────┬─────────────┘
                                        │
                 ┌──────────────────────┴──────────────────────┐
                 │                                             │
                 ▼                                             ▼
     ┌───────────────────────┐                    ┌─────────────────────────┐
     │   Frontend SPA        │                    │   FastAPI Backend       │
     │   (Vite Static Build) │                    │   Port 8000             │
     └───────────────────────┘                    └────────────┬────────────┘
                                                               │
                                  ┌────────────────────────────┼───────────────────────────┐
                                  ▼                            ▼                           ▼
                     ┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
                     │ PostgreSQL 16 + PostGIS │ │ Redis 7 In-Memory Broker│ │ Local / S3 Storage      │
                     │ Port 5432               │ │ Port 6379               │ │ data/objects            │
                     └─────────────────────────┘ └─────────────┬───────────┘ └─────────────────────────┘
                                                               │
                                                  ┌────────────┴────────────┐
                                                  ▼                         ▼
                                     ┌─────────────────────────┐ ┌─────────────────────────┐
                                     │ Celery Worker 1         │ │ Celery Worker 2         │
                                     │ (YOLO & Tracking)       │ │ (pycolmap & 3D Fusion)  │
                                     └─────────────────────────┘ └─────────────────────────┘
```

---

## 2. Environment Configuration Reference

Production environment variables are configured via `.env` (derived from [`.env.example`](file:///d:/SIH/SIH-aeromesh/.env.example)).

| Variable | Type | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | String | `None` (JSON fallback) | Connection string for PostgreSQL/PostGIS. |
| `REDIS_URL` | String | `redis://localhost:6379/0` | In-memory message broker for Celery worker. |
| `CELERY_BROKER_URL` | String | `redis://localhost:6379/0` | Celery broker URL. |
| `CELERY_RESULT_BACKEND`| String | `redis://localhost:6379/0` | Celery result backend. |
| `SECRET_KEY` | String | *Generated* | Cryptographic key used to sign JWT tokens. |
| `JWT_ALGORITHM` | String | `HS256` | JWT signing algorithm. |
| `JWT_EXPIRATION_MINUTES`| Integer | `1440` (24h) | Token lifetime before re-authentication. |
| `AEROMESH_AUTH_OPTIONAL`| Boolean | `1` (Demo mode) | `0` enforces strict token requirement on all endpoints. |
| `CORS_ALLOWED_ORIGINS` | String | Localhost regex | Comma-separated allowed CORS origin domains. |
| `MAX_UPLOAD_SIZE_BYTES` | Integer | `1073741824` (1 GB) | Maximum allowed flight video upload size. |
| `RATE_LIMIT_PER_MINUTE` | Integer | `120` | Max requests per client IP per minute on sensitive routes. |
| `OBJECT_STORAGE_ROOT` | Path | `data/objects` | Storage path for video and reconstruction artifacts. |

---

## 3. Quickstart: Local Demo / Evaluation Workflow

AeroMesh is pre-configured to run out-of-the-box on a local judge or evaluation workstation without cloud dependencies:

### Step 1: Start Backend
```powershell
# Activate project virtual environment
& "d:\SIH\SIH-aeromesh\.venv312\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

### Step 2: Start Frontend
```powershell
cmd /c "npm --prefix frontend run dev"
```

### Step 3: Open Browser & Access Mission
1. Open `http://localhost:5173`.
2. Click **Dashboard** -> **Reports** or **3D Reconstruction**.
3. Benchmark mission `phase5_drone_validation` is pre-loaded with verified photogrammetric and spatial fusion data.
4. Use the **Operator** button in the Topbar to switch roles between **ADMIN**, **ANALYST**, and **OPERATOR** with 1 click.

---

## 4. Production Docker Compose Deployment

To deploy the fully orchestrated stack using Docker:

```bash
# 1. Clone repository and verify branch
git checkout aeromesh-v2

# 2. Copy and configure environment
cp .env.example .env
# Edit .env with your secure production values

# 3. Build and launch all services
docker compose -f docker-compose.yml up -d --build

# 4. Run database migrations
docker compose exec backend alembic upgrade head

# 5. Verify health & readiness
curl -f http://localhost:8000/health
curl -f http://localhost:8000/ready
```

Services exposed:
- Web Application & Reverse Proxy: `http://localhost:80`
- Direct Backend API: `http://localhost:8000`
- PostgreSQL / PostGIS: `localhost:5432`
- Redis: `localhost:6379`

---

## 5. Authentication & Role-Based Access Control (RBAC)

AeroMesh enforces standard Bearer JWT authentication and hierarchical RBAC:

### Roles & Permissions
- **ADMIN**:
  - Full system administration.
  - Access to all missions and cross-tenant data.
  - Can configure calibrations, trigger pipelines, and generate reports.
- **ANALYST**:
  - Read-only inspection of 3D reconstructions, semantic objects, and measurements.
  - Generates executive reports (PDF, CSV, JSON, Evidence Packages).
- **OPERATOR**:
  - Flight video uploads and mission creation.
  - Pipeline processing execution on owned missions.

### Seed Demo Accounts
Pre-seeded for evaluation:
- `admin@aeromesh.internal` / `Admin123!` (Role: `ADMIN`)
- `analyst@aeromesh.internal` / `Analyst123!` (Role: `ANALYST`)
- `operator@aeromesh.internal` / `Operator123!` (Role: `OPERATOR`)

---

## 6. Security Hardening Specifications

1. **Password Hashing**: Standard PBKDF2-HMAC-SHA256 with 100,000 iterations and 16-byte cryptographically secure salts.
2. **File Upload Security**:
   - Extension whitelist (`.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`).
   - Magic byte container validation (`ftyp`, `moov`, `mdat`, `RIFF AVI`).
   - Client filenames are sanitized using `sanitize_filename()`; path traversal strings (`../`, `..\`, absolute paths) are rejected with HTTP 400.
3. **Storage Isolation**: `LocalObjectStorage` enforces root containment checks, blocking traversal breakouts.
4. **Rate Limiting**: Sliding-window limiter on sensitive endpoints (`/api/auth/login`, `/api/missions/upload`, `/api/missions/{id}/report/pdf`, `/api/missions/{id}/export/package`) returning HTTP 429 with `Retry-After`.
5. **HTTP Security Headers**: Injected automatically:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `X-XSS-Protection: 1; mode=block`
   - `Referrer-Policy: strict-origin-when-cross-origin`
6. **Error Masking**: Production 500 handler suppresses internal stack traces, generating a tracking `request_id` while writing full diagnostics to server logs.

---

## 7. Database Migration & Safe Backup Procedures

> [!CAUTION]
> Never execute `DROP DATABASE` or `TRUNCATE` against production or demo instances.

### Applying Migrations
```bash
alembic upgrade head
```

### PostgreSQL Backup
```bash
# Backup database
pg_dump -U aeromesh -h localhost -d aeromesh -F c -b -v -f /backups/aeromesh_$(date +%Y%m%d_%H%M%S).dump

# Restore database
pg_restore -U aeromesh -h localhost -d aeromesh -v /backups/aeromesh_20260905_120000.dump
```

### Artifacts Backup
Back up the `data/objects` and `data/missions` directories:
```bash
tar -czvf /backups/aeromesh_artifacts_$(date +%Y%m%d).tar.gz data/objects data/missions
```

---

## 8. Health & Readiness Monitoring

- **`GET /health`**: Liveness probe returning HTTP 200:
  ```json
  {
    "status": "healthy",
    "backend": "ready",
    "processing_engine": "ready",
    "reconstruction_engine": "ready",
    "database": "ready"
  }
  ```
- **`GET /ready`**: Readiness probe checking database, storage read/write, and Redis connectivity:
  ```json
  {
    "status": "ready",
    "timestamp": "2026-09-05T14:30:00Z",
    "checks": {
      "database": { "status": "ready", "mode": "configured_database" },
      "storage": { "status": "ready", "backend": "LocalObjectStorage" },
      "redis": { "status": "ready" }
    }
  }
  ```

---

## 9. Scientific Data Disclosures

All coordinate representations maintain truth-in-advertising guarantees:
- Reconstructed scenes are ungeoreferenced monocular models labeled `LOCAL_ARBITRARY`.
- Scales without explicit ground baseline are labeled `RELATIVE_SCALE`.
- Monocular aerial video without WGS84 ground control is labeled `UNREFERENCED`.
- GeoJSON export explicitly refuses unreferenced coordinates with an explanation rather than fabricating GPS coordinates.
