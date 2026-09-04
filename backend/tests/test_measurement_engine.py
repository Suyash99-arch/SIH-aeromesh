"""
Tests for Phase 7 Scale Calibration and Geometric Measurement Engine.
Validates:
- 3D Euclidean distance (relative and calibrated metric)
- ScaleCalibrationService lifecycle
- 3D polygon area (Stokes' theorem / Newell's method) and perimeter
- Elevation difference and unverified gravity handling
- 3D object dimensions and strict INSUFFICIENT_GEOMETRY / HEIGHT_UNAVAILABLE guards
- 3D volume requiring closed watertight mesh (VOLUME_UNAVAILABLE on open mesh)
- REST API endpoints for calibrations and measurements
"""

import math
import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.scale_calibration import (
    ScaleCalibrationService,
    CalibrationRecord,
    CalibrationMethod,
    ScaleStatus,
)
from backend.measurement_engine import (
    GeometricMeasurementEngine,
    MeasurementStatus,
    DistanceMeasurement,
    PolygonMeasurement,
    ElevationMeasurement,
    ObjectDimensionsMeasurement,
    VolumeMeasurement,
)


def test_distance_uncalibrated_relative():
    """Uncalibrated distance must be in relative units, status RELATIVE, metric_available False."""
    pa = [0.0, 0.0, 0.0]
    pb = [3.0, 4.0, 0.0]

    meas = GeometricMeasurementEngine.distance_3d(pa, pb, calibration=None)
    assert meas.value == 5.0
    assert meas.unit == "relative_units"
    assert meas.status == MeasurementStatus.RELATIVE.value
    assert meas.scale_status == ScaleStatus.RELATIVE_SCALE.value
    assert meas.metric_available is False
    assert "relative distance" in meas.note.lower()


def test_distance_calibrated_metric():
    """Calibrated distance must report metric units and status METRIC."""
    # Calibration with scale factor 2.0 (1 relative unit = 2 meters)
    cal = CalibrationRecord(
        calibration_id="CAL_TEST_1",
        mission_id="m1",
        method=CalibrationMethod.KNOWN_REFERENCE_DISTANCE,
        scale_factor=2.0,
        unit="m",
        reference_points=[[0, 0, 0], [1, 0, 0]],
        confidence=0.95,
        uncertainty=0.02,
        is_active=True,
    )

    pa = [0.0, 0.0, 0.0]
    pb = [0.0, 6.0, 8.0]  # relative dist = 10.0

    meas = GeometricMeasurementEngine.distance_3d(pa, pb, calibration=cal)
    assert meas.value == 20.0  # 10.0 * 2.0
    assert meas.unit == "m"
    assert meas.status == MeasurementStatus.METRIC.value
    assert meas.scale_status == ScaleStatus.METRIC_CALIBRATED.value
    assert meas.metric_available is True
    assert meas.reconstructed_distance == 10.0
    assert meas.calibration_method == CalibrationMethod.KNOWN_REFERENCE_DISTANCE.value
    assert meas.uncertainty is not None


def test_scale_calibration_service_reference_distance():
    """Test ScaleCalibrationService calculation of scale factor from reference points."""
    service = ScaleCalibrationService()
    # Distance between points is 5.0 relative units, known to be 10.0 meters -> scale_factor = 2.0
    pa = [0.0, 0.0, 0.0]
    pb = [3.0, 4.0, 0.0]
    record = service.calibrate_by_reference_distance(
        mission_id="mission_alpha",
        point_a=pa,
        point_b=pb,
        known_distance_meters=10.0,
        source_evidence="Reference ground survey marker",
        confidence=0.98,
    )

    assert record.scale_factor == pytest.approx(2.0, rel=1e-5)
    assert record.reconstructed_value == pytest.approx(5.0, rel=1e-5)
    assert record.is_active is True
    assert record.method == CalibrationMethod.KNOWN_REFERENCE_DISTANCE

    # Active calibration retrieval
    active = service.get_active_calibration("mission_alpha")
    assert active is not None
    assert active.calibration_id == record.calibration_id

    # Deactivate
    service.deactivate_all("mission_alpha")
    assert service.get_active_calibration("mission_alpha") is None


def test_scale_calibration_service_object_size():
    """Test scale calibration using known object dimension."""
    service = ScaleCalibrationService()
    # Car reconstructed as 2.5 relative units, known catalog length is 5.0m -> scale = 2.0
    record = service.calibrate_by_known_object_size(
        mission_id="mission_beta",
        object_id="OBJ_T0001",
        reconstructed_length=2.5,
        known_length_meters=5.0,
        source_evidence="Toyota Camry manufacturer specs: 4.88m rounded to 5.0m",
    )
    assert record.scale_factor == 2.0
    assert record.method == CalibrationMethod.KNOWN_OBJECT_SIZE


def test_polygon_3d_planar_area_and_perimeter():
    """Test 3D planar polygon area via Newell's method / Stokes' theorem."""
    # A 3x4 rectangle on the XY plane: [0,0,0], [3,0,0], [3,4,0], [0,4,0]
    # Area = 12.0, Perimeter = 14.0
    verts = [[0.0, 0.0, 0.0], [3.0, 0.0, 0.0], [3.0, 4.0, 0.0], [0.0, 4.0, 0.0]]

    # 1. Uncalibrated
    poly_rel = GeometricMeasurementEngine.measure_polygon(verts, calibration=None)
    assert poly_rel.area == pytest.approx(12.0, rel=1e-4)
    assert poly_rel.perimeter == pytest.approx(14.0, rel=1e-4)
    assert poly_rel.unit_area == "relative_units^2"
    assert poly_rel.unit_perimeter == "relative_units"
    assert poly_rel.status == MeasurementStatus.RELATIVE.value

    # 2. Calibrated (scale factor = 2.0 -> area scales by 4.0, perimeter by 2.0)
    cal = CalibrationRecord(
        calibration_id="CAL_POLY",
        mission_id="m1",
        method=CalibrationMethod.KNOWN_REFERENCE_DISTANCE,
        scale_factor=2.0,
        unit="m",
        is_active=True,
    )
    poly_metric = GeometricMeasurementEngine.measure_polygon(verts, calibration=cal)
    assert poly_metric.area == pytest.approx(48.0, rel=1e-4)  # 12 * 4
    assert poly_metric.perimeter == pytest.approx(28.0, rel=1e-4)  # 14 * 2
    assert poly_metric.unit_area == "sq_m"
    assert poly_metric.unit_perimeter == "m"
    assert poly_metric.status == MeasurementStatus.METRIC.value


def test_elevation_difference_and_unverified_gravity():
    """Test vertical difference and strict refusal to claim true elevation without verified gravity."""
    pa = [0.0, 0.0, 10.0]
    pb = [3.0, 4.0, 15.0]  # dx=3, dy=4, dz=5; h_dist=5, d_dist=sqrt(50)=7.071, slope=45 deg

    # Without verified gravity
    elev_unverified = GeometricMeasurementEngine.measure_elevation(pa, pb, has_verified_gravity=False)
    assert elev_unverified.vertical_difference == 5.0
    assert elev_unverified.horizontal_distance == 5.0
    assert elev_unverified.slope_angle_degrees == 45.0
    assert elev_unverified.status == MeasurementStatus.UNCERTAIN.value
    assert elev_unverified.gravity_verified is False
    assert "LOCAL_ARBITRARY" in elev_unverified.note

    # With verified gravity
    elev_verified = GeometricMeasurementEngine.measure_elevation(pa, pb, has_verified_gravity=True)
    assert elev_verified.status == MeasurementStatus.RELATIVE.value
    assert elev_verified.gravity_verified is True


def test_object_dimensions_insufficient_geometry():
    """Objects with < 2 3D points must return INSUFFICIENT_GEOMETRY rather than fabricating sizes."""
    # Single point
    meas_single = GeometricMeasurementEngine.measure_object_dimensions(
        object_id="OBJ_TEST_1",
        class_name="car",
        points_3d=[[10.0, 20.0, 30.0]],
    )
    assert meas_single.status == MeasurementStatus.INSUFFICIENT_GEOMETRY.value
    assert meas_single.length is None
    assert meas_single.width is None
    assert meas_single.height is None
    assert meas_single.footprint_area is None

    # Empty points
    meas_empty = GeometricMeasurementEngine.measure_object_dimensions(
        object_id="OBJ_TEST_2",
        class_name="car",
        points_3d=[],
    )
    assert meas_empty.status == MeasurementStatus.INSUFFICIENT_GEOMETRY.value


def test_object_dimensions_height_unverified_gravity_guard():
    """Physical height must NOT be derived from arbitrary Z without verified gravity."""
    # Cluster of points forming a 4.0 x 2.0 x 3.0 box
    pts = [
        [0.0, 0.0, 0.0],
        [4.0, 0.0, 0.0],
        [4.0, 2.0, 0.0],
        [0.0, 2.0, 0.0],
        [0.0, 0.0, 3.0],
        [4.0, 2.0, 3.0],
    ]

    # Case A: has_verified_gravity = False
    meas_no_grav = GeometricMeasurementEngine.measure_object_dimensions(
        object_id="OBJ_CAR",
        class_name="car",
        points_3d=pts,
        has_verified_gravity=False,
    )
    assert meas_no_grav.length == 4.0
    assert meas_no_grav.width == 2.0
    assert meas_no_grav.footprint_area == 8.0
    assert meas_no_grav.height is None
    assert meas_no_grav.height_status == MeasurementStatus.HEIGHT_UNAVAILABLE.value
    assert "Arbitrary Z-range cannot be interpreted as physical height" in meas_no_grav.height_note

    # Case B: has_verified_gravity = True
    meas_grav = GeometricMeasurementEngine.measure_object_dimensions(
        object_id="OBJ_CAR",
        class_name="car",
        points_3d=pts,
        has_verified_gravity=True,
    )
    assert meas_grav.height == 3.0
    assert meas_grav.height_status == "AVAILABLE"


def test_volume_watertight_vs_open_geometry():
    """Volume requires a closed watertight mesh; open meshes must return VOLUME_UNAVAILABLE."""
    # 1. Open surface mesh (e.g. single triangle or open sheet)
    open_verts = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
    open_faces = [[0, 1, 2]]

    vol_open = GeometricMeasurementEngine.measure_volume(
        vertices=open_verts,
        faces=open_faces,
        is_watertight=False,
    )
    assert vol_open.status == MeasurementStatus.VOLUME_UNAVAILABLE.value
    assert vol_open.volume is None
    assert vol_open.is_watertight is False
    assert "open boundaries" in vol_open.note.lower()

    # 2. Closed watertight geometry (Tetrahedron with 4 vertices, 4 faces)
    # Vertices of regular tetrahedron: (1,1,1), (1,-1,-1), (-1,1,-1), (-1,-1,1)
    # Volume of tetrahedron = 8 / 3 ≈ 2.6667
    tetra_verts = [
        [1.0, 1.0, 1.0],
        [1.0, -1.0, -1.0],
        [-1.0, 1.0, -1.0],
        [-1.0, -1.0, 1.0],
    ]
    tetra_faces = [
        [0, 1, 2],
        [0, 2, 3],
        [0, 3, 1],
        [1, 3, 2],
    ]
    vol_closed = GeometricMeasurementEngine.measure_volume(
        vertices=tetra_verts,
        faces=tetra_faces,
        is_watertight=True,
    )
    assert vol_closed.status == MeasurementStatus.RELATIVE.value
    assert vol_closed.volume == pytest.approx(8.0 / 3.0, rel=1e-4)
    assert vol_closed.is_watertight is True


def test_api_calibration_and_measurement_endpoints():
    """Test full FastAPI REST endpoints for Phase 7 calibrations and measurements."""
    client = TestClient(app)

    # 1. Create test mission
    create_res = client.post(
        "/api/missions",
        params={
            "name": "Measurement Engine Mission",
            "location": "Validation Yard",
            "mission_type": "single-pass",
            "operator": "Measurement Auditor",
        },
    )
    assert create_res.status_code == 200
    mission_id = create_res.json()["mission"]["id"]

    # 2. Initial measurements fetch (uncalibrated)
    get_res = client.get(f"/api/missions/{mission_id}/measurements")
    assert get_res.status_code == 200
    assert get_res.json()["scale_status"] == "RELATIVE_SCALE"
    assert get_res.json()["metric_available"] is False

    # 3. Reference Distance Calibration endpoint
    cal_res = client.post(
        f"/api/missions/{mission_id}/calibrations/reference-distance",
        json={
            "point_a": [0.0, 0.0, 0.0],
            "point_b": [3.0, 4.0, 0.0],  # 5.0 relative units
            "known_distance_meters": 10.0,  # scale_factor = 2.0
            "source_evidence": "Ground reference scale bar",
            "confidence": 0.95,
        },
    )
    assert cal_res.status_code == 200
    cal_data = cal_res.json()["calibration"]
    assert cal_data["scale_factor"] == 2.0
    cal_id = cal_data["calibration_id"]

    # 4. Calibrations listing endpoint
    list_res = client.get(f"/api/missions/{mission_id}/calibrations")
    assert list_res.status_code == 200
    assert list_res.json()["scale_status"] == "METRIC_CALIBRATED"
    assert len(list_res.json()["calibrations"]) == 1

    # 5. Distance measurement endpoint (now metric because calibration is active)
    dist_res = client.post(
        f"/api/missions/{mission_id}/measurements/distance",
        json={
            "point_a": [0.0, 0.0, 0.0],
            "point_b": [0.0, 6.0, 8.0],  # 10.0 relative units * 2.0 = 20.0 m
        },
    )
    assert dist_res.status_code == 200
    dist_meas = dist_res.json()["measurement"]
    assert dist_meas["value"] == 20.0
    assert dist_meas["unit"] == "m"
    assert dist_meas["status"] == "METRIC"
    assert dist_meas["metric_available"] is True

    # 6. Polygon measurement endpoint
    poly_res = client.post(
        f"/api/missions/{mission_id}/measurements/polygon",
        json={
            "vertices": [[0.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, 2.0, 0.0], [0.0, 2.0, 0.0]],
        },
    )
    assert poly_res.status_code == 200
    poly_meas = poly_res.json()["measurement"]
    # 2x2 = 4 relative area * (2^2) = 16 sq_m
    assert poly_meas["area"] == 16.0
    assert poly_meas["unit_area"] == "sq_m"
    assert poly_meas["status"] == "METRIC"

    # 7. Elevation measurement endpoint without verified gravity
    elev_res = client.post(
        f"/api/missions/{mission_id}/measurements/elevation",
        json={
            "point_a": [0.0, 0.0, 1.0],
            "point_b": [0.0, 0.0, 5.0],
            "has_verified_gravity": False,
        },
    )
    assert elev_res.status_code == 200
    assert elev_res.json()["measurement"]["status"] == "UNCERTAIN"

    # 8. Volume measurement endpoint with open mesh
    vol_res = client.post(
        f"/api/missions/{mission_id}/measurements/volume",
        json={"is_watertight": False, "vertices": [[0,0,0], [1,0,0], [0,1,0]], "faces": [[0,1,2]]},
    )
    assert vol_res.status_code == 200
    assert vol_res.json()["measurement"]["status"] == "VOLUME_UNAVAILABLE"

    # 9. Deactivate calibration and verify reversion to relative scale
    deact_res = client.post(f"/api/missions/{mission_id}/calibrations/deactivate")
    assert deact_res.status_code == 200
    assert deact_res.json()["scale_status"] == "RELATIVE_SCALE"

    dist_rel_res = client.post(
        f"/api/missions/{mission_id}/measurements/distance",
        json={"point_a": [0.0, 0.0, 0.0], "point_b": [0.0, 6.0, 8.0]},
    )
    assert dist_rel_res.json()["measurement"]["status"] == "RELATIVE"
    assert dist_rel_res.json()["measurement"]["unit"] == "relative_units"
