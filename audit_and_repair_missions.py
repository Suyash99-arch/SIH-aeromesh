"""
Audit existing missions and repair missing SHA-256 hashes.
DO NOT delete any missions. Only calculate and store missing hashes.
"""

import json
import hashlib
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"


def compute_video_sha256(video_path: Path, chunk_size: int = 65536) -> str:
    """Compute SHA-256 hash of a video file."""
    sha256_hash = hashlib.sha256()
    try:
        with open(video_path, "rb") as f:
            for chunk in iter(lambda: f.read(chunk_size), b""):
                sha256_hash.update(chunk)
        return sha256_hash.hexdigest().upper()
    except Exception as e:
        print(f"    ERROR computing hash: {e}")
        return ""


def audit_missions():
    """Audit all missions and report duplicate videos."""
    print("=" * 80)
    print("MISSION VIDEO AUDIT")
    print("=" * 80)
    
    mission_hashes = {}
    corrupted = []
    no_video = []
    no_hash = []
    
    # Scan all mission JSON files
    for mission_file in sorted(MISSIONS_DIR.glob("*.json")):
        mission_id = mission_file.stem
        
        try:
            with open(mission_file) as f:
                mission_data = json.load(f)
        except Exception as e:
            print(f"ERROR loading {mission_id}: {e}")
            continue
        
        video_info = mission_data.get("video")
        
        if not video_info:
            no_video.append(mission_id)
            continue
        
        # Check if video file exists
        mission_dir = MISSIONS_DIR / mission_id
        video_path = next(mission_dir.glob("video.*"), None)
        
        if not video_path or not video_path.exists():
            print(f"Mission {mission_id}: VIDEO FILE MISSING")
            corrupted.append(mission_id)
            continue
        
        # Get stored hash
        stored_hash = video_info.get("sha256", "").upper()
        
        # Compute current hash
        computed_hash = compute_video_sha256(video_path)
        
        if not computed_hash:
            print(f"Mission {mission_id}: FAILED TO COMPUTE HASH")
            corrupted.append(mission_id)
            continue
        
        if not stored_hash:
            print(f"Mission {mission_id}: NO HASH STORED (will repair)")
            no_hash.append((mission_id, computed_hash))
        elif computed_hash != stored_hash:
            print(f"Mission {mission_id}: HASH MISMATCH")
            print(f"  Stored:   {stored_hash}")
            print(f"  Computed: {computed_hash}")
            corrupted.append(mission_id)
        else:
            print(f"Mission {mission_id}: OK ({computed_hash[:16]}...)")
        
        # Track hashes for duplicate detection
        if computed_hash not in mission_hashes:
            mission_hashes[computed_hash] = []
        mission_hashes[computed_hash].append(mission_id)
    
    # Report duplicates
    print()
    print("=" * 80)
    print("DUPLICATE VIDEO DETECTION")
    print("=" * 80)
    
    duplicates_found = False
    for video_hash, missions_with_hash in sorted(mission_hashes.items()):
        if len(missions_with_hash) > 1:
            duplicates_found = True
            print(f"Hash {video_hash[:16]}... found in {len(missions_with_hash)} missions:")
            for mission_id in missions_with_hash:
                print(f"  - {mission_id}")
    
    if not duplicates_found:
        print("✓ No duplicate videos detected")
    
    # Summary
    print()
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    print(f"Total missions: {len(list(MISSIONS_DIR.glob('*.json')))}")
    print(f"Missions with video: {len(list(MISSIONS_DIR.glob('*.json'))) - len(no_video)}")
    print(f"Missions without video: {len(no_video)}")
    print(f"Missions with missing hash: {len(no_hash)}")
    print(f"Corrupted/problematic: {len(corrupted)}")
    
    return no_hash, corrupted


def repair_missions(missions_to_repair):
    """Add missing SHA-256 hashes to missions."""
    if not missions_to_repair:
        print("\n✓ No repairs needed")
        return
    
    print()
    print("=" * 80)
    print("REPAIRING MISSIONS")
    print("=" * 80)
    
    for mission_id, computed_hash in missions_to_repair:
        mission_file = MISSIONS_DIR / f"{mission_id}.json"
        
        try:
            with open(mission_file) as f:
                mission_data = json.load(f)
            
            # Add/update SHA-256
            if not mission_data.get("video"):
                mission_data["video"] = {}
            
            mission_data["video"]["sha256"] = computed_hash
            
            # Save
            with open(mission_file, "w") as f:
                json.dump(mission_data, f, indent=2)
            
            print(f"✓ Repaired {mission_id}: Added SHA-256 {computed_hash[:16]}...")
        
        except Exception as e:
            print(f"ERROR repairing {mission_id}: {e}")


if __name__ == "__main__":
    print("\nRunning mission audit...\n")
    
    no_hash, corrupted = audit_missions()
    
    if corrupted:
        print()
        print("⚠️  WARNING: Corrupted missions found that need investigation:")
        for mission_id in corrupted:
            print(f"   {mission_id}")
        print("\nThese missions should be manually reviewed before repair.")
    
    if no_hash:
        print()
        print(f"Auto-repairing {len(no_hash)} missions with missing hashes...")
        repair_missions(no_hash)
        print("\n✓ Repair complete")
    
    print("\n" + "=" * 80)
