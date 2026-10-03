#!/usr/bin/env python3
"""
scripts/list_test_missions.py
Dry-run list only: inspects and lists test/synthetic missions under data/missions.
Read-only: NEVER mutates or deletes any mission directory or file.
"""
import sys
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MISSIONS_DIR = BASE_DIR / "data" / "missions"

def list_test_missions():
    print(f"=== LIST TEST MISSIONS (DRY-RUN ONLY) ===")
    print(f"Inspecting directory: {MISSIONS_DIR}")
    
    if not MISSIONS_DIR.exists():
        print("Missions directory does not exist.")
        return

    all_dirs = [d for d in MISSIONS_DIR.iterdir() if d.is_dir()]
    print(f"Total mission directories found: {len(all_dirs)}\n")
    
    test_prefixes = ("test_", "mock_", "synthetic_", "tmp_", "fixture_")
    test_missions = []

    for d in sorted(all_dirs, key=lambda p: p.name):
        is_test = d.name.lower().startswith(test_prefixes)
        meta_file = d / "reconstruction" / "reconstruction_metadata.json"
        has_meta = meta_file.exists()
        
        # Check mission JSON if exists
        mission_json = MISSIONS_DIR / f"{d.name}.json"
        is_synthetic_content = False
        if mission_json.exists():
            try:
                data = json.loads(mission_json.read_text(encoding="utf-8"))
                name = data.get("name", "")
                if "test" in name.lower() or "synthetic" in name.lower():
                    is_synthetic_content = True
            except Exception:
                pass
                
        if is_test or is_synthetic_content:
            test_missions.append((d.name, "TEST / SYNTHETIC", has_meta))
        else:
            print(f"  [AUTHENTIC] {d.name} (has_recon_meta={has_meta})")

    print(f"\nIdentified {len(test_missions)} test/synthetic missions:")
    for name, tag, meta in test_missions:
        print(f"  [{tag}] {name} (has_recon_meta={meta})")
    
    print("\n--> DRY RUN COMPLETE. No files were modified or deleted.")

if __name__ == "__main__":
    list_test_missions()
