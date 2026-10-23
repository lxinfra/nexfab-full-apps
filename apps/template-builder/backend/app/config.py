"""Runtime configuration, overridable through environment variables (or ``backend/.env``)."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent


def _load_env_file() -> None:
    """Read KEY=VALUE lines from ``backend/.env`` (or ``ENV_FILE``; empty = none).

    Variables already set in the environment win, so a host's own settings
    (Docker, Render ...) are never overridden by a stray file.
    """
    path = os.environ.get("ENV_FILE", str(BACKEND_DIR / ".env"))
    if not path or not Path(path).is_file():
        return
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key.strip(), value)


_load_env_file()


def _path(env: str, default: Path) -> Path:
    return Path(os.environ.get(env, default)).resolve()


def _list(env: str, default: str) -> list[str]:
    return [item.strip().rstrip("/") for item in os.environ.get(env, default).split(",") if item.strip()]


@dataclass
class Settings:
    # Uploads, extracted images, fonts and previews. Served at `storage_url`.
    storage_dir: Path = field(default_factory=lambda: _path("STORAGE_DIR", ROOT_DIR / "storage"))
    storage_url: str = "/storage"
    # Kept outside storage_dir so the database is never served as a static file.
    data_dir: Path = field(default_factory=lambda: _path("DATA_DIR", ROOT_DIR / "data"))
    # Extra fonts for export (e.g. downloaded Google Fonts): any .ttf/.otf dropped here.
    fonts_dir: Path = field(default_factory=lambda: _path("FONTS_DIR", BACKEND_DIR / "fonts"))
    # Letters a PDF's own fonts lack may be fetched from Google Fonts (GOOGLE_FONTS=off: never).
    google_fonts: bool = field(
        default_factory=lambda: os.environ.get("GOOGLE_FONTS", "on").strip().lower() not in ("0", "false", "no", "off"))
    max_upload_bytes: int = int(os.environ.get("MAX_UPLOAD_MB", "50")) * 1024 * 1024
    # Sites allowed to call the API. An entry may use * (https://*.example.com).
    cors: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS", "http://localhost:3000"))
    preview_dpi: int = 72

    # Supabase: files go to a private Storage bucket instead of `storage_dir` when both are set.
    supabase_url: str = field(default_factory=lambda: os.environ.get("SUPABASE_URL", "").strip().rstrip("/"))
    supabase_key: str = field(default_factory=lambda: os.environ.get("SUPABASE_SERVICE_KEY", "").strip())
    supabase_bucket: str = field(default_factory=lambda: os.environ.get("SUPABASE_BUCKET", "templates").strip())

    # Sign-in (through Supabase Auth) is on whenever Supabase is configured; AUTH=none turns it off.
    auth_mode: str = field(default_factory=lambda: os.environ.get("AUTH", "").strip().lower())
    # Who may create an account on the sign-in screen: "first" (only while there is
    # no account yet), "always" or "never".
    signup: str = field(default_factory=lambda: os.environ.get("ALLOW_SIGNUP", "first").strip().lower())
    # One library for everybody: every signed-in account sees and edits all templates.
    shared_templates: bool = field(
        default_factory=lambda: os.environ.get("SHARED_TEMPLATES", "").strip().lower() in ("1", "true", "yes", "on"))
    # The built frontend (the `dist` folder) to serve alongside the API, as the desktop app does.
    frontend_dir: str = field(default_factory=lambda: os.environ.get("FRONTEND_DIR", "").strip())
    # Signs the links to files. Defaults to a key derived from the service key.
    secret_key: str = field(default_factory=lambda: os.environ.get("SECRET_KEY", "").strip())

    @property
    def auth_enabled(self) -> bool:
        return bool(self.supabase_url and self.supabase_key) and self.auth_mode not in ("none", "off", "false", "0")

    @property
    def allow_signup(self) -> str:
        if self.signup in ("always", "true", "yes", "1", "on"):
            return "always"
        if self.signup in ("never", "false", "no", "0", "off"):
            return "never"
        return "first"

    @property
    def cache_dir(self) -> Path:
        """Local copies of files kept in Supabase Storage (safe to delete)."""
        return _path("CACHE_DIR", self.data_dir / "cache")

    @property
    def cors_origins(self) -> list[str]:
        return [origin for origin in self.cors if "*" not in origin]

    @property
    def cors_origin_regex(self) -> str | None:
        patterns = [re.escape(origin).replace(r"\*", "[^/]*") for origin in self.cors if "*" in origin]
        return "|".join(patterns) or None

    @property
    def database_url(self) -> str:
        url = os.environ.get("DATABASE_URL", "").strip()
        if not url:
            return f"sqlite:///{(self.data_dir / 'templates.db').as_posix()}"
        # Supabase hands out postgresql:// (or postgres://); name the driver we install
        return re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", url)


settings = Settings()
