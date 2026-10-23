"""Sign-in and per-account access, against an in-memory stand-in for Supabase Auth (no network)."""
from __future__ import annotations

import json
import uuid

import httpx
import pytest

from app.auth import FILE_TOKEN_WINDOW, SupabaseAuth
from app.config import settings
from app.export import Exporter
from app.storage import get_storage

from .conftest import upload

OWNER = ("owner@example.com", "correct horse")
GUEST = ("guest@example.com", "battery staple")


class FakeSupabaseAuth:
    """Just enough of /auth/v1 to sign people up and in."""

    def __init__(self) -> None:
        self.users: dict[str, dict] = {}        # email -> {id, email, password}
        self.tokens: dict[str, str] = {}        # access token -> email
        self.refresh: dict[str, str] = {}       # refresh token -> email
        self.calls: list[str] = []

    def _session(self, email: str) -> httpx.Response:
        access, refresh = f"at-{uuid.uuid4().hex}", f"rt-{uuid.uuid4().hex}"
        self.tokens[access], self.refresh[refresh] = email, email
        user = self.users[email]
        return httpx.Response(200, json={"access_token": access, "refresh_token": refresh, "expires_in": 3600,
                                         "user": {"id": user["id"], "email": email}})

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/auth/v1")
        self.calls.append(f"{request.method} {path}")
        assert request.headers["apikey"] == "service-key"
        body = json.loads(request.content) if request.content else {}
        bearer = request.headers.get("authorization", "").removeprefix("Bearer ")
        if path == "/admin/users":
            assert bearer == "service-key"
            if request.method == "GET":
                return httpx.Response(200, json={"users": [{"id": u["id"]} for u in self.users.values()][:int(request.url.params["per_page"])]})
            if body["email"] in self.users:
                return httpx.Response(422, json={"error_code": "email_exists", "msg": "A user with this email address has already been registered"})
            assert body["email_confirm"] is True
            self.users[body["email"]] = {"id": str(uuid.uuid4()), "email": body["email"], "password": body["password"]}
            return httpx.Response(200, json={"id": self.users[body["email"]]["id"], "email": body["email"]})
        if path == "/token" and request.url.params["grant_type"] == "password":
            user = self.users.get(body["email"])
            if not user or user["password"] != body["password"]:
                return httpx.Response(400, json={"error_code": "invalid_credentials", "msg": "Invalid login credentials"})
            return self._session(body["email"])
        if path == "/token":
            email = self.refresh.pop(body["refresh_token"], None)
            return self._session(email) if email else httpx.Response(400, json={"error_code": "refresh_token_not_found"})
        if path == "/user":
            email = self.tokens.get(bearer)
            return httpx.Response(200, json=self.users[email]) if email else httpx.Response(403, json={"error_code": "bad_jwt"})
        if path == "/logout":
            self.tokens.pop(bearer, None)
            return httpx.Response(204)
        raise AssertionError(f"unexpected request {request.method} {path}")


@pytest.fixture()
def supabase(monkeypatch) -> FakeSupabaseAuth:
    """Turn sign-in on for the app, backed by the fake."""
    fake = FakeSupabaseAuth()
    client = httpx.Client(transport=httpx.MockTransport(fake))
    monkeypatch.setattr("app.auth._auth", SupabaseAuth("https://project.supabase.co", "service-key", client=client))
    monkeypatch.setattr(settings, "signup", "first")
    monkeypatch.setattr("app.main._owners", {})
    return fake


def bearer(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['accessToken']}"}


def sign_up(client, who=OWNER) -> dict:
    res = client.post("/api/auth/signup", json={"email": who[0], "password": who[1]})
    assert res.status_code == 200, res.text
    return res.json()


def upload_as(client, session, path):
    with path.open("rb") as fh:
        res = client.post("/api/upload", files={"file": (path.name, fh, "application/pdf")}, headers=bearer(session))
    assert res.status_code == 200, res.text
    return res.json()["template"]


@pytest.fixture()
def cleanup(client):
    """Delete the templates a test made, whatever sign-in state it leaves behind."""
    made: list[str] = []
    yield made
    from app.db import SessionLocal, Template
    with SessionLocal() as db:
        for template_id in made:
            row = db.get(Template, template_id)
            if row is not None:
                db.delete(row)
        db.commit()
    for template_id in made:
        get_storage().delete_prefix(template_id)


def test_without_supabase_there_is_no_sign_in(client):
    assert client.get("/api/auth/status").json() == {"required": False, "signup": False, "first": False, "shared": False}
    assert client.get("/api/templates").status_code == 200
    assert client.get("/api/auth/me").json() == {"user": None}
    assert client.post("/api/auth/login", json={"email": "a@b.c", "password": "x"}).status_code == 404


def test_everything_needs_a_session(client, supabase):
    for method, path in [
        ("get", "/api/templates"), ("get", "/api/templates/abc"), ("put", "/api/templates/abc"),
        ("delete", "/api/templates/abc"), ("post", "/api/templates/abc/duplicate"), ("post", "/api/export/abc"),
        ("get", "/api/auth/me"), ("get", "/storage/abc/source.pdf"),
    ]:
        res = getattr(client, method)(path, **({"json": {}} if method == "put" else {}))
        assert res.status_code == 401, f"{method} {path} -> {res.status_code}"
        assert res.json()["error"]["code"] == "unauthorized"
    files = {"file": ("a.pdf", b"%PDF-1.4", "application/pdf")}
    assert client.post("/api/upload", files=files).status_code == 401
    assert client.post("/api/spreadsheets/parse", files={"file": ("a.csv", b"a,b", "text/csv")}).status_code == 401
    assert client.get("/api/templates", headers={"Authorization": "Bearer made-up"}).status_code == 401
    assert client.get("/api/health").status_code == 200       # the host's health check stays open
    assert client.get("/api/health").json()["signIn"] is True


def test_the_first_account_is_the_owner_and_gets_the_existing_templates(client, supabase, samples, cleanup):
    # made before there was any sign-in
    monkey_auth = __import__("app.auth", fromlist=["_auth"])
    provider, monkey_auth._auth = monkey_auth._auth, None
    old = upload(client, samples / "invoice.pdf").json()["template"]
    cleanup.append(old["id"])
    monkey_auth._auth = provider

    assert client.get("/api/auth/status").json() == {"required": True, "signup": True, "first": True, "shared": False}
    owner = sign_up(client)
    assert owner["user"]["email"] == OWNER[0] and owner["expiresAt"] > 0
    # (other tests may have left templates behind: those were unowned too)
    assert old["id"] in [t["id"] for t in client.get("/api/templates", headers=bearer(owner)).json()]
    assert client.get("/api/auth/me", headers=bearer(owner)).json()["user"]["email"] == OWNER[0]

    # after that the door is closed
    assert client.get("/api/auth/status").json() == {"required": True, "signup": False, "first": False, "shared": False}
    res = client.post("/api/auth/signup", json={"email": GUEST[0], "password": GUEST[1]})
    assert res.status_code == 403 and res.json()["error"]["code"] == "signup_closed"
    assert GUEST[0] not in supabase.users


def test_accounts_only_see_their_own_templates(client, supabase, samples, cleanup, monkeypatch):
    monkeypatch.setattr(settings, "signup", "always")
    owner, guest = sign_up(client), sign_up(client, GUEST)
    mine = upload_as(client, owner, samples / "invoice.pdf")
    cleanup.append(mine["id"])
    tid = mine["id"]

    assert [t["id"] for t in client.get("/api/templates", headers=bearer(owner)).json()] == [tid]
    assert client.get("/api/templates", headers=bearer(guest)).json() == []
    as_guest = bearer(guest)
    assert client.get(f"/api/templates/{tid}", headers=as_guest).status_code == 404
    assert client.put(f"/api/templates/{tid}", json={"name": "Taken"}, headers=as_guest).status_code == 404
    assert client.post(f"/api/templates/{tid}/duplicate", headers=as_guest).status_code == 404
    assert client.post(f"/api/export/{tid}", headers=as_guest).status_code == 404
    assert client.delete(f"/api/templates/{tid}", headers=as_guest).status_code == 404
    still = client.get(f"/api/templates/{tid}", headers=bearer(owner))
    assert still.status_code == 200 and still.json()["name"] == "invoice"

    # a copy belongs to whoever made it
    copy = client.post(f"/api/templates/{tid}/duplicate", headers=bearer(owner)).json()
    cleanup.append(copy["id"])
    assert len(client.get("/api/templates", headers=bearer(owner)).json()) == 2
    assert client.get("/api/templates", headers=as_guest).json() == []


def test_files_need_a_file_token_of_the_owner(client, supabase, samples, cleanup, monkeypatch):
    monkeypatch.setattr(settings, "signup", "always")
    owner, guest = sign_up(client), sign_up(client, GUEST)
    template = upload_as(client, owner, samples / "invoice.pdf")
    cleanup.append(template["id"])
    preview = template["pages"][0]["preview"]

    assert client.get(preview).status_code == 401
    ok = client.get(preview, params={"k": owner["fileToken"]})
    assert ok.status_code == 200 and ok.content[:4] == b"\x89PNG"
    assert client.get(preview, headers=bearer(owner)).status_code == 200
    assert client.get(preview, params={"k": guest["fileToken"]}).status_code == 404
    assert client.get(preview, headers=bearer(guest)).status_code == 404
    user_id, expires, signature = owner["fileToken"].rsplit(".", 2)
    forged = f"{guest['user']['id']}.{expires}.{signature}"
    assert client.get(preview, params={"k": forged}).status_code == 401
    assert client.get(preview, params={"k": f"{user_id}.{int(expires) + 99999}.{signature}"}).status_code == 401
    # an access token is not a file token, and a file token is not an access token
    assert client.get(preview, params={"k": owner["accessToken"]}).status_code == 401
    assert client.get("/api/templates", headers={"Authorization": f"Bearer {owner['fileToken']}"}).status_code == 401


def test_file_tokens_are_stable_then_expire():
    auth = SupabaseAuth("https://project.supabase.co", "service-key", client=httpx.Client())
    now = 1_800_000_000.0
    token = auth.file_token("user-1", now)
    assert auth.file_token("user-1", now + 60) == token                     # same link: the browser cache keeps working
    assert auth.file_user(token, now) == "user-1"
    assert auth.file_user(token, now + FILE_TOKEN_WINDOW) == "user-1"       # good for at least 12 hours
    assert auth.file_user(token, now + 2 * FILE_TOKEN_WINDOW + 1) is None   # and at most 24
    assert auth.file_user("user-1.9999999999.deadbeef", now) is None
    assert auth.file_user("", now) is None
    other = SupabaseAuth("https://project.supabase.co", "another-key", client=httpx.Client())
    assert other.file_user(token, now) is None


def test_sign_in_refresh_and_sign_out(client, supabase):
    sign_up(client)
    wrong = client.post("/api/auth/login", json={"email": OWNER[0], "password": "nope nope"})
    assert wrong.status_code == 401 and wrong.json()["error"]["code"] == "invalid_credentials"
    unknown = client.post("/api/auth/login", json={"email": "who@example.com", "password": "nope nope"})
    assert unknown.json() == wrong.json()        # no hint about which accounts exist
    assert client.post("/api/auth/login", json={"email": OWNER[0]}).status_code == 422

    session = client.post("/api/auth/login", json={"email": "  Owner@Example.com ", "password": OWNER[1]}).json()
    assert client.get("/api/templates", headers=bearer(session)).status_code == 200
    renewed = client.post("/api/auth/refresh", json={"refreshToken": session["refreshToken"]}).json()
    assert renewed["accessToken"] != session["accessToken"] and renewed["fileToken"] == session["fileToken"]
    assert client.get("/api/templates", headers=bearer(renewed)).status_code == 200
    assert client.post("/api/auth/refresh", json={"refreshToken": session["refreshToken"]}).status_code == 401   # used up
    assert client.post("/api/auth/refresh", json={}).status_code == 401

    assert client.post("/api/auth/logout", headers=bearer(renewed)).status_code == 204
    assert client.get("/api/templates", headers=bearer(renewed)).status_code == 401


def test_a_checked_token_is_not_checked_again_each_request(client, supabase):
    session = sign_up(client)
    before = supabase.calls.count("GET /user")
    for _ in range(5):
        assert client.get("/api/templates", headers=bearer(session)).status_code == 200
    assert supabase.calls.count("GET /user") == before


def test_sign_up_rules(client, supabase, monkeypatch):
    short = client.post("/api/auth/signup", json={"email": OWNER[0], "password": "short"})
    assert short.status_code == 422 and short.json()["error"]["code"] == "weak_password"
    assert client.post("/api/auth/signup", json={"email": "not-an-email", "password": OWNER[1]}).status_code == 422
    assert supabase.users == {}
    sign_up(client)
    monkeypatch.setattr(settings, "signup", "always")
    assert client.get("/api/auth/status").json() == {"required": True, "signup": True, "first": False, "shared": False}
    again = client.post("/api/auth/signup", json={"email": OWNER[0], "password": OWNER[1]})
    assert again.status_code == 409 and again.json()["error"]["code"] == "email_exists"
    monkeypatch.setattr(settings, "signup", "never")
    assert client.get("/api/auth/status").json() == {"required": True, "signup": False, "first": False, "shared": False}
    assert client.post("/api/auth/signup", json={"email": GUEST[0], "password": GUEST[1]}).status_code == 403


def test_a_later_account_does_not_get_other_peoples_templates(client, supabase, samples, cleanup, monkeypatch):
    monkeypatch.setattr(settings, "signup", "always")
    owner = sign_up(client)
    template = upload_as(client, owner, samples / "invoice.pdf")
    cleanup.append(template["id"])
    guest = sign_up(client, GUEST)
    assert client.get("/api/templates", headers=bearer(guest)).json() == []
    assert len(client.get("/api/templates", headers=bearer(owner)).json()) == 1


def test_export_only_reads_the_templates_own_files(client, supabase, samples, cleanup, monkeypatch):
    monkeypatch.setattr(settings, "signup", "always")
    owner, guest = sign_up(client), sign_up(client, GUEST)
    private = upload_as(client, owner, samples / "brochure.pdf")
    own = upload_as(client, guest, samples / "invoice.pdf")
    cleanup.extend([private["id"], own["id"]])
    stolen = next(e["src"] for p in private["pages"] for e in p["elements"] if e["type"] == "image")
    own_image = next(e["src"] for p in own["pages"] for e in p["elements"] if e["type"] == "image")

    exporter = Exporter(own, get_storage())
    assert exporter._image_bytes(own_image, 1) is not None
    assert exporter._image_bytes(stolen, 1) is None             # another template's file is "missing"
    # ... also when it is put into the page that is sent for export
    page = json.loads(json.dumps(own["pages"][0]))
    next(e for e in page["elements"] if e["type"] == "image")["src"] = stolen
    res = client.post(f"/api/export/{own['id']}", json={"pages": [page]}, headers=bearer(guest))
    assert res.status_code == 200 and res.content[:5] == b"%PDF-"


def test_one_shared_library_when_asked_for(client, supabase, samples, cleanup, monkeypatch):
    monkeypatch.setattr(settings, "signup", "always")
    monkeypatch.setattr(settings, "shared_templates", True)
    owner, guest = sign_up(client), sign_up(client, GUEST)
    template = upload_as(client, owner, samples / "invoice.pdf")
    cleanup.append(template["id"])
    tid = template["id"]
    # everybody who is signed in sees and edits everything ...
    assert tid in [t["id"] for t in client.get("/api/templates", headers=bearer(guest)).json()]
    assert client.get(f"/api/templates/{tid}", headers=bearer(guest)).status_code == 200
    assert client.put(f"/api/templates/{tid}", json={"name": "Ours"}, headers=bearer(guest)).status_code == 200
    assert client.get(template["pages"][0]["preview"], params={"k": guest["fileToken"]}).status_code == 200
    assert client.post(f"/api/export/{tid}", headers=bearer(guest)).status_code == 200
    # ... but still nobody who is not
    assert client.get("/api/templates").status_code == 401
    assert client.get(template["pages"][0]["preview"]).status_code == 401
    assert client.get("/api/health").json()["shared"] is True
