import json
from collections import Counter
from pathlib import Path

import cv2
from ultralytics import YOLO

video = Path('data/missions/00559be7-407/video.mp4')
model = YOLO('yolo11n.pt')
cap = cv2.VideoCapture(str(video))

if not cap.isOpened():
    raise RuntimeError(f'Could not open video: {video}')

fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
interval = max(1, round(fps / 10))
observations = []
frame_idx = 0
sampled_frames = 0

while True:
    ok, frame = cap.read()
    if not ok:
        break
    if frame_idx % interval != 0:
        frame_idx += 1
        continue
    sampled_frames += 1
    result = model(frame, conf=0.35, verbose=False)[0]
    for box in result.boxes:
        cls = result.names[int(box.cls[0])]
        conf = float(box.conf[0])
        bbox = [round(float(v), 1) for v in box.xyxy[0].tolist()]
        observations.append({
            'frame': frame_idx,
            'class': cls,
            'confidence': conf,
            'bbox': bbox,
        })
    frame_idx += 1

cap.release()
counts = Counter(item['class'] for item in observations)
summary = {
    'video_exists': video.exists(),
    'fps': round(float(fps), 2),
    'sampled_frames': sampled_frames,
    'total_observations': len(observations),
    'class_counts': dict(counts.most_common()),
    'person_count': sum(1 for item in observations if item['class'].lower() in {'person', 'people'}),
    'vehicle_count': sum(1 for item in observations if item['class'].lower() in {'car', 'truck', 'bus', 'motorcycle', 'bicycle', 'vehicle'}),
    'first_10': observations[:10],
}
print(json.dumps(summary, indent=2))
