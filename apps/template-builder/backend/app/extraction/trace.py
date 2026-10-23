"""Exact draw order and clip scopes from MuPDF's trace device.

``get_drawings``/``get_image_info``/``get_text`` each describe one kind of
object. To stack them exactly as the PDF does, and to know which clip paths
were active when an object was painted, we replay the page through MuPDF's
trace device and read back the operator list. Every painting operator gets a
sequence number that matches PyMuPDF's ``seqno`` (drawings, texttrace) and the
index into ``Page.get_bboxlog()``.

This relies on the low-level ``pymupdf.mupdf`` bindings. If they are missing or
the result does not line up with the bbox log, ``trace_page`` returns None and
extraction carries on without clip information.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import pymupdf

from ..geometry import Matrix, Segment, axis_aligned_rect, segments_bbox, transform_segments

log = logging.getLogger(__name__)

# trace tag -> type name used by Page.get_bboxlog()
_PAINT_OPS = {
    "fill_path": "fill-path",
    "stroke_path": "stroke-path",
    "fill_text": "fill-text",
    "stroke_text": "stroke-text",
    "ignore_text": "ignore-text",
    "fill_shade": "fill-shade",
    "fill_image": "fill-image",
    "fill_image_mask": "fill-imgmask",
}
# Operators that push an entry onto the clip stack (popped by <pop_clip/>).
_PUSH_OPS = {"clip_path", "clip_stroke_path", "clip_text", "clip_stroke_text", "clip_image_mask"}
# A soft mask: the operators inside the element paint the mask itself; what
# follows, up to the matching <pop_clip/>, is drawn through it.
_MASK_TAGS = {"clip_mask", "mask"}

_TAG = re.compile(r"\s*<(/?)([a-z_]+)([^>]*?)(/?)>")
_ATTR = re.compile(r'([\w-]+)="([^"]*)"')


@dataclass
class Clip:
    segments: list[Segment]            # page coordinates
    even_odd: bool
    bbox: tuple[float, float, float, float]
    rect: tuple[float, float, float, float] | None  # set when the clip is a plain rectangle


@dataclass(eq=False)
class SoftMask:
    luminosity: bool
    ops: list[int] = field(default_factory=list)   # seqnos of the operators that paint the mask


@dataclass
class PaintOp:
    kind: str                          # bboxlog type name, e.g. "fill-image"
    alpha: float = 1.0
    color: tuple[float, ...] | None = None
    clips: tuple[Clip, ...] = ()
    in_mask: bool = False              # painted while defining a soft mask (not visible content)
    soft_masks: tuple[SoftMask, ...] = ()   # soft masks this operator is drawn through
    unsupported_clip: bool = False     # under a text or stroke clip we cannot reproduce


def _floats(s: str) -> list[float]:
    return [float(v) for v in s.split()]


def _trace_text(page: pymupdf.Page) -> str:
    from pymupdf import mupdf

    buf = mupdf.fz_new_buffer(1 << 16)
    out = mupdf.FzOutput(buf)
    dev = mupdf.fz_new_trace_device(out)
    fz_page = page.this if isinstance(page.this, mupdf.FzPage) else mupdf.FzPage(page.this)
    mupdf.fz_run_page(fz_page, dev, mupdf.FzMatrix(), mupdf.FzCookie())
    mupdf.fz_close_device(dev)
    mupdf.fz_close_output(out)
    return bytes(mupdf.fz_buffer_extract(buf)).decode("utf-8", "replace")


def parse_trace(text: str) -> list[PaintOp]:
    ops: list[PaintOp] = []
    stack: list[Clip | SoftMask | None] = []   # None = a clip we track but cannot reproduce
    defining: list[SoftMask] = []              # soft masks whose content is being read
    collecting: dict | None = None     # clip_path currently being read

    for line in text.splitlines():
        m = _TAG.match(line)
        if not m:
            continue
        closing, tag, attr_text, self_closing = m.groups()

        if collecting is not None:
            if tag == "moveto" or tag == "lineto":
                a = dict(_ATTR.findall(attr_text))
                collecting["segs"].append(("M" if tag == "moveto" else "L", float(a["x"]), float(a["y"])))
            elif tag == "curveto":
                a = dict(_ATTR.findall(attr_text))
                collecting["segs"].append(
                    ("C", *(float(a[k]) for k in ("x1", "y1", "x2", "y2", "x3", "y3")))
                )
            elif tag == "closepath":
                collecting["segs"].append(("Z",))
            elif closing and tag == "clip_path":
                segs = transform_segments(collecting["segs"], collecting["matrix"])
                bbox = segments_bbox(segs)
                if bbox is None:
                    # an empty clip path hides everything painted under it
                    stack.append(Clip([], collecting["even_odd"], (0, 0, 0, 0), (0, 0, 0, 0)))
                else:
                    stack.append(Clip(segs, collecting["even_odd"], bbox, axis_aligned_rect(segs)))
                collecting = None
            continue

        if closing:
            if tag in _MASK_TAGS and defining:
                defining.pop()
            continue

        if tag in _PAINT_OPS:
            a = dict(_ATTR.findall(attr_text))
            color = tuple(_floats(a["color"])) if "color" in a else None
            if defining:
                defining[-1].ops.append(len(ops))
            ops.append(PaintOp(
                kind=_PAINT_OPS[tag],
                alpha=float(a.get("alpha", 1)),
                color=color,
                clips=tuple(c for c in stack if isinstance(c, Clip)),
                in_mask=bool(defining),
                soft_masks=tuple(c for c in stack if isinstance(c, SoftMask) and c not in defining),
                unsupported_clip=any(c is None for c in stack),
            ))
        elif tag == "clip_path":
            a = dict(_ATTR.findall(attr_text))
            t = _floats(a.get("transform", "1 0 0 1 0 0"))
            matrix: Matrix = tuple(t) if len(t) == 6 else (1, 0, 0, 1, 0, 0)  # type: ignore[assignment]
            collecting = {"segs": [], "matrix": matrix, "even_odd": a.get("winding") == "eofill"}
            if self_closing:  # defensive: clip_path with no children
                stack.append(Clip([], collecting["even_odd"], (0, 0, 0, 0), (0, 0, 0, 0)))
                collecting = None
        elif tag in _MASK_TAGS:
            mask = SoftMask(luminosity=dict(_ATTR.findall(attr_text)).get("s") == "luminosity")
            stack.append(mask)
            if not self_closing:
                defining.append(mask)
        elif tag in _PUSH_OPS:
            # clip_image_mask is an image's own soft mask, which we merge into
            # the PNG's alpha channel; the other kinds cannot be reproduced.
            stack.append(_SMASK if tag == "clip_image_mask" else None)
        elif tag == "pop_clip":
            if stack:
                stack.pop()
    return [_strip_smask(op) for op in ops]


# Sentinel for clip_image_mask entries: tracked for push/pop balance, never reported.
_SMASK = Clip([], False, (0, 0, 0, 0), None)


def _strip_smask(op: PaintOp) -> PaintOp:
    if any(c is _SMASK for c in op.clips):
        op.clips = tuple(c for c in op.clips if c is not _SMASK)
    return op


def trace_page(page: pymupdf.Page, bboxlog: list) -> list[PaintOp] | None:
    """Paint operators for ``page`` indexed by seqno, or None if unavailable."""
    try:
        ops = parse_trace(_trace_text(page))
    except Exception as exc:  # low-level bindings changed or missing
        log.warning("trace device unavailable (%s); clip paths will be ignored", exc)
        return None
    if len(ops) != len(bboxlog) or any(op.kind != entry[0] for op, entry in zip(ops, bboxlog)):
        log.warning(
            "page %d: trace (%d ops) does not line up with bbox log (%d); ignoring clip paths",
            page.number + 1, len(ops), len(bboxlog),
        )
        return None
    return ops


@dataclass
class ClipResult:
    hidden: bool = False                       # entirely clipped away
    paths: list[tuple[list[Segment], bool]] = field(default_factory=list)  # (page-space segments, even_odd)


def effective_clips(op: PaintOp | None, bbox: tuple[float, float, float, float], tol: float = 0.5) -> ClipResult:
    """Reduce the clip stack to the clips that actually cut ``bbox``."""
    result = ClipResult()
    if op is None or not op.clips:
        return result
    x0, y0, x1, y1 = bbox
    rect: list[float] | None = None
    for clip in op.clips:
        if clip.rect is not None:
            r = clip.rect
            rect = list(r) if rect is None else [max(rect[0], r[0]), max(rect[1], r[1]), min(rect[2], r[2]), min(rect[3], r[3])]
        else:
            cb = clip.bbox
            if cb[2] <= x0 + tol or cb[0] >= x1 - tol or cb[3] <= y0 + tol or cb[1] >= y1 - tol:
                result.hidden = x1 - x0 > 2 * tol and y1 - y0 > 2 * tol
                if result.hidden:
                    return result
            result.paths.append((clip.segments, clip.even_odd))
    if rect is not None:
        if rect[2] <= rect[0] or rect[3] <= rect[1] or (
            (rect[2] <= x0 + tol or rect[0] >= x1 - tol or rect[3] <= y0 + tol or rect[1] >= y1 - tol)
            and x1 - x0 > 2 * tol and y1 - y0 > 2 * tol
        ):
            result.hidden = True
            return result
        cuts = rect[0] > x0 + tol or rect[1] > y0 + tol or rect[2] < x1 - tol or rect[3] < y1 - tol
        if cuts:
            rx0, ry0, rx1, ry1 = rect
            segs: list[Segment] = [("M", rx0, ry0), ("L", rx1, ry0), ("L", rx1, ry1), ("L", rx0, ry1), ("Z",)]
            result.paths.insert(0, (segs, False))
    return result
