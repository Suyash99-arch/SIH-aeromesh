"""
AeroMesh Legacy Mission Cleanup Tool
Phase 10 — Migration & Maintenance

Safely inspects and moves legacy non-UUID (12-character or alias) mission folders to a trash/backup directory.

Usage:
  # Dry-run inspection (default):
  python -m backend.tools.cleanup_legacy --dry-run

  # Perform move to trash/backup folder (requires --confirm):
  python -m backend.tools.cleanup_legacy --confirm
"""

import argparse
import logging
import os
import shutil
import sys
import time
import uuid
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cleanup_legacy")

# Define base paths
BASE_DIR = Path(__file__).resolve().parent.parent.parent
BACKEND_DIR = BASE_DIR / "backend"
DATA_DIR = BASE_DIR / "data"
MISSIONS_DIR = DATA_DIR / "missions"
TRASH_DIR = DATA_DIR / "trash_missions"


def is_valid_uuid(val: str) -> bool:
    """Return True if val is a valid 36-character UUID v4/v5 string."""
    if not isinstance(val, str) or len(val) != 36:
        return False
    try:
        uuid.UUID(val)
        return True
    except ValueError:
        return False


def get_dir_size_bytes(path: Path) -> int:
    """Calculate recursive directory size in bytes."""
    total = 0
    try:
        for p in path.rglob("*"):
            if p.is_file():
                total += p.stat().st_size
    except Exception:
        pass
    return total


def find_legacy_missions(search_dirs: list[Path]) -> list[Path]:
    """Scans target directories for non-UUID mission folders."""
    legacy_folders = []
    seen_paths = set()
    for base_dir in search_dirs:
        if not base_dir.exists():
            continue
        for child in base_dir.iterdir():
            if child.is_dir() and child not in seen_paths:
                m_id = child.name
                if not is_valid_uuid(m_id):
                    legacy_folders.append(child)
                    seen_paths.add(child)
    return legacy_folders


def run_cleanup(dry_run: bool = True, confirm: bool = False, target_trash_dir: Path = TRASH_DIR):
    """Inspects and safely moves legacy non-UUID missions to trash/backup folder."""
    search_dirs = [
        MISSIONS_DIR,
        DATA_DIR / "objects" / "missions",
        DATA_DIR / "processing",
    ]

    legacy_folders = find_legacy_missions(search_dirs)

    if not legacy_folders:
        logger.info("No legacy non-UUID mission folders found. System is clean.")
        return

    logger.info("Found %d legacy non-UUID mission folder(s):", len(legacy_folders))
    total_bytes = 0
    for idx, folder in enumerate(legacy_folders, 1):
        size = get_dir_size_bytes(folder)
        total_bytes += size
        size_mb = round(size / (1024 * 1024), 2)
        logger.info("  [%d] %s (Size: %.2f MB, Path: %s)", idx, folder.name, size_mb, folder)

    total_mb = round(total_bytes / (1024 * 1024), 2)
    logger.info("Total size of legacy folders: %.2f MB", total_mb)

    if dry_run or not confirm:
        logger.info("DRY-RUN MODE ACTIVE: No files were moved.")
        logger.info("To execute safety move to trash folder '%s', run:", target_trash_dir)
        logger.info("  python -m backend.tools.cleanup_legacy --confirm")
        return

    # Execute move to trash
    ts = int(time.time())
    backup_session_dir = target_trash_dir / f"backup_{ts}"
    backup_session_dir.mkdir(parents=True, exist_ok=True)

    moved_count = 0
    for folder in legacy_folders:
        m_id = folder.name
        dest = backup_session_dir / f"{folder.parent.name}_{m_id}"
        try:
            shutil.move(str(folder), str(dest))
            moved_count += 1
            logger.info("Moved '%s' -> '%s'", folder, dest)
        except Exception as exc:
            logger.error("Failed moving '%s': %s", folder, exc)

    logger.info("Cleanup complete: moved %d folder(s) to trash backup '%s'. Zero items deleted permanently.", moved_count, backup_session_dir)


def main():
    parser = argparse.ArgumentParser(
        description="AeroMesh CLI: Inspect and safely archive legacy non-UUID mission records to a trash backup directory."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Inspect legacy folders without modifying disk (default behavior).",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Confirm execution of moving legacy folders to trash/backup folder.",
    )
    parser.add_argument(
        "--trash-dir",
        type=Path,
        default=TRASH_DIR,
        help="Custom directory path for trash/backup storage.",
    )

    args = parser.parse_args()

    # If --confirm is explicitly passed, disable dry_run
    if args.confirm:
        dry_run = False
    else:
        dry_run = True

    run_cleanup(dry_run=dry_run, confirm=args.confirm, target_trash_dir=args.trash_dir)


if __name__ == "__main__":
    main()
