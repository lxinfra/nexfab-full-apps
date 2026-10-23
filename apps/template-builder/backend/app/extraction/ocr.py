"""Optional OCR for scanned pages (needs pytesseract and the tesseract binary)."""
from __future__ import annotations

import logging
import shutil

import pymupdf
from PIL import Image

from ..geometry import r3
from .context import ExtractionContext

log = logging.getLogger(__name__)
_OCR_DPI = 200


def ocr_available() -> bool:
    try:
        import pytesseract  # noqa: F401
    except ImportError:
        return False
    return shutil.which("tesseract") is not None


def ocr_page(page: pymupdf.Page, page_no: int, ctx: ExtractionContext, start_seq: int) -> list[dict]:
    """Recover text positions from a scanned page as hidden text fields.

    The words are already visible in the scan itself, so the fields are created
    with ``visible: false``; the editor can reveal one when the user wants to
    overwrite that piece of text.
    """
    import pytesseract

    pix = page.get_pixmap(dpi=_OCR_DPI, alpha=False)
    image = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    data = pytesseract.image_to_data(image, lang=ctx.options.ocr_language, output_type=pytesseract.Output.DICT)
    scale = 72 / _OCR_DPI

    lines: dict[tuple, list[int]] = {}
    for i, text in enumerate(data["text"]):
        if text.strip() and float(data["conf"][i]) >= 30:
            lines.setdefault((data["block_num"][i], data["par_num"][i], data["line_num"][i]), []).append(i)

    elements: list[dict] = []
    for n, idxs in enumerate(lines.values()):
        x0 = min(data["left"][i] for i in idxs) * scale
        y0 = min(data["top"][i] for i in idxs) * scale
        x1 = max(data["left"][i] + data["width"][i] for i in idxs) * scale
        y1 = max(data["top"][i] + data["height"][i] for i in idxs) * scale
        height = y1 - y0
        size = max(4.0, height / 1.15)
        content = " ".join(data["text"][i].strip() for i in idxs)
        words = [[r3(data["left"][i] * scale - x0), r3(data["width"][i] * scale)] for i in idxs]
        line = {"text": content, "x": 0.0, "y": r3(height * 0.8), "width": r3(x1 - x0)}
        if len(words) > 1:
            line["words"] = words
        elements.append({
            "type": "text", "content": content,
            "x": r3(x0), "y": r3(y0), "width": r3(x1 - x0), "height": r3(height), "rotation": 0.0,
            "fontFamily": "Helvetica", "fontName": "Helvetica", "fontId": None,
            "fontSize": r3(size), "fontWeight": "normal", "fontStyle": "normal",
            "color": "#000000", "opacity": 1.0, "align": "left", "lineHeight": 1.15,
            "baseline": r3(height * 0.8), "editable": True,
            "fieldName": ctx.field_name(content), "isVariable": False,
            "layout": {"fontSize": r3(size), "lines": [line]},
            "visible": False, "ocr": True, "_seq": start_seq + n,
        })
    return elements
