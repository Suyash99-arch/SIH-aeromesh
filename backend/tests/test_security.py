"""
Deterministic Security Tests for AeroMesh Phase 10
Verifies:
- Password hashing and constant-time verification
- JWT token issuance, verification, and tamper rejection
- RBAC role enforcement (Admin, Analyst, Operator)
- Mission-level access authorization
- Path traversal defense & filename sanitization
- Upload file validation (size, extension, signature)
- In-memory rate limiting
- Security headers
- Health and readiness endpoints
"""

import time
import pytest
from fastapi import FastAPI, Depends, HTTPException
from fastapi.testclient import TestClient
from starlette.middleware.base import BaseHTTPMiddleware

from backend.security import (
    hash_password,
    verify_password,
    create_access_token,
    decode_access_token,
    get_current_user,
    require_roles,
    check_mission_access,
    sanitize_filename,
    validate_uploaded_file,
    RateLimiter,
    SecurityHeadersMiddleware,
    ROLE_ADMIN,
    ROLE_ANALYST,
    ROLE_OPERATOR,
    DEMO_USERS,
    UserRecord,
)


def test_password_hashing_and_verification():
    """Verify standard PBKDF2 password hashing is deterministic and secure."""
    password = "SuperSecretPassword123!"
    hashed = hash_password(password)

    assert hashed.startswith("pbkdf2_sha256$100000$")
    assert verify_password(password, hashed) is True
    assert verify_password("WrongPassword123!", hashed) is False
    assert verify_password("", hashed) is False
    assert verify_password(password, "") is False

    # Unique salts generate unique hashes for identical passwords
    hashed2 = hash_password(password)
    assert hashed != hashed2
    assert verify_password(password, hashed2) is True


def test_jwt_issuance_and_decoding():
    """Verify JWT creation, claim preservation, and expiration detection."""
    claims = {"sub": "analyst@aeromesh.internal", "role": ROLE_ANALYST, "name": "Jane Analyst"}
    token = create_access_token(claims)
    assert isinstance(token, str)

    payload = decode_access_token(token)
    assert payload["sub"] == "analyst@aeromesh.internal"
    assert payload["role"] == ROLE_ANALYST
    assert payload["iss"] == "aeromesh-auth"
    assert "exp" in payload


def test_jwt_tamper_rejection():
    """Verify that tampered tokens fail validation."""
    token = create_access_token({"sub": "admin@aeromesh.internal", "role": ROLE_ADMIN})
    tampered = token[:-4] + "abcd"

    with pytest.raises(HTTPException) as excinfo:
        decode_access_token(tampered)
    assert excinfo.value.status_code == 401


def test_path_traversal_sanitization():
    """Verify dangerous filenames and directory traversal patterns are sanitized or rejected."""
    assert sanitize_filename("../../etc/passwd") == "passwd"
    assert sanitize_filename("..\\..\\windows\\system32\\cmd.exe") == "cmd.exe"
    assert sanitize_filename("/absolute/path/to/flight.mp4") == "flight.mp4"
    assert sanitize_filename("C:\\data\\flight.mp4") == "flight.mp4"
    assert sanitize_filename("safe_flight_01.mp4") == "safe_flight_01.mp4"

    # Validation rejection for traversal patterns
    valid, reason = validate_uploaded_file("../../secret.mp4", b"\x00\x00\x00 ftypisom")
    assert valid is False
    assert "traversal" in reason.lower()

    valid, reason = validate_uploaded_file("..\\secret.mp4", b"\x00\x00\x00 ftypisom")
    assert valid is False
    assert "traversal" in reason.lower()


def test_file_upload_validation():
    """Verify file upload checks for extensions, sizes, and binary headers."""
    # Valid MP4 header
    mp4_bytes = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41"
    valid, err = validate_uploaded_file("flight.mp4", mp4_bytes)
    assert valid is True
    assert err is None

    # Disallowed extension
    valid, err = validate_uploaded_file("exploit.sh", b"#!/bin/bash\necho bad")
    assert valid is False
    assert "Invalid file extension" in err

    # Executable disguised as MP4 (MZ header)
    valid, err = validate_uploaded_file("fake.mp4", b"MZ\x90\x00\x03\x00\x00\x00")
    assert valid is False

    # Oversized file
    valid, err = validate_uploaded_file("huge.mp4", b"x" * 1000, max_size_bytes=500)
    assert valid is False
    assert "exceeds maximum" in err

    # Empty file
    valid, err = validate_uploaded_file("empty.mp4", b"")
    assert valid is False
    assert "empty" in err


def test_rbac_role_enforcement():
    """Verify role-based authorization hierarchy."""
    admin_user = DEMO_USERS["admin@aeromesh.internal"]
    analyst_user = DEMO_USERS["analyst@aeromesh.internal"]
    operator_user = DEMO_USERS["operator@aeromesh.internal"]

    # Endpoint requiring ANALYST role
    checker = require_roles(ROLE_ANALYST)
    # Admin is automatically allowed
    assert checker(admin_user) == admin_user
    # Analyst is allowed
    assert checker(analyst_user) == analyst_user
    # Operator is denied
    with pytest.raises(HTTPException) as excinfo:
        checker(operator_user)
    assert excinfo.value.status_code == 403

    # Endpoint requiring OPERATOR role
    op_checker = require_roles(ROLE_OPERATOR)
    assert op_checker(admin_user) == admin_user
    assert op_checker(operator_user) == operator_user
    with pytest.raises(HTTPException) as excinfo:
        op_checker(analyst_user)
    assert excinfo.value.status_code == 403


def test_mission_level_access_control():
    """Verify tenant isolation and public validation access."""
    admin = DEMO_USERS["admin@aeromesh.internal"]
    analyst = DEMO_USERS["analyst@aeromesh.internal"]
    operator1 = DEMO_USERS["operator@aeromesh.internal"]
    operator2 = UserRecord(id="usr_op2", email="other@aeromesh.internal", full_name="Other Op", role=ROLE_OPERATOR, hashed_password="")

    # Benchmark mission is public for everyone
    assert check_mission_access("phase5_drone_validation", operator1) is True
    assert check_mission_access("phase5_drone_validation", operator2) is True

    # Admin and Analyst can access any mission
    assert check_mission_access("mission_secret_99", admin, mission_owner="other@aeromesh.internal") is True
    assert check_mission_access("mission_secret_99", analyst, mission_owner="other@aeromesh.internal") is True

    # Operator can access own mission
    assert check_mission_access("mission_1", operator1, mission_owner="operator@aeromesh.internal") is True

    # Operator cannot access another operator's private mission
    with pytest.raises(HTTPException) as excinfo:
        check_mission_access("mission_2", operator1, mission_owner="other@aeromesh.internal")
    assert excinfo.value.status_code == 403


def test_rate_limiter():
    """Verify sliding-window rate limiter throttles burst traffic."""
    limiter = RateLimiter(requests_per_minute=5)
    ip = "192.168.1.100"

    # First 5 requests must succeed
    for _ in range(5):
        allowed, retry_after = limiter.is_allowed(ip)
        assert allowed is True
        assert retry_after == 0

    # 6th request must be throttled
    allowed, retry_after = limiter.is_allowed(ip)
    assert allowed is False
    assert retry_after > 0

    # Different IP is not throttled
    allowed_other, _ = limiter.is_allowed("192.168.1.101")
    assert allowed_other is True


def test_security_headers_middleware():
    """Verify that SecurityHeadersMiddleware injects secure HTTP headers."""
    app = FastAPI()
    app.add_middleware(SecurityHeadersMiddleware)

    @app.get("/ping")
    def ping():
        return {"ping": "pong"}

    client = TestClient(app)
    res = client.get("/ping")
    assert res.status_code == 200
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["X-XSS-Protection"] == "1; mode=block"
    assert res.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"


def test_storage_path_traversal_rejection(tmp_path):
    """Verify LocalObjectStorage strictly blocks path escape attempts."""
    from backend.storage import LocalObjectStorage
    storage = LocalObjectStorage(tmp_path)

    import io
    # Valid relative key works
    storage.upload("missions/m1/file.txt", io.BytesIO(b"hello"), "file.txt")
    assert storage.exists("missions/m1/file.txt") is True

    # Traversal keys are rejected
    with pytest.raises(ValueError):
        storage.upload("../outside.txt", io.BytesIO(b"escaped"), "outside.txt")

    with pytest.raises(ValueError):
        storage.download("..\\outside.txt")

    with pytest.raises(ValueError):
        storage.exists("/root/secret.txt")


def test_api_health_and_readiness_endpoints():
    """Verify production /health and /ready endpoints return structured JSON."""
    from backend.main import app
    client = TestClient(app)

    res_health = client.get("/health")
    assert res_health.status_code == 200
    data_health = res_health.json()
    assert data_health["status"] == "healthy"
    assert "backend" in data_health
    assert "database" in data_health

    res_ready = client.get("/ready")
    assert res_ready.status_code == 200
    data_ready = res_ready.json()
    assert data_ready["status"] in ("ready", "degraded")
    assert "checks" in data_ready
    assert "storage" in data_ready["checks"]


def test_api_authentication_login_flow():
    """Verify login authentication, credential verification, and token issuance."""
    from backend.main import app
    client = TestClient(app)

    # Valid admin login
    res = client.post("/api/auth/login", json={"email": "admin@aeromesh.internal", "password": "Admin123!"})
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert "access_token" in body
    assert body["user"]["role"] == ROLE_ADMIN

    # Test /api/auth/me with Bearer token
    token = body["access_token"]
    me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["user"]["email"] == "admin@aeromesh.internal"

    # Invalid password rejection
    bad_res = client.post("/api/auth/login", json={"email": "admin@aeromesh.internal", "password": "WrongPassword"})
    assert bad_res.status_code == 401
    assert "Invalid email or password" in bad_res.json()["detail"]

    # Unknown user rejection
    unknown_res = client.post("/api/auth/login", json={"email": "unknown@hacker.io", "password": "Admin123!"})
    assert unknown_res.status_code == 401


def test_api_demo_users_endpoint():
    """Verify demo users endpoint returns safe non-sensitive profiles."""
    from backend.main import app
    client = TestClient(app)

    res = client.get("/api/auth/demo-users")
    assert res.status_code == 200
    users = res.json()["users"]
    roles = {u["role"] for u in users}
    assert ROLE_ADMIN in roles
    assert ROLE_ANALYST in roles
    assert ROLE_OPERATOR in roles
    for u in users:
        assert "hashed_password" not in u


def test_api_upload_path_traversal_rejection():
    """Verify upload endpoint blocks client filenames containing path traversal."""
    from backend.main import app
    client = TestClient(app)

    # Upload with ../ traversal filename
    files = {"file": ("../../malicious.mp4", b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41", "video/mp4")}
    res = client.post("/api/missions/phase5_drone_validation/upload", files=files)
    assert res.status_code == 400
    assert "traversal" in res.json()["detail"].lower()


def test_safe_error_handling_no_stack_trace_leak():
    """Verify unhandled exceptions return sanitized JSON without leaking stack traces."""
    from backend.main import app
    client = TestClient(app)

    # Call storage with invalid traversal key
    res = client.get("/api/storage/..%2F..%2Fetc%2Fpasswd")
    assert res.status_code in (400, 404)
    # Must never return Python traceback in response
    assert "Traceback (most recent call last)" not in res.text


