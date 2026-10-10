from __future__ import annotations

import hashlib
import os
import threading
import time
from pathlib import Path

import psutil
from fastapi.testclient import TestClient

from backend import main


def test_large_chunk_upload_is_resumable_and_disk_streamed(tmp_path, monkeypatch):
    client = TestClient(main.app)
    monkeypatch.setenv("PIPELINE_MODE", "light")
    monkeypatch.setattr(main, "is_lightweight_profile", lambda: True)

    mission_response = client.post("/api/v1/missions?name=35_MB_Chunk_Test")
    assert mission_response.status_code == 200
    mission_id = mission_response.json()["mission"]["id"]

    source_path = tmp_path / "large-generated.mp4"
    source_size = 35 * 1024 * 1024
    block_size = 1024 * 1024
    with source_path.open("wb") as source:
        first = b"\x00\x00\x00\x20ftypisom" + (b"\x00" * (block_size - 12))
        source.write(first)
        for _ in range(source_size // block_size - 1):
            source.write(os.urandom(block_size))

    def process_uploaded_file(video_path, safe_name, mid, request, storage_metadata):
        return {
            "filename": safe_name,
            "storage_key": storage_metadata.key,
            "size_bytes": video_path.stat().st_size,
            "sha256": storage_metadata.checksum,
            "storage_persistence": "ephemeral",
        }

    monkeypatch.setattr(main, "_process_and_validate_video_file", process_uploaded_file)
    total_chunks = (source_size + main.CHUNK_SIZE_BYTES - 1) // main.CHUNK_SIZE_BYTES
    upload_id = "large_upload_test_id"
    process = psutil.Process(os.getpid())
    baseline_rss = process.memory_info().rss
    peak_rss = [baseline_rss]
    stop_sampling = threading.Event()

    def sample_rss():
        while not stop_sampling.is_set():
            try:
                peak_rss[0] = max(peak_rss[0], process.memory_info().rss)
            except psutil.Error:
                pass
            time.sleep(0.01)

    sampler = threading.Thread(target=sample_rss, daemon=True)
    sampler.start()
    last_response = None
    try:
        # Send an out-of-order partial upload, retry one chunk, then resume from backend state.
        order = [8, 0, total_chunks - 1, 1, 8]
        with source_path.open("rb") as source:
            for index in order:
                start = index * main.CHUNK_SIZE_BYTES
                source.seek(start)
                payload = source.read(min(main.CHUNK_SIZE_BYTES, source_size - start))
                response = client.post(
                    f"/api/v1/missions/{mission_id}/upload/chunk",
                    params={
                        "chunk_index": index,
                        "total_chunks": total_chunks,
                        "upload_id": upload_id,
                        "filename": source_path.name,
                    },
                    files={"chunk": (source_path.name, payload, "video/mp4")},
                )
                assert response.status_code == 200, response.text
                last_response = response.json()

            status_response = client.get(
                f"/api/v1/missions/{mission_id}/upload-status",
                params={"upload_id": upload_id, "total_chunks": total_chunks},
            )
            assert status_response.status_code == 200
            received_chunks = status_response.json()["received_chunks"]
            assert received_chunks == sorted(set(order))

            for index in range(total_chunks):
                if index in received_chunks:
                    continue
                start = index * main.CHUNK_SIZE_BYTES
                source.seek(start)
                payload = source.read(min(main.CHUNK_SIZE_BYTES, source_size - start))
                response = client.post(
                    f"/api/v1/missions/{mission_id}/upload/chunk",
                    params={
                        "chunk_index": index,
                        "total_chunks": total_chunks,
                        "upload_id": upload_id,
                        "filename": source_path.name,
                    },
                    files={"chunk": (source_path.name, payload, "video/mp4")},
                )
                assert response.status_code == 200, response.text
                last_response = response.json()

        assert last_response["status"] == "upload_complete"
        assert last_response["processing"]["heavy_reconstruction_available"] is False
    finally:
        stop_sampling.set()
        sampler.join(timeout=2)

    status_response = client.get(
        f"/api/v1/missions/{mission_id}/upload-status",
        params={"upload_id": upload_id, "total_chunks": total_chunks},
    )
    assert status_response.status_code == 200
    status_data = status_response.json()
    assert status_data["complete"] is True
    assert status_data["received_chunks"] == list(range(total_chunks))

    stored_video = (
        Path(os.environ["OBJECT_STORAGE_ROOT"])
        / "missions"
        / mission_id
        / "original"
        / source_path.name
    )
    digest = hashlib.sha256()
    with stored_video.open("rb") as uploaded:
        for chunk in iter(lambda: uploaded.read(1024 * 1024), b""):
            digest.update(chunk)
    with source_path.open("rb") as source:
        expected_digest = hashlib.sha256(source.read()).hexdigest()
    assert digest.hexdigest() == expected_digest
    rss_growth_mb = (peak_rss[0] - baseline_rss) / (1024 * 1024)
    print(f"Chunk upload sampled RSS growth: {rss_growth_mb:.1f} MB")
    assert rss_growth_mb < 100


def test_health_and_upload_config_are_lightweight():
    client = TestClient(main.app)
    health = client.get("/api/v1/health")
    config = client.get("/api/v1/config")
    engine = client.get("/api/v1/ai-engine/status")

    assert health.status_code == 200
    assert health.json()["status"] == "healthy"
    assert config.status_code == 200
    assert config.json()["max_upload_size_bytes"] == main.MAX_UPLOAD_SIZE_BYTES
    assert config.json()["chunk_size_bytes"] == 2 * 1024 * 1024
    assert engine.status_code == 200


def test_vercel_upload_preflight_allows_upload_headers():
    client = TestClient(main.app)
    origin = "https://sih-aeromesh-blond.vercel.app"
    response = client.options(
        "/api/v1/missions/test/upload/chunk",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": (
                "authorization,content-type,ngrok-skip-browser-warning,"
                "x-chunk-index,x-total-chunks,x-upload-id"
            ),
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    allowed_headers = response.headers["access-control-allow-headers"].lower()
    assert "ngrok-skip-browser-warning" in allowed_headers
    assert "x-upload-id" in allowed_headers
