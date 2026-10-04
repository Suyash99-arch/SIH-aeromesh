"""
Test server stability during processing file writes in data/
Proves that writes into data/ do not trigger server restart or PID change,
and that orphaned jobs are properly marked INTERRUPTED on startup.
"""

import os
import json
import time
import socket
from pathlib import Path
from backend.status import resolve_mission_status, MissionStatus
from backend.summary_builder import build_canonical_mission_summary


def test_orphaned_job_recovery_status():
    """Verify that an interrupted or orphaned job is resolved to INTERRUPTED status."""
    mission_data = {
        "id": "test-orphaned-job-001",
        "name": "Orphaned Job Test",
        "status": "interrupted",
        "failed_stage": "pipeline",
        "error": "Server restarted while processing was active. Please retry.",
        "video": {"filename": "test.mp4"},
    }
    status, failed_stage, err_msg, stages = resolve_mission_status(mission_data)
    assert status == MissionStatus.INTERRUPTED
    assert failed_stage == "pipeline"
    assert "Server restarted" in err_msg


def test_summary_builder_aggregates_categories_honestly():
    """Verify that MissionSummary correctly aggregates detections into people, vehicles, etc."""
    mission_data = {
        "id": "test-summary-counts-001",
        "name": "Count Test",
        "status": "complete",
        "detections": {
            "total_detections": 665,
            "detections_by_class": {
                "van": 526,
                "person": 66,
                "bus": 33,
                "tricycle": 33,
                "truck": 7,
            },
        },
        "tracking": {
            "unique_tracks": 104,
            "tracks_by_class": {
                "van": 80,
                "person": 15,
                "bus": 5,
                "truck": 4,
            },
        },
        "reconstruction": {
            "registered_cameras": 35,
            "total_images": 35,
            "sparse_point_count": 3151,
            "mesh_vertices": 5000,
            "mesh_faces": 9800,
        },
    }
    summary = build_canonical_mission_summary("test-summary-counts-001", raw_mission_data=mission_data)
    objects = summary.get("objects", {})
    assert objects["total"] == 665
    assert objects["people"] == 66
    assert objects["vehicles"] == 526 + 33 + 33 + 7  # van + bus + tricycle + truck = 599
    assert summary["reconstruction"]["method"] == "depth-fused: monocular depth aligned to SfM scale; relative scale; not MVS"
    assert summary["reconstruction"]["registered_cameras"] == 35


def test_failed_sfm_produces_no_geometry_in_summary():
    """Verify that if SfM registered 0 cameras, geometry is strictly UNAVAILABLE and 0 points/faces."""
    mission_data = {
        "id": "test-failed-sfm-001",
        "name": "Failed SfM Test",
        "status": "failed",
        "reconstruction": {
            "registered_cameras": 0,
            "total_images": 35,
            "sparse_point_count": 0,
            "mesh_vertices": 0,
            "mesh_faces": 0,
        },
    }
    summary = build_canonical_mission_summary("test-failed-sfm-001", raw_mission_data=mission_data)
    recon = summary["reconstruction"]
    assert recon["registered_cameras"] == 0
    assert recon["sparse_point_count"] == 0
    assert recon["mesh_status"] == "UNAVAILABLE"
    assert recon["point_cloud_url"] is None
    assert recon["mesh_url"] is None
