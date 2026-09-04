from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditEvent, Finding, Mission, Report, Track, Video
from .models import Detection


class MissionRepository:
    """Database repository that keeps the API-shaped mission payload intact."""

    def __init__(self, session: Session):
        self.session = session

    def create(self, data: dict[str, Any]) -> dict[str, Any]:
        mission = Mission(
            id=data["id"],
            name=data["name"],
            mission_type=data.get("type"),
            location=data.get("location"),
            operator=data.get("operator"),
            created_at=_parse_datetime(data.get("createdAt")),
            status=data.get("status", "created"),
            payload=data,
        )
        self.session.add(mission)
        self.session.add(AuditEvent(mission_id=mission.id, action="mission.created", payload={}))
        self.session.flush()
        return data

    def get(self, mission_id: str) -> dict[str, Any] | None:
        mission = self.session.get(Mission, mission_id)
        return _payload(mission) if mission else None

    def list(self) -> list[dict[str, Any]]:
        missions = self.session.scalars(select(Mission).order_by(Mission.created_at.desc())).all()
        return [_payload(mission) for mission in missions]

    def update(self, mission_id: str, updates: dict[str, Any]) -> dict[str, Any] | None:
        mission = self.session.get(Mission, mission_id)
        if mission is None:
            return None
        payload = dict(mission.payload or {})
        payload.update(updates)
        mission.payload = payload
        mission.name = payload.get("name", mission.name)
        mission.mission_type = payload.get("type", mission.mission_type)
        mission.location = payload.get("location", mission.location)
        mission.operator = payload.get("operator", mission.operator)
        mission.status = payload.get("status", mission.status)
        self.session.flush()
        return payload

    def record_video(self, mission_id: str, metadata: dict[str, Any]) -> None:
        self.session.add(Video(
            mission_id=mission_id,
            filename=metadata.get("filename", "video"),
            storage_path=metadata.get("storage_key"),
            sha256=metadata.get("sha256"),
            metadata_json=metadata,
        ))
        self.session.flush()

    def replace_detection_results(self, mission_id: str, detections: list[dict[str, Any]], tracks: list[dict[str, Any]]) -> None:
        mission = self.session.get(Mission, mission_id)
        if mission is None:
            return
        for track_data in tracks:
            track = Track(
                mission_id=mission_id,
                external_id=str(track_data.get("track_id") or track_data.get("trackId")),
                class_name=track_data.get("class_name") or track_data.get("class"),
                first_frame=str(track_data.get("first_frame") or track_data.get("firstSeen", "")),
                last_frame=str(track_data.get("last_frame") or track_data.get("lastSeen", "")),
                first_timestamp=track_data.get("first_timestamp"),
                last_timestamp=track_data.get("last_timestamp"),
                detection_count=track_data.get("detection_count") or track_data.get("hits", 0),
                average_confidence=track_data.get("average_confidence") or track_data.get("averageConfidence"),
                trajectory_2d=track_data.get("trajectory") or track_data.get("trajectory_2d"),
                metadata_json=track_data,
            )
            self.session.add(track)
            self.session.flush()
            track_id = track.id
            for detection_data in detections:
                if str(detection_data.get("track_id") or detection_data.get("trackId")) != str(track.external_id):
                    continue
                self.session.add(Detection(
                    mission_id=mission_id,
                    track_id=track_id,
                    frame_id=detection_data.get("frame_db_id"),
                    class_name=detection_data.get("class_name") or detection_data.get("class", "unknown"),
                    confidence=detection_data.get("confidence"),
                    timestamp=detection_data.get("timestamp"),
                    bbox=detection_data.get("bbox") or detection_data.get("boundingBox"),
                    evidence_key=detection_data.get("evidence_key"),
                ))
        self.session.flush()


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    if value:
        return datetime.fromisoformat(str(value))
    return datetime.utcnow()


def _payload(mission: Mission) -> dict[str, Any]:
    payload = dict(mission.payload or {})
    payload.setdefault("id", mission.id)
    payload.setdefault("name", mission.name)
    payload.setdefault("type", mission.mission_type)
    payload.setdefault("location", mission.location)
    payload.setdefault("operator", mission.operator)
    payload.setdefault("createdAt", mission.created_at.isoformat())
    payload.setdefault("status", mission.status)
    return payload
