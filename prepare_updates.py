#!/usr/bin/env python3
"""
Update missions.js with real YOLO detection data from mission_results.json
"""
import json
import sys

# Read mission results
with open('mission_results.json') as f:
    results = json.load(f)

# Map each mission to its real detection data
mission_updates = {}
for mission_id in ['north-ridge', 'downtown-grid', 'harbor-district', 'river-approach']:
    r = results[mission_id]
    inf = r['inference']
    det = inf['detections']
    
    # Build detections object matching missions.js format
    mission_updates[mission_id] = {
        'detections': {
            'uniqueTracks': det['uniqueTracks'],
            'byGroup': det['byGroup'],
            'byClass': det['byClass']
        },
        'objects': list(det['byClass'].keys()),
        'frameQuality': inf['frameQuality']
    }
    
    print(f'\n{mission_id}:')
    print(f'  Unique Tracks: {det["uniqueTracks"]}')
    print(f'  By Class: {det["byClass"]}')
    print(f'  Quality: {inf["frameQuality"]}')

# Save for later use
with open('mission_updates.json', 'w') as f:
    json.dump(mission_updates, f, indent=2)

print('\n✓ Mission updates saved to mission_updates.json')
