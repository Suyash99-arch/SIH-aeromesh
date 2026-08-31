import json
from pathlib import Path

mission_file = Path("data/missions/9168ef98-95e.json")
data = json.load(open(mission_file))
sc = data['scene_analysis']

print("Per-object evidence details:")
vehicles = []
for e in sc['per_object_evidence']:
    cls = e['class']
    status = e['status']
    is_vehicle = cls in {"car", "truck", "bus", "motorcycle", "bicycle", "tricycle", "vehicle"}
    print(f"  {e['track_id']}: class={cls}, status={status}, is_vehicle={is_vehicle}")
    if is_vehicle:
        vehicles.append(e)

print(f"\nTotal objects: {len(sc['per_object_evidence'])}")
print(f"Total vehicles (by class check): {len(vehicles)}")
print(f"Reported vehicles count: {data['objects']['vehicles']}")

# Check what's in confirmed vs possible
confirmed = [e for e in sc['per_object_evidence'] if e['status'] == 'CONFIRMED']
possible = [e for e in sc['per_object_evidence'] if e['status'] == 'POSSIBLE']
print(f"\nConfirmed: {len(confirmed)}, Possible: {len(possible)}")

confirmed_vehicles = [e for e in confirmed if e['class'] in {"car", "truck", "bus", "motorcycle", "bicycle", "tricycle", "vehicle"}]
possible_vehicles = [e for e in possible if e['class'] in {"car", "truck", "bus", "motorcycle", "bicycle", "tricycle", "vehicle"}]
print(f"Confirmed vehicles: {len(confirmed_vehicles)}, Possible vehicles: {len(possible_vehicles)}")
print(f"Total vehicles (calc): {len(confirmed_vehicles) + len(possible_vehicles)}")
