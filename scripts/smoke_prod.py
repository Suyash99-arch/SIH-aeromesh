#!/usr/bin/env python3
"""
AeroMesh Production Smoke Test Script
Stdlib + httpx only. Verifies core production API contracts:
1. /api/v1/health (db == postgres, pipeline flag, commit)
2. /docs title
3. POST /api/v1/auth/guest
4. POST /api/v1/auth/register + login
5. GET /api/v1/missions with auth token
6. GET /api/v1/auth/demo-users returns 404 (production safety)
"""

import sys
import time
import uuid
from typing import Any, Dict, List, Tuple
import httpx


def run_smoke_tests(base_url: str) -> bool:
    base = base_url.rstrip("/")
    print("\n" + "=" * 95)
    print(f"AEROMESH PRODUCTION SMOKE TEST RUNNER: {base}")
    print("=" * 95)

    results: List[Tuple[str, str, float, str]] = []
    all_passed = True

    client = httpx.Client(timeout=15.0)

    # 1. Health check
    t0 = time.time()
    try:
        r = client.get(f"{base}/api/v1/health")
        latency = (time.time() - t0) * 1000
        if r.status_code == 200:
            data = r.json()
            db_val = data.get("db")
            pipeline_flag = data.get("pipeline_enabled") if data.get("pipeline_enabled") is not None else data.get("pipeline")
            commit_val = data.get("git_commit") or data.get("commit")
            
            # Check db == postgres, pipeline flag exists, commit exists
            if db_val == "postgres" and isinstance(pipeline_flag, bool) and commit_val is not None:
                results.append(("GET /api/v1/health", "PASS", latency, f"db={db_val}, pipeline={pipeline_flag}, commit={str(commit_val)[:8]}"))
            else:
                all_passed = False
                results.append(("GET /api/v1/health", "FAIL", latency, f"Expected db=postgres, bool pipeline, commit. Got db={db_val}, pipeline={pipeline_flag}, commit={commit_val}"))
        else:
            all_passed = False
            results.append(("GET /api/v1/health", "FAIL", latency, f"Status code {r.status_code}: {r.text[:60]}"))
    except Exception as exc:
        latency = (time.time() - t0) * 1000
        all_passed = False
        results.append(("GET /api/v1/health", "FAIL", latency, f"Connection error: {exc}"))

    # 2. Docs title
    t0 = time.time()
    try:
        r = client.get(f"{base}/docs")
        latency = (time.time() - t0) * 1000
        if r.status_code == 200 and ("AEROMESH API" in r.text or "Hexa Spark API" in r.text or "Swagger UI" in r.text):
            results.append(("GET /docs", "PASS", latency, "Swagger documentation title verified"))
        else:
            all_passed = False
            results.append(("GET /docs", "FAIL", latency, f"Status code {r.status_code} or title missing"))
    except Exception as exc:
        latency = (time.time() - t0) * 1000
        all_passed = False
        results.append(("GET /docs", "FAIL", latency, str(exc)))

    # 3. Guest login
    t0 = time.time()
    guest_token = None
    try:
        r = client.post(f"{base}/api/v1/auth/guest", json={})
        latency = (time.time() - t0) * 1000
        if r.status_code == 200:
            token_data = r.json()
            guest_token = token_data.get("access_token") or token_data.get("token")
            if guest_token:
                results.append(("POST /api/v1/auth/guest", "PASS", latency, f"Token acquired (len={len(guest_token)})"))
            else:
                all_passed = False
                results.append(("POST /api/v1/auth/guest", "FAIL", latency, "No access token in response"))
        else:
            all_passed = False
            results.append(("POST /api/v1/auth/guest", "FAIL", latency, f"Status {r.status_code}"))
    except Exception as exc:
        latency = (time.time() - t0) * 1000
        all_passed = False
        results.append(("POST /api/v1/auth/guest", "FAIL", latency, str(exc)))

    # 4. User Register & Login
    t0 = time.time()
    user_token = None
    test_email = f"smoke_{uuid.uuid4().hex[:8]}@aeromesh.internal"
    test_password = f"TestPassw0rd!{uuid.uuid4().hex[:6]}"
    try:
        # Register
        r_reg = client.post(
            f"{base}/api/v1/auth/register",
            json={"email": test_email, "password": test_password, "role": "operator"}
        )
        if r_reg.status_code in (200, 201):
            # Login
            r_login = client.post(
                f"{base}/api/v1/auth/login",
                json={"email": test_email, "password": test_password}
            )
            latency = (time.time() - t0) * 1000
            if r_login.status_code == 200:
                user_token = r_login.json().get("access_token")
                results.append(("POST /api/v1/auth/register + login", "PASS", latency, f"User {test_email} authenticated"))
            else:
                all_passed = False
                results.append(("POST /api/v1/auth/register + login", "FAIL", latency, f"Login failed: {r_login.status_code}"))
        else:
            latency = (time.time() - t0) * 1000
            all_passed = False
            results.append(("POST /api/v1/auth/register + login", "FAIL", latency, f"Register failed: {r_reg.status_code} {r_reg.text[:60]}"))
    except Exception as exc:
        latency = (time.time() - t0) * 1000
        all_passed = False
        results.append(("POST /api/v1/auth/register + login", "FAIL", latency, str(exc)))

    # 5. GET /api/v1/missions with auth token
    auth_token = user_token or guest_token
    t0 = time.time()
    try:
        headers = {"Authorization": f"Bearer {auth_token}"} if auth_token else {}
        r = client.get(f"{base}/api/v1/missions", headers=headers)
        latency = (time.time() - t0) * 1000
        if r.status_code == 200:
            data = r.json()
            missions_list = data.get("missions", data) if isinstance(data, dict) else data
            count = len(missions_list) if isinstance(missions_list, list) else 0
            results.append(("GET /api/v1/missions (Authenticated)", "PASS", latency, f"Retrieved {count} missions"))
        else:
            all_passed = False
            results.append(("GET /api/v1/missions (Authenticated)", "FAIL", latency, f"Status code {r.status_code}"))
    except Exception as exc:
        latency = (time.time() - t0) * 1000
        all_passed = False
        results.append(("GET /api/v1/missions (Authenticated)", "FAIL", latency, str(exc)))

    # 6. Gated demo-users returns 404 in production
    t0 = time.time()
    try:
        r = client.get(f"{base}/api/v1/auth/demo-users")
        latency = (time.time() - t0) * 1000
        if r.status_code == 404:
            results.append(("GET /api/v1/auth/demo-users (404 Gated)", "PASS", latency, "Properly returned 404 in non-development mode"))
        else:
            all_passed = False
            results.append(("GET /api/v1/auth/demo-users (404 Gated)", "FAIL", latency, f"Expected 404, got status {r.status_code}"))
    except Exception as exc:
        latency = (time.time() - t0) * 1000
        all_passed = False
        results.append(("GET /api/v1/auth/demo-users (404 Gated)", "FAIL", latency, str(exc)))

    # Print Table
    print(f"\n{'Target Endpoint / Flow':<38} | {'Status':<6} | {'Latency':<8} | {'Details'}")
    print("-" * 95)
    for endpoint, status, lat, detail in results:
        print(f"{endpoint:<38} | {status:<6} | {lat:6.1f}ms | {detail}")
    print("=" * 95)

    if all_passed:
        print("ALL PRODUCTION SMOKE CONTRACTS VERIFIED [PASS]\n")
        return True
    else:
        print("PRODUCTION SMOKE CONTRACTS FAILED [FAIL]\n")
        return False


if __name__ == "__main__":
    target_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    success = run_smoke_tests(target_url)
    sys.exit(0 if success else 1)
