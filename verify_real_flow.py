import json
import requests

base = 'http://127.0.0.1:8000/api'
create = requests.post(
    f'{base}/missions',
    params={'name': 'real-flow-check-4', 'mission_type': 'single-pass', 'location': 'validation', 'operator': 'copilot'},
    timeout=60,
)
mission_id = create.json()['mission']['id']
print('CREATE_STATUS', create.status_code)
print('MISSION_ID', mission_id)

with open(r'C:\Users\kc889\OneDrive\Desktop\Sih\tests\test.mp4', 'rb') as f:
    upload = requests.post(
        f'{base}/missions/{mission_id}/upload',
        files={'file': ('test.mp4', f, 'video/mp4')},
        timeout=180,
    )
print('UPLOAD_STATUS', upload.status_code)
print('UPLOAD_JSON', json.dumps(upload.json(), indent=2, default=str))

process = requests.post(
    f'{base}/missions/{mission_id}/process',
    params={'frame_sampling': 2, 'inference_resolution': 640, 'detection_confidence': 0.35, 'reconstruction_quality': 'medium'},
    timeout=600,
)
print('PROCESS_STATUS', process.status_code)
print('PROCESS_JSON', json.dumps(process.json(), indent=2, default=str))

recon = requests.get(f'{base}/missions/{mission_id}/reconstruction', timeout=180)
print('RECON_STATUS', recon.status_code)
print('RECON_JSON', json.dumps(recon.json(), indent=2, default=str))

mission = requests.get(f'{base}/missions/{mission_id}', timeout=180)
print('MISSION_STATUS', mission.status_code)
print('MISSION_JSON', json.dumps(mission.json(), indent=2, default=str))
