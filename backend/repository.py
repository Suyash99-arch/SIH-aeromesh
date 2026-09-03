from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditEvent, Finding, Mission, Report, Track, Video


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
