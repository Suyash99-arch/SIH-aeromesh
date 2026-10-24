#!/usr/bin/env python3
"""
Test 3 completed missions on local backend:
Checks reconstruction status, tier used, quality label, 3D points, mesh, 3D objects, and video streaming.
"""
import requests
import json

BASE_URL = "http://127.0.0.1:8000/api/v1"

def test_missions():
    # 1. Fetch mission list
    resp = requests.get(f"{BASE_URL}/missions", timeout=5)
    assert resp.status_code == 200, f"Failed fetching missions: {resp.status_code}"
    data = resp.json()
    missions = data.get("missions", [])
    print(f"Total missions available: {len(missions)}")

    target_mission_ids = [
        "1d0633fe-e21c-4f6c-8be5-031c785cd52a",
        "272d28b4-d52b-4f4b-aaec-f2b2113d9d6c",
        "8a2db1c2-8635-4377-aff4-6226c915fb8c",
    ]
    active_missions = [m for m in missions if m.get("id") in target_mission_ids]
    if not active_missions:
        active_missions = [{"id": mid} for mid in target_mission_ids]

    if not active_missions:
        active_missions = missions[:3]

    print(f"Found {len(active_missions)} candidate missions. Testing up to 3...")

    tested = 0
    for m in active_missions:
        m_id = m.get("id")
        m_name = m.get("name") or m_id[:8]
        m_status = m.get("status")

        # Fetch detail
        m_resp = requests.get(f"{BASE_URL}/missions/{m_id}", timeout=5)
        if m_resp.status_code != 200:
            continue

        detail = m_resp.json().get("mission", {})
        recon = detail.get("reconstruction", {})
        pts = recon.get("point_count") or recon.get("sparse_point_count") or 0
        tier = recon.get("tier_used", "N/A")
        quality = recon.get("quality_label", "N/A")
        mesh_st = (recon.get("mesh") or {}).get("status", "NONE")
        objs = len(detail.get("objects_3d", []))

        # Check endpoints
        pc_r = requests.get(f"{BASE_URL}/missions/{m_id}/reconstruction/pointcloud", headers={"Range": "bytes=0-100"}, timeout=3)
        mesh_r = requests.get(f"{BASE_URL}/missions/{m_id}/reconstruction/mesh", headers={"Range": "bytes=0-100"}, timeout=3)
        vid_r = requests.get(f"{BASE_URL}/missions/{m_id}/video", headers={"Range": "bytes=0-100"}, timeout=3)

        print("-" * 75)
        print(f"Mission: {m_name} ({m_id})")
        print(f"  Status: {m_status} | Tier: {tier} | Quality: {quality}")
        print(f"  Points: {pts:,} | Mesh: {mesh_st} | 3D Objects: {objs}")
        print(f"  Point Cloud HTTP: {pc_r.status_code} | Mesh HTTP: {mesh_r.status_code} | Video HTTP: {vid_r.status_code}")

        tested += 1
        if tested >= 3:
            break

    print("-" * 75)
    print("Verification complete.")

if __name__ == "__main__":
    test_missions()
