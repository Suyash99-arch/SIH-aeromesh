from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from .database import get_configured_engine, session_scope
from .models import ProcessingJob

JOB_STAGES = (
    "QUEUED", "VALIDATING", "EXTRACTING_FRAMES", "DETECTING_OBJECTS",
    "TRACKING", "RECONSTRUCTING", "GENERATING_MESH", "FUSING_3D", "ANALYZING",
    "COMPLETED", "FAILED",
)
JOB_STALL_SECONDS = int(os.getenv("JOB_STALL_SECONDS", "120"))
STAGE_TIMEOUT_SECONDS = int(os.getenv("STAGE_TIMEOUT_SECONDS", "600"))

_local_jobs: dict[str, dict[str, Any]] = {}


def _now():
    return datetime.now(timezone.utc).isoformat()


def create_job(mission_id: str, parameters: dict[str, Any] | None = None) -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    now_str = _now()
    payload = {
        "id": job_id,
        "mission_id": mission_id,
        "status": "QUEUED",
        "stage": "QUEUED",
        "current_stage_id": None,
        "completed_stages": [],
        "failed_stage": None,
        "progress_percent": 0,
        "message": "Job queued",
        "error_message": None,
        "created_at": now_str,
        "started_at": None,
        "completed_at": None,
        "last_heartbeat": now_str,
        "parameters": parameters or {},
        "details": {},
    }
    engine = get_configured_engine()
    if engine is not None:
        try:
            with session_scope(engine) as session:
                job = ProcessingJob(
                    id=_numeric_id(job_id),
                    mission_id=mission_id,
                    status="QUEUED",
                    stage="QUEUED",
                    parameters=payload["parameters"],
                    result={"last_heartbeat": now_str},
                )
                session.add(job)
                session.flush()
                payload["id"] = str(job.id)
        except Exception:
            pass
    _local_jobs[payload["id"]] = payload
    return payload


def record_heartbeat(
    job_id: Any,
    stage: str | None = None,
    progress_percent: int | None = None,
    message: str | None = None,
) -> None:
    """Record worker activity timestamp to prevent watchdog timeout."""
    now_str = _now()
    update_job(
        job_id,
        stage=stage,
        progress_percent=progress_percent,
        message=message,
        details={"last_heartbeat": now_str},
    )


def check_watchdog(job_id: Any = None, stall_threshold_seconds: int = JOB_STALL_SECONDS) -> dict[str, Any] | None:
    """Check if job(s) have stalled without heartbeat and mark FAILED if timed out."""
    targets = [job_id] if job_id else list(_local_jobs.keys())
    now = datetime.now(timezone.utc)
    for jid in targets:
        job = get_job(jid)
        if not job:
            continue
        status = str(job.get("status", "")).upper()
        if status in ("PROCESSING", "RUNNING", "EXTRACTING_FRAMES", "DETECTING_OBJECTS", "TRACKING", "RECONSTRUCTING", "GENERATING_MESH", "FUSING_3D", "VALIDATING"):
            last_hb_str = (job.get("details") or {}).get("last_heartbeat") or job.get("last_heartbeat") or job.get("started_at") or job.get("created_at")
            if last_hb_str:
                try:
                    last_hb = datetime.fromisoformat(last_hb_str.replace("Z", "+00:00"))
                    if last_hb.tzinfo is None:
                        last_hb = last_hb.replace(tzinfo=timezone.utc)
                    elapsed = (now - last_hb).total_seconds()
                    if elapsed > stall_threshold_seconds:
                        stalled_stage = job.get("current_stage_id") or job.get("stage") or "processing"
                        err_msg = f"worker stalled at {stalled_stage} (no heartbeat for {int(elapsed)}s)"
                        return update_job(
                            jid,
                            status="FAILED",
                            stage="FAILED",
                            failed_stage=stalled_stage,
                            error_message=err_msg,
                            message=err_msg,
                        )
                except Exception:
                    pass
    return get_job(job_id) if job_id else None


def get_job(job_id: Any) -> dict[str, Any] | None:
    if isinstance(job_id, dict):
        job_id = str(job_id.get("id"))
    if job_id in _local_jobs:
        return dict(_local_jobs[job_id])
    engine = get_configured_engine()
    if engine is None or not str(job_id).isdigit():
        return None
    try:
        with session_scope(engine) as session:
            job = session.get(ProcessingJob, int(job_id))
            return _serialize(job) if job else None
    except Exception:
        return None


def update_job(
    job_id: Any,
    *,
    status: str | None = None,
    stage: str | None = None,
    progress_percent: int | None = None,
    message: str | None = None,
    error_message: str | None = None,
    current_stage_id: str | None = None,
    completed_stages: list[str] | None = None,
    failed_stage: str | None = None,
    details: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    if isinstance(job_id, dict):
        job_id = str(job_id.get("id"))
    now_str = _now()
    job = _local_jobs.get(job_id)
    if job is not None:
        if status is not None: job["status"] = status
        if stage is not None: job["stage"] = stage
        if progress_percent is not None: job["progress_percent"] = progress_percent
        if message is not None: job["message"] = message
        if error_message is not None: job["error_message"] = error_message
        if current_stage_id is not None: job["current_stage_id"] = current_stage_id
        if completed_stages is not None: job["completed_stages"] = completed_stages
        if failed_stage is not None: job["failed_stage"] = failed_stage
        job["last_heartbeat"] = now_str
        if details is not None:
            job.setdefault("details", {}).update(details)
            job["details"]["last_heartbeat"] = now_str
        if status in {"VALIDATING", "EXTRACTING_FRAMES", "PROCESSING"} and job.get("started_at") is None:
            job["started_at"] = now_str
        if status in {"COMPLETED", "FAILED"} or stage == "FAILED":
            job["completed_at"] = now_str
        return dict(job)

    engine = get_configured_engine()
    if engine is None or not str(job_id).isdigit():
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
            if status in {"VALIDATING", "EXTRACTING_FRAMES"} and job.started_at is None:
                job.started_at = datetime.now(timezone.utc)
            if status in {"COMPLETED", "FAILED"}:
                job.completed_at = datetime.now(timezone.utc)
            curr_res = dict(job.result or {})
            curr_res["last_heartbeat"] = now_str
            if current_stage_id is not None: curr_res["current_stage_id"] = current_stage_id
            if completed_stages is not None: curr_res["completed_stages"] = completed_stages
            if failed_stage is not None: curr_res["failed_stage"] = failed_stage
            if details: curr_res.update(details)
            job.result = curr_res
            session.flush()
            return _serialize(job)
    except Exception:
        return None


def _numeric_id(job_id: str) -> int:
    return int(job_id[:15], 16) % 2147483647


def _serialize(job: ProcessingJob) -> dict[str, Any]:
    res = job.result or {}
    return {
        "id": str(job.id),
        "mission_id": job.mission_id,
        "status": job.status,
        "stage": job.stage,
        "current_stage_id": res.get("current_stage_id"),
        "completed_stages": res.get("completed_stages", []),
        "failed_stage": res.get("failed_stage"),
        "progress_percent": job.progress_percent,
        "message": job.message,
        "error_message": job.error_message,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "last_heartbeat": res.get("last_heartbeat"),
        "parameters": job.parameters,
        "details": res,
    }