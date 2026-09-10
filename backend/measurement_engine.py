"""
Geometric Measurement Engine for AeroMesh.
Provides scientifically honest 3D spatial measurements:
- 3D Point-to-Point Distance
- 3D Object Dimensions (Length, Width, Height, Footprint Area)
- 3D Polygon Area & Perimeter (Newell's method / Stokes' theorem)
- Elevation / Vertical Difference & Slope
- 3D Watertight Volume

Strictly enforces scale honesty:
- LOCAL_ARBITRARY + RELATIVE_SCALE + UNREFERENCED scenes remain in relative_units
- Never claims meters unless calibrated by ScaleCalibrationService
- Requires verified gravity before interpreting Z as physical height
- Requires watertight closed geometry before computing volume (otherwise VOLUME_UNAVAILABLE)
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
import math
from typing import Any
import numpy as np

from backend.scale_calibration import CalibrationRecord, CalibrationMethod, ScaleStatus


class MeasurementStatus(str, Enum):
    RELATIVE = "RELATIVE"
    METRIC = "METRIC"
    ESTIMATED = "ESTIMATED"
    INVALID = "INVALID"
    UNCERTAIN = "UNCERTAIN"
    INSUFFICIENT_GEOMETRY = "INSUFFICIENT_GEOMETRY"
    VOLUME_UNAVAILABLE = "VOLUME_UNAVAILABLE"
    HEIGHT_UNAVAILABLE = "HEIGHT_UNAVAILABLE"


@dataclass
class DistanceMeasurement:
    value: float
    unit: str
    status: str
    scale_status: str
    metric_available: bool
    confidence: float
    point_a: list[float]
    point_b: list[float]
    reconstructed_distance: float
    calibration_method: str = "NONE"
    calibration_id: str | None = None
    uncertainty: float | None = None
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ObjectDimensionsMeasurement:
    object_id: str
    class_name: str
    length: float | None
    width: float | None
    height: float | None
    footprint_area: float | None
    unit: str
    area_unit: str
    status: str
    scale_status: str
    metric_available: bool
    confidence: float
    height_status: str = "AVAILABLE"
    height_note: str = ""
    calibration_method: str = "NONE"
    calibration_id: str | None = None
    reconstructed_dimensions: dict[str, float | None] = field(default_factory=dict)
    uncertainty: float | None = None
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class PolygonMeasurement:
    area: float
    perimeter: float
    unit_area: str
    unit_perimeter: str
    status: str
    scale_status: str
    metric_available: bool
    confidence: float
    vertex_count: int
    vertices_3d: list[list[float]]
    reconstructed_area: float
    reconstructed_perimeter: float
    calibration_method: str = "NONE"
    calibration_id: str | None = None
    uncertainty: float | None = None
    normal_vector: list[float] = field(default_factory=list)
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ElevationMeasurement:
    vertical_difference: float
    horizontal_distance: float
    direct_distance: float
    slope_angle_degrees: float
    unit: str
    status: str
    scale_status: str
    metric_available: bool
    confidence: float
    gravity_verified: bool
    point_a: list[float]
    point_b: list[float]
    calibration_method: str = "NONE"
    calibration_id: str | None = None
    uncertainty: float | None = None
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class VolumeMeasurement:
    volume: float | None
    unit: str
    status: str
    scale_status: str
    metric_available: bool
    confidence: float
    is_watertight: bool
    reconstructed_volume: float | None = None
    calibration_method: str = "NONE"
    calibration_id: str | None = None
    uncertainty: float | None = None
    triangle_count: int = 0
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class GeometricMeasurementEngine:
    """
    Core geometric measurement engine for AeroMesh.
    Handles distance, object dimensioning, polygon surface areas, elevations,
    and volume calculations with scientific integrity.
    """

    @staticmethod
    def distance_3d(
        point_a: list[float] | tuple[float, float, float],
        point_b: list[float] | tuple[float, float, float],
        calibration: CalibrationRecord | None = None,
    ) -> DistanceMeasurement:
        """
        Compute 3D Euclidean distance between two points.
        Never reports meters unless calibration is provided.
        """
        pa = [float(v) for v in point_a[:3]]
        pb = [float(v) for v in point_b[:3]]

        reconstructed_dist = float(math.sqrt(
            (pb[0] - pa[0]) ** 2 + (pb[1] - pa[1]) ** 2 + (pb[2] - pa[2]) ** 2
        ))

        if calibration is not None and calibration.is_active and calibration.scale_factor > 0:
            scale = calibration.scale_factor
            val = reconstructed_dist * scale
            unit = calibration.unit
            status = MeasurementStatus.METRIC.value
            scale_status = ScaleStatus.METRIC_CALIBRATED.value
            metric_avail = True
            cal_method = calibration.method.value if hasattr(calibration.method, "value") else str(calibration.method)
            cal_id = calibration.calibration_id
            conf = min(1.0, float(calibration.confidence))
            unc = float(calibration.uncertainty or 0.02) * val
            note = f"Calibrated via {cal_method} (scale_factor={scale:.6f})."
        else:
            val = reconstructed_dist
            unit = "relative_units"
            status = MeasurementStatus.RELATIVE.value
            scale_status = ScaleStatus.RELATIVE_SCALE.value
            metric_avail = False
            cal_method = CalibrationMethod.NONE.value
            cal_id = None
            conf = 0.90
            unc = None
            note = "Uncalibrated relative distance in local arbitrary coordinate units. Do not interpret as meters."

        return DistanceMeasurement(
            value=round(val, 4),
            unit=unit,
            status=status,
            scale_status=scale_status,
            metric_available=metric_avail,
            confidence=round(conf, 3),
            point_a=pa,
            point_b=pb,
            reconstructed_distance=round(reconstructed_dist, 4),
            calibration_method=cal_method,
            calibration_id=cal_id,
            uncertainty=round(unc, 4) if unc is not None else None,
            note=note,
        )

    @staticmethod
    def measure_polygon(
        vertices: list[list[float]] | list[tuple[float, float, float]],
        calibration: CalibrationRecord | None = None,
    ) -> PolygonMeasurement:
        """
        Compute 3D planar polygon area and perimeter using Newell's method / Stokes' theorem.
        """
        if len(vertices) < 3:
            raise ValueError(f"Polygon requires at least 3 vertices, got {len(vertices)}")

        pts = np.array([[float(v[0]), float(v[1]), float(v[2])] for v in vertices], dtype=np.float64)
        n = len(pts)

        # 1. Perimeter
        diffs = np.diff(pts, axis=0)
        closing = pts[0] - pts[-1]
        all_segs = np.vstack([diffs, closing])
        reconstructed_perimeter = float(np.sum(np.linalg.norm(all_segs, axis=1)))

        # 2. 3D Planar Area via Newell's Method: N = 0.5 * sum(v_i x v_{i+1})
        cross_sum = np.zeros(3, dtype=np.float64)
        for i in range(n):
            j = (i + 1) % n
            v_curr = pts[i]
            v_next = pts[j]
            cross_sum[0] += (v_curr[1] - v_next[1]) * (v_curr[2] + v_next[2])
            cross_sum[1] += (v_curr[2] - v_next[2]) * (v_curr[0] + v_next[0])
            cross_sum[2] += (v_curr[0] - v_next[0]) * (v_curr[1] + v_next[1])

        normal = cross_sum * 0.5
        norm_len = float(np.linalg.norm(normal))
        unit_normal = (normal / norm_len).tolist() if norm_len > 1e-9 else [0.0, 0.0, 1.0]
        reconstructed_area = norm_len

        if calibration is not None and calibration.is_active and calibration.scale_factor > 0:
            scale = calibration.scale_factor
            val_area = reconstructed_area * (scale ** 2)
            val_perim = reconstructed_perimeter * scale
            unit_area = "sq_m"
            unit_perim = calibration.unit
            status = MeasurementStatus.METRIC.value
            scale_status = ScaleStatus.METRIC_CALIBRATED.value
            metric_avail = True
            cal_method = calibration.method.value if hasattr(calibration.method, "value") else str(calibration.method)
            cal_id = calibration.calibration_id
            conf = min(1.0, float(calibration.confidence))
            unc = float(calibration.uncertainty or 0.02) * val_area
            note = f"Calibrated 3D polygon measurement via {cal_method}."
        else:
            val_area = reconstructed_area
            val_perim = reconstructed_perimeter
            unit_area = "relative_units^2"
            unit_perim = "relative_units"
            status = MeasurementStatus.RELATIVE.value
            scale_status = ScaleStatus.RELATIVE_SCALE.value
            metric_avail = False
            cal_method = CalibrationMethod.NONE.value
            cal_id = None
            conf = 0.85
            unc = None
            note = "Uncalibrated relative 3D polygon area in arbitrary coordinate units. Do not interpret as square meters."

        return PolygonMeasurement(
            area=round(val_area, 4),
            perimeter=round(val_perim, 4),
            unit_area=unit_area,
            unit_perimeter=unit_perim,
            status=status,
            scale_status=scale_status,
            metric_available=metric_avail,
            confidence=round(conf, 3),
            vertex_count=n,
            vertices_3d=pts.tolist(),
            reconstructed_area=round(reconstructed_area, 4),
            reconstructed_perimeter=round(reconstructed_perimeter, 4),
            calibration_method=cal_method,
            calibration_id=cal_id,
            uncertainty=round(unc, 4) if unc is not None else None,
            normal_vector=[round(float(v), 4) for v in unit_normal],
            note=note,
        )

    @staticmethod
    def measure_elevation(
        point_a: list[float] | tuple[float, float, float],
        point_b: list[float] | tuple[float, float, float],
        calibration: CalibrationRecord | None = None,
        has_verified_gravity: bool = False,
    ) -> ElevationMeasurement:
        """
        Compute vertical difference and slope between two points.
        Strict integrity: if gravity is not verified, flags elevation as UNCERTAIN
        and explicitly notes that Z is an unreferenced arbitrary coordinate axis.
        """
        pa = [float(v) for v in point_a[:3]]
        pb = [float(v) for v in point_b[:3]]

        dx = pb[0] - pa[0]
        dy = pb[1] - pa[1]
        dz = pb[2] - pa[2]

        h_dist = math.sqrt(dx ** 2 + dy ** 2)
        d_dist = math.sqrt(dx ** 2 + dy ** 2 + dz ** 2)
        slope_deg = math.degrees(math.atan2(abs(dz), max(1e-7, h_dist)))

        if calibration is not None and calibration.is_active and calibration.scale_factor > 0:
            scale = calibration.scale_factor
            val_dz = dz * scale
            val_h = h_dist * scale
            val_d = d_dist * scale
            unit = calibration.unit
            scale_status = ScaleStatus.METRIC_CALIBRATED.value
            metric_avail = True
            cal_method = calibration.method.value if hasattr(calibration.method, "value") else str(calibration.method)
            cal_id = calibration.calibration_id
            unc = float(calibration.uncertainty or 0.02) * abs(val_dz)
        else:
            val_dz = dz
            val_h = h_dist
            val_d = d_dist
            unit = "relative_units"
            scale_status = ScaleStatus.RELATIVE_SCALE.value
            metric_avail = False
            cal_method = CalibrationMethod.NONE.value
            cal_id = None
            unc = None

        if not has_verified_gravity:
            status = MeasurementStatus.UNCERTAIN.value
            conf = 0.50
            note = (
                "Coordinate system is LOCAL_ARBITRARY without verified gravity/vertical reference. "
                "Delta Z represents coordinate difference along arbitrary camera frame axis, NOT true physical elevation."
            )
        else:
            status = MeasurementStatus.METRIC.value if metric_avail else MeasurementStatus.RELATIVE.value
            conf = 0.90 if metric_avail else 0.80
            note = "Verified vertical elevation difference."

        return ElevationMeasurement(
            vertical_difference=round(val_dz, 4),
            horizontal_distance=round(val_h, 4),
            direct_distance=round(val_d, 4),
            slope_angle_degrees=round(slope_deg, 2),
            unit=unit,
            status=status,
            scale_status=scale_status,
            metric_available=metric_avail,
            confidence=round(conf, 3),
            gravity_verified=has_verified_gravity,
            point_a=pa,
            point_b=pb,
            calibration_method=cal_method,
            calibration_id=cal_id,
            uncertainty=round(unc, 4) if unc is not None else None,
            note=note,
        )

    @staticmethod
    def measure_object_dimensions(
        object_id: str,
        class_name: str,
        points_3d: list[list[float]] | np.ndarray | None = None,
        mesh_vertices: np.ndarray | None = None,
        calibration: CalibrationRecord | None = None,
        has_verified_gravity: bool = False,
    ) -> ObjectDimensionsMeasurement:
        """
        Estimate 3D object dimensions (length, width, height, footprint area)
        from available 3D geometry.

        Strict integrity guards:
        1. If object points are insufficient (< 2 distinct points): returns INSUFFICIENT_GEOMETRY.
        2. Height: strictly refuses to interpret arbitrary Z as physical height
           without a verified gravity reference. Returns HEIGHT_UNAVAILABLE if unverified.
        """
        pts = None
        if points_3d is not None and len(points_3d) > 0:
            pts = np.array(points_3d, dtype=np.float64)

        # Require at least 2 distinct points to estimate object extent
        if pts is None or len(pts) < 2:
            return ObjectDimensionsMeasurement(
                object_id=object_id,
                class_name=class_name,
                length=None,
                width=None,
                height=None,
                footprint_area=None,
                unit="relative_units",
                area_unit="relative_units^2",
                status=MeasurementStatus.INSUFFICIENT_GEOMETRY.value,
                scale_status=ScaleStatus.RELATIVE_SCALE.value,
                metric_available=False,
                confidence=0.0,
                height_status=MeasurementStatus.INSUFFICIENT_GEOMETRY.value,
                height_note="Insufficient 3D point coverage (< 2 supporting points) to measure object dimensions.",
                calibration_method=CalibrationMethod.NONE.value,
                note="Physical object dimensions cannot be derived from a 2D bounding box alone without spatial geometry.",
            )

        # Compute horizontal 2D extent (X, Y in local frame)
        xy_pts = pts[:, :2]
        min_xy = np.min(xy_pts, axis=0)
        max_xy = np.max(xy_pts, axis=0)
        extent_xy = max_xy - min_xy

        # Length is major horizontal axis, Width is minor horizontal axis
        recon_length = float(max(extent_xy[0], extent_xy[1]))
        recon_width = float(min(extent_xy[0], extent_xy[1]))
        recon_footprint = float(recon_length * recon_width)

        # Height handling: check verified gravity
        recon_height = None
        height_status = MeasurementStatus.HEIGHT_UNAVAILABLE.value
        height_note = "Arbitrary Z-range cannot be interpreted as physical height without a verified gravity reference."

        if has_verified_gravity:
            z_pts = pts[:, 2]
            recon_height = float(np.max(z_pts) - np.min(z_pts))
            height_status = "AVAILABLE"
            height_note = "Height measured along verified vertical axis."

        # Scale scaling
        if calibration is not None and calibration.is_active and calibration.scale_factor > 0:
            s = calibration.scale_factor
            val_len = recon_length * s
            val_wid = recon_width * s
            val_h = recon_height * s if recon_height is not None else None
            val_area = recon_footprint * (s ** 2)
            unit = calibration.unit
            area_unit = "sq_m"
            status = MeasurementStatus.ESTIMATED.value
            scale_status = ScaleStatus.METRIC_CALIBRATED.value
            metric_avail = True
            cal_method = calibration.method.value if hasattr(calibration.method, "value") else str(calibration.method)
            cal_id = calibration.calibration_id
            conf = min(1.0, float(calibration.confidence) * 0.85)
            unc = float(calibration.uncertainty or 0.05) * val_len
            note = f"Metric object dimensions estimated via 3D point cluster and {cal_method}."
        else:
            val_len = recon_length
            val_wid = recon_width
            val_h = recon_height
            val_area = recon_footprint
            unit = "relative_units"
            area_unit = "relative_units^2"
            status = MeasurementStatus.RELATIVE.value
            scale_status = ScaleStatus.RELATIVE_SCALE.value
            metric_avail = False
            cal_method = CalibrationMethod.NONE.value
            cal_id = None
            conf = 0.70
            unc = None
            note = "Relative object dimensions in arbitrary coordinate units."

        return ObjectDimensionsMeasurement(
            object_id=object_id,
            class_name=class_name,
            length=round(val_len, 4),
            width=round(val_wid, 4),
            height=round(val_h, 4) if val_h is not None else None,
            footprint_area=round(val_area, 4),
            unit=unit,
            area_unit=area_unit,
            status=status,
            scale_status=scale_status,
            metric_available=metric_avail,
            confidence=round(conf, 3),
            height_status=height_status,
            height_note=height_note,
            calibration_method=cal_method,
            calibration_id=cal_id,
            reconstructed_dimensions={
                "length": round(recon_length, 4),
                "width": round(recon_width, 4),
                "height": round(recon_height, 4) if recon_height is not None else None,
                "footprint_area": round(recon_footprint, 4),
            },
            uncertainty=round(unc, 4) if unc is not None else None,
            note=note,
        )

    @staticmethod
    def measure_volume(
        vertices: np.ndarray | list[list[float]] | None = None,
        faces: np.ndarray | list[list[int]] | None = None,
        is_watertight: bool = False,
        calibration: CalibrationRecord | None = None,
    ) -> VolumeMeasurement:
        """
        Compute enclosed 3D volume.
        Strict requirement: Requires a valid closed/watertight mesh.
        Otherwise returns VOLUME_UNAVAILABLE.
        """
        if not is_watertight or vertices is None or faces is None or len(faces) == 0:
            return VolumeMeasurement(
                volume=None,
                unit="cu_m" if (calibration and calibration.is_active) else "relative_units^3",
                status=MeasurementStatus.VOLUME_UNAVAILABLE.value,
                scale_status=ScaleStatus.METRIC_CALIBRATED.value if (calibration and calibration.is_active) else ScaleStatus.RELATIVE_SCALE.value,
                metric_available=bool(calibration and calibration.is_active),
                confidence=0.0,
                is_watertight=False,
                reconstructed_volume=None,
                calibration_method=calibration.method.value if (calibration and calibration.is_active and hasattr(calibration.method, "value")) else "NONE",
                calibration_id=calibration.calibration_id if (calibration and calibration.is_active) else None,
                triangle_count=len(faces) if faces is not None else 0,
                note="Volume calculation requires a verified closed/watertight mesh surface. Current surface mesh has open boundaries.",
            )

        verts = np.array(vertices, dtype=np.float64)
        fcs = np.array(faces, dtype=np.int64)

        # Divergence Theorem signed volume for closed triangular mesh:
        # V = 1/6 * sum( v1 . (v2 x v3) )
        v1 = verts[fcs[:, 0]]
        v2 = verts[fcs[:, 1]]
        v3 = verts[fcs[:, 2]]
        cross_prod = np.cross(v2, v3)
        recon_vol = float(abs(np.sum(np.einsum("ij,ij->i", v1, cross_prod)) / 6.0))

        if calibration is not None and calibration.is_active and calibration.scale_factor > 0:
            s = calibration.scale_factor
            vol = recon_vol * (s ** 3)
            unit = "cu_m"
            status = MeasurementStatus.METRIC.value
            scale_status = ScaleStatus.METRIC_CALIBRATED.value
            metric_avail = True
            cal_method = calibration.method.value if hasattr(calibration.method, "value") else str(calibration.method)
            cal_id = calibration.calibration_id
            conf = min(1.0, float(calibration.confidence))
            unc = float(calibration.uncertainty or 0.05) * vol
            note = f"Enclosed volume computed on watertight mesh via {cal_method}."
        else:
            vol = recon_vol
            unit = "relative_units^3"
            status = MeasurementStatus.RELATIVE.value
            scale_status = ScaleStatus.RELATIVE_SCALE.value
            metric_avail = False
            cal_method = CalibrationMethod.NONE.value
            cal_id = None
            conf = 0.85
            unc = None
            note = "Relative volume on watertight mesh in arbitrary coordinate units."

        return VolumeMeasurement(
            volume=round(vol, 4),
            unit=unit,
            status=status,
            scale_status=scale_status,
            metric_available=metric_avail,
            confidence=round(conf, 3),
            is_watertight=True,
            reconstructed_volume=round(recon_vol, 4),
            calibration_method=cal_method,
            calibration_id=cal_id,
            uncertainty=round(unc, 4) if unc is not None else None,
            triangle_count=len(fcs),
            note=note,
        )
