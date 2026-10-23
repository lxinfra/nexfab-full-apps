"""File storage behind a small interface: a local folder, or a Supabase Storage bucket.

Keys are POSIX-style relative paths such as ``{templateId}/images/p1_0.png``.
Everything else in the app talks to ``Storage`` only.
"""
from __future__ import annotations

import logging
import mimetypes
import os
import shutil
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from pathlib import Path, PurePosixPath
from typing import BinaryIO, Protocol
from urllib.parse import quote

import httpx

from .config import settings

log = logging.getLogger(__name__)


class StorageError(RuntimeError):
    """The storage service refused or failed a request."""


class Storage(Protocol):
    def write(self, key: str, data: bytes) -> None: ...
    def open_write(self, key: str) -> BinaryIO: ...
    def read(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...
    def delete_prefix(self, prefix: str) -> None: ...
    def copy_prefix(self, src: str, dst: str) -> None: ...
    def copy(self, src: str, dst: str) -> None: ...
    def url(self, key: str) -> str: ...
    def key_from_url(self, url: str) -> str | None: ...
    def local_path(self, key: str) -> Path: ...
    def flush(self) -> None: ...


class LocalStorage:
    def __init__(self, root: Path, url_prefix: str = "/storage") -> None:
        self.root = Path(root).resolve()
        self.url_prefix = url_prefix.rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)

    def _resolve(self, key: str) -> Path:
        parts = PurePosixPath(key.replace("\\", "/")).parts
        if not parts or any(p in ("..", "/", "") or ":" in p for p in parts):
            raise ValueError(f"invalid storage key: {key!r}")
        return self.root.joinpath(*parts)

    def write(self, key: str, data: bytes) -> None:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def open_write(self, key: str) -> BinaryIO:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        return path.open("wb")

    def read(self, key: str) -> bytes:
        return self._resolve(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._resolve(key).is_file()

    def delete(self, key: str) -> None:
        self._resolve(key).unlink(missing_ok=True)

    def delete_prefix(self, prefix: str) -> None:
        shutil.rmtree(self._resolve(prefix), ignore_errors=True)

    def copy_prefix(self, src: str, dst: str) -> None:
        source = self._resolve(src)
        if source.is_dir():
            shutil.copytree(source, self._resolve(dst), dirs_exist_ok=True)

    def copy(self, src: str, dst: str) -> None:
        target = self._resolve(dst)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self._resolve(src), target)

    def url(self, key: str) -> str:
        return f"{self.url_prefix}/{key}"

    def key_from_url(self, url: str) -> str | None:
        """Map a URL produced by ``url()`` back to its key (None for foreign URLs)."""
        path = url.split("?", 1)[0]
        marker = self.url_prefix + "/"
        idx = path.find(marker)
        return path[idx + len(marker):] if idx >= 0 else None

    def local_path(self, key: str) -> Path:
        return self._resolve(key)

    def flush(self) -> None:
        """Nothing is written behind the caller's back."""


class _UploadOnClose:
    """A file being written into the cache; it is sent to the bucket when closed."""

    def __init__(self, storage: "SupabaseStorage", key: str, path: Path) -> None:
        self._storage, self._key, self._path = storage, key, path
        self._file = path.open("wb")

    def write(self, data: bytes) -> int:
        return self._file.write(data)

    def close(self) -> None:
        if not self._file.closed:
            self._file.close()
            self._storage._submit(self._key, self._path)

    def __enter__(self) -> "_UploadOnClose":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


class SupabaseStorage(LocalStorage):
    """Files in a private Supabase Storage bucket, with a local cache in front.

    The bucket is the source of truth. Every file read or written is also kept
    in ``cache_dir`` so PyMuPDF and the export can open it as a normal file and
    repeated reads cost nothing; the cache can be deleted at any time. Uploads
    run on a few background threads (an extraction writes many small files):
    ``flush()`` waits for them and reports the first failure.

    URLs stay ``/storage/{key}``: the browser gets files through this backend,
    so the service key never leaves the server and the bucket can stay private.
    """

    def __init__(self, base_url: str, service_key: str, bucket: str, cache_dir: Path,
                 url_prefix: str = "/storage", client: httpx.Client | None = None) -> None:
        super().__init__(cache_dir, url_prefix)
        self.bucket = bucket
        self._api = base_url.rstrip("/") + "/storage/v1"
        self._client = client or httpx.Client(
            headers={"Authorization": f"Bearer {service_key}", "apikey": service_key},
            timeout=httpx.Timeout(120, connect=20), limits=httpx.Limits(max_connections=16),
        )
        self._pool = ThreadPoolExecutor(max_workers=6, thread_name_prefix="storage")
        self._pending: list[Future] = []
        self._lock = threading.Lock()
        self._bucket_ready = False

    # ------------------------------------------------------------- requests
    def _request(self, method: str, path: str, *, ok: tuple[int, ...] = (), **kwargs) -> httpx.Response:
        last: Exception | None = None
        for attempt in range(3):
            try:
                response = self._client.request(method, self._api + path, **kwargs)
            except httpx.HTTPError as exc:      # connection trouble: worth another go
                last = exc
            else:
                if response.status_code < 300 or response.status_code in ok:
                    return response
                if response.status_code < 500 and response.status_code != 429:
                    raise StorageError(f"Supabase Storage {method} {path}: {response.status_code} {response.text[:200]}")
                last = StorageError(f"Supabase Storage {method} {path}: {response.status_code} {response.text[:200]}")
            time.sleep(0.5 * (attempt + 1))
        raise StorageError(f"Supabase Storage is not reachable: {last}")

    def _object(self, key: str) -> str:
        return f"/object/{self.bucket}/{quote(key)}"

    def ensure_bucket(self) -> None:
        """Create the (private) bucket the first time it is needed."""
        if self._bucket_ready:
            return
        if self._request("GET", f"/bucket/{self.bucket}", ok=(400, 404)).status_code != 200:
            created = self._request("POST", "/bucket", ok=(400, 409),
                                    json={"id": self.bucket, "name": self.bucket, "public": False})
            if created.status_code >= 300 and "exist" not in created.text.lower():
                raise StorageError(f"Could not create the bucket {self.bucket!r}: {created.text[:200]}")
        self._bucket_ready = True

    def _upload(self, key: str, source: Path | bytes) -> None:
        self.ensure_bucket()
        data = source if isinstance(source, bytes) else source.read_bytes()
        content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
        self._request("POST", self._object(key), content=data,
                      headers={"Content-Type": content_type, "x-upsert": "true"})

    def _submit(self, key: str, source: Path | bytes) -> None:
        future = self._pool.submit(self._upload, key, source)
        with self._lock:
            self._pending.append(future)

    def _download(self, key: str) -> bool:
        """Fetch a file into the cache. False when the bucket does not have it."""
        self.ensure_bucket()
        response = self._request("GET", self._object(key), ok=(400, 404))
        if response.status_code != 200:
            return False
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_name(f"{path.name}.{threading.get_ident()}.part")
        partial.write_bytes(response.content)
        os.replace(partial, path)       # never leave a half-written file where a reader may look
        return True

    def _list(self, prefix: str) -> list[str]:
        """Every key under a folder, however deep."""
        self.ensure_bucket()
        keys: list[str] = []
        folders = [prefix.strip("/")]
        while folders:
            folder = folders.pop()
            offset = 0
            while True:
                page = self._request("POST", f"/object/list/{self.bucket}", json={
                    "prefix": folder, "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"},
                }).json()
                for item in page:
                    path = f"{folder}/{item['name']}"
                    (folders if item.get("id") is None else keys).append(path)
                if len(page) < 1000:
                    break
                offset += len(page)
        return keys

    # -------------------------------------------------------------- storage
    def flush(self) -> None:
        with self._lock:
            pending, self._pending = self._pending, []
        errors = [future.exception() for future in pending]
        failed = [error for error in errors if error is not None]
        if failed:
            raise StorageError(f"{len(failed)} file(s) could not be saved to Supabase Storage: {failed[0]}")

    def write(self, key: str, data: bytes) -> None:
        super().write(key, data)
        self._submit(key, self._resolve(key))     # sent from the cached copy: nothing extra is held in memory

    def open_write(self, key: str) -> BinaryIO:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        return _UploadOnClose(self, key, path)  # type: ignore[return-value]

    def exists(self, key: str) -> bool:
        return super().exists(key) or self._download(key)

    def read(self, key: str) -> bytes:
        if not self.exists(key):
            raise FileNotFoundError(key)
        return super().read(key)

    def local_path(self, key: str) -> Path:
        self.exists(key)
        return self._resolve(key)

    def _settle(self) -> None:
        """Let uploads in flight finish, so a delete or copy sees every file."""
        try:
            self.flush()
        except StorageError as exc:
            log.warning("%s", exc)

    def delete(self, key: str) -> None:
        self._settle()
        self._request("DELETE", f"/object/{self.bucket}", json={"prefixes": [key]}, ok=(400, 404))
        super().delete(key)

    def delete_prefix(self, prefix: str) -> None:
        self._settle()
        keys = self._list(prefix)
        for start in range(0, len(keys), 100):
            self._request("DELETE", f"/object/{self.bucket}", json={"prefixes": keys[start:start + 100]})
        super().delete_prefix(prefix)

    def copy(self, src: str, dst: str) -> None:
        self._settle()
        self._request("POST", "/object/copy", json={"bucketId": self.bucket, "sourceKey": src, "destinationKey": dst})
        if super().exists(src):
            super().copy(src, dst)

    def copy_prefix(self, src: str, dst: str) -> None:
        self._settle()
        src, dst = src.strip("/"), dst.strip("/")

        def copy(key: str) -> None:
            self._request("POST", "/object/copy", json={
                "bucketId": self.bucket, "sourceKey": key, "destinationKey": dst + key[len(src):],
            })

        list(self._pool.map(copy, self._list(src)))     # copied inside the bucket: nothing is downloaded
        super().copy_prefix(src, dst)


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        if settings.supabase_url and settings.supabase_key:
            _storage = SupabaseStorage(settings.supabase_url, settings.supabase_key, settings.supabase_bucket,
                                       settings.cache_dir, settings.storage_url)
        else:
            _storage = LocalStorage(settings.storage_dir, settings.storage_url)
    return _storage
