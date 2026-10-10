import asyncio
import os
import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.env_check import check_worker_shared_state, verify_environment, is_split_worker_mode


def test_mode_local_all_in_one(monkeypatch):
    """
    Mode 1: Local All-in-One.
    Single-machine local run (ENVIRONMENT=development, PIPELINE_ENABLED=true, no WORKER_URL).
    App must start with SQLite or JSON fallback, with NO Postgres needed.
    """
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("PIPELINE_ENABLED", "true")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ROLE", raising=False)
    monkeypatch.delenv("AEROMESH_ROLE", raising=False)
    monkeypatch.delenv("PROFILE", raising=False)
    monkeypatch.delenv("WORKER_MODE", raising=False)
    monkeypatch.delenv("WORKER_URL", raising=False)

    assert is_split_worker_mode() is False

    # verify_environment(strict=True) must NOT halt on worker state
    env_info = verify_environment(strict=True)
    assert env_info["worker_shared_state"]["is_split_worker"] is False
    assert env_info["worker_shared_state"]["status"] == "local_standalone"

    # startup event must succeed cleanly without PostgreSQL
    asyncio.run(main.startup_hardware_detection())

    client = TestClient(main.app)
    health_resp = client.get("/api/v1/health")
    assert health_resp.status_code == 200
    data = health_resp.json()
    assert data["db"] in ("json_fallback", "sqlite_configured")
    assert data["pipeline_enabled"] is True


def test_mode_production_api(monkeypatch):
    """
    Mode 2: Production API Gateway.
    ENVIRONMENT=production requires active PostgreSQL database.
    Must refuse to start if missing, invalid scheme, or unreachable (without leaking passwords).
    """
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("PIPELINE_ENABLED", "false")
    monkeypatch.delenv("ROLE", raising=False)
    monkeypatch.delenv("AEROMESH_ROLE", raising=False)
    monkeypatch.delenv("PROFILE", raising=False)
    monkeypatch.delenv("WORKER_URL", raising=False)

    # 1. Missing DATABASE_URL
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="PRODUCTION STARTUP HALTED: DATABASE_URL is missing"):
        asyncio.run(main.startup_hardware_detection())

    # 2. Bad Scheme (MySQL)
    monkeypatch.setenv("DATABASE_URL", "mysql://admin:secretpass@127.0.0.1:3306/db")
    with pytest.raises(RuntimeError, match="scheme 'mysql' is invalid"):
        asyncio.run(main.startup_hardware_detection())

    # 3. Unreachable PostgreSQL
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:super_secret_password_123@127.0.0.1:54399/aeromesh?connect_timeout=2")
    with pytest.raises(RuntimeError) as exc_info:
        asyncio.run(main.startup_hardware_detection())
    err_text = str(exc_info.value)
    assert "Active PostgreSQL connection required" in err_text
    assert "super_secret_password_123" not in err_text
    assert "***" in err_text


def test_mode_split_worker(monkeypatch):
    """
    Mode 3: Split Worker.
    Active when ROLE=worker, PROFILE=worker, WORKER_MODE=1, or WORKER_URL is set.
    Must enforce shared PostgreSQL and S3/R2 storage.
    """
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("ROLE", "worker")
    assert is_split_worker_mode() is True

    # 1. Missing DATABASE_URL
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(RuntimeError, match="WORKER STARTUP HALTED: DATABASE_URL environment variable is missing"):
        check_worker_shared_state(strict=True)

    # 2. SQLite DATABASE_URL
    monkeypatch.setenv("DATABASE_URL", "sqlite:///local.db")
    with pytest.raises(RuntimeError, match="WORKER STARTUP HALTED: Worker DATABASE_URL scheme is invalid"):
        check_worker_shared_state(strict=True)

    # 3. Valid Postgres but local storage
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://aeromesh:pass@db:5432/aeromesh")
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    monkeypatch.delenv("S3_BUCKET", raising=False)
    with pytest.raises(RuntimeError, match="WORKER STARTUP HALTED: Shared S3/R2 object storage"):
        check_worker_shared_state(strict=True)

    # 4. Valid Postgres and S3 storage
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("S3_BUCKET", "aeromesh-shared-bucket")
    res = check_worker_shared_state(strict=True)
    assert res["status"] == "ready"
    assert res["database"] == "postgres"
    assert res["storage"] == "s3"
    assert res["shared_state"] is True
    assert res["is_split_worker"] is True
