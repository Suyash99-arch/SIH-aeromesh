from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable
import os

from .detection import DetectionRecord, calculate_frame_interval, resolve_allowed_classes


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
    observations: list[dict[str, Any]] = field(default_factory=list)
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
                candidate.observations.append({
                    "frame_id": detection.frame_id,
                    "bbox": [float(v) for v in detection.bbox],
                    "confidence": float(detection.confidence),
                    "timestamp": float(detection.timestamp),
                })
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
            if track.observations:
                prev_bbox = track.observations[-1]["bbox"]
                det_bbox = detection.bbox
                ix1 = max(prev_bbox[0], det_bbox[0])
                iy1 = max(prev_bbox[1], det_bbox[1])
                ix2 = min(prev_bbox[2], det_bbox[2])
                iy2 = min(prev_bbox[3], det_bbox[3])
                iw = max(0.0, ix2 - ix1)
                ih = max(0.0, iy2 - iy1)
                inter = iw * ih
                a1 = max(0.0, prev_bbox[2] - prev_bbox[0]) * max(0.0, prev_bbox[3] - prev_bbox[1])
                a2 = max(0.0, det_bbox[2] - det_bbox[0]) * max(0.0, det_bbox[3] - det_bbox[1])
                union = a1 + a2 - inter
                iou = inter / union if union > 0 else 0.0
                score = iou
                if score < self.iou_threshold:
                    cx1 = (prev_bbox[0] + prev_bbox[2]) / 2.0
                    cy1 = (prev_bbox[1] + prev_bbox[3]) / 2.0
                    cx2 = (det_bbox[0] + det_bbox[2]) / 2.0
                    cy2 = (det_bbox[1] + det_bbox[3]) / 2.0
                    dist = ((cx1 - cx2)**2 + (cy1 - cy2)**2)**0.5
                    diag = max(30.0, ((prev_bbox[2] - prev_bbox[0])**2 + (prev_bbox[3] - prev_bbox[1])**2)**0.5)
                    if dist <= diag * 1.5:
                        score = max(score, max(0.0, 1.0 - dist / (diag * 1.5)))
            else:
                previous = track.trajectory[-1]
                current = [(detection.bbox[0] + detection.bbox[2]) / 2, (detection.bbox[1] + detection.bbox[3]) / 2]
                distance = abs(previous[0] - current[0]) + abs(previous[1] - current[1])
                score = 1 / (1 + distance)
            if score > best_score:
                best_score = score
                best = track
        return best


@dataclass
class CameraMotion:
    dx: float = 0.0
    dy: float = 0.0
    scale: float = 1.0
    rotation: float = 0.0
    inliers: int = 0
    success: bool = True


class CameraMotionEstimator:
    """Estimates inter-frame camera motion using sparse optical flow (Lucas-Kanade) and partial affine."""

    def __init__(self, target_width: int = 480, min_inliers: int = 8):
        self.target_width = target_width
        self.min_inliers = min_inliers
        self.prev_gray = None
        self.scale_factor = 1.0

    def estimate(self, frame: Any, exclude_boxes: list[list[float]] | None = None) -> CameraMotion:
        import cv2
        import numpy as np

        h, w = frame.shape[:2]
        target_w = self.target_width
        target_h = int(h * (target_w / w))
        self.scale_factor = w / target_w

        small = cv2.resize(frame, (target_w, target_h))
        curr_gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        if self.prev_gray is None:
            self.prev_gray = curr_gray
            return CameraMotion(success=True)

        mask = np.full((target_h, target_w), 255, dtype=np.uint8)
        if exclude_boxes:
            for b in exclude_boxes:
                bx1 = max(0, int(b[0] / self.scale_factor))
                by1 = max(0, int(b[1] / self.scale_factor))
                bx2 = min(target_w, int(b[2] / self.scale_factor))
                by2 = min(target_h, int(b[3] / self.scale_factor))
                mask[by1:by2, bx1:bx2] = 0

        p0 = cv2.goodFeaturesToTrack(self.prev_gray, maxCorners=150, qualityLevel=0.01, minDistance=20, mask=mask)
        if p0 is None or len(p0) < self.min_inliers:
            p0 = cv2.goodFeaturesToTrack(self.prev_gray, maxCorners=150, qualityLevel=0.01, minDistance=20)

        if p0 is None or len(p0) < self.min_inliers:
            self.prev_gray = curr_gray
            return CameraMotion(success=False)

        p1, st, _ = cv2.calcOpticalFlowPyrLK(self.prev_gray, curr_gray, p0, None)
        good_p0 = p0[st == 1]
        good_p1 = p1[st == 1]

        self.prev_gray = curr_gray

        if len(good_p0) < self.min_inliers:
            return CameraMotion(success=False, inliers=len(good_p0))

        matrix, inliers = cv2.estimateAffinePartial2D(good_p0, good_p1, method=cv2.RANSAC, ransacReprojThreshold=3.0)
        if matrix is None:
            return CameraMotion(success=False, inliers=0)

        inlier_count = int(inliers.sum()) if inliers is not None else 0
        if inlier_count < self.min_inliers:
            return CameraMotion(success=False, inliers=inlier_count)

        a = matrix[0, 0]
        b = matrix[1, 0]
        tx = matrix[0, 2] * self.scale_factor
        ty = matrix[1, 2] * self.scale_factor
        scale = float(np.sqrt(a * a + b * b))
        rotation = float(np.arctan2(b, a))

        return CameraMotion(
            dx=float(tx),
            dy=float(ty),
            scale=scale,
            rotation=rotation,
            inliers=inlier_count,
            success=True,
        )


def stitch_tracklets(
    records: list[DetectionRecord],
    camera_motions_by_frame: dict[int, CameraMotion] | None = None,
    max_gap_seconds: float = 3.5,
    max_spatial_distance: float = 250.0,
    max_area_ratio_diff: float = 0.50,
) -> tuple[list[DetectionRecord], int]:
    """Conservatively stitch broken tracklet fragments of the same physical object.

    Safety constraints:
    - Never merge tracks that co-occur in the same frame (prevents merging distinct vehicles).
    - Never merge tracks with different classes.
    - Strictly limit temporal gap <= max_gap_seconds.
    - Compensate for camera displacement across the temporal gap.
    - Require area/scale ratio compatibility <= max_area_ratio_diff.
    """
    from collections import defaultdict
    import numpy as np

    tracks: dict[str, list[DetectionRecord]] = defaultdict(list)
    untracked = []
    for r in records:
        if r.track_id is None:
            untracked.append(r)
        else:
            tracks[r.track_id].append(r)

    if not tracks:
        return records, 0

    summaries = {}
    for tid, obs in tracks.items():
        sorted_obs = sorted(obs, key=lambda x: x.timestamp)
        first_obs = sorted_obs[0]
        last_obs = sorted_obs[-1]
        first_box = first_obs.bbox
        last_box = last_obs.bbox
        first_center = [(first_box[0] + first_box[2]) / 2, (first_box[1] + first_box[3]) / 2]
        last_center = [(last_box[0] + last_box[2]) / 2, (last_box[1] + last_box[3]) / 2]
        first_area = max(1.0, (first_box[2] - first_box[0]) * (first_box[3] - first_box[1]))
        last_area = max(1.0, (last_box[2] - last_box[0]) * (last_box[3] - last_box[1]))
        frames = {int(o.frame_id) for o in sorted_obs}

        velocity = [0.0, 0.0]
        if len(sorted_obs) >= 2:
            dt = last_obs.timestamp - sorted_obs[-2].timestamp
            if dt > 0:
                p_prev = [(sorted_obs[-2].bbox[0] + sorted_obs[-2].bbox[2]) / 2, (sorted_obs[-2].bbox[1] + sorted_obs[-2].bbox[3]) / 2]
                velocity = [(last_center[0] - p_prev[0]) / dt, (last_center[1] - p_prev[1]) / dt]

        summaries[tid] = {
            "track_id": tid,
            "class_name": first_obs.class_name,
            "first_timestamp": first_obs.timestamp,
            "last_timestamp": last_obs.timestamp,
            "first_frame": int(first_obs.frame_id),
            "last_frame": int(last_obs.frame_id),
            "first_center": first_center,
            "last_center": last_center,
            "first_area": first_area,
            "last_area": last_area,
            "velocity": velocity,
            "frames": frames,
            "hits": len(sorted_obs),
        }

    candidates = []
    track_ids = list(summaries.keys())
    for i in range(len(track_ids)):
        tA = summaries[track_ids[i]]
        for j in range(len(track_ids)):
            if i == j:
                continue
            tB = summaries[track_ids[j]]

            if tA["class_name"] != tB["class_name"]:
                continue

            gap = tB["first_timestamp"] - tA["last_timestamp"]
            if gap <= 0 or gap > max_gap_seconds:
                continue

            if tA["frames"].intersection(tB["frames"]):
                continue

            area_a = tA["last_area"]
            area_b = tB["first_area"]
            max_area = max(area_a, area_b)
            if max_area > 0 and abs(area_a - area_b) / max_area > max_area_ratio_diff:
                continue

            cam_dx = 0.0
            cam_dy = 0.0
            if camera_motions_by_frame:
                start_f = tA["last_frame"]
                end_f = tB["first_frame"]
                for f_num, m in camera_motions_by_frame.items():
                    if start_f < f_num <= end_f and m.success:
                        cam_dx += m.dx
                        cam_dy += m.dy

            pred_x = tA["last_center"][0] + tA["velocity"][0] * gap + cam_dx
            pred_y = tA["last_center"][1] + tA["velocity"][1] * gap + cam_dy

            dist_pred = float(np.sqrt((pred_x - tB["first_center"][0]) ** 2 + (pred_y - tB["first_center"][1]) ** 2))
            dist_cam_only = float(np.sqrt((tA["last_center"][0] + cam_dx - tB["first_center"][0]) ** 2 + (tA["last_center"][1] + cam_dy - tB["first_center"][1]) ** 2))
            dist_direct = float(np.sqrt((tA["last_center"][0] - tB["first_center"][0]) ** 2 + (tA["last_center"][1] - tB["first_center"][1]) ** 2))

            effective_dist = min(dist_pred, dist_cam_only, dist_direct)
            if effective_dist <= max_spatial_distance:
                score = effective_dist + gap * 20.0
                candidates.append((score, track_ids[i], track_ids[j]))

    candidates.sort(key=lambda x: x[0])

    parent = {tid: tid for tid in track_ids}

    def find(i):
        if parent[i] == i:
            return i
        parent[i] = find(parent[i])
        return parent[i]

    def union(i, j):
        root_i = find(i)
        root_j = find(j)
        if root_i != root_j:
            if summaries[root_i]["first_timestamp"] <= summaries[root_j]["first_timestamp"]:
                parent[root_j] = root_i
            else:
                parent[root_i] = root_j
            return True
        return False

    merged_a = set()
    merged_b = set()
    num_stitched = 0

    for score, id_a, id_b in candidates:
        if id_a in merged_a or id_b in merged_b:
            continue
        root_a = find(id_a)
        root_b = find(id_b)
        if root_a == root_b:
            continue

        frames_a = set()
        frames_b = set()
        for tid in track_ids:
            if find(tid) == root_a:
                frames_a.update(summaries[tid]["frames"])
            if find(tid) == root_b:
                frames_b.update(summaries[tid]["frames"])
        if frames_a.intersection(frames_b):
            continue

        union(id_a, id_b)
        merged_a.add(id_a)
        merged_b.add(id_b)
        num_stitched += 1

    stitched_records = []
    for r in records:
        if r.track_id is None:
            stitched_records.append(r)
        else:
            final_id = find(r.track_id)
            stitched_records.append(
                DetectionRecord(
                    frame_id=r.frame_id,
                    class_name=r.class_name,
                    confidence=r.confidence,
                    bbox=r.bbox,
                    timestamp=r.timestamp,
                    track_id=final_id,
                )
            )

    return stitched_records, num_stitched


class UltralyticsTracker:
    """Run Ultralytics' persistent ByteTrack or BoT-SORT implementation with camera motion compensation and tracklet stitching."""

    @staticmethod
    def configured_tracker() -> str:
        return ByteTrackAdapter.configured_tracker()

    def __init__(self, model: Any, tracker_type: str | None = None):
        self.model = model
        self.tracker_type = (tracker_type or self.configured_tracker())
        if self.tracker_type not in {"bytetrack", "botsort"}:
            raise ValueError("TRACKING_FAILED: unsupported tracker type")
        self.last_motion_failures: int = 0
        self.last_stitched_count: int = 0
        self.last_raw_tracks: int = 0
        self.last_final_tracks: int = 0

    def track_video(
        self,
        video_path,
        sample_fps: float = 2.0,
        confidence: float = 0.35,
        iou: float = 0.7,
        classes: set[str] | list[str] | None = None,
        scene_profile: str | None = None,
        enable_motion_compensation: bool = True,
        enable_stitching: bool = True,
        stitching_max_gap: float = 3.5,
        stitching_max_distance: float = 250.0,
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
        allowed_classes = resolve_allowed_classes(scene_profile, classes)

        motion_estimator = CameraMotionEstimator(target_width=480) if enable_motion_compensation else None
        camera_motions: dict[int, CameraMotion] = {}
        motion_failures = 0

        records = []
        frame_number = 0
        while True:
            ok, frame = capture.read()
            if not ok:
                break
            if frame_number % interval == 0:
                if motion_estimator is not None:
                    motion = motion_estimator.estimate(frame)
                    camera_motions[frame_number] = motion
                    if not motion.success:
                        motion_failures += 1

                result = self.model.track(frame, persist=True, tracker=f"{self.tracker_type}.yaml", conf=confidence, iou=iou, verbose=False)[0]
                names = getattr(result, "names", {})
                boxes = getattr(result, "boxes", [])
                for box in boxes:
                    class_id = int(_scalar(box.cls[0]))
                    class_name = str(names[class_id] if isinstance(names, dict) else names[class_id])
                    if allowed_classes is not None and class_name not in allowed_classes:
                        continue
                    confidence_value = float(_scalar(box.conf[0]))
                    bbox = box.xyxy[0].tolist() if hasattr(box.xyxy[0], "tolist") else box.xyxy[0]
                    ids = getattr(box, "id", None)
                    track_id = str(int(_scalar(ids[0]))) if ids is not None else None
                    records.append(DetectionRecord(str(frame_number), class_name, confidence_value, [float(value) for value in bbox], frame_number / fps, track_id))
            frame_number += 1
        capture.release()

        raw_tracks = len({r.track_id for r in records if r.track_id})
        self.last_motion_failures = motion_failures
        self.last_raw_tracks = raw_tracks

        if enable_stitching and records:
            stitched_records, num_stitched = stitch_tracklets(
                records,
                camera_motions_by_frame=camera_motions if enable_motion_compensation else None,
                max_gap_seconds=stitching_max_gap,
                max_spatial_distance=stitching_max_distance,
            )
            self.last_stitched_count = num_stitched
            self.last_final_tracks = len({r.track_id for r in stitched_records if r.track_id})
            return stitched_records

        self.last_stitched_count = 0
        self.last_final_tracks = raw_tracks
        return records


def _scalar(value):
    while isinstance(value, (list, tuple)):
        value = value[0]
    return value.item() if hasattr(value, "item") else value
