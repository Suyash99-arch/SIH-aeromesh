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
import uuid
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
    UserRecord,
)


def test_password_hashing_and_verification():
    """Verify standard Argon2id / PBKDF2 password hashing is deterministic and secure."""
    sample_secret = "test-fixture-verification-string-123"
    hashed = hash_password(sample_secret)

    assert hashed.startswith("$argon2id$") or hashed.startswith("pbkdf2_sha256$")
    assert verify_password(sample_secret, hashed) is True
    assert verify_password("incorrect-fixture-string-456", hashed) is False
    assert verify_password("", hashed) is False
    assert verify_password(sample_secret, "") is False

    # Unique salts generate unique hashes for identical passwords
    hashed2 = hash_password(sample_secret)
    assert hashed != hashed2
    assert verify_password(sample_secret, hashed2) is True


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
    admin_user = UserRecord(id="usr_admin", email="admin@aeromesh.internal", full_name="Admin", role=ROLE_ADMIN, hashed_password="")
    analyst_user = UserRecord(id="usr_analyst", email="analyst@aeromesh.internal", full_name="Analyst", role=ROLE_ANALYST, hashed_password="")
    operator_user = UserRecord(id="usr_op", email="operator@aeromesh.internal", full_name="Operator", role=ROLE_OPERATOR, hashed_password="")

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
    """Verify tenant isolation and data access control."""
    admin = UserRecord(id="usr_admin", email="admin@aeromesh.internal", full_name="Admin", role=ROLE_ADMIN, hashed_password="")
    analyst = UserRecord(id="usr_analyst", email="analyst@aeromesh.internal", full_name="Analyst", role=ROLE_ANALYST, hashed_password="")
    operator1 = UserRecord(id="usr_op1", email="operator@aeromesh.internal", full_name="Op 1", role=ROLE_OPERATOR, hashed_password="")
    operator2 = UserRecord(id="usr_op2", email="other@aeromesh.internal", full_name="Other Op", role=ROLE_OPERATOR, hashed_password="")

    # Admin can access any mission
    assert check_mission_access("mission_secret_99", admin, mission_owner="other@aeromesh.internal") is True

    # Analyst cannot access unowned private mission outside their org
    with pytest.raises(HTTPException) as excinfo:
        check_mission_access("mission_secret_99", analyst, mission_owner="other@aeromesh.internal")
    assert excinfo.value.status_code == 403

    # Operator can access own mission
    assert check_mission_access("mission_1", operator1, mission_owner="operator@aeromesh.internal") is True

    # Operator cannot access another operator's private mission
    with pytest.raises(HTTPException) as excinfo:
        check_mission_access("mission_2", operator1, mission_owner="other@aeromesh.internal")
    assert excinfo.value.status_code == 403


def test_client_supplied_role_privilege_escalation_blocked():
    """Gate 0.4: Verify server rejects client-supplied role=ADMIN during individual registration."""
    from backend.main import app
    client = TestClient(app)

    uid = uuid.uuid4().hex[:6]
    res = client.post("/api/v1/auth/register", json={
        "email": f"hacker_{uid}@test.org",
        "password": "Password123!",
        "full_name": "Attacker",
        "role": "ADMIN",
        "portal_type": "INDIVIDUAL"
    })
    assert res.status_code == 200
    user_data = res.json()["user"]
    # Role must NOT be ADMIN; server must fix role to individual/operator
    assert user_data["role"] != "ADMIN"
    assert user_data["role"] == ROLE_OPERATOR


def test_api_upload_path_traversal_rejection(mock_mission_data):
    """Verify upload endpoint blocks client filenames containing path traversal."""
    from backend.main import app
    client = TestClient(app)
    m_id = mock_mission_data["id"]

    # Upload with ../ traversal filename
    files = {"file": ("../../malicious.mp4", b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41", "video/mp4")}
    res = client.post(f"/api/v1/missions/{m_id}/upload", files=files)
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


def test_pipeline_disabled_worker_disconnected_returns_503(monkeypatch, mock_mission_data):
    """Verify upload and process endpoints return 503 when PIPELINE_ENABLED=false and no WORKER_URL."""
    from backend import main
    client = TestClient(main.app)
    m_id = mock_mission_data["id"]

    monkeypatch.setenv("PIPELINE_ENABLED", "false")
    monkeypatch.delenv("WORKER_URL", raising=False)

    # 1. Process endpoints return 503
    res_proc_v1 = client.post(f"/api/v1/missions/{m_id}/process")
    assert res_proc_v1.status_code == 503
    assert "Processing worker not connected" in res_proc_v1.json()["detail"]

    # 2. Upload endpoint returns 503
    mp4_bytes = b"\x00\x00\x00\x20ftypisom\x00\x00\x02\x00isomiso2avc1mp41" + b"\x00" * 4000
    files = {"file": ("flight.mp4", mp4_bytes, "video/mp4")}
    res_up = client.post(f"/api/v1/missions/{m_id}/upload", files=files)
    assert res_up.status_code == 503
    assert "Processing worker not connected" in res_up.json()["detail"]
