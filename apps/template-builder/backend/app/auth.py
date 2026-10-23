"""Sign-in through Supabase Auth.

The browser never talks to Supabase: it sends e-mail and password to this
backend, which asks Supabase Auth and hands back the session. Every API request
then carries the access token, which is checked with Supabase (and remembered
for a few minutes, so a check is not a network call each time).

Files (images, fonts, previews) are loaded by ``<img>`` tags and the canvas,
which cannot send a header. They carry a *file token* in the address instead:
signed by this backend, tied to the user, good for 12 to 24 hours, and of no
use for anything but reading that user's files.

Without Supabase settings there is no sign-in: the app is then a single-user
tool for the computer it runs on.
"""
from __future__ import annotations

import hashlib
import hmac
import threading
import time
from dataclasses import dataclass

import httpx

from .config import settings

MIN_PASSWORD = 8
TOKEN_MEMORY = 300          # seconds a checked access token is trusted without asking again
FILE_TOKEN_WINDOW = 12 * 3600


@dataclass(frozen=True)
class User:
    id: str
    email: str


class AuthError(Exception):
    """A sign-in problem; ``message`` is safe to show."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _unavailable(detail: object) -> AuthError:
    return AuthError(502, "auth_unavailable", f"The sign-in service could not be reached ({detail}). Please try again.")


class SupabaseAuth:
    def __init__(self, base_url: str, service_key: str, secret: str = "", client: httpx.Client | None = None) -> None:
        self._api = base_url.rstrip("/") + "/auth/v1"
        self._service = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}
        self._apikey = {"apikey": service_key}
        self._client = client or httpx.Client(timeout=httpx.Timeout(30, connect=15))
        # file tokens are signed with their own key, derived so that no extra setting is needed
        self._file_key = hashlib.sha256(b"file-token:" + (secret or service_key).encode()).digest()
        self._known: dict[str, tuple[User, float]] = {}
        self._lock = threading.Lock()
        self._has_users_until = 0.0

    # ------------------------------------------------------------- requests
    def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            return self._client.request(method, self._api + path, **kwargs)
        except httpx.HTTPError as exc:
            raise _unavailable(type(exc).__name__) from exc

    @staticmethod
    def _problem(response: httpx.Response) -> tuple[str, str]:
        try:
            body = response.json()
        except ValueError:
            return "", response.text[:200]
        return str(body.get("error_code") or body.get("error") or ""), str(body.get("msg") or body.get("error_description") or body.get("message") or "")

    def _session(self, response: httpx.Response) -> dict:
        data = response.json()
        user = User(id=data["user"]["id"], email=data["user"].get("email") or "")
        expires_at = int(data.get("expires_at") or time.time() + int(data.get("expires_in") or 3600))
        self._remember(data["access_token"], user, expires_at)
        return {
            "accessToken": data["access_token"],
            "refreshToken": data["refresh_token"],
            "expiresAt": expires_at,
            "fileToken": self.file_token(user.id),
            "user": {"id": user.id, "email": user.email},
        }

    # -------------------------------------------------------------- sign-in
    def sign_in(self, email: str, password: str) -> dict:
        response = self._request("POST", "/token", params={"grant_type": "password"}, headers=self._apikey,
                                 json={"email": email.strip().lower(), "password": password})
        if response.status_code == 200:
            return self._session(response)
        code, _ = self._problem(response)
        if response.status_code == 429:
            raise AuthError(429, "too_many_attempts", "Too many attempts. Please wait a minute and try again.")
        if response.status_code >= 500:
            raise _unavailable(response.status_code)
        if code == "email_not_confirmed":
            raise AuthError(403, "email_not_confirmed", "This e-mail address has not been confirmed yet.")
        raise AuthError(401, "invalid_credentials", "The e-mail or password is not right.")

    def refresh(self, refresh_token: str) -> dict:
        response = self._request("POST", "/token", params={"grant_type": "refresh_token"}, headers=self._apikey,
                                 json={"refresh_token": refresh_token})
        if response.status_code == 200:
            return self._session(response)
        if response.status_code >= 500:
            raise _unavailable(response.status_code)
        raise AuthError(401, "session_expired", "Your session has ended. Please sign in again.")

    def sign_out(self, access_token: str) -> None:
        with self._lock:
            self._known.pop(access_token, None)
        try:
            self._request("POST", "/logout", params={"scope": "local"},     # this session only, not every device
                          headers={**self._apikey, "Authorization": f"Bearer {access_token}"})
        except AuthError:
            pass    # the browser forgets the session either way

    def create_user(self, email: str, password: str) -> User:
        email = email.strip().lower()
        if "@" not in email or len(email) > 254:
            raise AuthError(422, "invalid_email", "Enter a valid e-mail address.")
        if len(password) < MIN_PASSWORD:
            raise AuthError(422, "weak_password", f"Use a password of at least {MIN_PASSWORD} characters.")
        # created as confirmed: no confirmation e-mail has to arrive first
        response = self._request("POST", "/admin/users", headers=self._service,
                                 json={"email": email, "password": password, "email_confirm": True})
        if response.status_code == 200:
            self._has_users_until = time.monotonic() + 3600
            data = response.json()
            return User(id=data["id"], email=data.get("email") or email)
        code, message = self._problem(response)
        if response.status_code >= 500:
            raise _unavailable(response.status_code)
        if code == "email_exists" or "already" in message.lower():
            raise AuthError(409, "email_exists", "There is already an account with this e-mail. Sign in instead.")
        if code == "weak_password":
            raise AuthError(422, "weak_password", message or "That password is too weak.")
        raise AuthError(422, "signup_failed", message or "The account could not be created.")

    def user_count(self, limit: int = 2) -> int:
        """How many accounts exist, counted up to ``limit``."""
        response = self._request("GET", "/admin/users", headers=self._service, params={"page": 1, "per_page": limit})
        if response.status_code != 200:
            raise _unavailable(response.status_code)
        return len(response.json().get("users") or [])

    def has_users(self) -> bool:
        if time.monotonic() < self._has_users_until:
            return True
        if self.user_count(1) == 0:
            return False
        self._has_users_until = time.monotonic() + 60
        return True

    # --------------------------------------------------------------- checks
    def _remember(self, token: str, user: User, expires_at: float) -> None:
        with self._lock:
            if len(self._known) > 2000:     # forget the oldest half rather than grow without end
                for old in list(self._known)[:1000]:
                    del self._known[old]
            self._known[token] = (user, min(time.time() + TOKEN_MEMORY, expires_at))

    def user(self, access_token: str) -> User:
        """Who an access token belongs to. Raises AuthError when it is not (or no longer) valid."""
        with self._lock:
            known = self._known.get(access_token)
        if known and known[1] > time.time():
            return known[0]
        response = self._request("GET", "/user", headers={**self._apikey, "Authorization": f"Bearer {access_token}"})
        if response.status_code == 200:
            data = response.json()
            user = User(id=data["id"], email=data.get("email") or "")
            self._remember(access_token, user, time.time() + TOKEN_MEMORY)
            return user
        if response.status_code >= 500:
            raise _unavailable(response.status_code)
        raise AuthError(401, "session_expired", "Your session has ended. Please sign in again.")

    # ---------------------------------------------------------- file tokens
    def _sign(self, payload: str) -> str:
        return hmac.new(self._file_key, payload.encode(), hashlib.sha256).hexdigest()[:40]

    def file_token(self, user_id: str, now: float | None = None) -> str:
        """Lets its holder read this user's files until it expires. It is the same
        string for 12 hours at a time, so file addresses (and the browser's cache
        of them) stay stable."""
        window = int((time.time() if now is None else now) // FILE_TOKEN_WINDOW)
        payload = f"{user_id}.{(window + 2) * FILE_TOKEN_WINDOW}"
        return f"{payload}.{self._sign(payload)}"

    def file_user(self, token: str, now: float | None = None) -> str | None:
        """The user a file token was made for, or None if it is forged or expired."""
        payload, _, signature = token.rpartition(".")
        user_id, _, expires = payload.rpartition(".")
        if not user_id or not expires.isdigit() or not hmac.compare_digest(signature, self._sign(payload)):
            return None
        return user_id if int(expires) > (time.time() if now is None else now) else None


_auth: SupabaseAuth | None = None


def get_auth() -> SupabaseAuth | None:
    """The sign-in service, or None when the app runs without sign-in."""
    global _auth
    if _auth is None and settings.auth_enabled:
        _auth = SupabaseAuth(settings.supabase_url, settings.supabase_key, settings.secret_key)
    return _auth


def signup_open(auth: SupabaseAuth) -> bool:
    """May a new account be created from the sign-in screen?"""
    if settings.allow_signup == "first":
        return not auth.has_users()     # only the very first account: the owner's
    return settings.allow_signup == "always"
