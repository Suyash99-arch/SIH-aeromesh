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
    model, name, is_aeromesh = _load_detection_model(use_aeromesh=True)
    assert name == "yolo11n"
    assert is_aeromesh is False
    assert hasattr(model, "names")
    assert len(model.names) == 80
    assert "car" in model.names.values()

    # 2. Resolves canonical model robustly even when cwd is changed outside repo root
    monkeypatch.chdir(tmp_path)
    model_from_tmp, name2, is_aeromesh2 = _load_detection_model(use_aeromesh=True)
    assert name2 == "yolo11n"
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
