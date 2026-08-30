#!/usr/bin/env python3
"""
Generate updated missions.js with real YOLO detection data
"""
import json

# Read the original missions.js to get its structure
with open('frontend/src/data/missions.js') as f:
    content = f.read()

# Read mission results
with open('mission_results.json') as f:
    results = json.load(f)

# Extract real data for each mission
mission_data = {}
for mission_id in ['north-ridge', 'downtown-grid', 'harbor-district', 'river-approach']:
    r = results[mission_id]
    inf = r['inference']
    det = inf['detections']
    
    mission_data[mission_id] = {
        'uniqueTracks': det['uniqueTracks'],
        'byGroup': det['byGroup'],
        'byClass': det['byClass'],
        'objects': list(det['byClass'].keys()),
    }

# Print real counts for verification
print("\n" + "="*60)
print("REAL MISSION DATA FROM YOLO INFERENCE")
print("="*60)

print("\nNORTH-RIDGE:")
print(f"  Tracks: {mission_data['north-ridge']['uniqueTracks']}")
print(f"  Classes: {mission_data['north-ridge']['byClass']}")

print("\nDOWNTOWN-GRID:")
print(f"  Tracks: {mission_data['downtown-grid']['uniqueTracks']}")
print(f"  Classes: {mission_data['downtown-grid']['byClass']}")

print("\nHARBOR-DISTRICT:")
print(f"  Tracks: {mission_data['harbor-district']['uniqueTracks']}")
print(f"  Classes: {mission_data['harbor-district']['byClass']}")

print("\nRIVER-APPROACH:")
print(f"  Tracks: {mission_data['river-approach']['uniqueTracks']}")
print(f"  Classes: {mission_data['river-approach']['byClass']}")

print("\n" + "="*60)

# Save for missions.js template generation
with open('mission_data_real.json', 'w') as f:
    json.dump(mission_data, f, indent=2)

print("\n✓ Real mission data extracted and saved to mission_data_real.json")
