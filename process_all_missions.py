#!/usr/bin/env python3
"""
Process all 4 demo mission videos through the same YOLO pipeline.
Outputs real detection/findings data for each mission.
"""

import sys
import json
import cv2
from pathlib import Path

# Add SinglePass3D to path
sys.path.insert(0, str(Path(__file__).parent / "SinglePass3D" / "backend"))

from inference import process_video

MISSIONS = {
    "north-ridge": "frontend/public/assets/missions/north-ridge/flight-video.mp4",
    "downtown-grid": "frontend/public/assets/missions/downtown-grid/flight-video.mp4",
    "harbor-district": "frontend/public/assets/missions/harbor-district/flight-video.mp4",
    "river-approach": "frontend/public/assets/missions/river-approach/flight-video.mp4",
}

results = {}

for mission_id, video_path in MISSIONS.items():
    full_path = Path(__file__).parent / video_path
    
    if not full_path.exists():
        print(f"MISSING: {mission_id} at {full_path}")
        continue
    
    print(f"\n{'='*60}")
    print(f"Processing {mission_id}...")
    print(f"{'='*60}")
    
    try:
        # Get video info
        cap = cv2.VideoCapture(str(full_path))
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        cap.release()
        
        # Run inference
        inference_result = process_video(
            full_path,
            sample_fps=2,
            confidence=0.35
        )
        
        results[mission_id] = {
            "video_path": str(full_path),
            "fps": fps,
            "total_frames": total_frames,
            "duration_s": round(total_frames / fps, 2) if fps > 0 else 0,
            "inference": inference_result
        }
        
        # Print summary
        detections = inference_result.get("detections", {})
        print(f"✓ Unique tracks: {detections.get('uniqueTracks', 0)}")
        print(f"✓ Findings: {len(inference_result.get('findings', []))}")
        print(f"✓ Surface coverage: {inference_result.get('reconstruction', {}).get('observedSurface', '?')}%")
        
    except Exception as e:
        print(f"✗ Error processing {mission_id}: {e}")
        results[mission_id] = {"error": str(e)}

# Output all results as JSON
output_file = Path(__file__).parent / "mission_results.json"
with open(output_file, "w") as f:
    json.dump(results, f, indent=2)

print(f"\n{'='*60}")
print(f"Results saved to: {output_file}")
print(f"{'='*60}")

# Print summary
for mission_id in MISSIONS:
    if mission_id in results and "error" not in results[mission_id]:
        r = results[mission_id]
        print(f"{mission_id}: {r['duration_s']}s @ {r['fps']}fps, {r['inference'].get('detections', {}).get('uniqueTracks', 0)} tracks")
    else:
        print(f"{mission_id}: FAILED")
