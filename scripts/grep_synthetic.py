import re
import sys
from pathlib import Path

terms = ['procedural', 'synthetic', 'Math.random', 'np.random', 'generateDemo', 'hybrid']
roots = [Path('backend'), Path('frontend/src')]
exts = {'.py', '.js', '.jsx', '.ts', '.tsx'}
skip_dirs = {'__pycache__', 'node_modules', '.venv', '.venv311', 'dist', 'build'}

files_to_check = []
for r in roots:
    for p in r.rglob('*'):
        if any(part in skip_dirs for part in p.parts):
            continue
        if p.suffix in exts and p.is_file():
            files_to_check.append(p)

for t in terms:
    print(f"=== GREP FOR \"{t}\" ===", flush=True)
    matches = []
    pattern = re.compile(re.escape(t), re.IGNORECASE)
    for p in files_to_check:
        try:
            lines = p.read_text(encoding='utf-8', errors='ignore').splitlines()
            for idx, line in enumerate(lines, 1):
                if pattern.search(line):
                    matches.append(f"{p.as_posix()}:{idx}: {line.strip()[:100]}")
        except Exception:
            pass
    for m in matches[:10]:
        print(m, flush=True)
    print(f"Total matches for '{t}': {len(matches)}\n", flush=True)
