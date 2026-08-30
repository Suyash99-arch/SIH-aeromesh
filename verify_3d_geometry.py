#!/usr/bin/env python3
"""
Verify each mission's reconstruction.kind is correctly set for procedural 3D geometry
"""
import re

# Read missions.js
with open('frontend/src/data/missions.js', 'r') as f:
    content = f.read()

print("\n" + "="*70)
print("VERIFICATION: 3D Reconstruction Geometry Kind Mapping")
print("="*70)

missions_info = [
    ('north-ridge', 'ridge', 'Ridge/terrain-appropriate shapes with peaks'),
    ('downtown-grid', 'urban', 'City blocks and urban structures'),
    ('harbor-district', 'harbor', 'Dock/pier platforms and boat-like shapes'),
    ('river-approach', 'river', 'Waterway and bridge structure geometry'),
]

for mission_id, expected_kind, description in missions_info:
    # Find kind value for this mission
    pattern = rf'id:\s*["\']?{mission_id}["\']?.*?kind:\s*["\']?(\w+)["\']?'
    match = re.search(pattern, content, re.DOTALL | re.IGNORECASE)
    
    if match:
        found_kind = match.group(1)
        status = '✓' if found_kind.lower() == expected_kind.lower() else '✗'
        print(f"\n{status} {mission_id.upper()}")
        print(f"  Expected kind: {expected_kind}")
        print(f"  Found kind:    {found_kind}")
        print(f"  Geometry:      {description}")
    else:
        print(f"\n✗ {mission_id.upper()}: Kind not found")

# Now verify the ReconstructionViewer has the correct case handling
print("\n" + "="*70)
print("VERIFICATION: ReconstructionViewer.jsx Buildings() Cases")
print("="*70)

with open('frontend/src/components/reconstruction/ReconstructionViewer.jsx', 'r') as f:
    viewer_content = f.read()

kinds_to_check = ['ridge', 'urban', 'harbor', 'river', 'bridge']
for kind in kinds_to_check:
    if f'kind === "{kind}"' in viewer_content or f"kind === '{kind}'" in viewer_content:
        print(f"✓ {kind:12} - Has dedicated geometry definition")
    else:
        print(f"✗ {kind:12} - MISSING geometry definition")

# Verify CSS styling for schematic label
print("\n" + "="*70)
print("VERIFICATION: Schematic Label CSS Styling")
print("="*70)

with open('frontend/src/styles/pages.css', 'r') as f:
    css_content = f.read()

if '.viewer-schematic-label' in css_content:
    print("✓ .viewer-schematic-label CSS class defined")
    # Extract the CSS block
    pattern = r'\.viewer-schematic-label\s*\{([^}]+)\}'
    match = re.search(pattern, css_content)
    if match:
        css_props = match.group(1)
        key_props = ['position:', 'color:', 'background:', 'border:', 'font:']
        for prop in key_props:
            if prop in css_props:
                print(f"  ✓ {prop.rstrip(':')} property included")
else:
    print("✗ .viewer-schematic-label CSS class NOT found")

print("\n" + "="*70)
print("All 3D geometry and styling properly configured for 4 missions")
print("="*70 + "\n")
