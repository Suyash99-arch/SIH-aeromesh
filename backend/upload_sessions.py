from __future__ import annotations

import os
import re
import shutil
import threading
import time
from pathlib import Path
from typing import BinaryIO

CHUNK_SIZE_BYTES = 2 * 1024 * 1024
UPLOAD_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
_upload_locks: dict[str, threading.Lock] = {}
_upload_locks_guard = threading.Lock()


def upload_directory(data_dir: Path, mission_id: str, upload_id: str) -> Path:
    if not UPLOAD_ID_PATTERN.fullmatch(upload_id):
        raise ValueError("Invalid upload ID")
    if not mission_id or Path(mission_id).name != mission_id or mission_id in {".", ".."}:
        raise ValueError("Invalid mission ID")
    return data_dir / "staging" / mission_id / upload_id


def upload_lock(key: str) -> threading.Lock:
    with _upload_locks_guard:
        return _upload_locks.setdefault(key, threading.Lock())


def prune_stale_uploads(data_dir: Path, max_age_seconds: int = 3600) -> int:
    staging_dir = data_dir / "staging"
    if not staging_dir.is_dir():
        return 0
    cutoff = time.time() - max_age_seconds
    deleted = 0
    for mission_dir in staging_dir.iterdir():
        if not mission_dir.is_dir():
            continue
        for upload_dir in mission_dir.iterdir():
            try:
                if upload_dir.is_dir() and upload_dir.stat().st_mtime < cutoff:
                    shutil.rmtree(upload_dir)
                    deleted += 1
            except FileNotFoundError:
                continue
        try:
            mission_dir.rmdir()
        except OSError:
            pass
    return deleted


def received_chunk_indexes(session_dir: Path, total_chunks: int) -> list[int]:
    return sorted(
        int(path.stem)
        for path in session_dir.glob("*.chunk")
        if path.stem.isdigit() and 0 <= int(path.stem) < total_chunks
    )


def write_chunk(
    stream: BinaryIO,
    target: Path,
    max_chunk_bytes: int,
) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".tmp")
    written = 0
    try:
        with temporary.open("wb") as output:
            while block := stream.read(1024 * 1024):
                written += len(block)
                if written > max_chunk_bytes:
                    raise ValueError("Chunk exceeds the 2 MB chunk limit")
                output.write(block)
        if written == 0:
            raise ValueError("Uploaded chunk is empty")
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    return written


def assemble_chunks(session_dir: Path, total_chunks: int, output_path: Path) -> int:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = output_path.with_suffix(output_path.suffix + ".assembling")
    size = 0
    try:
        with temporary.open("wb") as destination:
            for index in range(total_chunks):
                chunk_path = session_dir / f"{index}.chunk"
                if not chunk_path.is_file():
                    raise FileNotFoundError(f"Upload is missing chunk {index}")
                with chunk_path.open("rb") as source:
                    while block := source.read(1024 * 1024):
                        destination.write(block)
                        size += len(block)
        os.replace(temporary, output_path)
    finally:
        temporary.unlink(missing_ok=True)
    return size
