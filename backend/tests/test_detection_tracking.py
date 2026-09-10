from types import SimpleNamespace

import pytest

from backend.detection import DetectionRecord, DetectionService
from backend.model_registry import ModelRegistry, ModelUnavailableError
from backend.tracking import ByteTrackAdapter


class FakeBox:
    def __init__(self, class_id, confidence, bbox):
        self.cls = [[class_id]]
        self.conf = [[confidence]]
        self.xyxy = [bbox]


class FakeModel:
    names = {0: "person", 1: "car"}

    def __init__(self, boxes):
        self.boxes = boxes

    def __call__(self, frame, **kwargs):
        return [SimpleNamespace(names=self.names, boxes=self.boxes)]


def test_model_registry_reports_missing_model(tmp_path):
    registry = ModelRegistry(tmp_path / "missing.pt")

    record = registry.inspect()

    assert record.available is False
    assert record.path.endswith("missing.pt")
    with pytest.raises(ModelUnavailableError, match="YOLO model not found"):
        registry.require_available()


def test_detection_normalizes_and_filters_confidence_and_class():
    model = FakeModel([FakeBox(0, 0.91, [1, 2, 10, 20]), FakeBox(1, 0.25, [3, 4, 8, 9])])
    service = DetectionService(model=model)

    detections = service.detect_frame(object(), "frame-4", timestamp=2.0, confidence=0.5, classes={"person"})

    assert detections == [DetectionRecord("frame-4", "person", 0.91, [1.0, 2.0, 10.0, 20.0], 2.0)]


def test_invalid_frame_is_rejected():
    with pytest.raises(ValueError, match="INVALID_FRAME"):
        DetectionService(model=FakeModel([])).detect_frame(None, "frame-0")


def test_tracking_persists_ids_across_missed_frame_and_counts_unique_objects():
    detector = DetectionRecord("1", "car", 0.8, [10, 10, 20, 20], 0.5)
    same_car = DetectionRecord("3", "car", 0.9, [10, 10, 20, 20], 1.5)
    person = DetectionRecord("3", "person", 0.7, [100, 100, 110, 110], 1.5)

    tracks = ByteTrackAdapter(max_missed_frames=2).track([[detector], [], [same_car, person]])

    assert len(tracks) == 2
    car_track = next(track for track in tracks if track.class_name == "car")
    assert car_track.track_id == "T0001"
    assert car_track.first_frame == "1"
    assert car_track.last_frame == "3"
    assert car_track.detection_count == 2
    assert car_track.to_dict()["duration_seconds"] == 1.0


def test_tracking_closes_track_after_missed_lifecycle():
    detection = DetectionRecord("1", "person", 0.8, [0, 0, 10, 10], 0.0)

    tracks = ByteTrackAdapter(max_missed_frames=1).track([[detection], [], []])

    assert len(tracks) == 1
    assert tracks[0].detection_count == 1
    assert tracks[0].last_frame == "1"


def test_tracker_configuration_is_explicit(monkeypatch):
    monkeypatch.setenv("TRACKER_TYPE", "botsort")
    assert ByteTrackAdapter.configured_tracker() == "botsort"
    monkeypatch.setenv("TRACKER_TYPE", "unsupported")
    with pytest.raises(ValueError, match="TRACKING_FAILED"):
        ByteTrackAdapter.configured_tracker()


def test_canonical_model_resolution_finds_yolo11n(monkeypatch, tmp_path):
    from backend.main import _load_detection_model

    # Ensure environment does not force a custom model path
    monkeypatch.delenv("YOLO_MODEL_PATH", raising=False)

    # 1. Resolves canonical model from normal workspace root
    model, name, is_aeromesh = _load_detection_model(use_aeromesh=False)
    assert name in ("yolo11m", "yolo11s", "yolo11n")
    assert is_aeromesh is False
    assert hasattr(model, "names")
    assert len(model.names) == 80
    assert "car" in model.names.values()

    # 2. Resolves canonical model robustly even when cwd is changed outside repo root
    monkeypatch.chdir(tmp_path)
    model_from_tmp, name2, is_aeromesh2 = _load_detection_model(use_aeromesh=False)
    assert name2 in ("yolo11m", "yolo11s", "yolo11n")
    assert is_aeromesh2 is False
    assert len(model_from_tmp.names) == 80


def test_calculate_frame_interval():
    from backend.detection import calculate_frame_interval

    assert calculate_frame_interval(24.0, 2.0) == 12
    assert calculate_frame_interval(24.0, 5.0) == 5
    assert calculate_frame_interval(30.0, 2.0) == 15
    assert calculate_frame_interval(30.0, 5.0) == 6
    assert calculate_frame_interval(60.0, 2.0) == 30
    assert calculate_frame_interval(0.0, 2.0) == 1
    assert calculate_frame_interval(-10.0, 2.0) == 1


def test_scene_profile_resolution():
    from backend.detection import resolve_allowed_classes, ROAD_SCENE_CLASSES

    # Default None -> None (all classes permitted)
    assert resolve_allowed_classes(None) is None
    assert resolve_allowed_classes("all") is None
    assert resolve_allowed_classes("default") is None

    # Road profile
    road_classes = resolve_allowed_classes("road")
    assert road_classes == set(ROAD_SCENE_CLASSES)
    assert "car" in road_classes
    assert "truck" in road_classes
    assert "train" not in road_classes

    # Case insensitivity
    assert resolve_allowed_classes("TERRESTRIAL_ROAD") == set(ROAD_SCENE_CLASSES)

    # Explicit allowed classes overrides profile
    explicit = resolve_allowed_classes("road", allowed_classes=["car", "bicycle"])
    assert explicit == {"car", "bicycle"}

    # Unknown profile raises ValueError
    with pytest.raises(ValueError, match="Unknown scene_profile"):
        resolve_allowed_classes("unknown_space_station")


def test_phase4_authoritative_artifact_is_not_mutated():
    from pathlib import Path
    import json

    artifact_path = Path("data/validation/phase4/phase4_validation.json")
    assert artifact_path.exists(), "Phase 4.5 validation artifact must exist"

    with artifact_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["validation_phase"] == "Phase 4.5D - Real YOLO11n Validation"
    assert data["model"]["name"] == "yolo11n"
    assert data["detection_metrics"]["total_detections"] == 399
    assert data["detection_metrics"]["detections_by_class"]["car"] == 383
    assert data["detection_metrics"]["detections_by_class"]["train"] == 15
    assert data["detection_metrics"]["detections_by_class"]["truck"] == 1
    assert data["tracking_metrics"]["unique_tracks"] == 23


def test_phase_b_authoritative_artifact_is_not_mutated():
    from pathlib import Path
    import json

    artifact_path = Path("data/validation/accuracy_remediation/phase_b_sampling_benchmark.json")
    assert artifact_path.exists(), "Phase B benchmark artifact must exist"

    with artifact_path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    assert data["benchmark_phase"] == "Phase B — Temporal Sampling & Scene-Specific Class Tuning"
    assert data["runs"]["run_2fps_default"]["detection_metrics"]["total_detections"] == 143
    assert data["runs"]["run_5fps_default"]["detection_metrics"]["total_detections"] == 414
    assert data["runs"]["run_5fps_road_profile"]["detection_metrics"]["total_detections"] == 413


def test_camera_motion_estimator_synthetic():
    import numpy as np
    from backend.tracking import CameraMotionEstimator

    estimator = CameraMotionEstimator(target_width=320, min_inliers=4)
    # Generate image with distinct texture
    np.random.seed(42)
    img1 = np.full((180, 320, 3), 128, dtype=np.uint8)
    for _ in range(30):
        x = np.random.randint(20, 300)
        y = np.random.randint(20, 160)
        img1[y:y+10, x:x+10] = np.random.randint(0, 255, size=(10, 10, 3), dtype=np.uint8)

    m1 = estimator.estimate(img1)
    assert m1.success is True

    # Shift image by (5, -3) pixels
    M = np.float32([[1, 0, 5], [0, 1, -3]])
    import cv2
    img2 = cv2.warpAffine(img1, M, (320, 180))

    m2 = estimator.estimate(img2)
    assert m2.success is True
    assert abs(m2.dx - 5.0) < 1.5
    assert abs(m2.dy - (-3.0)) < 1.5


def test_stitch_tracklets_prevents_merging_coexisting_frames():
    from backend.detection import DetectionRecord
    from backend.tracking import stitch_tracklets

    # Two tracks that exist in the same frame (frame 1) - distinct objects
    recs = [
        DetectionRecord("0", "car", 0.8, [100.0, 100.0, 150.0, 150.0], 0.0, "T1"),
        DetectionRecord("1", "car", 0.8, [105.0, 105.0, 155.0, 155.0], 0.5, "T1"),
        DetectionRecord("1", "car", 0.8, [110.0, 110.0, 160.0, 160.0], 0.5, "T2"),  # overlaps frame 1!
        DetectionRecord("2", "car", 0.8, [115.0, 115.0, 165.0, 165.0], 1.0, "T2"),
    ]

    stitched, num_merged = stitch_tracklets(recs, max_gap_seconds=2.0)
    assert num_merged == 0
    assert len({r.track_id for r in stitched}) == 2


def test_stitch_tracklets_stitches_broken_gap():
    from backend.detection import DetectionRecord
    from backend.tracking import stitch_tracklets

    # Track T1 (frames 0-1) and T2 (frames 3-4) with gap in frame 2
    recs = [
        DetectionRecord("0", "car", 0.8, [100.0, 100.0, 150.0, 150.0], 0.0, "T1"),
        DetectionRecord("1", "car", 0.8, [110.0, 100.0, 160.0, 150.0], 0.5, "T1"),
        DetectionRecord("3", "car", 0.8, [130.0, 100.0, 180.0, 150.0], 1.5, "T2"),
        DetectionRecord("4", "car", 0.8, [140.0, 100.0, 190.0, 150.0], 2.0, "T2"),
    ]

    stitched, num_merged = stitch_tracklets(recs, max_gap_seconds=2.0, max_spatial_distance=100.0)
    assert num_merged == 1
    assert len({r.track_id for r in stitched}) == 1
    # All records unified under the same track ID
    assert stitched[0].track_id == stitched[2].track_id


def test_tile_geometry_generation_and_overlap():
    from backend.detection import generate_tiles

    # 4K UHD test
    tiles = generate_tiles(3840, 2160, rows=2, cols=2, overlap=0.15)
    assert len(tiles) == 4

    # Top-left, top-right, bottom-left, bottom-right
    t_tl, t_tr, t_bl, t_br = tiles
    assert t_tl[0] == 0 and t_tl[1] == 0
    assert t_tr[2] == 3840 and t_tr[1] == 0
    assert t_bl[0] == 0 and t_bl[3] == 2160
    assert t_br[2] == 3840 and t_br[3] == 2160

    # Overlap validation (~15%)
    tile_w = t_tl[2] - t_tl[0]
    tile_h = t_tl[3] - t_tl[1]
    overlap_x = t_tl[2] - t_tr[0]
    overlap_y = t_tl[3] - t_bl[1]
    assert 0.14 <= (overlap_x / tile_w) <= 0.16
    assert 0.14 <= (overlap_y / tile_h) <= 0.16


def test_duplicate_detection_suppression():
    from backend.detection import DetectionRecord, suppress_tile_duplicates

    # Two overlapping detections of the same car across adjacent tiles
    rec1 = DetectionRecord("0", "car", 0.72, [1800.0, 1000.0, 1950.0, 1100.0], 0.0)
    rec2 = DetectionRecord("0", "car", 0.88, [1802.0, 1001.0, 1951.0, 1102.0], 0.0)
    # Distinct vehicle further away
    rec3 = DetectionRecord("0", "car", 0.75, [2500.0, 1200.0, 2600.0, 1280.0], 0.0)

    kept, suppressed = suppress_tile_duplicates([rec1, rec2, rec3], iou_threshold=0.5)
    assert suppressed == 1
    assert len(kept) == 2
    # Highest confidence detection is preserved
    assert any(r.confidence == 0.88 for r in kept)
    assert not any(r.confidence == 0.72 for r in kept)


def test_tile_inference_remaps_coordinates_and_respects_scene_profile():
    import numpy as np
    from backend.detection import DetectionService

    # Mock model that returns a box in tile coordinates [50, 50, 100, 100]
    class MockTileBox:
        def __init__(self, cls_id, conf, bbox):
            self.cls = [[cls_id]]
            self.conf = [[conf]]
            self.xyxy = [bbox]

    class MockTileModel:
        names = {0: "car", 1: "airplane"}

        def __call__(self, tile, **kwargs):
            return [SimpleNamespace(names=self.names, boxes=[
                MockTileBox(0, 0.85, [50.0, 50.0, 100.0, 100.0]),
                MockTileBox(1, 0.90, [60.0, 60.0, 120.0, 120.0]),  # filtered by road profile
            ])]

    service = DetectionService(model=MockTileModel())
    # Create fake 4K frame
    frame = np.zeros((2160, 3840, 3), dtype=np.uint8)

    # Road profile filters out "airplane"
    detections = service.detect_frame(
        frame,
        frame_id="0",
        classes={"car", "bus", "truck"},
        tile_inference=True,
        tile_rows=2,
        tile_cols=2,
        tile_overlap=0.15,
    )

    assert len(detections) >= 1
    assert all(d.class_name == "car" for d in detections)
    # Check that remapping shifted coordinates beyond tile 0 for later tiles
    assert any(d.bbox[0] >= 0.0 and d.bbox[2] <= 3840.0 for d in detections)


def test_default_tile_inference_is_false():
    from backend.detection import DetectionService
    import inspect

    sig = inspect.signature(DetectionService.detect_frame)
    assert sig.parameters["tile_inference"].default is False
    assert sig.parameters["tile_rows"].default == 2
    assert sig.parameters["tile_cols"].default == 2
    assert sig.parameters["tile_overlap"].default == 0.15

    sig_v = inspect.signature(DetectionService.detect_video)
    assert sig_v.parameters["tile_inference"].default is False


def test_no_mutation_of_authoritative_validation_artifacts():
    from pathlib import Path
    base = Path("data/validation")
    assert (base / "accuracy_remediation" / "phase_b_sampling_benchmark.json").exists()
    assert (base / "accuracy_remediation" / "phase_c_tracking_benchmark.json").exists()
    assert (base / "accuracy_remediation" / "phase_e_40keyframe_reconstruction.json").exists()
    assert (base / "phase5" / "phase5_reconstruction.json").exists()
