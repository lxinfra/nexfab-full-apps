"""Supabase Storage client, against an in-memory stand-in for the Storage API (no network)."""
from __future__ import annotations

import json
import shutil

import httpx
import pytest

from app.config import Settings
from app.storage import StorageError, SupabaseStorage

from .conftest import upload

BUCKET = "templates"


class FakeSupabase:
    """Just enough of /storage/v1 to behave like a bucket."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.buckets: dict[str, dict] = {}
        self.requests: list[str] = []
        self.fail_uploads = 0     # answer this many uploads with a 500
        self.reject_uploads = False

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer service-key"
        path = request.url.path.removeprefix("/storage/v1")
        self.requests.append(f"{request.method} {path}")
        if path == f"/bucket/{BUCKET}":
            return httpx.Response(200 if BUCKET in self.buckets else 404, json=self.buckets.get(BUCKET, {}))
        if path == "/bucket":
            self.buckets[BUCKET] = json.loads(request.content)
            return httpx.Response(200, json={"name": BUCKET})
        if path == f"/object/list/{BUCKET}":
            prefix = json.loads(request.content)["prefix"] + "/"
            names: dict[str, str | None] = {}
            for key in sorted(self.objects):
                if key.startswith(prefix):
                    head, _, tail = key[len(prefix):].partition("/")
                    names[head] = None if tail else "object-id"     # folders have no id
            return httpx.Response(200, json=[{"name": name, "id": ident} for name, ident in names.items()])
        if path == "/object/copy":
            body = json.loads(request.content)
            self.objects[body["destinationKey"]] = self.objects[body["sourceKey"]]
            return httpx.Response(200, json={})
        if path == f"/object/{BUCKET}" and request.method == "DELETE":
            for key in json.loads(request.content)["prefixes"]:
                self.objects.pop(key, None)
            return httpx.Response(200, json=[])
        key = path.removeprefix(f"/object/{BUCKET}/")
        if request.method == "POST":
            if self.reject_uploads:
                return httpx.Response(413, json={"message": "The object exceeded the maximum allowed size"})
            if self.fail_uploads:
                self.fail_uploads -= 1
                return httpx.Response(500, text="try later")
            assert request.headers["x-upsert"] == "true"
            self.objects[key] = request.content
            return httpx.Response(200, json={"Key": key})
        if key in self.objects:
            return httpx.Response(200, content=self.objects[key])
        return httpx.Response(400, json={"statusCode": "404", "error": "not_found"})


@pytest.fixture()
def fake() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture()
def storage(fake, tmp_path, monkeypatch) -> SupabaseStorage:
    monkeypatch.setattr("app.storage.time.sleep", lambda _seconds: None)
    client = httpx.Client(transport=httpx.MockTransport(fake), headers={"Authorization": "Bearer service-key"})
    return SupabaseStorage("https://project.supabase.co", "service-key", BUCKET, tmp_path / "cache", client=client)


def test_bucket_is_created_private_once(storage, fake):
    storage.write("t1/a.png", b"a")
    storage.write("t1/b.png", b"b")
    storage.flush()
    assert fake.buckets[BUCKET]["public"] is False
    assert fake.requests.count("POST /bucket") == 1


def test_written_files_reach_the_bucket(storage, fake):
    storage.write("t1/images/p1.png", b"image")
    with storage.open_write("t1/source.pdf") as out:
        out.write(b"%PDF-")
        out.write(b"1.7")
    storage.flush()
    assert fake.objects == {"t1/images/p1.png": b"image", "t1/source.pdf": b"%PDF-1.7"}
    assert storage.url("t1/source.pdf") == "/storage/t1/source.pdf"
    assert storage.key_from_url("http://api/storage/t1/source.pdf?v=1") == "t1/source.pdf"


def test_reads_come_from_the_bucket_once_then_from_the_cache(storage, fake):
    fake.objects["t1/fonts/f.ttf"] = b"font"
    assert storage.exists("t1/fonts/f.ttf")
    assert storage.read("t1/fonts/f.ttf") == b"font"
    assert storage.local_path("t1/fonts/f.ttf").read_bytes() == b"font"
    assert fake.requests.count("GET /object/templates/t1/fonts/f.ttf") == 1


def test_a_cleared_cache_is_refilled(storage, fake):
    storage.write("t1/a.png", b"a")
    storage.flush()
    shutil.rmtree(storage.root / "t1")
    assert storage.read("t1/a.png") == b"a"


def test_missing_files(storage):
    assert not storage.exists("t1/nope.png")
    with pytest.raises(FileNotFoundError):
        storage.read("t1/nope.png")
    with pytest.raises(ValueError):
        storage.exists("../secret")


def test_delete_prefix_removes_nested_files_only_for_that_template(storage, fake):
    for key in ("t1/source.pdf", "t1/images/a.png", "t1/images/deep/b.png", "t10/source.pdf"):
        storage.write(key, b"x")
    storage.delete_prefix("t1")     # also waits for the uploads still in flight
    assert set(fake.objects) == {"t10/source.pdf"}
    assert not (storage.root / "t1").exists() and (storage.root / "t10" / "source.pdf").is_file()


def test_copy_prefix_copies_inside_the_bucket(storage, fake):
    storage.write("t1/source.pdf", b"pdf")
    storage.write("t1/images/a.png", b"a")
    storage.copy_prefix("t1", "t2")
    assert fake.objects["t2/source.pdf"] == b"pdf" and fake.objects["t2/images/a.png"] == b"a"
    downloads = [r for r in fake.requests if r.startswith("GET /object/")]
    assert downloads == []
    assert storage.read("t2/images/a.png") == b"a"


def test_a_failed_upload_is_retried(storage, fake):
    fake.fail_uploads = 2
    storage.write("t1/a.png", b"a")
    storage.flush()
    assert fake.objects["t1/a.png"] == b"a"


def test_flush_reports_files_that_could_not_be_saved(storage, fake):
    fake.reject_uploads = True
    storage.write("t1/a.png", b"a")
    with pytest.raises(StorageError, match="could not be saved"):
        storage.flush()
    storage.flush()     # reported once


def test_settings_for_a_hosted_setup(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://postgres.ref:pass%40word@aws-0-eu.pooler.supabase.com:5432/postgres")
    monkeypatch.setenv("CORS_ORIGINS", "http://localhost:3000, https://my-site.netlify.app/, https://*.example.com")
    settings = Settings()
    assert settings.database_url.startswith("postgresql+psycopg://postgres.ref:pass%40word@")
    assert settings.cors_origins == ["http://localhost:3000", "https://my-site.netlify.app"]
    import re
    assert re.fullmatch(settings.cors_origin_regex, "https://app.example.com")
    assert not re.fullmatch(settings.cors_origin_regex, "https://app.example.com.evil.net")
    assert not re.fullmatch(settings.cors_origin_regex, "https://evil.net/x.example.com")


def test_stored_files_are_served_through_the_api(client, samples):
    template = upload(client, samples / "invoice.pdf").json()["template"]
    try:
        preview = client.get(template["pages"][0]["preview"])
        assert preview.status_code == 200 and preview.content[:4] == b"\x89PNG"
        assert preview.headers["content-type"] == "image/png"
        assert client.get(template["sourceFile"]).content[:5] == b"%PDF-"
        assert client.get(f"/storage/{template['id']}/missing.png").status_code == 404
        assert client.get("/storage/..%2F..%2Fbackend%2F.env").status_code == 404
        assert client.get("/api/health").json() == {"status": "ok", "database": "sqlite", "storage": "local", "signIn": False, "shared": False}
    finally:
        client.delete(f"/api/templates/{template['id']}")
