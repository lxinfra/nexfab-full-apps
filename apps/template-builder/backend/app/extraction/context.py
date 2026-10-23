"""State shared across the pages of one extraction run."""
from __future__ import annotations

import re
from dataclasses import dataclass, field

import pymupdf

from ..fontmap import normalise, strip_subset_prefix
from ..geometry import invert, local_to_page_matrix, r3, segments_to_d, transform_segments
from ..storage import Storage
from .trace import ClipResult

SOFT_MASK_WARNING = ("Page {page} uses a soft mask or text clip that cannot be recreated exactly; "
                     "the affected objects are approximated.")


@dataclass
class FontUse:
    id: str
    name: str                      # PDF font name without subset prefix
    basefont: str = ""             # as written in the PDF, e.g. "ABCDEF+Arial-BoldMT"
    xref: int = 0
    ext: str = "n/a"               # extract_font() extension; "n/a" = not embedded
    kind: str = ""                 # Type1, TrueType, Type0, Type3 ...
    flags: int = 0                 # span flags of the first use (serif/mono/bold/italic bits)
    chars: set[int] = field(default_factory=set)        # code points used in visible text
    gids: dict[int, int] = field(default_factory=dict)  # code point -> glyph id in the embedded program
    pages: set[int] = field(default_factory=set)


@dataclass
class Options:
    merge_paragraphs: bool = True
    ocr: bool = False
    ocr_language: str = "eng"
    preview_dpi: int = 72


class ExtractionContext:
    def __init__(self, doc: pymupdf.Document, template_id: str, storage: Storage, options: Options) -> None:
        self.doc = doc
        self.template_id = template_id
        self.storage = storage
        self.options = options
        self.images: dict[tuple, dict] = {}        # (xref, tint) -> stored image record
        # Images that paint a soft mask on the current page: seqno -> (pixels, placement matrix)
        self.mask_images: dict[int, tuple] = {}
        self.fonts: dict[str, FontUse] = {}
        self.warnings: list[dict] = []
        self._field_names: set[str] = set()
        self._warned: set[tuple] = set()

    # ---- storage -------------------------------------------------------
    def key(self, *parts: str) -> str:
        return "/".join((self.template_id, *parts))

    def save(self, data: bytes, *parts: str) -> str:
        key = self.key(*parts)
        self.storage.write(key, data)
        return self.storage.url(key)

    # ---- warnings ------------------------------------------------------
    def warn(self, code: str, message: str, page: int | None = None, once: bool = True) -> None:
        tag = (code, page)
        if once and tag in self._warned:
            return
        self._warned.add(tag)
        entry = {"code": code, "message": message}
        if page is not None:
            entry["page"] = page
        self.warnings.append(entry)

    # ---- fonts ---------------------------------------------------------
    def page_fonts(self, page: pymupdf.Page) -> dict[str, FontUse]:
        """Fonts referenced by ``page`` keyed by normalised name."""
        out: dict[str, FontUse] = {}
        for xref, ext, kind, basefont, _ref, _enc, *_ in page.get_fonts(full=True):
            fid = f"f{xref}"
            use = self.fonts.get(fid)
            if use is None:
                use = FontUse(id=fid, name=strip_subset_prefix(basefont), basefont=basefont,
                              xref=xref, ext=ext, kind=kind)
                self.fonts[fid] = use
            use.pages.add(page.number + 1)
            key = normalise(basefont)
            # prefer an embedded program when two fonts share a name
            if key not in out or (out[key].ext == "n/a" and ext != "n/a"):
                out[key] = use
        return out

    def font_use(self, page_fonts: dict[str, FontUse], span_font: str, flags: int = 0) -> FontUse:
        key = normalise(span_font)
        use = page_fonts.get(key)
        if use is None:
            # MuPDF sometimes reports the name from the font program rather than /BaseFont.
            use = next((u for k, u in page_fonts.items() if k.startswith(key) or key.startswith(k)), None)
        if use is None:
            fid = "n_" + (key or "unknown")
            use = self.fonts.get(fid)
            if use is None:
                use = self.fonts[fid] = FontUse(id=fid, name=strip_subset_prefix(span_font) or "Unknown")
            page_fonts[key] = use
        if not use.flags:
            use.flags = flags
        return use

    # ---- field names ---------------------------------------------------
    def field_name(self, content: str, fallback: str = "text") -> str:
        words = re.findall(r"[A-Za-z0-9]+", content.lower())[:4]
        base = "_".join(words)[:32].strip("_") or fallback
        if base[0].isdigit():
            base = f"{fallback}_{base}"
        name, n = base, 1
        while name in self._field_names:
            n += 1
            name = f"{base}_{n}"
        self._field_names.add(name)
        return name


def attach_clip(el: dict, clips: ClipResult) -> None:
    """Store clip paths on ``el`` in its own local frame, so they follow the
    element when it is moved, rotated or resized."""
    if not clips.paths:
        return
    inv = invert(local_to_page_matrix(el))
    if inv is None:  # zero-sized box: fall back to a pure translation
        inv = (1, 0, 0, 1, -float(el.get("x", 0)), -float(el.get("y", 0)))
    el["clip"] = [
        {"d": segments_to_d(transform_segments(segs, inv)), "rule": "evenodd" if even_odd else "nonzero"}
        for segs, even_odd in clips.paths
    ]
    el["refWidth"] = r3(el.get("width", 0))
    el["refHeight"] = r3(el.get("height", 0))

