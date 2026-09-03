from __future__ import annotations

from .jobs import update_job

try:
    from celery import Celery
except ImportError:  # pragma: no cover
    Celery = None


celery_app = Celery("aeromesh", broker=None, backend=None) if Celery else None
if celery_app is not None:
    celery_app.conf.broker_url = __import__("os").getenv("REDIS_URL", "redis://localhost:6379/0")
    celery_app.conf.result_backend = celery_app.conf.broker_url


def _placeholder(job_id: str):
    update_job(job_id, status="COMPLETED", stage="COMPLETED", progress_percent=100, message="Placeholder pipeline completed; expensive processing is not enabled in Phase 3")
    return get_job_result(job_id)


def get_job_result(job_id):
    from .jobs import get_job
    return get_job(job_id)


def _register(name):
    if celery_app is None:
        return _placeholder
    return celery_app.task(name=f"aeromesh.{name}")(_placeholder)


validate_video = _register("validate_video")
extract_frames = _register("extract_frames")
detect_objects = _register("detect_objects")
track_objects = _register("track_objects")
reconstruct = _register("reconstruct")
generate_mesh = _register("generate_mesh")
analyze = _register("analyze")
generate_report = _register("generate_report")
run_processing_pipeline = _register("run_processing_pipeline")


def enqueue_processing_job(job_id: str):
    if celery_app is None or not __import__("os").getenv("REDIS_URL", "").strip():
        return run_processing_pipeline(job_id)
    return run_processing_pipeline.delay(job_id)