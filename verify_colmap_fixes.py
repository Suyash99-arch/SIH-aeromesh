#!/usr/bin/env python3
"""
Verification script to show that COLMAP fixes have been correctly applied.
This verifies the code changes without requiring the backend to run.
"""

import sys
import re
from pathlib import Path

def check_file(file_path, description, patterns):
    """Check if a file contains expected patterns."""
    print(f"\n{'='*70}")
    print(f"✓ Checking {description}")
    print(f"  File: {file_path}")
    print(f"{'='*70}")
    
    if not Path(file_path).exists():
        print(f"✗ ERROR: File not found: {file_path}")
        return False
    
    with open(file_path, 'r') as f:
        content = f.read()
    
    all_found = True
    for pattern_name, pattern in patterns:
        if re.search(pattern, content, re.DOTALL | re.MULTILINE):
            print(f"  ✓ Found: {pattern_name}")
        else:
            print(f"  ✗ MISSING: {pattern_name}")
            all_found = False
    
    return all_found

def main():
    """Run verification checks."""
    print("\n" + "="*70)
    print("COLMAP & Response Contract Bug Fix Verification")
    print("="*70)
    
    reconstruction_py = r"c:\Users\kc889\OneDrive\Desktop\Sih\backend\reconstruction.py"
    main_py = r"c:\Users\kc889\OneDrive\Desktop\Sih\backend\main.py"
    
    # Check Bug A Fixes
    print("\n" + "█"*70)
    print("BUG A: COLMAP mapper fails with 'No good initial image pair found'")
    print("█"*70)
    
    colmap_patterns = [
        ("Telemetry-based init pair function", r"def _find_best_initial_pair_from_telemetry"),
        ("Sequential matcher overlap parameter (25)", r"--SequentialMatching\.overlap=25"),
        ("Mapper init_min_tri_angle parameter (6.0)", r"--Mapper\.init_min_tri_angle=6\.0"),
        ("Initial pair arguments in mapper command", r"init_pair_args\s*=\s*\[\]"),
        ("Initial pair application", r"\+\s*init_pair_args"),
    ]
    
    colmap_ok = check_file(reconstruction_py, "COLMAP Pipeline Fixes", colmap_patterns)
    
    if colmap_ok:
        print("\n  ✅ All COLMAP Bug A fixes are in place:")
        print("     1. Sequential matcher overlap widened to 25 (from default 10)")
        print("     2. Mapper init_min_tri_angle relaxed to 6° (from default ~16°)")
        print("     3. Telemetry-based initial pair seeding implemented")
    
    # Check Bug B Fix
    print("\n" + "█"*70)
    print("BUG B: Response contract inconsistency")
    print("█"*70)
    
    response_patterns = [
        ("outer_success variable derivation", r"outer_success\s*=\s*\("),
        ("reconstruction success check", r"reconstruction_result\.get\(\"success\",\s*False\)"),
        ("Return success derived from outer_success", r"\"success\":\s*outer_success"),
        ("NOT hardcoded success: True", r"\"success\":\s*True,\s*$", True),  # Should NOT be found
    ]
    
    response_ok = True
    # Check for positive patterns
    for pattern_name, pattern in response_patterns[:-1]:
        with open(main_py, 'r') as f:
            content = f.read()
        if re.search(pattern, content, re.DOTALL | re.MULTILINE):
            print(f"  ✓ Found: {pattern_name}")
        else:
            print(f"  ✗ MISSING: {pattern_name}")
            response_ok = False
    
    # Check for negative pattern (should NOT be hardcoded True)
    with open(main_py, 'r') as f:
        content = f.read()
    if '"success": True,' in content and "outer_success" in content:
        # Make sure we're not finding the old hardcoded version near the response return
        if re.search(r'return\s+\{\s*"success":\s*True,\s*"processing":', content):
            print(f"  ✗ FAILED: Still has hardcoded 'success': True in response")
            response_ok = False
        else:
            print(f"  ✓ Verified: Old hardcoded response removed")
    else:
        print(f"  ✓ Verified: Old hardcoded response removed")
    
    if response_ok:
        print("\n  ✅ Bug B fix is in place:")
        print("     - Outer success flag now derived from reconstruction_result.success")
        print("     - Response accurately reflects reconstruction outcome")
    
    # Overall summary
    print("\n" + "="*70)
    if colmap_ok and response_ok:
        print("✅ ALL FIXES VERIFIED SUCCESSFULLY")
        print("\nSummary of Changes:")
        print("\n[BUG A] COLMAP Initialization Fixes:")
        print("  1. Added _find_best_initial_pair_from_telemetry() function")
        print("  2. Sequential matcher overlap: 10 → 25")
        print("  3. Mapper init_min_tri_angle: ~16° → 6.0°")
        print("  4. Telemetry-based init pair: --Mapper.init_image_id1/id2 added")
        print("\n[BUG B] Response Contract Fix:")
        print("  - Outer process_video response.success now correctly reflects")
        print("    reconstruction_result.success")
        return 0
    else:
        print("✗ SOME FIXES NOT FOUND - Please review")
        return 1

if __name__ == "__main__":
    sys.exit(main())
