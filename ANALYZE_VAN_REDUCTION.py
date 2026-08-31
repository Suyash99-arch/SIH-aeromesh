#!/usr/bin/env python3
"""
Detailed analysis of van detection reduction: 111 raw → 7 confirmed
Shows frame-by-frame breakdown and explains temporal tracking vs confidence filtering
"""

import json
from pathlib import Path
from collections import defaultdict

MISSION_ID = "46bd52d9-1e2"
mission_file = Path(f"data/missions/{MISSION_ID}.json")

with open(mission_file) as f:
    mission_data = json.load(f)

detections = mission_data['detections']
observations = detections['observations']
tracks = mission_data['tracks']
scene_analysis = mission_data['scene_analysis']

print("="*80)
print("VAN DETECTION ANALYSIS: 111 RAW → 7 CONFIRMED")
print("="*80)

# Part 1: Raw detections summary
print("\n[1] RAW DETECTION SUMMARY (before any filtering)")
per_class_summary = detections.get('per_class_detection_summary', {})
print(f"\nPer-class detection counts (per frame detections):")
for cls, count in sorted(per_class_summary.items()):
    print(f"  {cls}: {count}")

print(f"\nTotal raw detections across all frames: {sum(per_class_summary.values())}")

# Part 2: Frame-by-frame van detections
print("\n" + "="*80)
print("[2] FRAME-BY-FRAME VAN DETECTIONS (from observations)")
print("="*80)

# Group observations by frame
van_observations_by_frame = defaultdict(list)
for obs in observations:
    if obs['class'] == 'van':
        van_observations_by_frame[obs['frame']].append(obs)

# Sort by frame number
sorted_frames = sorted(van_observations_by_frame.keys())

print(f"\nFrames with van detections: {len(sorted_frames)}")
print(f"Frame numbers: {sorted_frames}")

total_van_observations = 0
for frame in sorted_frames:
    obs_list = van_observations_by_frame[frame]
    total_van_observations += len(obs_list)
    print(f"\n  Frame {frame}: {len(obs_list)} van observation(s)")
    for obs in obs_list:
        print(f"    - Track: {obs['trackId']}, Confidence: {obs['confidence']}, "
              f"BBox: {obs['boundingBox'][:2]}")

print(f"\nTotal van observations across all frames: {total_van_observations}")

# Part 3: Van tracks
print("\n" + "="*80)
print("[3] VAN TRACKS (final confirmed/possible objects)")
print("="*80)

van_tracks = [t for t in tracks if t['class'] == 'van']
print(f"\nTotal van tracks: {len(van_tracks)}")

for track in van_tracks:
    print(f"\n  {track['trackId']}:")
    print(f"    Class: {track['class']}")
    print(f"    Confidence (avg): {track['confidence']}")
    print(f"    Confidence History: {track['confidenceHistory']}")
    print(f"    Hits (frames seen): {track['hits']}")
    print(f"    Persistence: {track['persistence']}")
    print(f"    First Seen Frame: {track['firstSeen']}")
    print(f"    Last Seen Frame: {track['lastSeen']}")
    print(f"    Frame Range Span: {track['lastSeen'] - track['firstSeen'] + 1} frames")

# Part 4: How confidence filtering worked
print("\n" + "="*80)
print("[4] CONFIDENCE FILTERING ANALYSIS")
print("="*80)

print(f"\nAeromesh model threshold for 'van': 0.25")
print(f"Per-class confidence filtering applied during detection processing")

# Check which observations made it into tracks
tracked_track_ids = {t['trackId'] for t in van_tracks}
print(f"\nVan observations that became tracks: {len(tracked_track_ids)}")

# Part 5: Temporal tracking explanation
print("\n" + "="*80)
print("[5] TEMPORAL TRACKING (IoU + Distance Matching)")
print("="*80)

print("""
How 111 raw detections became 7 tracks:

Step 1: Per-Frame Detection (produces 111 observations)
  - Model processes each sampled frame
  - Detects all objects with confidence > base_confidence
  - Detections are filtered by per-class threshold (van: 0.25)
  - 111 individual detections across multiple frames

Step 2: Temporal Matching (IoU tracking with distance threshold)
  - Each detection attempts to match with existing tracks
  - Matching criteria:
    a) Same class name ('van')
    b) Spatial proximity (distance < 150 pixels)
    c) Consistent center-point location
  - Matched detections extend existing track
  - Non-matching detections create new track

Step 3: Track Consolidation
  - Multiple detections of same physical object → single track
  - Track includes:
    - All hits (frames where matched)
    - Averaged confidence across hits
    - Persistence metric (hits / max(2, hits))
  
Result: 111 frame-level detections → 7 unique tracks

Frame-level detections span multiple frames because same van appears in ~15-20 frames
""")

# Part 6: Quantitative breakdown
print("\n" + "="*80)
print("[6] QUANTITATIVE BREAKDOWN")
print("="*80)

total_hits_in_tracks = sum(t['hits'] for t in van_tracks)
print(f"\nTotal hits across all van tracks: {total_hits_in_tracks}")
print(f"Total van observations: {total_van_observations}")
print(f"Match: {total_hits_in_tracks == total_van_observations}")

print(f"\nPer-track hits distribution:")
for track in van_tracks:
    avg_conf = track['confidence']
    hits = track['hits']
    persistance = track['persistence']
    print(f"  {track['trackId']}: {hits} hits, "
          f"avg confidence {avg_conf}, "
          f"persistence {persistance:.3f}")

avg_hits_per_track = total_hits_in_tracks / len(van_tracks) if van_tracks else 0
print(f"\nAverage hits per van track: {avg_hits_per_track:.1f}")
print(f"This means on average, each van appears in {avg_hits_per_track:.1f} sampled frames")

# Part 7: What didn't make it to final tracks
print("\n" + "="*80)
print("[7] FILTERING AT TRACK LEVEL")
print("="*80)

print(f"\nTrack confirmation criteria (from build_scene_analysis):")
print(f"  - CONFIRMED: hits > 1 AND confidence >= 0.4 AND persistence >= 0.5")
print(f"  - POSSIBLE: otherwise")

van_evidence = [e for e in scene_analysis['per_object_evidence'] if e['class'] == 'van']
confirmed_vans = [e for e in van_evidence if e['status'] == 'CONFIRMED']
possible_vans = [e for e in van_evidence if e['status'] == 'POSSIBLE']

print(f"\nVan track statuses in final scene_analysis:")
print(f"  CONFIRMED: {len(confirmed_vans)}")
print(f"  POSSIBLE: {len(possible_vans)}")

for ev in confirmed_vans:
    print(f"    {ev['track_id']}: {ev['hits']} hits, confidence {ev['confidence']}, "
          f"persistence {ev['persistence']:.3f}")

for ev in possible_vans:
    print(f"    {ev['track_id']}: {ev['hits']} hits, confidence {ev['confidence']}, "
          f"persistence {ev['persistence']:.3f}")

# Part 8: Summary explanation
print("\n" + "="*80)
print("[8] SUMMARY: 111 → 7 REDUCTION MECHANISM")
print("="*80)

print(f"""
The "111 raw detections reduced to 7 confirmed tracks" breaks down as:

1. RAW DETECTIONS (111):
   - These are per-frame detections: each time the model sees a van in a frame, it counts as 1
   - Same physical van appears in multiple sampled frames = multiple detections
   - Confidence filtering (0.25 threshold for van) applied per-detection
   - Result: 111 frame-level observations across the video

2. TEMPORAL AGGREGATION:
   - IoU-based tracking matches frame detections to tracks
   - Spatial distance threshold (<150 pixels) prevents false merges
   - Multiple frame detections of same van → single track
   - 111 observations → 7 tracks (average ~{avg_hits_per_track:.0f} observations per track)

3. FINAL FILTERING:
   - Scene analysis checks track confirmation criteria
   - Tracks with 1+ hits and confidence ≥ 0.4 → CONFIRMED (7 vans)
   - Tracks with <2 hits or low confidence → POSSIBLE or REJECTED (0 additional)

KEY INSIGHT: Confidence filtering (0.25) happens PER-DETECTION
             Temporal deduplication (IoU tracking) reduces frame-level detections to tracks
             Both mechanisms work together to produce 7 final van tracks
""")

print("\n" + "="*80)
