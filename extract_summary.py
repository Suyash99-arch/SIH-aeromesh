import json
with open('mission_results.json') as f:
    results = json.load(f)
for mission_id in ['north-ridge', 'downtown-grid', 'harbor-district', 'river-approach']:
    r = results[mission_id]
    inf = r['inference']
    det = inf['detections']
    recon = inf['reconstruction']
    print(f'\n{mission_id}:')
    print(f'  Tracks: {det["uniqueTracks"]}')
    print(f'  Classes: {list(det["byClass"].keys())}')
    print(f'  Counts: {det["byClass"]}')
    print(f'  Observed: {recon["observedSurface"]}%')
    print(f'  Confidence: {recon["confidence"]}%')
