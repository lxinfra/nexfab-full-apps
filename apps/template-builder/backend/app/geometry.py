"""Shared geometry: the element box model, colours and path strings.

Element box model (used by extraction, the editor and export alike):
``x, y, width, height`` describe the element's *unrotated* box in PDF points with
the origin at the page's top-left. ``rotation`` is in degrees, clockwise, about
the box centre. Images may additionally carry ``flipX``/``flipY``/``skewX``.

Matrices are 6-tuples ``(a, b, c, d, e, f)`` in PyMuPDF's row-vector convention:
``x' = a*x + c*y + e`` and ``y' = b*x + d*y + f``.
"""
from __future__ import annotations

import math
import re
from typing import Iterable, Sequence

Matrix = tuple[float, float, float, float, float, float]
# Path segments in absolute coordinates: ("M", x, y) | ("L", x, y) |
# ("C", x1, y1, x2, y2, x3, y3) | ("Z",)
Segment = tuple

IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


def r3(v: float) -> float:
    """Round for JSON output (1/1000 pt is far below anything visible)."""
    out = round(float(v), 3)
    return 0.0 if out == 0 else out


def fmt(v: float) -> str:
    s = f"{v:.3f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def rgb_to_hex(rgb: Sequence[float] | None) -> str | None:
    if rgb is None:
        return None
    if len(rgb) == 1:  # gray
        rgb = (rgb[0],) * 3
    elif len(rgb) == 4:  # cmyk
        c, m, y, k = rgb
        rgb = ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02x}" for c in rgb[:3])


def int_to_hex(color: int) -> str:
    return f"#{color & 0xFFFFFF:06x}"


def hex_to_rgb(color: str | None) -> tuple[float, float, float] | None:
    if not color or color in ("none", "transparent"):
        return None
    c = color.lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    try:
        return tuple(int(c[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError:
        return None


def apply(m: Matrix, x: float, y: float) -> tuple[float, float]:
    return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def concat(m1: Matrix, m2: Matrix) -> Matrix:
    """Matrix that applies ``m1`` first, then ``m2``."""
    a1, b1, c1, d1, e1, f1 = m1
    a2, b2, c2, d2, e2, f2 = m2
    return (
        a1 * a2 + b1 * c2, a1 * b2 + b1 * d2,
        c1 * a2 + d1 * c2, c1 * b2 + d1 * d2,
        e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2,
    )


def invert(m: Matrix) -> Matrix | None:
    a, b, c, d, e, f = m
    det = a * d - b * c
    if abs(det) < 1e-12:
        return None
    return (d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det)


def decompose_matrix(m: Matrix) -> dict:
    """Split a unit-square placement matrix into box-model fields.

    ``m`` maps the unit square (origin top-left, y down) onto the page, which is
    what PyMuPDF reports as an image's ``transform``.
    """
    a, b, c, d, e, f = m
    sx = math.hypot(a, b)
    if sx < 1e-9:
        return {"x": e, "y": f, "width": 0.0, "height": math.hypot(c, d), "rotation": 0.0}
    cos, sin = a / sx, b / sx
    shear = c * cos + d * sin        # v-axis component along the rotated x-axis
    sy = -c * sin + d * cos          # v-axis component along the rotated y-axis (signed)
    rotation = math.degrees(math.atan2(b, a))
    flip_x, flip_y = False, sy < 0
    if flip_y and abs(rotation) > 90:
        # A vertical flip plus a half turn is just a horizontal flip.
        rotation += -180 if rotation > 0 else 180
        flip_x, flip_y = True, False
    width, height = sx, abs(sy)
    cx, cy = apply(m, 0.5, 0.5)
    out = {
        "x": cx - width / 2, "y": cy - height / 2,
        "width": width, "height": height,
        "rotation": 0.0 if abs(rotation) < 1e-6 else rotation,
    }
    if flip_x:
        out["flipX"] = True
    if flip_y:
        out["flipY"] = True
    if sy and abs(shear / sy) > 1e-4:
        out["skewX"] = math.degrees(math.atan(shear / sy))
    return out


def local_to_page_matrix(el: dict, flips: bool = True) -> Matrix:
    """Matrix mapping box-local points (origin at the box's top-left, in pt) to the page."""
    w, h = float(el.get("width") or 0), float(el.get("height") or 0)
    cx, cy = float(el.get("x") or 0) + w / 2, float(el.get("y") or 0) + h / 2
    m: Matrix = (1, 0, 0, 1, -w / 2, -h / 2)
    if flips:
        fx = -1.0 if el.get("flipX") else 1.0
        fy = -1.0 if el.get("flipY") else 1.0
        if fx != 1 or fy != 1:
            m = concat(m, (fx, 0, 0, fy, 0, 0))
        skew = el.get("skewX")
        if skew:
            m = concat(m, (1, 0, math.tan(math.radians(skew)), 1, 0, 0))
    rot = float(el.get("rotation") or 0)
    if rot:
        cos, sin = math.cos(math.radians(rot)), math.sin(math.radians(rot))
        m = concat(m, (cos, sin, -sin, cos, 0, 0))
    return concat(m, (1, 0, 0, 1, cx, cy))


def unit_to_page_matrix(el: dict) -> Matrix:
    """Inverse of ``decompose_matrix``: unit square -> page for an element's box."""
    w, h = float(el.get("width") or 0), float(el.get("height") or 0)
    return concat((w, 0, 0, h, 0, 0), local_to_page_matrix(el))


def transform_segments(segs: Iterable[Segment], m: Matrix) -> list[Segment]:
    out: list[Segment] = []
    for s in segs:
        if s[0] == "Z":
            out.append(s)
        else:
            pts: list[float] = []
            for i in range(1, len(s), 2):
                pts.extend(apply(m, s[i], s[i + 1]))
            out.append((s[0], *pts))
    return out


def segments_bbox(segs: Iterable[Segment]) -> tuple[float, float, float, float] | None:
    xs: list[float] = []
    ys: list[float] = []
    for s in segs:
        xs.extend(s[1::2])
        ys.extend(s[2::2])
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


def segments_to_d(segs: Iterable[Segment]) -> str:
    return " ".join(s[0] if s[0] == "Z" else s[0] + " " + " ".join(fmt(v) for v in s[1:]) for s in segs)


_TOKEN = re.compile(r"[MLCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?")


def d_to_segments(d: str) -> list[Segment]:
    """Parse the subset of SVG path syntax we emit: absolute M, L, C and Z."""
    arity = {"M": 2, "L": 2, "C": 6, "Z": 0}
    segs: list[Segment] = []
    tokens = _TOKEN.findall(d or "")
    i, cmd = 0, None
    while i < len(tokens):
        if tokens[i] in arity:
            cmd = tokens[i]
            i += 1
            if cmd == "Z":
                segs.append(("Z",))
                continue
        if cmd is None or cmd == "Z":
            i += 1
            continue
        n = arity[cmd]
        if i + n > len(tokens):
            break
        segs.append((cmd, *(float(t) for t in tokens[i:i + n])))
        i += n
        if cmd == "M":  # further pairs after a moveto are linetos
            cmd = "L"
    return segs


def axis_aligned_rect(segs: Sequence[Segment], tol: float = 0.01,
                      closed_only: bool = False) -> tuple[float, float, float, float] | None:
    """Return (x0, y0, x1, y1) if the segments trace a single axis-aligned rectangle.

    With ``closed_only`` the outline must return to its start (needed for strokes,
    where an open three-sided path is not a rectangle).
    """
    pts = [(s[1], s[2]) for s in segs if s[0] in ("M", "L")]
    if any(s[0] == "C" for s in segs) or sum(1 for s in segs if s[0] == "M") != 1:
        return None
    closed = any(s[0] == "Z" for s in segs)
    if len(pts) == 5 and abs(pts[0][0] - pts[4][0]) <= tol and abs(pts[0][1] - pts[4][1]) <= tol:
        pts = pts[:4]
        closed = True
    if len(pts) != 4 or (closed_only and not closed):
        return None
    xs = sorted({round(p[0] / tol) for p in pts})
    ys = sorted({round(p[1] / tol) for p in pts})
    if len(xs) != 2 or len(ys) != 2:
        return None
    # consecutive corners must differ in exactly one coordinate
    for i in range(4):
        p, q = pts[i], pts[(i + 1) % 4]
        if (abs(p[0] - q[0]) > tol) == (abs(p[1] - q[1]) > tol):
            return None
    return (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
