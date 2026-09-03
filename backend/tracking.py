from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable
import os

from .detection import DetectionRecord


@dataclass
class TrackRecord:
    track_id: str
    class_name: str
    first_frame: str
    last_frame: str
    first_timestamp: float
    last_timestamp: float
    detection_count: int = 0
    confidences: list[float] = field(default_factory=list)
    trajectory: list[list[float]] = field(default_factory=list)
    missed_frames: int = 0

    @property
    def duration_seconds(self) -> float:
        return max(0.0, self.last_timestamp - self.first_timestamp)

    @property
    def average_confidence(self) -> float:
        return sum(self.confidences) / len(self.confidences) if self.confidences else 0.0

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["duration_seconds"] = round(self.duration_seconds, 4)
        value["average_confidence"] = round(self.average_confidence, 4)
        return value


class ByteTrackAdapter:
    """Deterministic adapter boundary for Ultralytics ByteTrack/BoT-SORT output."""

    def __init__(self, max_missed_frames: int = 3, iou_threshold: float = 0.3):
        self.max_missed_frames = max_missed_frames
        self.iou_threshold = iou_threshold

    @staticmethod
    def configured_tracker() -> str:
        tracker = os.getenv("TRACKER_TYPE", "bytetrack").strip().lower()
        if tracker not in {"bytetrack", "botsort"}:
            raise ValueError("TRACKING_FAILED: TRACKER_TYPE must be bytetrack or botsort")
        return tracker

    def track(self, detections_by_frame: Iterable[Iterable[DetectionRecord]]) -> list[TrackRecord]:
        active: list[TrackRecord] = []
        completed: list[TrackRecord] = []
        next_id = 1
        for frame_detections in detections_by_frame:
            detections = list(frame_detections)
            matched: set[int] = set()
            for detection in detections:
                candidate = self._best_track(active, detection, matched)
                if candidate is None:
                    candidate = TrackRecord(f"T{next_id:04d}", detection.class_name, detection.frame_id, detection.frame_id, detection.timestamp, detection.timestamp)
                    next_id += 1
                    active.append(candidate)
                candidate.last_frame = detection.frame_id
                candidate.last_timestamp = detection.timestamp
                candidate.detection_count += 1
                candidate.confidences.append(detection.confidence)
                candidate.trajectory.append([(detection.bbox[0] + detection.bbox[2]) / 2, (detection.bbox[1] + detection.bbox[3]) / 2])
                candidate.missed_frames = 0
                matched.add(id(candidate))
            survivors = []
            for track in active:
                if id(track) not in matched:
                    track.missed_frames += 1
                if track.missed_frames > self.max_missed_frames:
                    completed.append(track)
                else:
                    survivors.append(track)
            active = survivors
        return completed + active

    def _best_track(self, tracks: list[TrackRecord], detection: DetectionRecord, matched: set[int]) -> TrackRecord | None:
        best = None
        best_score = self.iou_threshold
        for track in tracks:
            if id(track) in matched or track.class_name != detection.class_name or not track.trajectory:
                continue
            previous = track.trajectory[-1]
            current = [(detection.bbox[0] + detection.bbox[2]) / 2, (detection.bbox[1] + detection.bbox[3]) / 2]
            distance = abs(previous[0] - current[0]) + abs(previous[1] - current[1])
            score = 1 / (1 + distance)
            if score > best_score:
                best_score = score
                best = track
        return best


class UltralyticsTracker:
    """Run Ultralytics' persistent ByteTrack or BoT-SORT implementation."""

    def __init__(self, model: Any, tracker_type: str | None = None):
        self.model = model
        self.tracker_type = (tracker_type or self.configured_tracker())
        if self.tracker_type not in {"bytetrack", "botsort"}:
            raise ValueError("TRACKING_FAILED: unsupported tracker type")

    def track_video(self, video_path, sample_fps: float = 2.0, confidence: float = 0.35, iou: float = 0.7) -> list[DetectionRecord]:
        import cv2
        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise ValueError("INVALID_VIDEO")
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        if fps <= 0:
            capture.release()
            raise ValueError("INVALID_VIDEO")
        interval = max(1, round(fps / max(sample_fps, 0.1)))
        records = []
        frame_number = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_number % interval == 0:
                result = self.model.track(frame, persist=True, tracker=f"{self.tracker_type}.yaml", conf=confidence, iou=iou, verbose=False)[0]
                names = getattr(result, "names", {})
                boxes = getattr(result, "boxes", [])
                for box in boxes:
                    class_id = int(_scalar(box.cls[0]))
                    confidence_value = float(_scalar(box.conf[0]))
                    bbox = box.xyxy[0].tolist() if hasattr(box.xyxy[0], "tolist") else box.xyxy[0]
                    ids = getattr(box, "id", None)
                    track_id = str(int(_scalar(ids[0]))) if ids is not None else None
                    records.append(DetectionRecord(str(frame_number), str(names[class_id]), confidence_value, [float(value) for value in bbox], frame_number / fps, track_id))
            frame_number += 1
        capture.release()
        return records


def _scalar(value):
    while isinstance(value, (list, tuple)):
        value = value[0]
    return value.item() if hasattr(value, "item") else value
