"""
Scale Calibration Service for AeroMesh.
Manages photogrammetric scale calibration, transitioning scenes from
unreferenced relative scale to metric scale only when an explicit,
validated calibration source is provided.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
import math
from typing import Any


class CalibrationMethod(str, Enum):
    NONE = "NONE"
    KNOWN_REFERENCE_DISTANCE = "KNOWN_REFERENCE_DISTANCE"
    KNOWN_OBJECT_SIZE = "KNOWN_OBJECT_SIZE"
    GCP = "GCP"
    GPS_RTK = "GPS_RTK"


class ScaleStatus(str, Enum):
    RELATIVE_SCALE = "RELATIVE_SCALE"
    METRIC_CALIBRATED = "METRIC_CALIBRATED"


@dataclass
class CalibrationRecord:
    calibration_id: str
    mission_id: str
    method: CalibrationMethod
    scale_factor: float  # Metric multiplier: distance_meters = distance_relative * scale_factor
    unit: str = "m"
    reference_points: list[list[float]] = field(default_factory=list)
    known_value: float | None = None
    reconstructed_value: float | None = None
    source_evidence: str = ""
    confidence: float = 1.0
    coordinate_system: str = "LOCAL_ARBITRARY"
    created_by: str = "operator"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    is_active: bool = True
    uncertainty: float | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["method"] = self.method.value if isinstance(self.method, CalibrationMethod) else str(self.method)
        return data


class ScaleCalibrationService:
    """
    Reusable scale calibration service.
    Ensures that relative reconstruction units are never claimed as meters
    without a validated reference calibration.
    """

    def __init__(self) -> None:
        # In-memory store: mission_id -> list of CalibrationRecord
        self._calibrations: dict[str, list[CalibrationRecord]] = {}

    def calibrate_by_reference_distance(
        self,
        mission_id: str,
        point_a: list[float] | tuple[float, float, float],
        point_b: list[float] | tuple[float, float, float],
        known_distance_meters: float,
        source_evidence: str = "Known physical landmark distance",
        confidence: float = 0.95,
        created_by: str = "operator",
        uncertainty_meters: float | None = None,
    ) -> CalibrationRecord:
        """
        Calibrate scene scale using two reconstructed points and a known physical distance.
        scale_factor = known_distance / reconstructed_distance
        """
        if known_distance_meters <= 0:
            raise ValueError(f"Known distance must be strictly positive, got {known_distance_meters}")

        pa = [float(v) for v in point_a[:3]]
        pb = [float(v) for v in point_b[:3]]

        reconstructed_dist = math.sqrt(
            (pb[0] - pa[0]) ** 2 + (pb[1] - pa[1]) ** 2 + (pb[2] - pa[2]) ** 2
        )

        if reconstructed_dist <= 1e-7:
            raise ValueError("Reference points are collinear or identical; distance is zero")

        scale_factor = known_distance_meters / reconstructed_dist

        # Compute uncertainty if supplied
        rel_uncertainty = (uncertainty_meters / known_distance_meters) if uncertainty_meters else 0.02

        cal_id = f"CAL_{mission_id}_{int(datetime.now(timezone.utc).timestamp())}"

        # Deactivate any previous active calibration for this mission
        self.deactivate_all(mission_id)

        record = CalibrationRecord(
            calibration_id=cal_id,
            mission_id=mission_id,
            method=CalibrationMethod.KNOWN_REFERENCE_DISTANCE,
            scale_factor=float(scale_factor),
            unit="m",
            reference_points=[pa, pb],
            known_value=float(known_distance_meters),
            reconstructed_value=float(reconstructed_dist),
            source_evidence=source_evidence,
            confidence=float(confidence),
            coordinate_system="LOCAL_ARBITRARY",
            created_by=created_by,
            is_active=True,
            uncertainty=float(rel_uncertainty),
        )

        if mission_id not in self._calibrations:
            self._calibrations[mission_id] = []
        self._calibrations[mission_id].append(record)
        return record

    def calibrate_by_known_object_size(
        self,
        mission_id: str,
        object_id: str,
        reconstructed_length: float,
        known_length_meters: float,
        source_evidence: str = "Known object catalog dimension",
        confidence: float = 0.85,
        created_by: str = "operator",
        uncertainty_meters: float | None = None,
    ) -> CalibrationRecord:
        """
        Calibrate scene scale using a known physical object dimension.
        """
        if known_length_meters <= 0 or reconstructed_length <= 1e-7:
            raise ValueError("Lengths must be strictly positive")

        scale_factor = known_length_meters / reconstructed_length
        rel_uncertainty = (uncertainty_meters / known_length_meters) if uncertainty_meters else 0.05

        cal_id = f"CAL_{mission_id}_OBJ_{int(datetime.now(timezone.utc).timestamp())}"
        self.deactivate_all(mission_id)

        record = CalibrationRecord(
            calibration_id=cal_id,
            mission_id=mission_id,
            method=CalibrationMethod.KNOWN_OBJECT_SIZE,
            scale_factor=float(scale_factor),
            unit="m",
            reference_points=[],
            known_value=float(known_length_meters),
            reconstructed_value=float(reconstructed_length),
            source_evidence=f"Object {object_id}: {source_evidence}",
            confidence=float(confidence),
            coordinate_system="LOCAL_ARBITRARY",
            created_by=created_by,
            is_active=True,
            uncertainty=float(rel_uncertainty),
        )

        if mission_id not in self._calibrations:
            self._calibrations[mission_id] = []
        self._calibrations[mission_id].append(record)
        return record

    def get_active_calibration(self, mission_id: str) -> CalibrationRecord | None:
        """Return the active calibration record for the mission, or None."""
        records = self._calibrations.get(mission_id, [])
        for rec in reversed(records):
            if rec.is_active:
                return rec
        return None

    def list_calibrations(self, mission_id: str) -> list[CalibrationRecord]:
        """Return all calibration records for the mission."""
        return list(self._calibrations.get(mission_id, []))

    def activate_calibration(self, mission_id: str, calibration_id: str) -> CalibrationRecord | None:
        """Set a specific calibration record as active."""
        records = self._calibrations.get(mission_id, [])
        target = None
        for rec in records:
            if rec.calibration_id == calibration_id:
                rec.is_active = True
                target = rec
            else:
                rec.is_active = False
        return target

    def deactivate_all(self, mission_id: str) -> None:
        """Deactivate all calibrations for a mission (reverting to relative scale)."""
        for rec in self._calibrations.get(mission_id, []):
            rec.is_active = False

    def delete_calibration(self, mission_id: str, calibration_id: str) -> bool:
        """Delete a calibration record."""
        records = self._calibrations.get(mission_id, [])
        for i, rec in enumerate(records):
            if rec.calibration_id == calibration_id:
                records.pop(i)
                return True
        return False
