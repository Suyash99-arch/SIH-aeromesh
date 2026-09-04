from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .database import Base


class PortableGeometry(TypeDecorator):
    """Store WKT in SQLite tests and compile to PostGIS geometry in PostgreSQL."""

    impl = Text
    cache_ok = True

    def __init__(self, geometry_type: str = "GEOMETRY", srid: int = 4326, **kwargs: Any):
        self.geometry_type = geometry_type
        self.srid = srid
        super().__init__(**kwargs)

    def copy(self, **kw: Any):
        return type(self)(self.geometry_type, self.srid, **kw)

@compiles(PortableGeometry, "postgresql")
def compile_postgis_geometry(element, compiler, **kwargs):
    return f"geometry({element.geometry_type},{element.srid})"


class Mission(Base):
    __tablename__ = "missions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    mission_type: Mapped[str | None] = mapped_column(String(100))
    location: Mapped[str | None] = mapped_column(String(500))
    reference_location: Mapped[str | None] = mapped_column(PortableGeometry("POINT"))
    operator: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    status: Mapped[str] = mapped_column(String(80), default="created", nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)

    videos: Mapped[list["Video"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    processing_jobs: Mapped[list["ProcessingJob"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    frames: Mapped[list["Frame"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    detections: Mapped[list["Detection"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    tracks: Mapped[list["Track"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    reconstruction_assets: Mapped[list["ReconstructionAsset"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    calibrations: Mapped[list["Calibration"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    measurements: Mapped[list["Measurement"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    reports: Mapped[list["Report"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    findings: Mapped[list["Finding"]] = relationship(back_populates="mission", cascade="all, delete-orphan")
    audit_events: Mapped[list["AuditEvent"]] = relationship(back_populates="mission", cascade="all, delete-orphan")


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_path: Mapped[str | None] = mapped_column(Text)
    sha256: Mapped[str | None] = mapped_column(String(64))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="videos")


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(80), default="created")
    stage: Mapped[str] = mapped_column(String(80), default="QUEUED")
    progress_percent: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    parameters: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="processing_jobs")


class Frame(Base):
    __tablename__ = "frames"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[int | None] = mapped_column(ForeignKey("videos.id", ondelete="SET NULL"))
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)
    image_path: Mapped[str | None] = mapped_column(Text)
    camera_position: Mapped[str | None] = mapped_column(PortableGeometry("POINT"))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="frames")
    quality: Mapped["FrameQuality | None"] = relationship(back_populates="frame", uselist=False, cascade="all, delete-orphan")


class FrameQuality(Base):
    __tablename__ = "frame_quality"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    frame_id: Mapped[int] = mapped_column(ForeignKey("frames.id", ondelete="CASCADE"), unique=True)
    sharpness: Mapped[float | None] = mapped_column(Float)
    brightness: Mapped[float | None] = mapped_column(Float)
    contrast: Mapped[float | None] = mapped_column(Float)
    accepted: Mapped[bool | None] = mapped_column()
    frame: Mapped[Frame] = relationship(back_populates="quality")


class Detection(Base):
    __tablename__ = "detections"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    frame_id: Mapped[int | None] = mapped_column(ForeignKey("frames.id", ondelete="SET NULL"))
    track_id: Mapped[int | None] = mapped_column(ForeignKey("tracks.id", ondelete="SET NULL"))
    class_name: Mapped[str] = mapped_column(String(120), nullable=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    timestamp: Mapped[float | None] = mapped_column(Float)
    evidence_key: Mapped[str | None] = mapped_column(Text)
    object_position: Mapped[str | None] = mapped_column(PortableGeometry("POINT"))
    bbox: Mapped[list[float] | None] = mapped_column(JSON)
    camera_image_id: Mapped[int | None] = mapped_column(Integer)
    reprojection_error: Mapped[float | None] = mapped_column(Float)
    mission: Mapped[Mission] = relationship(back_populates="detections")


class Track(Base):
    __tablename__ = "tracks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str] = mapped_column(String(100), nullable=False)
    class_name: Mapped[str | None] = mapped_column(String(120))
    trajectory: Mapped[str | None] = mapped_column(PortableGeometry("LINESTRING"))
    first_frame: Mapped[str | None] = mapped_column(String(100))
    last_frame: Mapped[str | None] = mapped_column(String(100))
    first_timestamp: Mapped[float | None] = mapped_column(Float)
    last_timestamp: Mapped[float | None] = mapped_column(Float)
    detection_count: Mapped[int] = mapped_column(Integer, default=0)
    average_confidence: Mapped[float | None] = mapped_column(Float)
    trajectory_2d: Mapped[list[Any] | None] = mapped_column(JSON)
    position_3d: Mapped[list[float] | None] = mapped_column(JSON)
    coordinate_system: Mapped[str] = mapped_column(String(80), default="LOCAL_ARBITRARY", nullable=False)
    association_status: Mapped[str] = mapped_column(String(50), default="INSUFFICIENT_EVIDENCE", nullable=False)
    association_confidence: Mapped[float | None] = mapped_column(Float)
    reprojection_error: Mapped[float | None] = mapped_column(Float)
    motion_state: Mapped[str] = mapped_column(String(50), default="UNKNOWN", nullable=False)
    trajectory_3d: Mapped[list[Any] | None] = mapped_column(JSON)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="tracks")


class ReconstructionAsset(Base):
    __tablename__ = "reconstruction_assets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    asset_type: Mapped[str] = mapped_column(String(50), nullable=False)
    storage_path: Mapped[str | None] = mapped_column(Text)
    footprint: Mapped[str | None] = mapped_column(PortableGeometry("POLYGON"))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="reconstruction_assets")


class Calibration(Base):
    __tablename__ = "calibrations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    calibration_id: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(80), nullable=False)
    scale_factor: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(20), default="m", nullable=False)
    reference_points: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    known_value: Mapped[float | None] = mapped_column(Float)
    reconstructed_value: Mapped[float | None] = mapped_column(Float)
    source_evidence: Mapped[str | None] = mapped_column(Text)
    confidence: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    coordinate_system: Mapped[str] = mapped_column(String(50), default="LOCAL_ARBITRARY", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    uncertainty: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="calibrations")


class Measurement(Base):
    __tablename__ = "measurements"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    measurement_type: Mapped[str] = mapped_column(String(80), nullable=False)
    value: Mapped[float | None] = mapped_column(Float)
    confidence: Mapped[float | None] = mapped_column(Float)
    geometry: Mapped[str | None] = mapped_column(PortableGeometry("GEOMETRY"))
    measurement_status: Mapped[str] = mapped_column(String(50), default="RELATIVE", nullable=False)
    unit: Mapped[str] = mapped_column(String(50), default="relative_units", nullable=False)
    scale_status: Mapped[str] = mapped_column(String(50), default="RELATIVE_SCALE", nullable=False)
    metric_available: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    calibration_id: Mapped[str | None] = mapped_column(String(80))
    uncertainty: Mapped[float | None] = mapped_column(Float)
    source_coordinates: Mapped[dict[str, Any] | list[Any] | None] = mapped_column(JSON, default=None)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="measurements")


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    format: Mapped[str] = mapped_column(String(30), default="json")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="reports")


class ModelVersion(Base):
    __tablename__ = "model_versions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    version: Mapped[str | None] = mapped_column(String(80))
    artifact_path: Mapped[str | None] = mapped_column(Text)
    checksum: Mapped[str | None] = mapped_column(String(128))
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)


class Finding(Base):
    __tablename__ = "findings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    external_id: Mapped[str | None] = mapped_column(String(120))
    category: Mapped[str | None] = mapped_column(String(80))
    severity: Mapped[str | None] = mapped_column(String(40))
    confidence: Mapped[float | None] = mapped_column(Float)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission] = relationship(back_populates="findings")


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    mission_id: Mapped[str | None] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    actor: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
    mission: Mapped[Mission | None] = relationship(back_populates="audit_events")
