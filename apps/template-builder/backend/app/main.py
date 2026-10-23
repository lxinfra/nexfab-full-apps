"""FastAPI application: upload/extract, template CRUD, image replacement, export."""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import time
import zipfile
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from PIL import Image, UnidentifiedImageError
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from . import repository as repo
from .auth import AuthError, User, get_auth, signup_open
from .config import settings
from .db import ReadSession, Template, engine, get_db, get_read_db, init_db, utcnow
from .export import Exporter
from .extraction import ExtractionError, Options, detect_tables_in_file, extract_template
from .spreadsheet import SpreadsheetError, read_spreadsheet
from .storage import StorageError, SupabaseStorage, get_storage

log = logging.getLogger(__name__)

PDF_MIME_TYPES = {"application/pdf", "application/x-pdf", "application/acrobat", "applications/vnd.pdf",
                  "text/pdf", "application/octet-stream", "binary/octet-stream"}
IMAGE_FORMATS = {"PNG": "png", "JPEG": "jpg", "GIF": "png", "WEBP": "png", "BMP": "png", "TIFF": "png"}
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_BULK_ROWS = 500
MAX_SPREADSHEET_BYTES = 10 * 1024 * 1024
_CHUNK = 1024 * 1024


class ApiError(HTTPException):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(status_code=status, detail={"code": code, "message": message})


@asynccontextmanager
async def lifespan(_app: FastAPI):
    for attempt in range(4):
        try:
            init_db()
            break
        except OperationalError:    # the database is far away: a dropped lookup or connection deserves another try
            if attempt == 3:
                raise
            log.warning("database not reachable yet, trying again")
            time.sleep(2 * (attempt + 1))
    storage = get_storage()
    if isinstance(storage, SupabaseStorage):
        storage.ensure_bucket()     # fail at start-up, not on the first upload, if the keys are wrong
    yield


app = FastAPI(title="PDF Template Builder", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=settings.cors_origins, allow_origin_regex=settings.cors_origin_regex,
    allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"],
)


@app.exception_handler(HTTPException)
async def http_error(_request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "error", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": detail})


@app.exception_handler(AuthError)
async def auth_error(_request: Request, exc: AuthError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"error": {"code": exc.code, "message": exc.message}})


def current_user(request: Request) -> User | None:
    """The signed-in user. None when the app runs without sign-in (no Supabase settings)."""
    auth = get_auth()
    if auth is None:
        return None
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ApiError(401, "unauthorized", "Please sign in.")
    return auth.user(token.strip())


def _owner(user: User | None) -> str | None:
    """Whose templates a request may touch. None = everyone's (no sign-in, or one shared library)."""
    return user.id if user and not settings.shared_templates else None


def _template_or_404(db: Session, template_id: str, elements: bool = True, user: User | None = None) -> Template:
    template = repo.get_template(db, template_id, elements, _owner(user))
    if template is None:
        raise ApiError(404, "not_found", "Template not found.")
    return template


def _safe_filename(name: str, fallback: str = "template") -> str:
    cleaned = re.sub(r"[^\w.\- ]+", "_", name, flags=re.ASCII).strip(" ._")
    return cleaned[:80] or fallback


@app.exception_handler(StorageError)
async def storage_error(_request: Request, exc: StorageError) -> JSONResponse:
    log.error("storage: %s", exc)
    return JSONResponse(status_code=502, content={"error": {
        "code": "storage_unavailable", "message": "The file storage could not be reached. Please try again."}})


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "database": engine.dialect.name,
        "storage": "supabase" if isinstance(get_storage(), SupabaseStorage) else "local",
        "signIn": get_auth() is not None,
        "shared": settings.shared_templates,
    }


_owners: dict[str, str] = {}    # template id -> owner; an owner never changes once set


def _may_read_files(template_id: str, user_id: str) -> bool:
    if template_id not in _owners:
        with ReadSession() as db:
            owner = repo.owner_of(db, template_id)
        if owner is None:
            return False
        if len(_owners) > 5000:
            _owners.clear()
        _owners[template_id] = owner
    return _owners[template_id] == user_id


@app.get(settings.storage_url + "/{key:path}")
def stored_file(key: str, request: Request, k: str | None = None) -> FileResponse:
    """Images, fonts, previews and source PDFs, wherever they are kept.

    With sign-in on, the address carries a file token (``?k=``): image tags and
    the canvas cannot send a header.
    """
    auth = get_auth()
    if auth is not None:
        user_id = auth.file_user(k) if k else current_user(request).id
        if user_id is None:
            raise ApiError(401, "unauthorized", "Please sign in.")
        if not settings.shared_templates and not _may_read_files(key.split("/", 1)[0], user_id):
            raise ApiError(404, "not_found", "File not found.")
    storage = get_storage()
    try:
        found = storage.exists(key)
    except ValueError:
        found = False
    if not found:
        raise ApiError(404, "not_found", "File not found.")
    # a key is written once and never changed, so browsers may keep it
    return FileResponse(storage.local_path(key), headers={"Cache-Control": "private, max-age=86400"})


# ----------------------------------------------------------------- sign-in
def _auth_or_404():
    auth = get_auth()
    if auth is None:
        raise ApiError(404, "no_sign_in", "This server runs without sign-in.")
    return auth


def _credentials(payload: dict) -> tuple[str, str]:
    email, password = payload.get("email"), payload.get("password")
    if not isinstance(email, str) or not isinstance(password, str) or not email.strip() or not password:
        raise ApiError(422, "missing_credentials", "Enter your e-mail and password.")
    return email, password


@app.get("/api/auth/status")
def auth_status() -> dict:
    """Does this server ask for sign-in, and may an account be created?"""
    auth = get_auth()
    if auth is None:
        return {"required": False, "signup": False, "first": False, "shared": False}
    # first: nobody has an account yet, so the next one made is the owner's
    return {"required": True, "signup": signup_open(auth), "first": not auth.has_users(),
            "shared": settings.shared_templates}


@app.post("/api/auth/login")
def login(payload: dict) -> dict:
    return _auth_or_404().sign_in(*_credentials(payload))


@app.post("/api/auth/signup")
def signup(payload: dict, db: Session = Depends(get_db)) -> dict:
    auth = _auth_or_404()
    email, password = _credentials(payload)
    if not signup_open(auth):
        raise ApiError(403, "signup_closed", "New accounts cannot be created here. Ask the owner to add you.")
    first = not auth.has_users()
    user = auth.create_user(email, password)
    if first:
        # the owner's account: the templates made before there was sign-in become theirs
        repo.claim_unowned(db, user.id)
        db.commit()
    return auth.sign_in(email, password)


@app.post("/api/auth/refresh")
def refresh_session(payload: dict) -> dict:
    token = payload.get("refreshToken")
    if not isinstance(token, str) or not token:
        raise ApiError(401, "session_expired", "Your session has ended. Please sign in again.")
    return _auth_or_404().refresh(token)


@app.post("/api/auth/logout", status_code=204)
def logout(request: Request) -> Response:
    auth = get_auth()
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    if auth is not None and scheme.lower() == "bearer" and token.strip():
        auth.sign_out(token.strip())
    return Response(status_code=204)


@app.get("/api/auth/me")
def me(user: User | None = Depends(current_user)) -> dict:
    return {"user": {"id": user.id, "email": user.email} if user else None}


# ------------------------------------------------------------------ upload
@app.post("/api/upload")
def upload(
    request: Request,
    file: UploadFile = File(...),
    password: str | None = Form(None),
    ocr: bool = Form(False),
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> dict:
    """Store the PDF, run the extraction pipeline and return the template JSON."""
    declared = int(request.headers.get("content-length") or 0)
    if declared > settings.max_upload_bytes + _CHUNK:  # multipart framing adds a little
        raise ApiError(413, "file_too_large", f"The file is larger than {settings.max_upload_bytes // 2**20} MB.")
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type and content_type not in PDF_MIME_TYPES:
        raise ApiError(415, "unsupported_type", f"Only PDF files can be uploaded (got {content_type}).")

    storage = get_storage()
    template_id = repo.new_id()
    source_key = f"{template_id}/source.pdf"
    size = 0
    try:
        # Stream to disk in chunks: the upload never has to fit in memory.
        with storage.open_write(source_key) as out:
            head = file.file.read(_CHUNK)
            if b"%PDF-" not in head[:1024]:
                raise ApiError(415, "unsupported_type", "This file is not a PDF.")
            chunk = head
            while chunk:
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise ApiError(413, "file_too_large",
                                   f"The file is larger than {settings.max_upload_bytes // 2**20} MB.")
                out.write(chunk)
                chunk = file.file.read(_CHUNK)

        original = file.filename or "document.pdf"
        name = re.sub(r"\.pdf$", "", original, flags=re.I) or "Untitled"
        row = Template(id=template_id, name=name[:255], original_filename=original[:255],
                   owner_id=user.id if user else None)
        db.add(row)
        db.flush()

        def save_page(page: dict) -> None:
            # Persist each page as soon as it is extracted (keeps memory flat on big PDFs).
            repo.add_page(db, template_id, page)
            db.flush()

        result = extract_template(
            storage.local_path(source_key), template_id, row.name, storage,
            password=password or None, options=Options(ocr=ocr, preview_dpi=settings.preview_dpi),
            on_page=save_page,
        )
        row.page_count = result["pageCount"]
        row.fonts = result["fonts"]
        row.warnings = result["warnings"]
        storage.flush()     # every extracted file is stored before the template is
        db.commit()
    except ExtractionError as exc:
        db.rollback()
        storage.delete_prefix(template_id)
        raise ApiError(exc.status, exc.code, exc.message) from exc
    except Exception:
        db.rollback()
        storage.delete_prefix(template_id)
        raise

    template = _template_or_404(db, template_id, user=user)
    return {"templateId": template_id, "template": repo.template_json(template, storage)}


# --------------------------------------------------------------- templates
@app.get("/api/templates")
def list_templates(db: Session = Depends(get_read_db), user: User | None = Depends(current_user)) -> list[dict]:
    return [repo.summary_json(t) for t in repo.list_templates(db, _owner(user))]


@app.get("/api/templates/{template_id}")
def get_template(template_id: str, db: Session = Depends(get_read_db),
                 user: User | None = Depends(current_user)) -> dict:
    template = _template_or_404(db, template_id, user=user)
    storage = get_storage()
    if any(page.tables is None for page in template.pages):
        # Imported before table detection existed: look for tables once, now.
        try:
            found = detect_tables_in_file(storage.local_path(f"{template_id}/source.pdf"))
        except Exception:   # password-protected or missing source: no tables, do not ask again
            found = []
        for page in template.pages:
            if page.tables is None:
                page.tables = found[page.index] if page.index < len(found) else []
        db.commit()
    return repo.template_json(template, storage)


@app.put("/api/templates/{template_id}")
def save_template(template_id: str, payload: dict, db: Session = Depends(get_db),
                  user: User | None = Depends(current_user)) -> dict:
    template = _template_or_404(db, template_id, elements=False, user=user)
    try:
        repo.apply_update(db, template, payload, get_storage())
    except repo.InvalidUpdate as exc:
        db.rollback()
        raise ApiError(400, "invalid_update", str(exc)) from exc
    db.commit()
    return repo.summary_json(template)


@app.delete("/api/templates/{template_id}", status_code=204)
def delete_template(template_id: str, db: Session = Depends(get_db),
                    user: User | None = Depends(current_user)) -> Response:
    template = _template_or_404(db, template_id, elements=False, user=user)
    db.delete(template)
    db.commit()
    get_storage().delete_prefix(template_id)
    return Response(status_code=204)


@app.post("/api/templates/{template_id}/tables")
def redetect_tables(template_id: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)) -> dict:
    """Look for tables in the template's PDF again (after the detector improved, say)
    and replace every page's grids. The pages' elements are left as they are."""
    template = _template_or_404(db, template_id, elements=False, user=user)
    storage = get_storage()
    try:
        found = detect_tables_in_file(storage.local_path(f"{template_id}/source.pdf"))
    except Exception as exc:
        raise ApiError(422, "no_source", "The original PDF could not be read for this template.") from exc
    for page in template.pages:
        page.tables = found[page.index] if page.index < len(found) else []
    template.updated_at = utcnow()
    db.commit()
    return {"pages": [{"index": page.index, "tables": page.tables} for page in template.pages]}


@app.post("/api/templates/{template_id}/duplicate")
def duplicate_template(template_id: str, db: Session = Depends(get_db),
                       user: User | None = Depends(current_user)) -> dict:
    source = _template_or_404(db, template_id, user=user)
    copy = repo.duplicate_template(db, source, get_storage())
    db.commit()
    return repo.summary_json(copy)


@app.post("/api/templates/{template_id}/images")
def upload_image(template_id: str, file: UploadFile = File(...), db: Session = Depends(get_read_db),
                 user: User | None = Depends(current_user)) -> dict:
    """Store a replacement image for this template and return its URL and pixel size."""
    _template_or_404(db, template_id, elements=False, user=user)
    data = file.file.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise ApiError(413, "file_too_large", f"Images can be at most {MAX_IMAGE_BYTES // 2**20} MB.")
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise ApiError(415, "unsupported_type", "That file is not an image we can read.") from exc
    ext = IMAGE_FORMATS.get(image.format or "")
    if ext is None:
        raise ApiError(415, "unsupported_type", f"Unsupported image format: {image.format}.")
    if image.format not in ("PNG", "JPEG") or image.mode in ("CMYK", "P", "I;16"):
        # normalise to something every browser and the PDF writer accept
        keep_alpha = "A" in image.getbands() or "transparency" in image.info
        image = image.convert("RGBA" if keep_alpha else "RGB")
        buf = io.BytesIO()
        image.save(buf, "PNG")
        data, ext = buf.getvalue(), "png"
    storage = get_storage()
    key = f"{template_id}/images/u_{repo.new_id()}.{ext}"
    storage.write(key, data)
    storage.flush()
    return {"src": storage.url(key), "naturalWidth": image.width, "naturalHeight": image.height}


@app.post("/api/templates/{template_id}/images/copy")
def copy_image(template_id: str, payload: dict, db: Session = Depends(get_read_db),
               user: User | None = Depends(current_user)) -> dict:
    """Give this template its own copy of an image of another template (pasting across templates)."""
    _template_or_404(db, template_id, elements=False, user=user)
    storage = get_storage()
    key = storage.key_from_url(str(payload.get("src") or ""))
    if not key or "/" not in key:
        raise ApiError(400, "invalid_image", "That is not one of the app's images.")
    source_id, name = key.split("/", 1)
    if source_id != template_id:
        _template_or_404(db, source_id, elements=False, user=user)   # it must be a template this user may read
    if not storage.exists(key):
        raise ApiError(404, "not_found", "The image was not found.")
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else "png"
    new_key = f"{template_id}/images/u_{repo.new_id()}.{ext}"
    storage.copy(key, new_key)
    storage.flush()
    return {"src": storage.url(new_key)}


# ------------------------------------------------------------ spreadsheets
@app.post("/api/spreadsheets/parse")
def parse_spreadsheet(file: UploadFile = File(...), _user: User | None = Depends(current_user)) -> dict:
    """Read an Excel or CSV file and return its sheets as rows of display text
    (what the editor's "Import Excel" puts into a table)."""
    data = file.file.read(MAX_SPREADSHEET_BYTES + 1)
    if len(data) > MAX_SPREADSHEET_BYTES:
        raise ApiError(413, "file_too_large", f"Spreadsheets can be at most {MAX_SPREADSHEET_BYTES // 2**20} MB.")
    try:
        sheets = read_spreadsheet(data, file.filename or "")
    except SpreadsheetError as exc:
        raise ApiError(422, "invalid_spreadsheet", str(exc)) from exc
    return {"filename": file.filename, "sheets": sheets}


# ------------------------------------------------------------------ export
async def _template_for_export(request: Request, template_id: str, db: Session, user: User | None) -> dict:
    """The saved template, or the one in the request body (unsaved edits)."""
    saved = repo.template_json(_template_or_404(db, template_id, user=user), get_storage())
    body = await request.body()
    if not body.strip() or "application/json" not in (request.headers.get("content-type") or ""):
        return saved
    try:
        payload = json.loads(body)
    except ValueError as exc:
        raise ApiError(400, "invalid_json", "The request body is not valid JSON.") from exc
    if isinstance(payload, dict) and isinstance(payload.get("pages"), list):
        saved["pages"] = payload["pages"]
        saved["name"] = payload.get("name") or saved["name"]
    return saved


@app.post("/api/export/{template_id}")
async def export_pdf(template_id: str, request: Request, db: Session = Depends(get_read_db),
                     user: User | None = Depends(current_user)) -> Response:
    template = await _template_for_export(request, template_id, db, user)
    pdf = Exporter(template, get_storage()).render()
    filename = _safe_filename(template["name"]) + ".pdf"
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@app.post("/api/export/{template_id}/bulk")
def export_bulk(template_id: str, file: UploadFile = File(...), db: Session = Depends(get_read_db),
                user: User | None = Depends(current_user)) -> Response:
    """CSV in (one row per document, columns = variable names), zip of PDFs out."""
    template = repo.template_json(_template_or_404(db, template_id, user=user), get_storage())
    raw = file.file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise ApiError(413, "file_too_large", "The CSV can be at most 10 MB.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    columns = [c.strip() for c in (reader.fieldnames or []) if c and c.strip()]
    if not columns:
        raise ApiError(400, "invalid_csv", "The CSV needs a header row with the variable names.")
    rows = [{(k or "").strip(): (v or "").strip() for k, v in row.items() if k} for row in reader]
    rows = [r for r in rows if any(r.values())]
    if not rows:
        raise ApiError(400, "invalid_csv", "The CSV has no data rows.")
    if len(rows) > MAX_BULK_ROWS:
        raise ApiError(400, "too_many_rows", f"Bulk fill is limited to {MAX_BULK_ROWS} rows per file.")

    exporter = Exporter(template, get_storage())
    base = _safe_filename(template["name"])
    archive = io.BytesIO()
    used: set[str] = set()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for n, row in enumerate(rows, start=1):
            # a `filename` column, if present, names the PDFs
            stem = _safe_filename(row.get("filename") or f"{base}_{n:03d}", f"{base}_{n:03d}")
            stem = re.sub(r"\.pdf$", "", stem, flags=re.I)
            name, k = stem, 1
            while name in used:
                k += 1
                name = f"{stem}_{k}"
            used.add(name)
            zf.writestr(f"{name}.pdf", exporter.render(variables=row, blank_missing=True))
    return Response(archive.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{base}_bulk.zip"'})


# ---------------------------------------------------------------- frontend
if settings.frontend_dir:
    from fastapi.staticfiles import StaticFiles

    # The desktop app: one local server gives the window both the pages and the API.
    @app.get("/config.js", include_in_schema=False)
    def frontend_config() -> Response:
        """Tell the pages that their API is right here, whatever address the folder was built for."""
        return Response('window.__APP_CONFIG__ = { apiUrl: "same-origin" };', media_type="text/javascript",
                        headers={"Cache-Control": "no-cache"})

    app.mount("/", StaticFiles(directory=settings.frontend_dir, html=True), name="frontend")
