from __future__ import annotations

import hashlib
import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Iterator, Optional
from urllib.parse import quote


@dataclass(frozen=True)
class StorageMetadata:
    key: str
    filename: str
    content_type: str
    size: int
    checksum: str


class ObjectStorage:
    def upload(
        self,
        key: str,
        data: BinaryIO,
        filename: str,
        content_type: Optional[str] = None,
    ) -> StorageMetadata:
        raise NotImplementedError

    def download(self, key: str) -> bytes:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError

    def get_size(self, key: str) -> int:
        raise NotImplementedError

    def get_content_type(self, key: str) -> str:
        raise NotImplementedError

    def get_stream(
        self, key: str, start: int = 0, length: Optional[int] = None, chunk_size: int = 64 * 1024
    ) -> Iterator[bytes]:
        raise NotImplementedError

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        raise NotImplementedError


class LocalObjectStorage(ObjectStorage):
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        normalized_str = str(key).replace("\\", "/")
        if (
            normalized_str.startswith("/")
            or "/../" in f"/{normalized_str}/"
            or normalized_str.startswith("../")
            or normalized_str == ".."
        ):
            raise ValueError("Storage key must be a relative path without traversal")
        relative = Path(normalized_str)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Storage key must be a relative path")
        target = (self.root / relative).resolve()
        if self.root != target and self.root not in target.parents:
            raise ValueError("Storage key escapes storage root")
        return target

    def upload(
        self,
        key: str,
        data: BinaryIO,
        filename: str,
        content_type: Optional[str] = None,
    ) -> StorageMetadata:
        target = self._path(key)
        target.parent.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256()
        size = 0
        with target.open("wb") as output:
            while chunk := data.read(1024 * 1024):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        guessed_type = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return StorageMetadata(key, filename, guessed_type, size, digest.hexdigest())

    def download(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def exists(self, key: str) -> bool:
        try:
            return self._path(key).is_file()
        except Exception:
            return False

    def get_size(self, key: str) -> int:
        return self._path(key).stat().st_size

    def get_content_type(self, key: str) -> str:
        guessed = mimetypes.guess_type(key)[0]
        return guessed or "application/octet-stream"

    def get_stream(
        self, key: str, start: int = 0, length: Optional[int] = None, chunk_size: int = 64 * 1024
    ) -> Iterator[bytes]:
        target = self._path(key)
        file_size = target.stat().st_size
        if start < 0 or start > file_size:
            start = 0
        bytes_to_read = file_size - start if length is None else min(length, file_size - start)
        bytes_remaining = max(0, bytes_to_read)

        with target.open("rb") as f:
            if start > 0:
                f.seek(start)
            while bytes_remaining > 0:
                current_chunk = min(chunk_size, bytes_remaining)
                data = f.read(current_chunk)
                if not data:
                    break
                bytes_remaining -= len(data)
                yield data

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        api_prefix = os.getenv("API_PREFIX", "/api/v1").rstrip("/")
        return f"{api_prefix}/storage/{quote(key, safe='/')}"


class S3ObjectStorage(ObjectStorage):
    """
    S3-compatible object storage provider.
    Works with Cloudflare R2, AWS S3, MinIO, Google Cloud Storage, and Wasabi.
    """

    def __init__(
        self,
        endpoint_url: Optional[str],
        bucket: str,
        region: Optional[str] = None,
        access_key: Optional[str] = None,
        secret_key: Optional[str] = None,
    ):
        import boto3
        from botocore.config import Config

        self.bucket = bucket
        cfg = Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
        )
        kwargs = {
            "config": cfg,
            "region_name": region or "auto",
        }
        if endpoint_url:
            kwargs["endpoint_url"] = endpoint_url
        if access_key and secret_key:
            kwargs["aws_access_key_id"] = access_key
            kwargs["aws_secret_access_key"] = secret_key

        self.client = boto3.client("s3", **kwargs)

    def upload(
        self,
        key: str,
        data: BinaryIO,
        filename: str,
        content_type: Optional[str] = None,
    ) -> StorageMetadata:
        digest = hashlib.sha256()
        body = data.read()
        digest.update(body)
        c_type = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType=c_type,
        )
        return StorageMetadata(key, filename, c_type, len(body), digest.hexdigest())

    def download(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False

    def get_size(self, key: str) -> int:
        resp = self.client.head_object(Bucket=self.bucket, Key=key)
        return int(resp.get("ContentLength", 0))

    def get_content_type(self, key: str) -> str:
        resp = self.client.head_object(Bucket=self.bucket, Key=key)
        return str(resp.get("ContentType", "application/octet-stream"))

    def get_stream(
        self, key: str, start: int = 0, length: Optional[int] = None, chunk_size: int = 64 * 1024
    ) -> Iterator[bytes]:
        params = {"Bucket": self.bucket, "Key": key}
        if length is not None:
            end = start + length - 1
            params["Range"] = f"bytes={start}-{end}"
        elif start > 0:
            params["Range"] = f"bytes={start}-"

        resp = self.client.get_object(**params)
        body = resp["Body"]
        while chunk := body.read(chunk_size):
            yield chunk

    def signed_url(self, key: str, expires_in: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=expires_in,
        )


def get_storage(root: Optional[Path] = None) -> ObjectStorage:
    """
    Factory to resolve ObjectStorage based on environment settings.
    Selects S3-compatible (AWS / Cloudflare R2 / MinIO) or Local Disk.
    """
    storage_type = os.getenv("STORAGE_BACKEND", "").lower().strip()
    bucket = os.getenv("S3_BUCKET", "").strip()

    if storage_type == "s3" or bucket:
        endpoint_url = os.getenv("S3_ENDPOINT_URL", "").strip() or None
        region = os.getenv("S3_REGION", "us-east-1").strip()
        access_key = os.getenv("AWS_ACCESS_KEY_ID", "").strip() or None
        secret_key = os.getenv("AWS_SECRET_ACCESS_KEY", "").strip() or None
        return S3ObjectStorage(
            endpoint_url=endpoint_url,
            bucket=bucket,
            region=region,
            access_key=access_key,
            secret_key=secret_key,
        )

    configured_root = os.getenv("OBJECT_STORAGE_ROOT", "").strip()
    if configured_root:
        base_dir = Path(configured_root).resolve()
    elif root is not None:
        base_dir = root.resolve()
    else:
        base_dir = (Path(__file__).resolve().parent.parent / "data" / "objects").resolve()

    return LocalObjectStorage(base_dir)


def mission_object_key(mission_id: str, filename: str) -> str:
    safe_name = Path(filename).name
    return f"missions/{mission_id}/original/{safe_name}"
