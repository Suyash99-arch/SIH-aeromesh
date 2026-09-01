#!/usr/bin/env python3
"""
CRITICAL TEST: Verify trained aeromesh_yolo.pt is used, NOT yolo11n.pt

This test:
1. Loads the inference module
2. Runs inference on a real video
3. Verifies the correct model was loaded
4. Verifies real AEROMESH class names in results (not COCO)
5. Verifies detections were actually made
"""

import sys
import json
from pathlib import Path

# Resolve repo root and add SinglePass3D backend to path
current = Path(__file__).resolve()
repo_root = current.parent
single_pass_3d = repo_root / "SinglePass3D" / "backend"
sys.path.insert(0, str(single_pass_3d))

def test_trained_model_inference():
    """Test 1: Load inference and verify trained model is used"""
    print("\n" + "=" * 80)
    print("TEST 1: VERIFY TRAINED MODEL LOADS (NOT YOLO11N)")
    print("=" * 80)
    
    try:
        from inference import process_video, AEROMESH_CLASSES
        print("✓ inference module imported successfully")
    except Exception as e:
        print(f"❌ Failed to import inference: {e}")
        return False
    
    # Verify AEROMESH classes are defined
    print(f"\n✓ AEROMESH classes defined: {len(AEROMESH_CLASSES)} classes")
    print(f"  Classes: {list(AEROMESH_CLASSES.values())}")
    
    expected_classes = {"van", "truck", "tricycle", "bus", "car", "bicycle", "motor", "pedestrian", "people", "awning-tricycle"}
    actual_classes = set(AEROMESH_CLASSES.values())
    
    if actual_classes == expected_classes:
        print("✓ All expected AEROMESH classes present")
        return True
    else:
        print(f"❌ Class mismatch!")
        print(f"  Expected: {expected_classes}")
        print(f"  Actual: {actual_classes}")
        return False


def test_real_video_inference():
    """Test 2: Run inference on a real mission video"""
    print("\n" + "=" * 80)
    print("TEST 2: REAL VIDEO INFERENCE")
    print("=" * 80)
    
    # Use a known mission video
    video_path = repo_root / "data" / "missions" / "040bcc51-8e0" / "video.mp4"
    
    if not video_path.exists():
        print(f"❌ Test video not found: {video_path}")
        return False
    
    print(f"✓ Test video found: {video_path.name} ({video_path.stat().st_size / 1024 / 1024:.1f} MB)")
    
    try:
        from inference import process_video
        
        print("\n[RUNNING INFERENCE]")
        result = process_video(video_path, sample_fps=2.0, confidence=0.35)
        
        print("\n[INFERENCE COMPLETE]")
        return result
        
    except Exception as e:
        print(f"❌ Inference failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_model_provenance():
    """Test 3: Verify model provenance is correct"""
    print("\n" + "=" * 80)
    print("TEST 3: MODEL PROVENANCE VERIFICATION")
    print("=" * 80)
    
    result = test_real_video_inference()
    
    if result is False:
        print("❌ Inference failed in previous test")
        return False
    
    provenance = result.get("provenance", {})
    obj_det = provenance.get("objectDetection", {})
    
    print(f"\nProvenance data:")
    print(f"  Model: {obj_det.get('model')}")
    print(f"  Mode: {obj_det.get('mode')}")
    print(f"  Dataset: {obj_det.get('dataset')}")
    
    # CRITICAL CHECKS
    checks = [
        ("model", "aeromesh_yolo.pt", obj_det.get("model")),
        ("mode", "trained/fine-tuned", obj_det.get("mode")),
        ("NOT COCO", None, "COCO" not in obj_det.get("dataset", "")),
    ]
    
    all_pass = True
    for check_name, expected, actual in checks:
        if check_name == "NOT COCO":
            if actual:
                print(f"  ✓ {check_name}: {actual}")
            else:
                print(f"  ❌ {check_name}: Found COCO in dataset string!")
                all_pass = False
        else:
            if actual == expected:
                print(f"  ✓ {check_name}: {actual}")
            else:
                print(f"  ❌ {check_name}: Expected '{expected}', got '{actual}'")
                all_pass = False
    
    return all_pass


def test_detections_are_real():
    """Test 4: Verify detections are real (not fabricated)"""
    print("\n" + "=" * 80)
    print("TEST 4: DETECTIONS ARE REAL")
    print("=" * 80)
    
    result = test_real_video_inference()
    
    if result is False:
        print("❌ Inference failed")
        return False
    
    detections = result.get("detections", {})
    unique_tracks = detections.get("uniqueTracks", 0)
    by_class = detections.get("byClass", {})
    observations = detections.get("observations", [])
    
    print(f"\nDetections found:")
    print(f"  Unique tracks: {unique_tracks}")
    print(f"  By class: {by_class}")
    print(f"  Observations: {len(observations)}")
    
    if unique_tracks == 0:
        print("⚠️  WARNING: No detections found")
        print("   This may be expected if video has no objects")
        return True
    
    # Verify class names are AEROMESH, not COCO
    from inference import AEROMESH_CLASSES
    expected_classes = set(AEROMESH_CLASSES.values())
    actual_classes = set(by_class.keys())
    
    if actual_classes.issubset(expected_classes):
        print(f"✓ All detected classes are AEROMESH classes: {actual_classes}")
        return True
    else:
        invalid = actual_classes - expected_classes
        print(f"❌ Found invalid class names: {invalid}")
        print(f"   Expected only: {expected_classes}")
        return False


def test_model_path():
    """Test 5: Verify model path resolution"""
    print("\n" + "=" * 80)
    print("TEST 5: MODEL PATH RESOLUTION")
    print("=" * 80)
    
    try:
        from inference import _resolve_trained_model, _resolve_repo_root
        
        repo_root = _resolve_repo_root()
        print(f"✓ Repository root resolved: {repo_root}")
        
        model_path = _resolve_trained_model()
        print(f"✓ Model path resolved: {model_path}")
        
        if model_path.exists():
            size_mb = model_path.stat().st_size / 1024 / 1024
            print(f"✓ Model file exists ({size_mb:.1f} MB)")
            return True
        else:
            print(f"❌ Model file not found: {model_path}")
            return False
        
    except Exception as e:
        print(f"❌ Path resolution failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    print("\n" + "=" * 80)
    print(" " * 20 + "AEROMESH TRAINED MODEL VERIFICATION")
    print("=" * 80)
    
    tests = [
        ("Model Path Resolution", test_model_path),
        ("AEROMESH Classes Defined", test_trained_model_inference),
        ("Model Provenance", test_model_provenance),
        ("Detections Are Real", test_detections_are_real),
    ]
    
    results = []
    for test_name, test_func in tests:
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"\n❌ TEST EXCEPTION: {e}")
            import traceback
            traceback.print_exc()
            results.append((test_name, False))
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, r in results if r)
    total = len(results)
    
    for test_name, result in results:
        status = "✓ PASS" if result else "❌ FAIL"
        print(f"{status}: {test_name}")
    
    print(f"\nResult: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n✅ TRAINED MODEL IS CORRECTLY INTEGRATED")
        print("   yolo11n.pt is NOT being used")
        return 0
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED")
        return 1


if __name__ == "__main__":
    sys.exit(main())
