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


def calculate_frame_interval(fps: float, sample_fps: float = 2.0) -> int:
    """Calculate frame stride/interval from video FPS and target sampling FPS."""
    if fps <= 0:
        return 1
    safe_sample_fps = max(0.1, float(sample_fps))
    return max(1, round(float(fps) / safe_sample_fps))


ROAD_SCENE_CLASSES: frozenset[str] = frozenset({
    "car",
    "motorcycle",
    "bus",
    "truck",
    "bicycle",
    "person",
    "pedestrian",
    "people",
    "van",
    "motor",
    "tricycle",
    "awning-tricycle",
    "vehicle",
})

SCENE_PROFILES: dict[str, frozenset[str] | None] = {
    "all": None,
    "default": None,
    "road": ROAD_SCENE_CLASSES,
    "terrestrial_road": ROAD_SCENE_CLASSES,
    "rail": frozenset({"train", "person", "car", "truck"}),
    "maritime": frozenset({"boat", "person"}),
    "aerial": frozenset({"airplane"}),
}


def resolve_allowed_classes(
    scene_profile: str | None = None,
    allowed_classes: Iterable[str] | None = None,
) -> set[str] | None:
    """Resolve allowed classes set from explicit list or named scene profile.

    If neither is specified, returns None (all classes permitted, preserving default behavior).
    """
    if allowed_classes is not None:
        return set(allowed_classes)
    if scene_profile:
        profile_key = str(scene_profile).strip().lower()
        if profile_key in SCENE_PROFILES:
            profile_set = SCENE_PROFILES[profile_key]
            return set(profile_set) if profile_set is not None else None
        raise ValueError(
            f"Unknown scene_profile '{scene_profile}'. Supported profiles: {list(SCENE_PROFILES.keys())}"
        )
    return None



def generate_tiles(
    img_width: int,
    img_height: int,
    rows: int = 2,
    cols: int = 2,
    overlap: float = 0.15,
) -> list[tuple[int, int, int, int]]:
    """Generate (x1, y1, x2, y2) bounding coordinates for overlapping tiles spanning an image."""
    def get_1d_intervals(length: int, count: int, ov: float) -> list[tuple[int, int]]:
        if count <= 1 or length <= 0:
            return [(0, length)]
        safe_ov = max(0.0, min(0.5, float(ov)))
        s = length / (count - (count - 1) * safe_ov)
        tile_size = int(round(s))
        step = s * (1.0 - safe_ov)
        intervals = []
        for i in range(count):
            if i == count - 1:
                start = max(0, length - tile_size)
                end = length
            else:
                start = int(round(i * step))
                end = min(length, start + tile_size)
            intervals.append((start, end))
        return intervals

    x_intervals = get_1d_intervals(img_width, cols, overlap)
    y_intervals = get_1d_intervals(img_height, rows, overlap)

    tiles = []
    for y1, y2 in y_intervals:
        for x1, x2 in x_intervals:
            tiles.append((x1, y1, x2, y2))
    return tiles


def _compute_bbox_iou(b1: list[float], b2: list[float]) -> float:
    ix1 = max(b1[0], b2[0])
    iy1 = max(b1[1], b2[1])
    ix2 = min(b1[2], b2[2])
    iy2 = min(b1[3], b2[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if inter <= 0.0:
        return 0.0
    a1 = max(0.0, b1[2] - b1[0]) * max(0.0, b1[3] - b1[1])
    a2 = max(0.0, b2[2] - b2[0]) * max(0.0, b2[3] - b2[1])
    union = a1 + a2 - inter
    return inter / union if union > 0.0 else 0.0


def suppress_tile_duplicates(
    records: list[DetectionRecord],
    iou_threshold: float = 0.5,
) -> tuple[list[DetectionRecord], int]:
    """Suppress duplicate detections across tile overlaps using confidence-aware NMS.

    Returns (kept_records, suppressed_count).
    """
    if len(records) <= 1:
        return list(records), 0

    sorted_records = sorted(records, key=lambda r: r.confidence, reverse=True)
    kept: list[DetectionRecord] = []
    suppressed_count = 0

    for candidate in sorted_records:
        is_dup = False
        for k in kept:
            if k.class_name == candidate.class_name:
                iou = _compute_bbox_iou(k.bbox, candidate.bbox)
                if iou >= iou_threshold:
                    is_dup = True
                    suppressed_count += 1
                    break
        if not is_dup:
            kept.append(candidate)

    return kept, suppressed_count


class DetectionService:
    def __init__(self, registry: ModelRegistry | None = None, model: Any = None):
        self.registry = registry or ModelRegistry()
        self.model = model
        self.record: ModelRecord | None = None
        self.last_tile_duplicates_suppressed: int = 0

    def _get_model(self):
        if self.model is None:
            self.record = self.registry.require_available()
            from ultralytics import YOLO
            self.model = YOLO(self.record.path)
        return self.model

    def detect_frame(
        self,
        frame: Any,
        frame_id: str,
        timestamp: float = 0.0,
        confidence: float | None = None,
        iou: float | None = None,
        classes: set[str] | None = None,
        tile_inference: bool = False,
        tile_rows: int = 2,
        tile_cols: int = 2,
        tile_overlap: float = 0.15,
        tile_iou: float = 0.5,
    ) -> list[DetectionRecord]:
        if frame is None:
            raise ValueError("INVALID_FRAME")
        model = self._get_model()

        if not tile_inference:
            kwargs = {"conf": confidence, "iou": iou, "verbose": False}
            result = model(frame, **{key: value for key, value in kwargs.items() if value is not None})[0]
            return self._normalize(result, frame_id, timestamp, classes, confidence)

        if not hasattr(frame, "shape"):
            raise ValueError("TILE_INFERENCE_REQUIRES_ARRAY")

        h, w = frame.shape[:2]
        tiles = generate_tiles(w, h, rows=tile_rows, cols=tile_cols, overlap=tile_overlap)
        all_raw_records: list[DetectionRecord] = []

        for tx1, ty1, tx2, ty2 in tiles:
            tile = frame[ty1:ty2, tx1:tx2]
            kwargs = {"conf": confidence, "iou": iou, "verbose": False}
            result = model(tile, **{key: value for key, value in kwargs.items() if value is not None})[0]
            tile_records = self._normalize(result, frame_id, timestamp, classes, confidence)
            del tile

            for rec in tile_records:
                remapped_bbox = [
                    round(max(0.0, min(float(w), rec.bbox[0] + tx1)), 4),
                    round(max(0.0, min(float(h), rec.bbox[1] + ty1)), 4),
                    round(max(0.0, min(float(w), rec.bbox[2] + tx1)), 4),
                    round(max(0.0, min(float(h), rec.bbox[3] + ty1)), 4),
                ]
                all_raw_records.append(
                    DetectionRecord(
                        frame_id=rec.frame_id,
                        class_name=rec.class_name,
                        confidence=rec.confidence,
                        bbox=remapped_bbox,
                        timestamp=rec.timestamp,
                    )
                )

        kept_records, suppressed = suppress_tile_duplicates(all_raw_records, iou_threshold=tile_iou)
        self.last_tile_duplicates_suppressed = suppressed
        return kept_records

    def detect_video(
        self,
        video_path: Path,
        sample_fps: float = 2.0,
        confidence: float = 0.35,
        iou: float = 0.7,
        classes: set[str] | None = None,
        scene_profile: str | None = None,
        tile_inference: bool = False,
        tile_rows: int = 2,
        tile_cols: int = 2,
        tile_overlap: float = 0.15,
        tile_iou: float = 0.5,
    ) -> list[DetectionRecord]:
        import cv2
        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise ValueError("INVALID_VIDEO")
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        if fps <= 0:
            capture.release()
            raise ValueError("INVALID_VIDEO")
        interval = calculate_frame_interval(fps, sample_fps)
        effective_classes = resolve_allowed_classes(scene_profile, classes)
        records: list[DetectionRecord] = []
        frame_number = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_number % interval == 0:
                records.extend(
                    self.detect_frame(
                        frame,
                        str(frame_number),
                        frame_number / fps,
                        confidence,
                        iou,
                        effective_classes,
                        tile_inference=tile_inference,
                        tile_rows=tile_rows,
                        tile_cols=tile_cols,
                        tile_overlap=tile_overlap,
                        tile_iou=tile_iou,
                    )
                )
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
