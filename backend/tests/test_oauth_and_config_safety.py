import os
import uuid
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from backend.main import app
from backend.security import UserRecord, save_persistent_user, verify_password
from backend.env_check import check_production_config


@pytest.fixture
def client():
    return TestClient(app)


def test_google_oauth_missing_client_id_returns_503(client, monkeypatch):
    """When GOOGLE_CLIENT_ID is not configured, /api/v1/auth/google returns 503."""
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    res = client.post("/api/v1/auth/google", json={"id_token": "some-token"})
    assert res.status_code == 503
    assert "not configured" in res.json()["detail"]


def test_google_oauth_invalid_forged_token_returns_401(client, monkeypatch):
    """When an invalid or forged ID token is provided, verify_oauth2_token fails and returns 401."""
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id-12345.apps.googleusercontent.com")
    res = client.post("/api/v1/auth/google", json={"id_token": "forged.or.invalid.token.structure"})
    assert res.status_code == 401
    assert "Invalid or expired" in res.json()["detail"]


def test_google_oauth_valid_token_creates_account_and_blocks_password_login(client, monkeypatch):
    """
    (i) Valid OAuth token creates user with server-controlled role OPERATOR.
    (ii) The OAuth user CANNOT log in via /api/v1/auth/login with any password.
    (iii) The old fixed password ('OAuthSecurePassword2026!') strictly does not work.
    """
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-google-client-id-12345.apps.googleusercontent.com")
    oauth_email = f"oauth_user_{uuid.uuid4().hex[:8]}@example.com"

    mock_id_info = {
        "email": oauth_email,
        "name": "Verified Google User",
        "aud": "test-google-client-id-12345.apps.googleusercontent.com",
    }

    with patch("google.oauth2.id_token.verify_oauth2_token", return_value=mock_id_info):
        res = client.post("/api/v1/auth/google", json={"id_token": "valid.mock.token"})
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["user"]["email"] == oauth_email
        assert data["user"]["role"] == "OPERATOR"  # Server strictly sets role

    # (ii) Attempting to login via password endpoint must fail with 401
    login_attempt1 = client.post("/api/v1/auth/login", json={
        "email": oauth_email,
        "password": "AnyArbitraryPassword123!",
    })
    assert login_attempt1.status_code == 401
    assert "Password login is disabled" in login_attempt1.json()["detail"]

    # (iii) Attempting old legacy fixed password must strictly fail
    login_attempt2 = client.post("/api/v1/auth/login", json={
        "email": oauth_email,
        "password": "OAuthSecurePassword2026!",
    })
    assert login_attempt2.status_code == 401
    assert "Password login is disabled" in login_attempt2.json()["detail"]


def test_production_cors_wildcard_rejection(monkeypatch):
    """Wildcard origins in CORS_ALLOWED_ORIGINS must be rejected in production."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AEROMESH_AUTH_OPTIONAL", "0")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com,https://*.vercel.app")

    with pytest.raises(RuntimeError) as excinfo:
        check_production_config(strict=True)
    assert "Wildcard CORS origin" in str(excinfo.value)


def test_production_auth_optional_rejection(monkeypatch):
    """AEROMESH_AUTH_OPTIONAL=1 must be rejected in production by env_check."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("AEROMESH_AUTH_OPTIONAL", "1")
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "https://app.example.com")

    with pytest.raises(RuntimeError) as excinfo:
        check_production_config(strict=True)
    assert "AEROMESH_AUTH_OPTIONAL is enabled" in str(excinfo.value)
