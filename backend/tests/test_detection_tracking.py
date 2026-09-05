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
