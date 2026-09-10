from __future__ import annotations

import hashlib
import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote


@dataclass(frozen=True)
class StorageMetadata:
    key: str
    filename: str
    content_type: str
    size: int
    checksum: str


class ObjectStorage:
    def upload(self, key: str, data: BinaryIO, filename: str, content_type: str | None = None) -> StorageMetadata:
        raise NotImplementedError

    def download(self, key: str) -> bytes:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError

    def signed_url(self, key: str, expires_in: int = 3600) -> str | None:
        raise NotImplementedError


class LocalObjectStorage(ObjectStorage):
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        normalized_str = str(key).replace("\\", "/")
        if normalized_str.startswith("/") or "/../" in f"/{normalized_str}/" or normalized_str.startswith("../") or normalized_str == "..":
            raise ValueError("Storage key must be a relative path without traversal")
        relative = Path(normalized_str)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Storage key must be a relative path")
        target = (self.root / relative).resolve()
        if self.root != target and self.root not in target.parents:
            raise ValueError("Storage key escapes storage root")
        return target

    def upload(self, key, data, filename, content_type=None):
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        with target.open("wb") as output:
            while chunk := data.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        return StorageMetadata(key, filename, content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream", size, digest.hexdigest())

    def download(self, key):
        return self._path(key).read_bytes()

    def delete(self, key):
        self._path(key).unlink(missing_ok=True)

    def exists(self, key):
        return self._path(key).is_file()

    def signed_url(self, key, expires_in=3600):
        return f"/api/storage/{quote(key, safe='/')}"


class S3ObjectStorage(ObjectStorage):
    def __init__(self, endpoint_url: str | None, bucket: str, region: str | None = None):
        import boto3

        self.bucket = bucket
        self.client = boto3.client("s3", endpoint_url=endpoint_url or None, region_name=region or None)

    def upload(self, key, data, filename, content_type=None):
        digest = hashlib.sha256()
        body = data.read()
        digest.update(body)
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType=content_type or "application/octet-stream")
        return StorageMetadata(key, filename, content_type or "application/octet-stream", len(body), digest.hexdigest())

    def download(self, key):
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key):
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key):
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def signed_url(self, key, expires_in=3600):
        return self.client.generate_presigned_url("get_object", Params={"Bucket": self.bucket, "Key": key}, ExpiresIn=expires_in)


def get_storage(root: Path) -> ObjectStorage:
    bucket = os.getenv("S3_BUCKET", "").strip()
    if bucket:
        return S3ObjectStorage(os.getenv("S3_ENDPOINT_URL"), bucket, os.getenv("S3_REGION", "us-east-1"))
    configured_root = os.getenv("OBJECT_STORAGE_ROOT", "").strip()
    return LocalObjectStorage(Path(configured_root) if configured_root else root)


def mission_object_key(mission_id: str, filename: str) -> str:
    safe_name = Path(filename).name
    return f"missions/{mission_id}/original/{safe_name}"
