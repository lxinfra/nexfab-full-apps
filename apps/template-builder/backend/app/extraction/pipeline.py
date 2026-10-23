"""PDF -> template JSON, one page at a time."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, Iterator

import pymupdf

from ..config import settings
from ..storage import Storage
from .context import ExtractionContext, Options
from .drawings import extract_shapes
from .fonts import finalize_fonts
from .images import extract_images
from .ocr import ocr_available, ocr_page
from .text import detect_page_tables, extract_text
from .trace import trace_page

log = logging.getLogger(__name__)
pymupdf.TOOLS.mupdf_display_errors(False)

SCANNED_COVERAGE = 0.85   # a single image covering this much of a text-less page = scan
MAX_SHAPES_WARN = 4000


class ExtractionError(Exception):
    """A problem with the uploaded file that the user can act on."""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def open_pdf(path: str | Path, password: str | None = None) -> pymupdf.Document:
    try:
        doc = pymupdf.open(str(path), filetype="pdf")
    except Exception as exc:
        raise ExtractionError("invalid_pdf", "This file is corrupted or is not a valid PDF.", 422) from exc
    if doc.needs_pass:
        if not password:
            doc.close()
            raise ExtractionError("password_required", "This PDF is password-protected. Enter its password to continue.", 401)
        if not doc.authenticate(password):
            doc.close()
            raise ExtractionError("password_incorrect", "That password is not correct for this PDF.", 401)
    try:
        page_count = doc.page_count
    except Exception as exc:
        doc.close()
        raise ExtractionError("invalid_pdf", "This file is corrupted or is not a valid PDF.", 422) from exc
    if page_count == 0:
        doc.close()
        raise ExtractionError("invalid_pdf", "This PDF has no pages (the file may be corrupted).", 422)
    return doc


def _is_scanned(elements: list[dict], width: float, height: float) -> bool:
    if any(e["type"] == "text" and e.get("visible", True) for e in elements):
        return False
    area = width * height
    return any(e["type"] == "image" and e["width"] * e["height"] >= SCANNED_COVERAGE * area for e in elements)


def extract_page(doc: pymupdf.Document, index: int, ctx: ExtractionContext) -> dict:
    page_no = index + 1
    page = doc.load_page(index)
    rotation = page.rotation
    if rotation:
        # Bake /Rotate into the content so every coordinate below is already in
        # the page's displayed orientation (in memory only; the upload is untouched).
        page.remove_rotation()
    width, height = page.rect.width, page.rect.height

    pix = page.get_pixmap(dpi=ctx.options.preview_dpi, alpha=False)
    preview = ctx.save(pix.tobytes("png"), "previews", f"p{page_no}.png")

    bboxlog = page.get_bboxlog()
    ops = trace_page(page, bboxlog)
    ctx.mask_images.clear()
    page_fonts = ctx.page_fonts(page)

    elements = extract_images(page, page_no, ctx, ops, bboxlog)
    shapes = extract_shapes(page, page_no, ctx, ops)
    elements += shapes
    text, tables = extract_text(page, page_no, ctx, page_fonts)
    elements += text

    scanned = _is_scanned(elements, width, height)
    if scanned:
        if ctx.options.ocr and ocr_available():
            try:
                elements += ocr_page(page, page_no, ctx, start_seq=len(bboxlog) + 1)
                ctx.warn("scanned_page", f"Page {page_no} is a scan; OCR recovered its text as hidden fields.", page_no)
            except Exception as exc:
                log.warning("OCR failed on page %d: %s", page_no, exc)
                ctx.warn("scanned_page", f"Page {page_no} is a scanned image and OCR failed, so it has no editable text.", page_no)
        else:
            hint = ("OCR was requested but Tesseract is not installed." if ctx.options.ocr
                    else "Re-upload with OCR enabled to recover text positions.")
            ctx.warn("scanned_page", f"Page {page_no} is a scanned image with no editable text. {hint}", page_no)

    shades = sum(1 for kind, _ in bboxlog if kind == "fill-shade")
    if shades:
        ctx.warn("gradients", f"Page {page_no} has {shades} gradient fill(s) that cannot be recreated as shapes.", page_no)
    if len(shapes) > MAX_SHAPES_WARN:
        ctx.warn("complex_vectors", f"Page {page_no} has {len(shapes)} vector shapes; the editor may be slow.", page_no)
    if page.first_widget is not None or page.first_annot is not None:
        ctx.warn("annotations", f"Page {page_no} has form fields or annotations, which are not converted.", page_no)

    # Stack exactly as painted. Sorting is stable, so objects sharing a paint
    # step (a path that is both filled and stroked) keep their relative order.
    elements.sort(key=lambda e: e["_seq"])
    for z, el in enumerate(elements):
        del el["_seq"]
        el["id"] = f"p{page_no}-e{z}"
        el["z"] = z

    return {
        "index": index,
        "width": round(width, 3),
        "height": round(height, 3),
        "rotation": rotation,
        "preview": preview,
        "scanned": scanned,
        "tables": [table.to_json(f"p{page_no}-t{n}") for n, table in enumerate(tables)],
        "elements": elements,
    }


def iter_pages(doc: pymupdf.Document, ctx: ExtractionContext) -> Iterator[dict]:
    for index in range(doc.page_count):
        try:
            yield extract_page(doc, index, ctx)
        except Exception as exc:
            log.exception("page %d failed", index + 1)
            ctx.warn("page_failed", f"Page {index + 1} could not be analysed ({exc.__class__.__name__}).", index + 1)
            rect = doc.load_page(index).rect
            yield {"index": index, "width": round(rect.width, 3), "height": round(rect.height, 3),
                   "rotation": 0, "preview": None, "scanned": False, "tables": [], "elements": []}


def extract_template(
    path: str | Path,
    template_id: str,
    name: str,
    storage: Storage,
    password: str | None = None,
    options: Options | None = None,
    on_page: Callable[[dict], None] | None = None,
) -> dict:
    """Analyse ``path`` and return the template JSON.

    Pages are processed one at a time; ``on_page`` is called with each finished
    page so callers can persist or report progress without waiting for the end.
    """
    options = options or Options(preview_dpi=settings.preview_dpi)
    doc = open_pdf(path, password)
    try:
        ctx = ExtractionContext(doc, template_id, storage, options)
        pages: list[dict] = []
        for page in iter_pages(doc, ctx):
            if on_page is not None:
                on_page(page)
            pages.append(page)
        fonts = finalize_fonts(ctx)
        return {
            "id": template_id,
            "name": name,
            "pageCount": len(pages),
            "fonts": fonts,
            "warnings": ctx.warnings,
            "pages": pages,
        }
    finally:
        doc.close()


def detect_tables_in_file(path: str | Path, password: str | None = None) -> list[list[dict]]:
    """Table grids for every page of a PDF (used for templates imported before
    table detection existed). Pages that fail simply have no tables."""
    doc = open_pdf(path, password)
    try:
        out: list[list[dict]] = []
        for index in range(doc.page_count):
            try:
                page = doc.load_page(index)
                if page.rotation:
                    page.remove_rotation()
                out.append([table.to_json(f"p{index + 1}-t{n}") for n, table in enumerate(detect_page_tables(page))])
            except Exception:
                log.exception("table detection failed on page %d", index + 1)
                out.append([])
        return out
    finally:
        doc.close()
