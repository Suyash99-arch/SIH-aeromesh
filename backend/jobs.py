from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select

from .database import get_configured_engine, session_scope
from .models import ProcessingJob

JOB_STAGES = (
    "QUEUED", "VALIDATING", "EXTRACTING_FRAMES", "DETECTING_OBJECTS",
    "TRACKING", "RECONSTRUCTING", "GENERATING_MESH", "ANALYZING",
    "COMPLETED", "FAILED",
)
_local_jobs: dict[str, dict[str, Any]] = {}


def _now():
    return datetime.utcnow().isoformat()


def create_job(mission_id: str, parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    payload = {"id": job_id, "mission_id": mission_id, "status": "QUEUED", "stage": "QUEUED", "progress_percent": 0, "message": "Job queued", "error_message": None, "created_at": _now(), "started_at": None, "completed_at": None, "parameters": parameters or {}}
    engine = get_configured_engine()
    if engine is not None:
        try:
            with session_scope(engine) as session:
                job = ProcessingJob(id=_numeric_id(job_id), mission_id=mission_id, status="QUEUED", stage="QUEUED", parameters=payload["parameters"], result={})
                session.add(job)
                session.flush()
                payload["id"] = str(job.id)
        except Exception:
            pass
    _local_jobs[payload["id"]] = payload
    return payload


def get_job(job_id: str) -> dict[str, Any] | None:
    if job_id in _local_jobs:
        return dict(_local_jobs[job_id])
    engine = get_configured_engine()
    if engine is None or not job_id.isdigit():
        return None
    try:
        with session_scope(engine) as session:
            job = session.get(ProcessingJob, int(job_id))
            return _serialize(job) if job else None
    except Exception:
        return None


def update_job(job_id: str, *, status: str | None = None, stage: str | None = None, progress_percent: int | None = None, message: str | None = None, error_message: str | None = None) -> dict[str, Any] | None:
    job = _local_jobs.get(job_id)
    if job is not None:
        if status is not None: job["status"] = status
        if stage is not None: job["stage"] = stage
        if progress_percent is not None: job["progress_percent"] = progress_percent
        if message is not None: job["message"] = message
        if error_message is not None: job["error_message"] = error_message
        if status == "FAILED" or stage == "FAILED": job["completed_at"] = _now()
        return dict(job)
    engine = get_configured_engine()
    if engine is None or not job_id.isdigit():
        return None
    try:
        with session_scope(engine) as session:
            job = session.get(ProcessingJob, int(job_id))
            if job is None:
                return None
            if status is not None: job.status = status
            if stage is not None: job.stage = stage
            if progress_percent is not None: job.progress_percent = progress_percent
            if message is not None: job.message = message
            if error_message is not None: job.error_message = error_message
            if status in {"VALIDATING", "EXTRACTING_FRAMES"} and job.started_at is None: job.started_at = datetime.utcnow()
            if status in {"COMPLETED", "FAILED"}: job.completed_at = datetime.utcnow()
            session.flush()
            return _serialize(job)
    except Exception:
        return None


def _numeric_id(job_id: str) -> int:
    return int(job_id[:15], 16) % 2147483647


def _serialize(job: ProcessingJob) -> dict[str, Any]:
    return {"id": str(job.id), "mission_id": job.mission_id, "status": job.status, "stage": job.stage, "progress_percent": job.progress_percent, "message": job.message, "error_message": job.error_message, "created_at": job.created_at.isoformat(), "started_at": job.started_at.isoformat() if job.started_at else None, "completed_at": job.completed_at.isoformat() if job.completed_at else None, "parameters": job.parameters}