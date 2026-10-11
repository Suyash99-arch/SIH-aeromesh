from fastapi.testclient import TestClient

from backend import main
from backend import reconstructability


def test_hover_or_rotation_warning_does_not_block_upload_or_processing(
    synthetic_video_path, monkeypatch
):
    warning_result = {
        "score": 72,
        "is_reconstructable": False,
        "motion_type": "HOVER_OR_ROTATION",
        "warning": "Camera motion looks like a hover or rotation; reconstruction may be incomplete",
        "shooting_guidance": "Capture a moving baseline with overlap.",
    }
    monkeypatch.setattr(
        reconstructability,
        "analyze_video_reconstructability",
        lambda _video_path: warning_result,
    )
    monkeypatch.setattr(main, "is_lightweight_profile", lambda: False)
    monkeypatch.setattr(main, "is_pipeline_enabled", lambda: True)
    monkeypatch.setattr(main, "_dispatch_task_wrapper", lambda _task_kwargs: None)

    client = TestClient(main.app)
    created = client.post("/api/v1/missions", params={"name": "Advisory Check Test"})
    assert created.status_code == 200
    mission_id = created.json()["mission"]["id"]

    uploaded = client.post(
        f"/api/v1/missions/{mission_id}/upload",
        files={
            "file": (
                "hover-or-rotation.mp4",
                synthetic_video_path.read_bytes(),
                "video/mp4",
            )
        },
    )
    assert uploaded.status_code == 200, uploaded.text
    upload_body = uploaded.json()
    assert upload_body["video"]["reconstructability"]["motion_type"] == "HOVER_OR_ROTATION"
    assert upload_body["processing"]["heavy_reconstruction_available"] is True

    processed = client.post(f"/api/v1/missions/{mission_id}/process", json={})
    assert processed.status_code == 200, processed.text
    assert processed.json()["success"] is True
    assert processed.json()["status"] in {"PROCESSING", "QUEUED"}
    assert processed.json().get("job_id")
