#!/usr/bin/env python3
"""
Test script to verify aeromesh model integration and confidence scoring.

This script:
1. Creates a mission
2. Uploads a test video
3. Processes the video with aeromesh model
4. Collects and reports confidence scores
5. Verifies Object Summary and Confidence Distribution consistency
"""

import json
import requests
import time
from pathlib import Path

BASE_URL = "http://localhost:8000"
MISSION_NAME = "Aeromesh Test Mission"

# Test videos available
TEST_VIDEOS = [
    Path("c:/Users/kc889/OneDrive/Desktop/Sih/SinglePass3D/input/drone.mp4"),
]

def find_test_video():
    """Find the first available test video."""
    for video_path in TEST_VIDEOS:
        if video_path.exists():
            print(f"✓ Found test video: {video_path}")
            return video_path
    raise FileNotFoundError(f"No test videos found in {TEST_VIDEOS}")

def create_mission(name: str) -> str:
    """Create a new mission and return mission_id."""
    print(f"\n[1] Creating mission: {name}")
    resp = requests.post(
        f"{BASE_URL}/api/missions",
        params={
            "name": name,
            "mission_type": "single-pass",
            "location": "Test Location",
            "operator": "Test Operator",
        }
    )
    resp.raise_for_status()
    data = resp.json()
    # Response format: {"success": true, "mission": {"id": "..."}}
    mission_id = None
    if data.get("success"):
        mission_data = data.get("mission", {})
        mission_id = mission_data.get("id")
    if not mission_id:
        raise ValueError(f"Failed to create mission: {data}")
    print(f"✓ Mission created: {mission_id}")
    return mission_id

def upload_video(mission_id: str, video_path: Path) -> dict:
    """Upload video to mission and return video info."""
    print(f"\n[2] Uploading video: {video_path.name}")
    with open(video_path, "rb") as f:
        resp = requests.post(
            f"{BASE_URL}/api/missions/{mission_id}/upload",
            files={"file": (video_path.name, f)},
        )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise ValueError(f"Failed to upload video: {data}")
    print(f"✓ Video uploaded successfully")
    return data.get("video", {})

def process_video(mission_id: str) -> dict:
    """Process the uploaded video and return results."""
    print(f"\n[3] Processing video (this may take a minute or two...)")
    
    resp = requests.post(
        f"{BASE_URL}/api/missions/{mission_id}/process",
        params={
            "frame_sampling": 2,
            "inference_resolution": 640,
            "detection_confidence": 0.35,
            "reconstruction_quality": "medium",
        }
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("success"):
        raise ValueError(f"Failed to process video: {data}")
    print(f"✓ Video processed successfully")
    return data

def get_mission_data(mission_id: str) -> dict:
    """Get full mission data."""
    mission_file = Path(f"c:/Users/kc889/OneDrive/Desktop/Sih/data/missions/{mission_id}.json")
    with open(mission_file) as f:
        return json.load(f)

def report_results(result: dict, mission_data: dict):
    """Report detection results and verify consistency."""
    print("\n" + "="*70)
    print("DETECTION RESULTS REPORT")
    print("="*70)
    
    detector = mission_data.get("detector", {})
    scene_analysis = mission_data.get("scene_analysis", {})
    objects = mission_data.get("objects", {})
    detections = mission_data.get("detections", {})
    findings = mission_data.get("findings", [])
    
    # Report model information
    print(f"\n📊 MODEL INFORMATION")
    print(f"  Model: {detector.get('model', 'unknown')}")
    print(f"  Dataset: {detector.get('dataset', 'unknown')}")
    print(f"  Domain: {detector.get('domain', 'unknown')}")
    print(f"  Base Threshold: {detector.get('confidence_threshold', 'unknown')}")
    
    if detector.get('per_class_thresholds'):
        print(f"\n  Per-Class Thresholds:")
        for cls, thresh in detector['per_class_thresholds'].items():
            print(f"    - {cls}: {thresh}")
    
    if detector.get('known_weaknesses'):
        print(f"\n  Known Weaknesses:")
        for weakness in detector['known_weaknesses']:
            print(f"    - {weakness}")
    
    if detector.get('known_strengths'):
        print(f"\n  Known Strengths:")
        for strength in detector['known_strengths']:
            print(f"    - {strength}")
    
    # Report Object Summary
    print(f"\n📈 OBJECT SUMMARY (from scene_analysis)")
    print(f"  Total Objects: {objects.get('total', 0)}")
    print(f"  People: {objects.get('people', 0)}")
    print(f"  Vehicles: {objects.get('vehicles', 0)}")
    print(f"  Structures: {objects.get('structures', 0)}")
    print(f"  Hazards: {objects.get('hazards', 0)}")
    print(f"  Confirmed: {objects.get('confirmed_objects', 0)}")
    print(f"  Possible: {objects.get('possible_objects', 0)}")
    print(f"  Rejected: {objects.get('rejected_objects', 0)}")
    
    # Report detection breakdown
    print(f"\n🔍 DETECTION BREAKDOWN (byClass)")
    by_class = detections.get('byClass', {})
    if by_class:
        for cls, count in sorted(by_class.items()):
            print(f"  - {cls}: {count}")
    else:
        print("  No detections by class")
    
    # Report per-class detection summary (raw)
    print(f"\n📊 RAW DETECTION SUMMARY (before remapping)")
    per_class_summary = detections.get('per_class_detection_summary', {})
    if per_class_summary:
        for cls, count in sorted(per_class_summary.items()):
            print(f"  - {cls}: {count}")
    else:
        print("  No raw detection summary available")
    
    # Report Confidence Distribution (from findings)
    print(f"\n📊 CONFIDENCE DISTRIBUTION (from findings)")
    if findings:
        confidence_scores = []
        for finding in findings:
            confidence = finding.get('confidence', 0)
            title = finding.get('title', 'unknown')
            status = finding.get('status', 'unknown')
            confidence_scores.append(confidence)
            print(f"  - {title}")
            print(f"    Confidence: {confidence}%")
            print(f"    Status: {status}")
        
        avg_confidence = sum(confidence_scores) / len(confidence_scores) if confidence_scores else 0
        print(f"\n  Average Confidence: {avg_confidence:.2f}%")
    else:
        print("  No findings available")
    
    # Verify consistency
    print(f"\n✓ CONSISTENCY VERIFICATION")
    scene_total = scene_analysis.get('total', 0)
    objects_total = objects.get('total', 0)
    
    if scene_total == objects_total:
        print(f"  ✓ Scene analysis total ({scene_total}) == Objects total ({objects_total})")
    else:
        print(f"  ✗ MISMATCH: Scene analysis total ({scene_total}) != Objects total ({objects_total})")
    
    # Check per-object evidence
    per_object_evidence = scene_analysis.get('per_object_evidence', [])
    print(f"  ✓ Per-object evidence records: {len(per_object_evidence)}")
    
    if per_object_evidence:
        print(f"\n  Per-Object Evidence Details:")
        for evidence in per_object_evidence[:5]:  # Show first 5
            print(f"    - ID: {evidence.get('track_id')}")
            print(f"      Class: {evidence.get('class')}")
            print(f"      Status: {evidence.get('status')}")
            print(f"      Confidence: {evidence.get('confidence')}")
            print(f"      Source: {evidence.get('source')}")
        if len(per_object_evidence) > 5:
            print(f"    ... and {len(per_object_evidence) - 5} more")
    
    # Scene analysis confidence
    scene_confidence = scene_analysis.get('confidence', 0)
    print(f"\n  Scene Analysis Average Confidence: {scene_confidence:.3f}")
    
    print("\n" + "="*70)

def main():
    """Run the test."""
    try:
        # Find test video
        video_path = find_test_video()
        
        # Create mission
        mission_id = create_mission(MISSION_NAME)
        
        # Upload video
        upload_video(mission_id, video_path)
        
        # Process video
        result = process_video(mission_id)
        
        # Get mission data
        mission_data = get_mission_data(mission_id)
        
        # Report results
        report_results(result, mission_data)
        
        print("\n✓ Test completed successfully!")
        print(f"   Mission ID: {mission_id}")
        print(f"   Mission data saved to: data/missions/{mission_id}.json")
        
    except Exception as e:
        print(f"\n✗ Test failed with error:")
        print(f"  {type(e).__name__}: {e}")
        raise

if __name__ == "__main__":
    main()
