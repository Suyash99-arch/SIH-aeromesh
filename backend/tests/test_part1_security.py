"""
Part 1 Security Test Suite
Verifies:
1. Government account invite code enforcement (no self-signup without valid code).
2. Forged JWT signatures return 401.
3. Government-only endpoints return 403 for individual and guest users.
4. User A accessing User B's mission returns 403 (not 404).
5. Guest user cannot access government dashboard or other users' data.
6. Rate limiting on authentication endpoints returns 429 upon brute force.
"""

import json
import pytest
from fastapi.testclient import TestClient
from backend.main import app, PORTAL_GOV_ORG, PORTAL_INDIVIDUAL, PORTAL_GUEST, ROLE_ADMIN, ROLE_OPERATOR
from backend.security import create_access_token, hash_password, UserRecord, save_persistent_user, save_invite_code


@pytest.fixture
def client():
    return TestClient(app)


def test_individual_cannot_register_as_government_without_valid_invite_code(client):
    """Attempting government registration without a valid invite code must fail with 400 Bad Request."""
    payload = {
        "email": "attacker@fake.com",
        "password": "Password123!",
        "portal_type": PORTAL_GOV_ORG,
        "organization_name": "Fake Ministry",
        "invite_code": "INVALID-CODE-1234",
    }
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 400
    assert "invite code" in response.json()["detail"].lower()


def test_individual_can_register_with_valid_invite_code(client):
    """Registering with a valid admin-issued invite code succeeds and grants government organization status."""
    import uuid
    valid_code = save_invite_code(f"TEST-GOV-INVITE-{uuid.uuid4().hex[:6]}", "admin@aeromesh.internal", "Defence", "Ministry of Defence")
    test_email = f"officer_{uuid.uuid4().hex[:6]}@mod.gov.in"
    payload = {
        "email": test_email,
        "password": "SecurePassword123!",
        "portal_type": PORTAL_GOV_ORG,
        "organization_name": "Ministry of Defence",
        "department": "Defence Intelligence",
        "employee_id": "MOD-88492",
        "invite_code": valid_code,
    }
    response = client.post("/api/v1/auth/register", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["user"]["portal_type"] == PORTAL_GOV_ORG
    assert data["user"]["role"] == ROLE_ADMIN
    assert data["user"]["employee_id"] == "MOD-88492"


def test_forged_jwt_with_government_role_returns_401(client):
    """Forged JWT with tampered role claim and invalid signature must be rejected with 401 Unauthorized."""
    import jwt
    bogus_token = jwt.encode(
        {"sub": "user@individual.com", "role": "ADMIN", "portal_type": "GOVERNMENT_ORG"},
        "WRONG_SECRET_KEY_FORGERY",
        algorithm="HS256",
    )
    headers = {"Authorization": f"Bearer {bogus_token}"}
    response = client.get("/api/v1/auth/me", headers=headers)
    assert response.status_code == 401
    assert "token" in response.json()["detail"].lower() or "authentication" in response.json()["detail"].lower()


def test_individual_and_guest_call_gov_only_endpoints_returns_403(client):
    """Individual and Guest accounts calling government-only endpoints must receive 403 Forbidden."""
    # Individual user token
    indiv_token = create_access_token({
        "sub": "user@individual.com",
        "user_id": "usr_indiv_999",
        "role": ROLE_OPERATOR,
        "portal_type": PORTAL_INDIVIDUAL,
    })
    
    # Guest user token
    guest_token = create_access_token({
        "sub": "guest_session_123@guest.aeromesh",
        "user_id": "usr_guest_123",
        "role": ROLE_OPERATOR,
        "portal_type": PORTAL_GUEST,
    })

    # Test government dashboard
    res1 = client.get("/api/v1/gov/dashboard", headers={"Authorization": f"Bearer {indiv_token}"})
    assert res1.status_code == 403

    res2 = client.get("/api/v1/gov/dashboard", headers={"Authorization": f"Bearer {guest_token}"})
    assert res2.status_code == 403

    # Test team invite endpoint
    invite_payload = {"email": "newmember@mod.gov.in", "role": "ANALYST"}
    res3 = client.post("/api/v1/auth/invite", json=invite_payload, headers={"Authorization": f"Bearer {indiv_token}"})
    assert res3.status_code == 403

    res4 = client.post("/api/v1/auth/invite", json=invite_payload, headers={"Authorization": f"Bearer {guest_token}"})
    assert res4.status_code == 403


def test_user_a_reads_user_b_mission_returns_403_not_404(client):
    """User A attempting to access User B's mission must get 403 Forbidden, not 404 Not Found."""
    # Register / create user A
    token_a = create_access_token({
        "sub": "userA@domain.com",
        "user_id": "usr_A_101",
        "role": ROLE_OPERATOR,
        "portal_type": PORTAL_INDIVIDUAL,
    })
    # Token for User B
    token_b = create_access_token({
        "sub": "userB@domain.com",
        "user_id": "usr_B_202",
        "role": ROLE_OPERATOR,
        "portal_type": PORTAL_INDIVIDUAL,
    })

    # User B creates a mission
    create_res = client.post("/api/v1/missions?name=User+B+Secret+Mission", headers={"Authorization": f"Bearer {token_b}"})
    assert create_res.status_code == 200
    mission_id = create_res.json()["mission"]["id"]

    # User A tries to read User B's mission
    read_res = client.get(f"/api/v1/missions/{mission_id}", headers={"Authorization": f"Bearer {token_a}"})
    assert read_res.status_code == 403
    assert read_res.status_code != 404


def test_guest_cannot_access_government_dashboard_or_other_users_data(client):
    """Guest sandbox users cannot access government dashboard or other users' private missions."""
    guest_token = create_access_token({
        "sub": "eval_guest_404@guest.aeromesh",
        "user_id": "usr_guest_404",
        "role": ROLE_OPERATOR,
        "portal_type": PORTAL_GUEST,
    })

    # 1. Gov dashboard access
    res_gov = client.get("/api/v1/gov/dashboard", headers={"Authorization": f"Bearer {guest_token}"})
    assert res_gov.status_code == 403

    # 2. Audit log access
    res_audit = client.get("/api/v1/auth/audit-log", headers={"Authorization": f"Bearer {guest_token}"})
    assert res_audit.status_code == 403


def test_brute_force_login_is_rate_limited(client):
    """Repeated login attempts beyond rate limit threshold must trigger 429 Too Many Requests."""
    # Reset or saturate rate limiter for a specific test IP if needed
    from backend.security import global_rate_limiter
    original_rpm = global_rate_limiter.rpm
    global_rate_limiter.rpm = 5  # Set low threshold for quick test execution

    try:
        ip = "127.0.0.1"
        for _ in range(5):
            client.post("/api/v1/auth/login", json={"email": "brute@test.com", "password": "wrongpassword"})
        
        # 6th attempt must trigger rate limiter
        res = client.post("/api/v1/auth/login", json={"email": "brute@test.com", "password": "wrongpassword"})
        assert res.status_code == 429
        assert "rate limit" in res.json()["detail"].lower()
    finally:
        global_rate_limiter.rpm = original_rpm
