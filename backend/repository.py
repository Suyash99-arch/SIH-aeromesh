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
            created_by=data.get("created_by"),
            owner_id=data.get("owner_id"),
            organization_name=data.get("organization_name"),
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

    def delete(self, mission_id: str) -> bool:
        mission = self.session.get(Mission, mission_id)
        if mission is not None:
            self.session.delete(mission)
            self.session.flush()
            return True
        return False

    def list(self, user: Any = None, include_benchmarks: bool = False) -> list[dict[str, Any]]:
        from sqlalchemy import not_, or_
        query = select(Mission).order_by(Mission.created_at.desc())
        if not include_benchmarks:
            test_names = [
                "Happy_Path_Sortie", "Regression Mission",
                "Scope_Mesh_1", "Scope_Mesh_2", "Scope_Mesh_3",
                "Scope_PC_1", "Scope_PC_2",
                "Scope_Test_1", "Scope_Test_2", "Scope_Test_3",
                "Concurrency_Stress_Test", "Worker Forwarding Test", "Shared Artifacts Test",
                "Alpha Dept Incident", "Guest A Mission", "User B Secret Mission",
                "Compare_Target", "Untitled mission", "Chunk_Upload_Test",
                "Shareable_Test_Mission", "Resolution 422 Test", "Quality 422 Test",
                "Legacy Alias Test", "JSON Body Options Test", "Fusion Test Mission",
                "Defaults Test", "Corrupt_Test_Mission", "Confidence 422 Test",
                "35_MB_Chunk_Test", "Forced_Chunk_Error_Test", "Preview_Unavailable_Test",
                "Advisory Check Test",
            ]
            query = query.where(
                not_(Mission.id.like("test_%")),
                not_(Mission.name.like("%Test%")),
                not_(Mission.name.in_(test_names)),
            )
        if user is not None:
            is_superadmin = (getattr(user, "role", "") == "ADMIN" and not getattr(user, "organization_name", None))
            if not is_superadmin:
                portal = getattr(user, "portal_type", "INDIVIDUAL")
                org = getattr(user, "organization_name", None)
                uid = getattr(user, "id", None)
                email = getattr(user, "email", None)
                if portal in ("GOVERNMENT_ORG", "ENTERPRISE") and org:
                    query = query.where(or_(
                        Mission.organization_name == org,
                        Mission.owner_id == uid,
                        Mission.created_by == email,
                    ))
                elif uid or email:
                    query = query.where(or_(
                        Mission.owner_id == uid,
                        Mission.created_by == email,
                    ))
        missions = self.session.scalars(query).all()
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
        # Chunk-finalize may be retried after the file was saved but before the
        # completion marker was written. Update the mission's video row when it
        # already exists so retrying is safe, including on schemas that enforce
        # one video per mission.
        video = self.session.scalars(
            select(Video).where(Video.mission_id == mission_id).order_by(Video.id)
        ).first()
        values = {
            "filename": metadata.get("filename", "video"),
            "storage_path": metadata.get("storage_key"),
            "sha256": metadata.get("sha256"),
            "metadata_json": metadata,
        }
        if video is None:
            self.session.add(Video(mission_id=mission_id, **values))
        else:
            for field, value in values.items():
                setattr(video, field, value)
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
    payload.setdefault("createdAt", mission.created_at.isoformat() if mission.created_at else datetime.utcnow().isoformat())
    payload.setdefault("status", mission.status)
    m_id = mission.id

    assets = dict(payload.get("assets") or {})
    v_dict = payload.get("video")
    if not assets.get("video") and isinstance(v_dict, dict) and v_dict.get("url"):
        assets["video"] = v_dict["url"]
    elif not assets.get("video") and v_dict:
        assets["video"] = f"/api/v1/missions/{m_id}/video"
    if not assets.get("pointCloud"):
        assets["pointCloud"] = f"/api/v1/missions/{m_id}/reconstruction/pointcloud"
    if not assets.get("mesh"):
        assets["mesh"] = f"/api/v1/missions/{m_id}/reconstruction/mesh"
    payload["assets"] = assets
    return payload
