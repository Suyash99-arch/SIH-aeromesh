"""
Concurrency and Atomic Write Test.
Verifies that rapid background worker updates to mission data do not produce
transient 404s, half-written JSON reads, or race conditions across endpoints:
- GET /api/v1/missions/{id}
- GET /api/v1/missions/{id}/summary
- GET /api/v1/missions/{id}/processing-status
"""

import time
import uuid
import threading
from starlette.testclient import TestClient
from backend.main import app, MissionData


def test_concurrent_reads_during_active_worker_writes():
    client = TestClient(app)
    
    # 1. Create a test mission
    res = client.post("/api/v1/missions?name=Concurrency_Stress_Test")
    assert res.status_code == 200
    mission_id = res.json()["mission"]["id"]

    stop_event = threading.Event()
    worker_error = []
    reader_errors = []

    # 2. Background worker continuously updating mission data with atomic saves
    def background_worker():
        step = 0
        try:
            m_data = MissionData(mission_id)
            while not stop_event.is_set():
                step += 1
                m_data.update({
                    "progress": step % 100,
                    "current_stage": f"Stage_{step % 8}",
                    "detections": {"count": step * 10, "uniqueTracks": step * 2},
                    "reconstruction": {"sparse_point_count": step * 50, "registered_cameras": min(step, 30)},
                })
                time.sleep(0.002)
        except Exception as exc:
            worker_error.append(str(exc))

    worker_thread = threading.Thread(target=background_worker)
    worker_thread.daemon = True
    worker_thread.start()

    # 3. Multiple concurrent reader threads making 200 API calls total
    def reader_task(endpoint_template, iterations=50):
        for _ in range(iterations):
            url = endpoint_template.format(id=mission_id)
            resp = client.get(url)
            if resp.status_code != 200:
                reader_errors.append(f"HTTP {resp.status_code} on {url}: {resp.text}")

    threads = [
        threading.Thread(target=reader_task, args=("/api/v1/missions/{id}", 70)),
        threading.Thread(target=reader_task, args=("/api/v1/missions/{id}/summary", 70)),
        threading.Thread(target=reader_task, args=("/api/v1/missions/{id}/processing-status", 60)),
    ]

    for t in threads:
        t.start()
    for t in threads:
        t.join()

    stop_event.set()
    worker_thread.join(timeout=2.0)

    # Assert 0 worker errors and 0 reader 404s/errors
    assert not worker_error, f"Worker crashed: {worker_error}"
    assert not reader_errors, f"Encountered transient 404/read errors: {reader_errors}"
