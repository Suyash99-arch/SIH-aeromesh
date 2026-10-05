import uuid
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.security import (
    DEMO_USERS,
    PORTAL_GOV_ORG,
    PORTAL_GUEST,
    PORTAL_INDIVIDUAL,
    ROLE_ADMIN,
    ROLE_ANALYST,
    ROLE_VIEWER,
    hash_password,
    verify_password,
)

client = TestClient(app)

# Generate unique run ID so tests are completely isolated across repeated runs
RUN_ID = uuid.uuid4().hex[:6]
GOV_EMAIL = f"commander_{RUN_ID}@defence.gov.internal"
INDIV_EMAIL = f"surveyor_{RUN_ID}@geo-mapping.io"
INVITE_EMAIL = f"analyst_{RUN_ID}@defence.gov.internal"


def test_argon2_password_hashing():
    pwd = "Secr3tPassword!#2026"
    hashed = hash_password(pwd)
    assert hashed.startswith("$argon2") or hashed.startswith("$2") or hashed.startswith("pbkdf2_")
    assert verify_password(pwd, hashed) is True
    assert verify_password("WrongPassword!", hashed) is False


def test_government_org_registration():
    from backend.security import save_invite_code
    code = save_invite_code(f"GOV-INVITE-{RUN_ID}-1", "admin@aeromesh.internal", "UAV", f"Air Force Reconnaissance {RUN_ID}")
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": GOV_EMAIL,
            "password": "DefencePass123!",
            "full_name": "Wing Commander Sharma",
            "portal_type": PORTAL_GOV_ORG,
            "organization_name": f"Air Force Reconnaissance {RUN_ID}",
            "department": "UAV Flight Operations",
            "role": ROLE_ADMIN,
            "invite_code": code,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["portal_type"] == PORTAL_GOV_ORG
    assert data["user"]["organization_name"] == f"Air Force Reconnaissance {RUN_ID}"
    assert data["user"]["department"] == "UAV Flight Operations"
    assert data["user"]["role"] in ("pending_org_admin", "org_admin", ROLE_ADMIN)
    # Verify httpOnly cookies were set
    assert "access_token" in res.cookies
    assert "refresh_token" in res.cookies


def test_individual_registration():
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": INDIV_EMAIL,
            "password": "SurveyorPass123!",
            "full_name": "Alex Mercer",
            "portal_type": PORTAL_INDIVIDUAL,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["user"]["portal_type"] == PORTAL_INDIVIDUAL
    assert data["user"]["role"] == "OPERATOR"
    assert data["user"]["organization_name"] is None


def test_duplicate_registration_rejected():
    from backend.security import save_invite_code
    code = save_invite_code(f"GOV-INVITE-{RUN_ID}-2", "admin@aeromesh.internal", "UAV", f"Air Force Reconnaissance {RUN_ID}")
    res = client.post(
        "/api/v1/auth/register",
        json={
            "email": GOV_EMAIL,
            "password": "DuplicatePassword123!",
            "portal_type": PORTAL_GOV_ORG,
            "organization_name": f"Air Force Reconnaissance {RUN_ID}",
            "invite_code": code,
        },
    )
    assert res.status_code == 400
    assert "already exists" in res.json()["detail"].lower()


def test_login_and_cookie_issuance():
    res = client.post(
        "/api/v1/auth/login",
        json={
            "email": GOV_EMAIL,
            "password": "DefencePass123!",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "access_token" in data
    assert "refresh_token" in data
    assert "access_token" in res.cookies


def test_guest_session_creation():
    res = client.post("/api/v1/auth/guest")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["user"]["portal_type"] == PORTAL_GUEST
    assert data["user"]["guest_expires_at"] is not None
    assert "access_token" in data
    assert "refresh_token" in data
    assert "access_token" in res.cookies


def test_token_refresh():
    # Login to get refresh token
    login_res = client.post(
        "/api/v1/auth/login",
        json={
            "email": GOV_EMAIL,
            "password": "DefencePass123!",
        },
    )
    refresh_token = login_res.json()["refresh_token"]

    # Call refresh endpoint with payload
    ref_res = client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert ref_res.status_code == 200
    ref_data = ref_res.json()
    assert ref_data["success"] is True
    assert "access_token" in ref_data


def test_org_team_invite():
    # Login as Gov/Org Admin
    login_res = client.post(
        "/api/v1/auth/login",
        json={
            "email": GOV_EMAIL,
            "password": "DefencePass123!",
        },
    )
    admin_token = login_res.json()["access_token"]

    invite_res = client.post(
        "/api/v1/auth/invite",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "email": INVITE_EMAIL,
            "role": ROLE_ANALYST,
            "department": "Imagery Analysis Cell",
            "full_name": "Priya Verma",
        },
    )
    assert invite_res.status_code == 200
    invite_data = invite_res.json()
    assert invite_data["success"] is True
    assert invite_data["invited_user"]["organization_name"] == f"Air Force Reconnaissance {RUN_ID}"
    assert invite_data["invited_user"]["role"] == ROLE_ANALYST
    assert "temporary_password" in invite_data


def test_audit_log_scoped_to_organization():
    login_res = client.post(
        "/api/v1/auth/login",
        json={
            "email": GOV_EMAIL,
            "password": "DefencePass123!",
        },
    )
    admin_token = login_res.json()["access_token"]

    audit_res = client.get(
        "/api/v1/auth/audit-log",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert audit_res.status_code == 200
    audit_data = audit_res.json()
    assert audit_data["success"] is True
    assert audit_data["organization"] == f"Air Force Reconnaissance {RUN_ID}"
    assert len(audit_data["events"]) >= 1


def test_per_user_and_org_mission_isolation():
    # 1. Create a mission as Org User (Commander)
    login_gov = client.post(
        "/api/v1/auth/login",
        json={
            "email": GOV_EMAIL,
            "password": "DefencePass123!",
        },
    )
    gov_token = login_gov.json()["access_token"]
    gov_mission = client.post(
        "/api/v1/missions",
        headers={"Authorization": f"Bearer {gov_token}"},
        params={"name": f"Border Sector Alpha {RUN_ID}", "location": "Western Border Sector"},
    ).json()["mission"]

    # 2. Create a mission as Individual User (Alex)
    login_indiv = client.post(
        "/api/v1/auth/login",
        json={
            "email": INDIV_EMAIL,
            "password": "SurveyorPass123!",
        },
    )
    indiv_token = login_indiv.json()["access_token"]
    indiv_mission = client.post(
        "/api/v1/missions",
        headers={"Authorization": f"Bearer {indiv_token}"},
        params={"name": f"Private Survey {RUN_ID}", "location": "Valley Farm"},
    ).json()["mission"]

    # 3. List missions as Individual User (Alex) -> should see their mission, NOT the org's mission
    alex_missions = client.get(
        "/api/v1/missions",
        headers={"Authorization": f"Bearer {indiv_token}"},
    ).json()["missions"]
    alex_mission_ids = [m["id"] for m in alex_missions]
    assert indiv_mission["id"] in alex_mission_ids
    assert gov_mission["id"] not in alex_mission_ids

    # 4. List missions as Gov User -> should see the Org mission, NOT Alex's personal mission
    gov_missions = client.get(
        "/api/v1/missions",
        headers={"Authorization": f"Bearer {gov_token}"},
    ).json()["missions"]
    gov_mission_ids = [m["id"] for m in gov_missions]
    assert gov_mission["id"] in gov_mission_ids
    assert indiv_mission["id"] not in gov_mission_ids

    # Cleanup missions
    client.delete(f"/api/v1/missions/{gov_mission['id']}", headers={"Authorization": f"Bearer {gov_token}"})
    client.delete(f"/api/v1/missions/{indiv_mission['id']}", headers={"Authorization": f"Bearer {indiv_token}"})
