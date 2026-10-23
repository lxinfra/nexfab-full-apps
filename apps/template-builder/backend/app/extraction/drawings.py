"""Vector graphics: rectangles, lines and arbitrary paths as shape elements."""
from __future__ import annotations

import io
import re

import pymupdf
from PIL import Image

from ..geometry import (
    Segment, axis_aligned_rect, decompose_matrix, hex_to_rgb, r3, rgb_to_hex, segments_bbox, segments_to_d,
)
from .context import SOFT_MASK_WARNING, ExtractionContext, attach_clip
from .trace import PaintOp, effective_clips

_DASH = re.compile(r"\[([^\]]*)\]\s*([-\d.]+)?")


def _segments(items: list, close: bool) -> list[Segment]:
    """PyMuPDF drawing items -> absolute M/L/C/Z segments in page space."""
    segs: list[Segment] = []
    cur: tuple[float, float] | None = None

    def move_to(p) -> None:
        nonlocal cur
        if cur is None or abs(cur[0] - p.x) > 1e-4 or abs(cur[1] - p.y) > 1e-4:
            segs.append(("M", p.x, p.y))
        cur = (p.x, p.y)

    for item in items:
        kind = item[0]
        if kind == "l":
            move_to(item[1])
            segs.append(("L", item[2].x, item[2].y))
            cur = (item[2].x, item[2].y)
        elif kind == "c":
            move_to(item[1])
            segs.append(("C", item[2].x, item[2].y, item[3].x, item[3].y, item[4].x, item[4].y))
            cur = (item[4].x, item[4].y)
        elif kind == "re":
            r = item[1]
            pts = [(r.x0, r.y0), (r.x1, r.y0), (r.x1, r.y1), (r.x0, r.y1)]
            if len(item) > 2 and item[2] < 0:  # winding direction matters for nested fills
                pts = [pts[0], pts[3], pts[2], pts[1]]
            segs.append(("M", *pts[0]))
            segs.extend(("L", *p) for p in pts[1:])
            segs.append(("Z",))
            cur = None
        elif kind == "qu":
            q = item[1]
            segs.append(("M", q.ul.x, q.ul.y))
            segs.extend(("L", p.x, p.y) for p in (q.ur, q.lr, q.ll))
            segs.append(("Z",))
            cur = None
    if close and segs and segs[-1][0] != "Z":
        segs.append(("Z",))
    return segs


def _dash(spec: str | None) -> list[float] | None:
    m = _DASH.match(spec or "")
    if not m:
        return None
    values = [float(v) for v in m.group(1).split()]
    return values if any(v > 0 for v in values) else None


def _masked_fill(ctx: ExtractionContext, page_no: int, op: PaintOp, seq: int, fill: str | None,
                 opacity: float, segs: list[Segment], bbox: tuple[float, float, float, float]) -> dict | None:
    """Turn `solid fill through an image soft mask` into an RGBA image element."""
    if fill is None or len(op.soft_masks) != 1:
        return None
    mask = op.soft_masks[0]
    if not mask.luminosity or len(mask.ops) != 1 or mask.ops[0] not in ctx.mask_images:
        return None
    pixels, matrix = ctx.mask_images[mask.ops[0]]
    alpha = pixels if opacity >= 1 else pixels.point(lambda v: round(v * opacity))
    rgb = tuple(round(c * 255) for c in (hex_to_rgb(fill) or (0, 0, 0)))
    image = Image.new("RGBA", pixels.size, rgb + (0,))
    image.putalpha(alpha)
    buf = io.BytesIO()
    image.save(buf, "PNG")
    box = decompose_matrix(matrix)
    el = {
        "type": "image",
        "src": ctx.save(buf.getvalue(), "images", f"p{page_no}_mask{seq}.png"),
        **{k: (v if isinstance(v, bool) else r3(v)) for k, v in box.items()},
        "opacity": 1.0, "fit": "stretch",
        "naturalWidth": image.width, "naturalHeight": image.height,
        "_seq": seq,
    }
    # The fill only shows inside its own outline and the ordinary clips.
    x0, y0 = box["x"], box["y"]
    x1, y1 = x0 + box["width"], y0 + box["height"]
    clips = effective_clips(op, (x0, y0, x1, y1))
    if clips.hidden:
        return None
    if bbox[0] > x0 + 0.5 or bbox[1] > y0 + 0.5 or bbox[2] < x1 - 0.5 or bbox[3] < y1 - 0.5:
        clips.paths.append((segs, False))
    attach_clip(el, clips)
    return el


def extract_shapes(page: pymupdf.Page, page_no: int, ctx: ExtractionContext,
                   ops: list[PaintOp] | None) -> list[dict]:
    elements: list[dict] = []
    for path in page.get_drawings():
        seq = path.get("seqno", 0)
        op = ops[seq] if ops is not None and 0 <= seq < len(ops) else None
        if op is not None and op.in_mask:
            continue  # paints a soft mask, not the page

        kind = path.get("type", "")
        fill = rgb_to_hex(path.get("fill")) if "f" in kind else None
        stroke = rgb_to_hex(path.get("color")) if "s" in kind else None
        fill_opacity = path.get("fill_opacity")
        stroke_opacity = path.get("stroke_opacity")
        fill_opacity = 1.0 if fill_opacity is None else fill_opacity
        stroke_opacity = 1.0 if stroke_opacity is None else stroke_opacity
        if fill is not None and fill_opacity <= 0:
            fill = None
        if stroke is not None and stroke_opacity <= 0:
            stroke = None
        if fill is None and stroke is None:
            continue

        segs = _segments(path.get("items") or [], bool(path.get("closePath")))
        bbox = segments_bbox(segs)
        if bbox is None:
            continue
        x0, y0, x1, y1 = bbox
        width, height = x1 - x0, y1 - y0
        if stroke is None and (width <= 0 or height <= 0):
            continue  # a fill with no area paints nothing

        if op is not None and op.soft_masks:
            # A fill seen through a soft mask (how Chromium draws shadows). When the
            # mask is a single image this is exactly a tinted, transparent picture.
            masked = _masked_fill(ctx, page_no, op, seq, fill, fill_opacity, segs, bbox)
            if masked is not None:
                elements.append(masked)
            else:  # dropped: drawing it unmasked would paint a solid block
                ctx.warn("soft_mask", SOFT_MASK_WARNING.format(page=page_no), page_no)
            continue

        stroke_width = float(path.get("width") or 0) if stroke is not None else 0.0
        el: dict = {"type": "shape"}
        rect = axis_aligned_rect(segs, closed_only=stroke is not None)
        drawn = [s for s in segs if s[0] != "M"]
        if rect is not None:
            el.update(shape="rect", x=r3(rect[0]), y=r3(rect[1]),
                      width=r3(rect[2] - rect[0]), height=r3(rect[3] - rect[1]))
        elif len(drawn) == 1 and drawn[0][0] == "L" and stroke is not None and fill is None:
            (_, sx, sy), (_, ex, ey) = segs[0], segs[1]
            el.update(shape="line", x1=r3(sx), y1=r3(sy), x2=r3(ex), y2=r3(ey),
                      x=r3(x0), y=r3(y0), width=r3(width), height=r3(height))
        else:
            local = [s if s[0] == "Z" else (s[0], *(v - (x0 if i % 2 == 0 else y0) for i, v in enumerate(s[1:])))
                     for s in segs]
            el.update(shape="path", d=segments_to_d(local), x=r3(x0), y=r3(y0),
                      width=r3(width), height=r3(height), refWidth=r3(width), refHeight=r3(height),
                      fillRule="evenodd" if path.get("even_odd") else "nonzero")
        el.update(rotation=0.0, fill=fill, stroke=stroke, strokeWidth=r3(stroke_width),
                  fillOpacity=r3(fill_opacity) if fill is not None else 1.0,
                  strokeOpacity=r3(stroke_opacity) if stroke is not None else 1.0)
        if stroke is not None:
            dash = _dash(path.get("dashes"))
            if dash:
                el["dash"] = [r3(v) for v in dash]
            cap = path.get("lineCap")
            cap = cap[0] if isinstance(cap, (tuple, list)) and cap else cap
            if cap:
                el["lineCap"] = {1: "round", 2: "square"}.get(int(cap), "butt")
            join = path.get("lineJoin")
            if join:
                el["lineJoin"] = {1: "round", 2: "bevel"}.get(int(join), "miter")
        el["_seq"] = seq

        pad = stroke_width / 2
        clips = effective_clips(op, (x0 - pad, y0 - pad, x1 + pad, y1 + pad))
        if clips.hidden:
            continue
        attach_clip(el, clips)
        if op is not None and op.unsupported_clip:
            ctx.warn("soft_mask", SOFT_MASK_WARNING.format(page=page_no), page_no)
        elements.append(el)
    return elements
