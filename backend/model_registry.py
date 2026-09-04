from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ModelRecord:
    name: str
    version: str
    path: str
    model_type: str
    class_mapping: dict[str, str]
    checksum: str | None
    available: bool
    registered_at: str


class ModelUnavailableError(RuntimeError):
    code = "MODEL_NOT_FOUND"


def _checksum(path: Path) -> str | None:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ModelRegistry:
    def __init__(self, model_path: str | Path | None = None):
        configured = str(model_path or os.getenv("YOLO_MODEL_PATH", "")).strip()
        self.model_path = Path(configured) if configured else Path(__file__).resolve().parent / "models" / "aeromesh_yolo.pt"

    def inspect(self) -> ModelRecord:
        path = self.model_path.resolve()
        return ModelRecord(
            name=path.stem,
            version=os.getenv("YOLO_MODEL_VERSION", "unversioned"),
            path=str(path),
            model_type="ultralytics_yolo",
            class_mapping={},
            checksum=_checksum(path),
            available=path.is_file(),
            registered_at=datetime.now(timezone.utc).isoformat(),
        )

    def require_available(self) -> ModelRecord:
        record = self.inspect()
        if not record.available:
            raise ModelUnavailableError(f"YOLO model not found at {record.path}. Set YOLO_MODEL_PATH to an authorized local model file.")
        return record

    def metadata(self) -> dict[str, Any]:
        return asdict(self.inspect())
