import pytest
from fastapi.testclient import TestClient
import backend.main as main


@pytest.fixture
def test_app():
    return TestClient(main.app)


def test_new_guest_sees_empty_dashboard(test_app):
    """A new guest evaluator has no missions and must see an empty dashboard."""
    # 1. Login as guest
    guest_res = test_app.post("/api/v1/auth/guest")
    assert guest_res.status_code == 200
    token = guest_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 2. List missions
    list_res = test_app.get("/api/v1/missions", headers=headers)
    assert list_res.status_code == 200
    data = list_res.json()
    missions = data.get("missions", [])

    # Must be completely empty - no other users' missions
    assert missions == [], f"Expected empty dashboard for new guest, got: {[m.get('id') for m in missions]}"


def test_validation_missions_excluded_for_real_users(test_app):
    """Test and benchmark missions must never leak into normal mission lists."""
    guest_res = test_app.post("/api/v1/auth/guest")
    token = guest_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    list_res = test_app.get("/api/v1/missions", headers=headers)
    data = list_res.json()
    mission_ids = [m.get("id") for m in data.get("missions", [])]

    for m_id in mission_ids:
        assert not str(m_id).startswith("test_")


def test_guest_isolated_to_own_session(test_app):
    """Guest A creates a mission; Guest A sees it; Guest B sees an empty dashboard."""
    # Guest A
    res_a = test_app.post("/api/v1/auth/guest")
    token_a = res_a.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    create_res = test_app.post(
        "/api/v1/missions",
        params={"name": "Guest A Mission", "location": "Test Area"},
        headers=headers_a,
    )
    assert create_res.status_code == 200
    mission_id_a = create_res.json()["mission"]["id"]

    # Guest A listing
    list_a = test_app.get("/api/v1/missions", headers=headers_a).json()["missions"]
    assert len(list_a) == 1
    assert list_a[0]["id"] == mission_id_a

    # Guest B
    res_b = test_app.post("/api/v1/auth/guest")
    token_b = res_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    list_b = test_app.get("/api/v1/missions", headers=headers_b).json()["missions"]
    assert list_b == [], f"Guest B should see empty dashboard, but saw: {list_b}"


def test_government_org_multi_tenant_scoping(test_app):
    """Government users within the same agency share missions, but cannot see other agencies' missions."""
    # Org Alpha User
    alpha_token = main.create_access_token({
        "sub": "alpha_op@fire.gov",
        "user_id": "usr_alpha_1",
        "role": main.ROLE_OPERATOR,
        "portal_type": main.PORTAL_GOV_ORG,
        "organization_name": "Alpha Fire Dept",
        "department": "Rescue",
    })
    headers_alpha = {"Authorization": f"Bearer {alpha_token}"}

    create_alpha = test_app.post(
        "/api/v1/missions",
        params={"name": "Alpha Dept Incident"},
        headers=headers_alpha,
    )
    assert create_alpha.status_code == 200
    alpha_mission_id = create_alpha.json()["mission"]["id"]

    # Org Alpha Colleague (same agency)
    colleague_token = main.create_access_token({
        "sub": "alpha_chief@fire.gov",
        "user_id": "usr_alpha_2",
        "role": main.ROLE_ADMIN,
        "portal_type": main.PORTAL_GOV_ORG,
        "organization_name": "Alpha Fire Dept",
        "department": "Command",
    })
    headers_colleague = {"Authorization": f"Bearer {colleague_token}"}

    colleague_missions = test_app.get("/api/v1/missions", headers=headers_colleague).json()["missions"]
    alpha_ids = [m["id"] for m in colleague_missions]
    assert alpha_mission_id in alpha_ids, "Colleague in same org should see the mission"

    # Org Beta User (different agency)
    beta_token = main.create_access_token({
        "sub": "beta_op@police.gov",
        "user_id": "usr_beta_1",
        "role": main.ROLE_OPERATOR,
        "portal_type": main.PORTAL_GOV_ORG,
        "organization_name": "Beta Police Dept",
        "department": "Aviation",
    })
    headers_beta = {"Authorization": f"Bearer {beta_token}"}

    beta_missions = test_app.get("/api/v1/missions", headers=headers_beta).json()["missions"]
    beta_ids = [m["id"] for m in beta_missions]
    assert alpha_mission_id not in beta_ids, "Agency B should not see Agency A missions"

    # Individual User (no org)
    indiv_token = main.create_access_token({
        "sub": "civilian@example.com",
        "user_id": "usr_indiv_1",
        "role": main.ROLE_OPERATOR,
        "portal_type": main.PORTAL_INDIVIDUAL,
        "organization_name": None,
    })
    headers_indiv = {"Authorization": f"Bearer {indiv_token}"}

    indiv_missions = test_app.get("/api/v1/missions", headers=headers_indiv).json()["missions"]
    indiv_ids = [m["id"] for m in indiv_missions]
    assert alpha_mission_id not in indiv_ids, "Individual user should not see org missions"
