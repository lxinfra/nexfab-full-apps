"""Text: spans grouped into editable fields that keep their exact placement.

Each text element is one line, or a paragraph of evenly spaced lines in a single
style. Besides the box-model fields it carries ``layout``: where every line and
word sat in the original. Export uses it to put unchanged text back exactly
(even when justified, tracked, or set in a substitute font), while edited lines
reflow naturally from the same slot.
"""
from __future__ import annotations

import math
from bisect import bisect_right
from dataclasses import dataclass, field, replace

import pymupdf

from ..fontmap import map_font
from ..geometry import int_to_hex, r3
from .context import ExtractionContext, FontUse, Options
from .tables import Seg, Table, cell_lookup, detect_tables, refine_alignment

_FLAGS = pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_IMAGES
_STYLE_BITS = 0b11110            # italic, serif, monospace, bold (superscript bit ignored)
_TOP = 10 ** 9                   # paint order for text we could not place in the sequence

SPLIT_GAP_EM = 1.5               # a gap this wide between words starts a new field
MAX_LEADING_EM = 1.6             # lines further apart than this are separate fields
MIN_LEADING_EM = 0.7
KERN_TOLERANCE = 0.04            # pt a glyph may stray from natural spacing before we record positions


@dataclass
class Run:
    """A stretch of same-styled text on one baseline, in the line's own frame:
    ``u`` runs along the text direction, ``v`` across it (down for upright text)."""
    # (text, u_start, u_end, glyph starts if the word is kerned/tracked else None,
    #  number of space characters before the word)
    words: list[tuple[str, float, float, list[float] | None, int]]
    font: str
    size: float
    color: int
    flags: int
    alpha: float
    direction: tuple[float, float]
    v: float                                   # baseline
    ascent: float                              # pt above the baseline
    descent: float                             # pt below the baseline
    span_style: tuple = ()                     # style of the source span, for run splitting
    seq: int = _TOP
    visible: bool = True
    opacity: float = 1.0
    use: FontUse | None = field(default=None, repr=False)
    cell: tuple | None = None                  # (table, row, column) when the run sits in a table cell

    @property
    def upright(self) -> bool:
        return abs(self.direction[0] - 1) < 1e-6 and abs(self.direction[1]) < 1e-6

    @property
    def text(self) -> str:
        return "".join(" " * max(1, w[4]) * (i > 0) + w[0] for i, w in enumerate(self.words))

    @property
    def u0(self) -> float:
        return self.words[0][1]

    @property
    def u1(self) -> float:
        return self.words[-1][2]

    @property
    def style(self) -> tuple:
        return (self.font, round(self.size, 2), self.color, self.flags & _STYLE_BITS,
                round(self.alpha, 2), self.visible)


def _trace_lookup(page: pymupdf.Page, ctx: ExtractionContext, page_fonts: dict[str, FontUse]) -> dict:
    """Glyph origin -> (seqno, render type, opacity); also records glyph ids per font."""
    lookup: dict[tuple[float, float], tuple[int, int, float]] = {}
    for span in page.get_texttrace():
        info = (span["seqno"], span.get("type", 0), span.get("opacity", 1.0))
        use = ctx.font_use(page_fonts, span["font"], span.get("flags", 0))
        gids = use.gids
        for uni, gid, origin, _bbox in span["chars"]:
            lookup[(round(origin[0], 1), round(origin[1], 1))] = info
            if gid > 0 and 32 < uni != 0xFFFD:
                gids.setdefault(uni, gid)
    return lookup


def _find(lookup: dict, origin: tuple[float, float]):
    x, y = round(origin[0], 1), round(origin[1], 1)
    for dx in (0.0, -0.1, 0.1):
        for dy in (0.0, -0.1, 0.1):
            hit = lookup.get((round(x + dx, 1), round(y + dy, 1)))
            if hit is not None:
                return hit
    return None


def _line_runs(line: dict, lookup: dict, ctx: ExtractionContext, page_fonts: dict[str, FontUse]) -> list[Run]:
    dx, dy = line["dir"]
    norm = math.hypot(dx, dy) or 1.0
    dx, dy = dx / norm, dy / norm
    upright = abs(dx - 1) < 1e-6 and abs(dy) < 1e-6
    nx, ny = -dy, dx

    runs: list[Run] = []
    cur: Run | None = None
    # [chars, u_start, u_end, glyph starts, kerned, where the next glyph would
    #  start if the word were set at the font's own advances] for the word being built
    word: list | None = None
    last_u1 = 0.0
    space_pending = 0                 # space characters seen since the last glyph

    def close_word() -> None:
        nonlocal word
        if cur is not None and word is not None:
            cur.words.append(("".join(word[0]), word[1], word[2], word[3] if word[4] else None, word[6]))
        word = None

    def close_run() -> None:
        nonlocal cur
        close_word()
        if cur is not None and cur.words:
            runs.append(cur)
        cur = None

    for span in line["spans"]:
        size = span["size"]
        if size <= 0:
            continue
        style = (span["font"], round(size, 2), span["color"], span["flags"] & _STYLE_BITS, span.get("alpha", 255))
        for ch in span["chars"]:
            c = ch["c"]
            ox, oy = ch["origin"]
            if c.isspace() or c == "\u00a0":
                if cur is not None:
                    space_pending += 1
                continue
            if upright:
                u0, u1, v = ox, ch["bbox"][2], oy
            else:
                u0, v = ox * dx + oy * dy, ox * nx + oy * ny
                quad = pymupdf.recover_char_quad(line["dir"], span, ch)
                u1 = max(p.x * dx + p.y * dy for p in (quad.ul, quad.ur, quad.ll, quad.lr))

            if cur is not None:
                gap = u0 - last_u1
                same = style == cur.span_style and abs(v - cur.v) <= 0.02 * size + 0.05
                if not same or gap < -0.6 * size:
                    close_run()
                elif space_pending:
                    if gap > SPLIT_GAP_EM * size:
                        close_run()
                    else:
                        close_word()
                elif gap > 0.5 * size:
                    close_run()

            if cur is None:
                hit = _find(lookup, (ox, oy))
                cur = Run(
                    words=[], font=span["font"], size=size, color=span["color"], flags=span["flags"],
                    alpha=span.get("alpha", 255) / 255, direction=(dx, dy), v=v,
                    ascent=span["ascender"] * size, descent=-span["descender"] * size,
                    span_style=style, use=ctx.font_use(page_fonts, span["font"], span["flags"]),
                )
                if hit is not None:
                    cur.seq, render_type, cur.opacity = hit[0], hit[1], hit[2]
                    cur.visible = render_type != 3
            if word is None:
                word = [[c], u0, u1, [u0], False, u1, space_pending]
            else:
                # Compare against the running prediction rather than the previous
                # glyph: kerning and letter-spacing show up either way, and so
                # does the slow drift of PDFs that round their glyph widths.
                if abs(u0 - word[5]) > KERN_TOLERANCE:
                    word[4] = True
                word[0].append(c)
                word[2] = max(word[2], u1)
                word[3].append(u0)
                word[5] += u1 - u0
            last_u1 = u1
            space_pending = 0
    close_run()
    return runs


def _can_append(par: list[Run], run: Run) -> bool:
    last = par[-1]
    if run.cell != last.cell:
        return False   # never merge across table cells (or into / out of a table)
    if run.style != last.style or run.use is not last.use:
        return False
    if abs(run.direction[0] - last.direction[0]) > 1e-3 or abs(run.direction[1] - last.direction[1]) > 1e-3:
        return False
    size = run.size
    lead = run.v - last.v
    if not MIN_LEADING_EM * size <= lead <= MAX_LEADING_EM * size:
        return False
    if len(par) >= 2 and abs(lead - (par[-1].v - par[-2].v)) > max(0.3, 0.03 * size):
        return False
    if min(run.u1, last.u1) - max(run.u0, last.u0) <= 0:
        return False
    tol = max(1.0, 0.15 * size)
    return (abs(run.u0 - last.u0) <= tol or abs(run.u1 - last.u1) <= tol
            or abs((run.u0 + run.u1) - (last.u0 + last.u1)) / 2 <= tol)


def _paragraph_align(par: list[Run]) -> str:
    if len(par) < 2:
        return "left"
    tol = max(1.0, 0.1 * par[0].size)
    lefts = [r.u0 for r in par]
    rights = [r.u1 for r in par]
    centers = [(r.u0 + r.u1) / 2 for r in par]

    def spread(vals: list[float]) -> float:
        return max(vals) - min(vals)

    if spread(lefts) <= tol:
        if len(par) >= 3 and spread(rights[:-1]) <= tol and rights[-1] <= max(rights[:-1]) + tol:
            return "justify"
        return "left"
    if spread(rights) <= tol:
        return "right"
    if spread(centers) <= tol:
        return "center"
    return "left"


def _element(par: list[Run], ctx: ExtractionContext) -> dict:
    first = par[0]
    dx, dy = first.direction
    nx, ny = -dy, dx
    u_min = min(r.u0 for r in par)
    u_max = max(r.u1 for r in par)
    v_top = first.v - first.ascent
    v_bot = par[-1].v + par[-1].descent
    width, height = u_max - u_min, v_bot - v_top
    uc, vc = (u_min + u_max) / 2, (v_top + v_bot) / 2
    cx, cy = uc * dx + vc * nx, uc * dy + vc * ny
    rotation = math.degrees(math.atan2(dy, dx))

    info = map_font(first.font, first.flags)
    use = first.use
    content = "\n".join(r.text for r in par)
    if use is not None and first.visible:
        use.chars.update(ord(c) for c in content if not c.isspace())

    lines = []
    for r in par:
        entry: dict = {"text": r.text, "x": r3(r.u0 - u_min), "y": r3(r.v - v_top), "width": r3(r.u1 - r.u0)}
        if len(r.words) > 1 or r.words[0][3]:
            # per word: [offset in line, width] plus, for kerned words, the offset
            # of each glyph after the first
            entry["words"] = [
                [r3(w[1] - r.u0), r3(w[2] - w[1])] + ([[round(g - w[1], 2) for g in w[3][1:]]] if w[3] else [])
                for w in r.words
            ]
        lines.append(entry)

    if len(par) >= 2:
        line_height = (par[-1].v - par[0].v) / (len(par) - 1) / first.size
    else:
        line_height = min(1.5, max(1.0, (first.ascent + first.descent) / first.size))

    el = {
        "type": "text",
        "content": content,
        "x": r3(cx - width / 2), "y": r3(cy - height / 2),
        "width": r3(width), "height": r3(height),
        "rotation": r3(rotation) if abs(rotation) > 1e-6 else 0.0,
        "fontFamily": info.family,
        "fontName": info.name,
        "fontId": use.id if use is not None else None,
        "fontSize": r3(first.size),
        "fontWeight": info.css_weight,
        "fontStyle": "italic" if info.italic else "normal",
        "color": int_to_hex(first.color),
        "opacity": r3(min(first.alpha, first.opacity)),
        "align": _paragraph_align(par),
        "lineHeight": r3(line_height),
        "baseline": r3(first.ascent),
        "editable": True,
        "fieldName": ctx.field_name(content),
        "isVariable": False,
        "layout": {"fontSize": r3(first.size), "lines": lines},
        "_seq": min(r.seq for r in par),
    }
    if not first.visible:
        # Invisible text (render mode 3) is almost always the OCR layer of a scan.
        el["visible"] = False
        el["ocr"] = True
    return el


def _infer_single_line_alignment(elements: list[dict], page_width: float) -> None:
    """Guess centre/right alignment for one-line fields so edited text grows the right way."""
    upright = [e for e in elements if not e["rotation"] and e.get("visible", True)]
    lefts = [e["x"] for e in upright]
    rights = [e["x"] + e["width"] for e in upright]
    for e in upright:
        if len(e["layout"]["lines"]) != 1:
            continue
        left, right = e["x"], e["x"] + e["width"]
        # How many other fields start / end at the same x: a column of numbers
        # shares its right edge, a column of labels its left edge.
        shared_left = sum(1 for v in lefts if abs(v - left) <= 0.6) - 1
        shared_right = sum(1 for v in rights if abs(v - right) <= 0.6) - 1
        if shared_right > shared_left:
            e["align"] = "right"
        elif shared_left == 0 and abs((left + right) / 2 - page_width / 2) <= 1.0 and e["width"] < 0.9 * page_width:
            e["align"] = "center"


def _collect_runs(page: pymupdf.Page, ctx: ExtractionContext, page_fonts: dict[str, FontUse],
                  lookup: dict) -> list[list[Run]]:
    """The runs of every text line, in reading order."""
    raw = page.get_text("rawdict", flags=_FLAGS)
    return [_line_runs(line, lookup, ctx, page_fonts)
            for block in raw["blocks"] if block.get("type") == 0 for line in block["lines"]]


def _split_at(run: Run, edges: list[float]) -> list[Run]:
    """Split a run where it crosses a column edge of a ruled table."""
    groups: list[tuple[int, list]] = []
    for word in run.words:
        column = bisect_right(edges, word[1] + 0.5)
        if groups and groups[-1][0] == column:
            groups[-1][1].append(word)
        else:
            groups.append((column, [word]))
    return [run] if len(groups) == 1 else [replace(run, words=words) for _column, words in groups]


def _find_tables(page: pymupdf.Page, lines: list[list[Run]]) -> list[Table]:
    """Detect tables and tag each run with the cell it sits in (``lines`` is updated in place)."""
    segs = [Seg(r.u0, r.u1, r.v, r.v - r.ascent, r.v + r.descent, r.size, r.style, r.text)
            for line in lines for r in line if r.upright and r.visible]
    tables = detect_tables(page, segs)
    if not tables:
        return tables
    lookup = cell_lookup(tables)
    for line in lines:
        for table in tables:
            if table.source != "ruled":
                continue
            # neighbouring cells with little space between them come out as one run
            line[:] = [part for run in line
                       for part in (_split_at(run, table.columns)
                                    if run.upright and table.rows[0] <= run.v <= table.rows[-1] else [run])]
        for run in line:
            if run.upright:
                run.cell = lookup(run.u0 + min(1.0, (run.u1 - run.u0) / 2), run.v - run.ascent / 2)
    return tables


def detect_page_tables(page: pymupdf.Page) -> list[Table]:
    """Tables on a page, without extracting anything else (for templates
    imported before table detection existed)."""
    ctx = ExtractionContext(page.parent, "", None, Options())  # type: ignore[arg-type]
    return _find_tables(page, _collect_runs(page, ctx, ctx.page_fonts(page), {}))


def extract_text(page: pymupdf.Page, page_no: int, ctx: ExtractionContext,
                 page_fonts: dict[str, FontUse]) -> tuple[list[dict], list[Table]]:
    """Text elements and the tables found among them."""
    lookup = _trace_lookup(page, ctx, page_fonts)
    lines = _collect_runs(page, ctx, page_fonts, lookup)
    tables = _find_tables(page, lines)
    # Lines are merged into a paragraph when they follow each other in reading
    # order and _can_append agrees. MuPDF's own blocks are not relied on: some
    # producers (Chromium) emit every line as a separate block.
    paragraphs: list[list[Run]] = []
    cur: list[Run] | None = None
    for runs in lines:
        if len(runs) == 1 and ctx.options.merge_paragraphs:
            if cur is not None and _can_append(cur, runs[0]):
                cur.append(runs[0])
            else:
                cur = [runs[0]]
                paragraphs.append(cur)
        elif runs:
            cur = None
            paragraphs.extend([r] for r in runs)
    elements = [_element(par, ctx) for par in paragraphs]

    _infer_single_line_alignment(elements, page.rect.width)
    refine_alignment(elements, tables)
    return elements, tables
