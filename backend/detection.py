from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

from .model_registry import ModelRecord, ModelRegistry


@dataclass(frozen=True)
class DetectionRecord:
    frame_id: str
    class_name: str
    confidence: float
    bbox: list[float]
    timestamp: float
    track_id: str | None = None


class DetectionService:
    def __init__(self, registry: ModelRegistry | None = None, model: Any = None):
        self.registry = registry or ModelRegistry()
        self.model = model
        self.record: ModelRecord | None = None

    def _get_model(self):
        if self.model is None:
            self.record = self.registry.require_available()
            from ultralytics import YOLO
            self.model = YOLO(self.record.path)
        return self.model

    def detect_frame(self, frame: Any, frame_id: str, timestamp: float = 0.0, confidence: float | None = None, iou: float | None = None, classes: set[str] | None = None) -> list[DetectionRecord]:
        if frame is None:
            raise ValueError("INVALID_FRAME")
        model = self._get_model()
        kwargs = {"conf": confidence, "iou": iou, "verbose": False}
        result = model(frame, **{key: value for key, value in kwargs.items() if value is not None})[0]
        return self._normalize(result, frame_id, timestamp, classes, confidence)

    def detect_video(self, video_path: Path, sample_fps: float = 2.0, confidence: float = 0.35, iou: float = 0.7, classes: set[str] | None = None) -> list[DetectionRecord]:
        import cv2
        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise ValueError("INVALID_VIDEO")
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        if fps <= 0:
            capture.release()
            raise ValueError("INVALID_VIDEO")
        interval = max(1, round(fps / max(sample_fps, 0.1)))
        records: list[DetectionRecord] = []
        frame_number = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_number % interval == 0:
                records.extend(self.detect_frame(frame, str(frame_number), frame_number / fps, confidence, iou, classes))
            frame_number += 1
        capture.release()
        return records

    @staticmethod
    def _normalize(result: Any, frame_id: str, timestamp: float, classes: set[str] | None, confidence_threshold: float | None = None) -> list[DetectionRecord]:
        names = getattr(result, "names", {})
        records = []
        for box in getattr(result, "boxes", []):
            class_id = int(DetectionService._scalar(box.cls[0]))
            class_name = str(names[class_id] if isinstance(names, dict) else names[class_id])
            confidence = float(DetectionService._scalar(box.conf[0]))
            if confidence_threshold is not None and confidence < confidence_threshold:
                continue
            if classes is not None and class_name not in classes:
                continue
            raw_bbox = box.xyxy[0]
            bbox = raw_bbox.tolist() if hasattr(raw_bbox, "tolist") else raw_bbox
            records.append(DetectionRecord(frame_id, class_name, confidence, [round(float(value), 4) for value in bbox], timestamp))
        return records

    @staticmethod
    def _scalar(value: Any) -> Any:
        while isinstance(value, (list, tuple)):
            value = value[0]
        if hasattr(value, "item"):
            return value.item()
        return value

    @staticmethod
    def serialize(records: Iterable[DetectionRecord]) -> list[dict[str, Any]]:
        return [asdict(record) for record in records]
