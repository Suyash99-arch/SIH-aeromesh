from __future__ import annotations

import hashlib
import os
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import psutil
from fastapi.testclient import TestClient
from starlette.requests import Request

from backend import main
from backend import video_ingest


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


def test_lightweight_upload_succeeds_without_preview_dependencies(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "is_lightweight_profile", lambda: True)
    monkeypatch.setattr(video_ingest, "cv2", None)
    monkeypatch.setattr(main.shutil, "which", lambda name: None if name == "ffprobe" else "/usr/bin/ffmpeg")

    client = TestClient(main.app)
    mission_response = client.post("/api/v1/missions?name=Preview_Unavailable_Test")
    assert mission_response.status_code == 200
    mission_id = mission_response.json()["mission"]["id"]
    video_path = tmp_path / "stored-original.mp4"
    video_path.write_bytes(b"stored original video")
    request = Request({
        "type": "http",
        "method": "POST",
        "scheme": "http",
        "path": "/api/v1/missions/upload/chunk",
        "headers": [],
        "server": ("testserver", 80),
        "client": ("testclient", 123),
    })

    video_info = main._process_and_validate_video_file(
        video_path,
        "stored-original.mp4",
        mission_id,
        request,
        SimpleNamespace(
            key=f"missions/{mission_id}/original/stored-original.mp4",
            content_type="video/mp4",
            size=video_path.stat().st_size,
            checksum="test-checksum",
        ),
    )

    assert video_info["preview_available"] is False
    assert video_info["thumbnails"] == []
    assert video_info["resolution"] is None
    assert "preview unavailable" in video_info["processing_message"].lower()
    assert (main.MISSIONS_DIR / mission_id / "video.mp4").read_bytes() == video_path.read_bytes()


def test_unhandled_chunk_error_includes_cors_request_id_and_traceback(monkeypatch, caplog):
    import io
    import logging

    def fail_assembly(*args, **kwargs):
        raise RuntimeError("forced chunk assembly failure")

    monkeypatch.setattr(main, "assemble_chunks", fail_assembly)
    client = TestClient(main.app, raise_server_exceptions=False)
    mission_response = client.post("/api/v1/missions?name=Forced_Chunk_Error_Test")
    assert mission_response.status_code == 200
    mission_id = mission_response.json()["mission"]["id"]
    origin = "https://sih-aeromesh-blond.vercel.app"

    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    handler.addFilter(main._CredentialRedactionFilter())
    main.logger.addHandler(handler)
    try:
        response = client.post(
            f"/api/v1/missions/{mission_id}/upload/chunk",
            params={
                "chunk_index": 0,
                "total_chunks": 1,
                "upload_id": "forced_chunk_error_test",
                "filename": "test.mp4",
            },
            files={"chunk": ("test.mp4", b"small test video", "video/mp4")},
            headers={"Origin": origin},
        )
    finally:
        main.logger.removeHandler(handler)
        handler.close()
    emitted_log = output.getvalue()

    assert response.status_code == 500
    assert response.headers["access-control-allow-origin"] == origin
    body = response.json()
    assert body["error"] == "INTERNAL_ERROR"
    assert body["request_id"]
    assert body["stage"] == "assemble"
    assert body["error_type"] == "RuntimeError"
    assert "forced chunk assembly failure" not in response.text
    assert f"request_id={body['request_id']}" in caplog.text
    assert "method=POST" in caplog.text
    assert "/api/v1/missions/" in caplog.text
    assert "stage=assemble" in caplog.text
    assert "forced chunk assembly failure" in caplog.text
    assert "Traceback (most recent call last)" in caplog.text
    assert "Chunk finalize failed stage=assemble" in emitted_log
    assert "Unhandled server exception" in emitted_log
    assert "RuntimeError: forced chunk assembly failure" in emitted_log
    assert "in fail_assembly" in emitted_log


def test_json_safe_converts_nonfinite_and_numpy_metadata():
    import json
    import numpy as np

    normalized = main._json_safe({
        "fps": float("nan"),
        "frames": np.int64(5),
        "resolution": np.array([1920, 1080]),
        "eta": float("inf"),
    })
    assert normalized == {
        "fps": None,
        "frames": 5,
        "resolution": [1920, 1080],
        "eta": None,
    }
    json.dumps(normalized, allow_nan=False)


def test_lightweight_probe_exception_keeps_video_and_reports_preview_unavailable(tmp_path, monkeypatch):
    monkeypatch.setattr(main, "is_lightweight_profile", lambda: True)
    monkeypatch.setattr(main.shutil, "which", lambda _name: "/usr/bin/ffprobe")
    monkeypatch.setattr(video_ingest, "cv2", object())
    monkeypatch.setattr(video_ingest, "probe_video", lambda _path: (_ for _ in ()).throw(RuntimeError("probe failed")))
    monkeypatch.setattr(main, "_record_uploaded_video", lambda *_args, **_kwargs: None)

    source = tmp_path / "input.mp4"
    source.write_bytes(b"\x00\x00\x00\x20ftypisomvideo")
    request = Request({
        "type": "http", "method": "POST", "scheme": "https",
        "path": "/api/v1/missions/upload/chunk", "headers": [],
        "server": ("testserver", 443), "client": ("testclient", 123),
    })
    mission_id = "probe_fail_soft_test"
    metadata = SimpleNamespace(key=f"missions/{mission_id}/original/input.mp4", content_type="video/mp4", size=source.stat().st_size, checksum="abc")

    result = main._process_and_validate_video_file(source, "input.mp4", mission_id, request, metadata)
    assert result["preview_available"] is False
    assert "preview unavailable" in result["processing_message"].lower()
    assert (main.MISSIONS_DIR / mission_id / "video.mp4").read_bytes() == source.read_bytes()


def test_lightweight_validator_exception_uses_conservative_signature_fallback(monkeypatch):
    monkeypatch.setattr(main, "is_lightweight_profile", lambda: True)
    monkeypatch.setattr(main, "validate_uploaded_file", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("validator unavailable")))
    request = Request({
        "type": "http", "method": "POST", "scheme": "https",
        "path": "/api/v1/missions/upload/chunk", "headers": [],
        "server": ("testserver", 443), "client": ("testclient", 123),
    })
    valid, message = main._validate_upload_for_finalize(
        request, "video.mp4", b"\x00\x00\x00\x20ftypisom", 1024,
    )
    assert valid is True
    assert message is None


def test_lightweight_thumbnail_exception_does_not_fail_upload(tmp_path, monkeypatch):
    class FakeCapture:
        def isOpened(self):
            return True

        def get(self, prop):
            return {1: 30.0, 2: 2, 3: 64, 4: 64}.get(prop, 0)

        def set(self, *_args):
            return True

        def read(self):
            import numpy as np
            return True, np.zeros((64, 64, 3), dtype=np.uint8)

        def release(self):
            return None

    class FakeCV2:
        CAP_PROP_FPS = 1
        CAP_PROP_FRAME_COUNT = 2
        CAP_PROP_FRAME_WIDTH = 3
        CAP_PROP_FRAME_HEIGHT = 4
        CAP_PROP_POS_FRAMES = 5
        IMWRITE_JPEG_QUALITY = 6

        @staticmethod
        def VideoCapture(_path):
            return FakeCapture()

        @staticmethod
        def resize(*_args, **_kwargs):
            raise RuntimeError("thumbnail encoder unavailable")

    import backend.eta_engine as eta_engine
    monkeypatch.setattr(main, "is_lightweight_profile", lambda: True)
    monkeypatch.setattr(main.shutil, "which", lambda _name: "/usr/bin/ffprobe")
    monkeypatch.setattr(main, "cv2", FakeCV2)
    monkeypatch.setattr(video_ingest, "cv2", FakeCV2)
    monkeypatch.setattr(video_ingest, "probe_video", lambda _path: {"is_corrupt": False, "codec": "h264", "fps": 30, "duration": 1})
    monkeypatch.setattr(video_ingest, "check_cv2_decodable", lambda _path: (True, ""))
    monkeypatch.setattr(video_ingest, "should_transcode", lambda *_args: (False, ""))
    monkeypatch.setattr(main, "detect_compute_device", lambda: {})
    monkeypatch.setattr(eta_engine, "estimate_pipeline_eta", lambda *_args, **_kwargs: {"eta": 10})
    monkeypatch.setattr(main, "_record_uploaded_video", lambda *_args, **_kwargs: None)

    source = tmp_path / "input.mp4"
    source.write_bytes(b"\x00\x00\x00\x20ftypisomvideo")
    request = Request({
        "type": "http", "method": "POST", "scheme": "https",
        "path": "/api/v1/missions/upload/chunk", "headers": [],
        "server": ("testserver", 443), "client": ("testclient", 123),
    })
    mission_id = "thumbnail_fail_soft_test"
    metadata = SimpleNamespace(key=f"missions/{mission_id}/original/input.mp4", content_type="video/mp4", size=source.stat().st_size, checksum="abc")

    result = main._process_and_validate_video_file(source, "input.mp4", mission_id, request, metadata)
    assert result["thumbnail_preview_available"] is False
    assert result["thumbnails"] == []
    assert "thumbnails are unavailable" in result["processing_message"].lower()


def test_api_profile_cannot_be_overridden_to_heavy(monkeypatch):
    monkeypatch.setenv("PROFILE", "api")
    monkeypatch.setenv("PIPELINE_MODE", "heavy")

    assert main.get_pipeline_mode() == "light"
    assert main.is_lightweight_profile() is True


def test_memory_logging_works_without_psutil(monkeypatch):
    logged_messages = []
    monkeypatch.setattr(main, "psutil", None)
    monkeypatch.setattr(main.logger, "warning", lambda message, *args: logged_messages.append(message % args))

    main.log_process_memory("test_without_psutil")

    assert any("Process memory event=test_without_psutil rss_mb=" in message for message in logged_messages)


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
