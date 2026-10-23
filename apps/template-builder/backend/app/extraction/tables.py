"""Table detection.

Two kinds of table are recognised:

* **ruled** tables, whose cells are boxed in by lines: found by PyMuPDF's
  ``find_tables`` and kept when most of their cells actually contain text;
* **aligned** tables, which have at most horizontal rules: found here from
  text that lines up on shared baselines and in shared columns.

Aligned text is not always a table (think of two columns of prose), so an
aligned candidate must also show evidence of being one: a rule between its
rows, or a column of numbers / right-aligned values.

The result is a plain grid per table (column and row edges). The editor maps
text elements to cells by position, so the grid stays valid as text is edited.
"""
from __future__ import annotations

import contextlib
import io
import logging
import re
import statistics
from bisect import bisect_right
from dataclasses import dataclass, field

import pymupdf

log = logging.getLogger(__name__)

BASELINE_TOL = 0.75          # pt: cells of one row share a baseline
ALIGN_TOL = 1.5              # pt: edges that count as aligned
MAX_ROW_GAP_EM = 3.5         # rows further apart than this (in font sizes) are not one table
_NUMERIC = re.compile(r"^[\s$£€¥₹+\-−(]*\d[\d\s.,:/\-]*\)?\s*(%|[A-Za-z]{1,3})?$")


@dataclass
class Seg:
    """A piece of text on one baseline (one prospective cell line)."""
    x0: float
    x1: float
    baseline: float
    top: float
    bottom: float
    size: float
    style: tuple
    text: str


@dataclass
class Table:
    columns: list[float]       # x edges, one more than the number of columns
    rows: list[float]          # y edges, one more than the number of rows
    header_rows: int = 0
    source: str = "ruled"

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (self.columns[0], self.rows[0], self.columns[-1], self.rows[-1])

    def cell_of(self, x: float, y: float) -> tuple[int, int] | None:
        """(row, column) of the cell containing a point, if any."""
        if not (self.columns[0] <= x <= self.columns[-1] and self.rows[0] <= y <= self.rows[-1]):
            return None
        col = min(len(self.columns) - 2, max(0, bisect_right(self.columns, x) - 1))
        row = min(len(self.rows) - 2, max(0, bisect_right(self.rows, y) - 1))
        return row, col

    def to_json(self, table_id: str) -> dict:
        x0, y0, x1, y1 = self.bbox
        return {
            "id": table_id,
            "x": round(x0, 3), "y": round(y0, 3), "width": round(x1 - x0, 3), "height": round(y1 - y0, 3),
            "columns": [round(v, 3) for v in self.columns],
            "rows": [round(v, 3) for v in self.rows],
            "headerRows": self.header_rows,
            "source": self.source,
        }


def cell_lookup(tables: list[Table]):
    """Function mapping a point to (table index, row, column), or None outside every table."""
    def lookup(x: float, y: float) -> tuple[int, int, int] | None:
        for index, table in enumerate(tables):
            cell = table.cell_of(x, y)
            if cell is not None:
                return (index, *cell)
        return None
    return lookup


def _is_numeric(text: str) -> bool:
    compact = text.replace(" ", "")
    if not compact or not _NUMERIC.match(text):
        return False
    return sum(ch.isdigit() for ch in compact) * 2 >= len(compact)


def _spread(values: list[float]) -> float:
    return max(values) - min(values) if values else 0.0


def _cluster(values: list[float], tol: float) -> list[float]:
    """Merge values closer than ``tol`` and return the sorted cluster means."""
    out: list[list[float]] = []
    for v in sorted(values):
        if out and v - out[-1][-1] <= tol:
            out[-1].append(v)
        else:
            out.append([v])
    return [sum(c) / len(c) for c in out]


# ---------------------------------------------------------------- rules
def _rules(page: pymupdf.Page) -> tuple[list[tuple[float, float, float]], list[tuple[float, float, float]]]:
    """Horizontal rules as (x0, x1, y) and vertical rules as (y0, y1, x).

    The edges of filled or stroked rectangles count too: that is how header
    bands, row stripes and table frames are drawn.
    """
    horizontal: list[tuple[float, float, float]] = []
    vertical: list[tuple[float, float, float]] = []

    def add_rect(x0: float, y0: float, x1: float, y1: float) -> None:
        w, h = x1 - x0, y1 - y0
        if h <= 2.5 and w > 4:
            horizontal.append((x0, x1, (y0 + y1) / 2))
        elif w <= 2.5 and h > 4:
            vertical.append((y0, y1, (x0 + x1) / 2))
        elif w > 4 and h > 4:
            horizontal.extend([(x0, x1, y0), (x0, x1, y1)])
            vertical.extend([(y0, y1, x0), (y0, y1, x1)])

    for drawing in page.get_drawings():
        for item in drawing.get("items") or []:
            kind = item[0]
            if kind == "l":
                p, q = item[1], item[2]
                if abs(p.y - q.y) <= 0.5 and abs(p.x - q.x) > 4:
                    horizontal.append((min(p.x, q.x), max(p.x, q.x), (p.y + q.y) / 2))
                elif abs(p.x - q.x) <= 0.5 and abs(p.y - q.y) > 4:
                    vertical.append((min(p.y, q.y), max(p.y, q.y), (p.x + q.x) / 2))
            elif kind == "re":
                r = item[1]
                add_rect(r.x0, r.y0, r.x1, r.y1)
            elif kind == "qu":
                r = item[1].rect
                add_rect(r.x0, r.y0, r.x1, r.y1)
    return horizontal, vertical


# --------------------------------------------------------------- header
def _has_header(rows: list[list[Seg]]) -> bool:
    """The first row is a header if it is styled differently from the body,
    or holds only labels above columns of numbers."""
    if len(rows) < 2 or not rows[0]:
        return False
    body_styles = {s.style for row in rows[1:] for s in row}
    if all(s.style not in body_styles for s in rows[0]):
        return True
    body = [s for row in rows[1:] for s in row]
    return not any(_is_numeric(s.text) for s in rows[0]) and sum(_is_numeric(s.text) for s in body) * 3 >= len(body)


# ---------------------------------------------------------- ruled tables
def _ruled_tables(page: pymupdf.Page, segs: list[Seg]) -> list[Table]:
    try:
        with contextlib.redirect_stdout(io.StringIO()):   # find_tables prints an advert on first use
            found = page.find_tables(strategy="lines").tables
    except Exception as exc:
        log.info("find_tables failed on page %d: %s", page.number + 1, exc)
        return []
    tables: list[Table] = []
    for candidate in found:
        cells = [c for row in candidate.rows for c in row.cells if c is not None]
        if candidate.row_count < 2 or candidate.col_count < 2 or not cells:
            continue
        columns = _cluster([c[0] for c in cells] + [c[2] for c in cells], 1.0)
        rows = _cluster([c[1] for c in cells] + [c[3] for c in cells], 1.0)
        if len(columns) < 3 or len(rows) < 3:
            continue
        table = Table(columns, rows, source="ruled")
        # Charts and decorative grids also look like ruled tables: require text in the cells.
        grid: dict[tuple[int, int], list[Seg]] = {}
        for seg in segs:
            cell = table.cell_of(seg.x0 + min(1.0, (seg.x1 - seg.x0) / 2), (seg.top + seg.bottom) / 2)
            if cell is not None:
                grid.setdefault(cell, []).append(seg)
        total = (len(rows) - 1) * (len(columns) - 1)
        if len(grid) * 2 < total:
            continue
        by_row = [[s for (r, _c), items in sorted(grid.items()) if r == index for s in items]
                  for index in range(len(rows) - 1)]
        table.header_rows = 1 if _has_header(by_row) else 0
        tables.append(table)
    return tables


# ------------------------------------------------- tables ruled by rows
MIN_RULE_SPAN = 0.3          # of the page width: shorter rules are underlines, not row separators
MAX_RULED_ROW = 160.0        # pt: rules further apart than this do not bound one row


def _thin_rules(page: pymupdf.Page) -> list[tuple[float, float, float]]:
    """Visible horizontal rules drawn as lines or very thin boxes, as (x0, x1, y).
    The edges of filled bands and boxes are not rules here."""
    def visible(drawing: dict, key: str) -> bool:
        colour = drawing.get(key)
        return colour is not None and min(colour) < 0.9      # white (or nearly) draws nothing on paper

    out: list[tuple[float, float, float]] = []
    for drawing in page.get_drawings():
        for item in drawing.get("items") or []:
            if item[0] == "l":
                p, q = item[1], item[2]
                if abs(p.y - q.y) <= 0.5 and abs(p.x - q.x) > 4 and visible(drawing, "color"):
                    out.append((min(p.x, q.x), max(p.x, q.x), (p.y + q.y) / 2))
            elif item[0] in ("re", "qu"):
                r = item[1] if item[0] == "re" else item[1].rect
                if r.height <= 2.5 and r.width > 4 and (visible(drawing, "fill") or visible(drawing, "color")):
                    out.append((r.x0, r.x1, (r.y0 + r.y1) / 2))
    return out


def _row_ruled_tables(segs: list[Seg], horizontal, page_width: float, taken: list[Table]) -> list[Table]:
    """Tables whose rows are separated by horizontal rules but whose columns
    have no lines (statements often draw a rule under every cell and nothing
    else). Rows come from the rules; columns from where the rule segments
    break, or else from the gaps in the text.
    """
    if not horizontal:
        return []
    ys = _cluster([y for _, _, y in horizontal], 1.0)
    at: dict[float, list[tuple[float, float]]] = {y: [] for y in ys}
    for x0, x1, y in horizontal:
        at[min(ys, key=lambda c: abs(c - y))].append((x0, x1))

    # each rule row: its widest continuous span (small gaps closed) and the x where its pieces meet
    rule_rows: list[tuple[float, float, float, list[float]]] = []
    for y in ys:
        pieces = sorted(at[y])
        spans: list[list[float]] = []
        for x0, x1 in pieces:
            if spans and x0 <= spans[-1][1] + 3:
                spans[-1][1] = max(spans[-1][1], x1)
            else:
                spans.append([x0, x1])
        x0, x1 = max(spans, key=lambda sp: sp[1] - sp[0])
        if x1 - x0 < MIN_RULE_SPAN * page_width:
            continue
        joins = sorted({v for a, b in pieces for v in (a, b) if x0 + 4 < v < x1 - 4})
        rule_rows.append((y, x0, x1, joins))

    def text_between(y0: float, y1: float, x0: float, x1: float) -> list[Seg]:
        return [s for s in segs if y0 < (s.top + s.bottom) / 2 < y1 and x0 - 2 <= s.x0 and s.x1 <= x1 + 2]

    tables: list[Table] = []
    band: list[tuple[float, float, float, list[float]]] = []

    def flush() -> None:
        if len(band) < 3:
            return
        x0 = min(r[1] for r in band)
        x1 = max(r[2] for r in band)
        rows = [r[0] for r in band]
        if any(t.columns[0] < x1 and t.columns[-1] > x0 and t.rows[0] < rows[-1] and t.rows[-1] > rows[0] for t in taken):
            return                       # a ruled table already covers this
        inside = text_between(rows[0], rows[-1], x0, x1)
        if not inside:
            return

        # ---- columns: where the rule pieces meet in most rows ...
        joins = _cluster([v for r in band for v in r[3]], 2.0)
        counted = [sum(1 for r in band if any(abs(v - j) <= 2.0 for v in r[3])) for j in joins]
        interior = [j for j, n in zip(joins, counted) if n * 10 >= len(band) * 6]
        from_gaps = not interior
        if from_gaps:
            # ... or else the gaps that run through the text of every row
            spans = sorted((s.x0, s.x1) for s in inside)
            merged: list[list[float]] = []
            for a, b in spans:
                if merged and a <= merged[-1][1] + 5:
                    merged[-1][1] = max(merged[-1][1], b)
                else:
                    merged.append([a, b])
            interior = [(merged[i][1] + merged[i + 1][0]) / 2 for i in range(len(merged) - 1)]
        if not interior:
            return
        if from_gaps and len(rows) < 4:
            return                       # two rows and no column rules is too little to go on (a chart's gridlines)
        columns = [x0, *interior, x1]

        def lines_of(cells: list[Seg], row_edges: list[float]) -> list[set[int]]:
            """The columns used by each line of text in the row, top line first."""
            probe = Table(columns, row_edges)
            per_line: dict[float, set[int]] = {}
            for seg in sorted(cells, key=lambda sg: sg.baseline):
                cell = probe.cell_of(seg.x0 + min(1.0, (seg.x1 - seg.x0) / 2), (seg.top + seg.bottom) / 2)
                if cell is None:
                    continue
                key = next((b for b in per_line if abs(b - seg.baseline) <= BASELINE_TOL), seg.baseline)
                per_line.setdefault(key, set()).add(cell[1])
            return [per_line[b] for b in sorted(per_line)]

        def cells_of(row_edges: list[float], text: list[Seg]) -> tuple[list[list[Seg]], list[int]]:
            probe = Table(columns, row_edges)
            by_row: list[list[Seg]] = [[] for _ in range(len(row_edges) - 1)]
            used: list[set[int]] = [set() for _ in range(len(row_edges) - 1)]
            for seg in text:
                cell = probe.cell_of(seg.x0 + min(1.0, (seg.x1 - seg.x0) / 2), (seg.top + seg.bottom) / 2)
                if cell is not None:
                    by_row[cell[0]].append(seg)
                    used[cell[0]].add(cell[1])
            return by_row, [len(u) for u in used]

        def scattered(cells: list[Seg], row_edges: list[float]) -> bool:
            """Text in several columns but on no shared line (a chart's value labels)."""
            lines = lines_of(cells, row_edges)
            return len({c for line in lines for c in line}) >= 2 and all(len(c) == 1 for c in lines)

        # ---- rows: a title above the table or a sign-off under it sits between rules too.
        # Rows at either end that use a single column go.
        by_row, widths = cells_of(rows, inside)
        while len(rows) > 3 and widths[0] <= 1:
            rows, widths, by_row = rows[1:], widths[1:], by_row[1:]
        while len(rows) > 3 and widths[-1] <= 1:
            rows, widths, by_row = rows[:-1], widths[:-1], by_row[:-1]
        inside = [sg for sg in inside if rows[0] < (sg.top + sg.bottom) / 2 < rows[-1]]

        # ---- lines next to the rules without a rule of their own: a heading above, a
        # total below, as long as they use the columns like the rows do
        heights = [b - a for a, b in zip(rows, rows[1:])]
        typical = sorted(heights)[len(heights) // 2]
        probe = Table(columns, [rows[0] - 2 * typical, *rows, rows[-1] + 2 * typical])

        def line_beyond(edge_y: float, above: bool) -> list[Seg]:
            near = [sg for sg in segs if x0 - 2 <= sg.x0 and sg.x1 <= x1 + 2 and sg not in inside
                    and (edge_y - 1.5 * typical < (sg.top + sg.bottom) / 2 < edge_y if above
                         else edge_y < (sg.top + sg.bottom) / 2 < edge_y + 1.5 * typical)]
            if not near:
                return []
            baseline = max(sg.baseline for sg in near) if above else min(sg.baseline for sg in near)
            line = [sg for sg in near if abs(sg.baseline - baseline) <= BASELINE_TOL]
            used = {probe.cell_of(sg.x0 + 1, (sg.top + sg.bottom) / 2) for sg in line}
            return line if len({c[1] for c in used if c}) >= 2 else []

        for _ in range(12):
            head = line_beyond(rows[0], above=True)
            if not head:
                break
            pad = max(1.0, (typical - (max(sg.bottom for sg in head) - min(sg.top for sg in head))) / 2)
            rows = [min(sg.top for sg in head) - pad, *rows]
            inside = head + inside
        for _ in range(12):
            foot = line_beyond(rows[-1], above=False)
            if not foot:
                break
            pad = max(1.0, (typical - (max(sg.bottom for sg in foot) - min(sg.top for sg in foot))) / 2)
            rows = [*rows, max(sg.bottom for sg in foot) + pad]
            inside = inside + foot

        # ---- a table, not a list with underlines or a chart
        by_row, widths = cells_of(rows, inside)
        if sum(1 for w in widths if w >= 2) * 3 < len(widths) * 2:
            return
        if sum(1 for cells in by_row if scattered(cells, rows)) * 2 > len(by_row):
            return
        table = Table(columns, rows, source="ruled")
        table.header_rows = 1 if _has_header(by_row) else 0
        tables.append(table)

    for rule in rule_rows:
        if band:
            prev = band[-1]
            # the rules of one table start and end at the same x; the edge of a box around it does not
            fits = (abs(prev[1] - rule[1]) <= 6 and abs(prev[2] - rule[2]) <= 6
                    and 0 < rule[0] - prev[0] <= MAX_RULED_ROW
                    and text_between(prev[0], rule[0], min(prev[1], rule[1]), max(prev[2], rule[2])))
            if not fits:
                flush()
                band = []
        band.append(rule)
    flush()
    return tables


# -------------------------------------------------------- aligned tables
@dataclass
class _Row:
    cells: dict[int, list[Seg]] = field(default_factory=dict)   # column index -> lines of that cell
    baseline: float = 0.0        # of the row's first line
    last: float = 0.0            # baseline of its last line

    @property
    def top(self) -> float:
        return min(s.top for line in self.cells.values() for s in line)

    @property
    def bottom(self) -> float:
        return max(s.bottom for line in self.cells.values() for s in line)

    @property
    def size(self) -> float:
        return max(s.size for line in self.cells.values() for s in line)


def _overlapping(seg: Seg, extents: list[list[float]]) -> list[int]:
    return [i for i, (x0, x1) in enumerate(extents) if min(seg.x1, x1) - max(seg.x0, x0) > 0.5]


def _grow(lines: list[list[Seg]], start: int) -> tuple[list[_Row], list[list[float]], int]:
    """Collect the rows of a table whose first row is ``lines[start]``."""
    first = sorted(lines[start], key=lambda s: s.x0)
    extents = [[s.x0, s.x1] for s in first]
    rows = [_Row({i: [s] for i, s in enumerate(first)}, first[0].baseline, first[0].baseline)]
    pitches: list[float] = []
    index = start + 1
    while index < len(lines):
        line = lines[index]
        baseline = line[0].baseline
        gap = baseline - rows[-1].last
        limit = MAX_ROW_GAP_EM * rows[-1].size
        if pitches:
            limit = min(limit, 1.9 * statistics.median(pitches))
        if gap > limit:
            break
        hits = [(seg, _overlapping(seg, extents)) for seg in line]
        if any(len(cols) > 1 for _seg, cols in hits):
            break   # text running across several columns: a heading or paragraph, so the table ends
        matched = [(seg, cols[0]) for seg, cols in hits if len(cols) == 1]
        if len(matched) >= 2:
            row = _Row({}, baseline, baseline)
            for seg, col in matched:
                row.cells.setdefault(col, []).append(seg)
                extents[col][0] = min(extents[col][0], seg.x0)
                extents[col][1] = max(extents[col][1], seg.x1)
            pitches.append(baseline - rows[-1].baseline)
            rows.append(row)
        elif len(matched) == 1:
            seg, col = matched[0]
            above = rows[-1].cells.get(col)
            pitch = statistics.median(pitches) if pitches else None
            # a second line of the cell above: same style, same left edge, normal line spacing
            if (above and above[-1].style == seg.style and abs(above[0].x0 - seg.x0) <= ALIGN_TOL
                    and 0.8 * seg.size <= baseline - above[-1].baseline <= 1.45 * seg.size
                    and (pitch is None or baseline - above[-1].baseline < 0.8 * pitch)):
                above.append(seg)
                rows[-1].last = baseline
                extents[col][1] = max(extents[col][1], seg.x1)
        index += 1
    return rows, extents, index


def _prune(rows: list[_Row], extents: list[list[float]]) -> tuple[list[_Row], list[list[float]]]:
    """Drop columns that are mostly empty (text that merely sits beside the
    table), then rows left with fewer than two cells at either end."""
    keep = [c for c in range(len(extents)) if sum(1 for r in rows if c in r.cells) * 2 > len(rows)]
    remap = {old: new for new, old in enumerate(keep)}
    for row in rows:
        row.cells = {remap[c]: line for c, line in row.cells.items() if c in remap}
    rows = [r for r in rows if r.cells]
    while rows and len(rows[0].cells) < 2:
        rows.pop(0)
    while rows and len(rows[-1].cells) < 2:
        rows.pop()
    columns = []
    for new in range(len(keep)):
        segs = [s for r in rows for s in r.cells.get(new, [])]
        columns.append([min(s.x0 for s in segs), max(s.x1 for s in segs)] if segs else extents[keep[new]])
    return rows, columns


def _evidence(rows: list[_Row], extents: list[list[float]], horizontal: list[tuple[float, float, float]]) -> bool:
    width = extents[-1][1] - extents[0][0]
    for upper, lower in zip(rows, rows[1:]):
        for x0, x1, y in horizontal:
            covered = min(x1, extents[-1][1]) - max(x0, extents[0][0])
            if upper.last - 0.5 <= y <= lower.baseline - 0.5 * lower.size and covered >= 0.6 * width:
                return True
    for col in range(len(extents)):
        firsts = [r.cells[col][0] for r in rows if col in r.cells]
        if len(firsts) < 2:
            continue
        if sum(_is_numeric(s.text) for s in firsts) * 5 >= len(firsts) * 3:
            return True
        if (len(firsts) >= 3 and _spread([s.x1 for s in firsts]) <= ALIGN_TOL
                and _spread([s.x0 for s in firsts]) > ALIGN_TOL):
            return True
    return False


def _edges(rows: list[_Row], extents: list[list[float]], horizontal, vertical) -> tuple[list[float], list[float]]:
    left, right = extents[0][0], extents[-1][1]
    width = right - left
    top, bottom = rows[0].top, rows[-1].bottom
    spanning = [(x0, x1, y) for x0, x1, y in horizontal if min(x1, right) - max(x0, left) >= 0.6 * width]

    gaps = [lower.top - upper.bottom for upper, lower in zip(rows, rows[1:])]
    pad = max(1.0, statistics.median(gaps) / 2) if gaps else 2.0

    def rule_between(lo: float, hi: float) -> float | None:
        inside = [y for _x0, _x1, y in spanning if lo <= y <= hi]
        return min(inside, key=lambda y: abs(y - (lo + hi) / 2)) if inside else None

    def edge(lo: float, hi: float, fallback: float) -> float:
        rule = rule_between(lo, hi)
        return fallback if rule is None else rule

    row_edges = [edge(top - 2 * pad - 2, top + 1, top - pad)]
    for upper, lower in zip(rows, rows[1:]):
        row_edges.append(edge(upper.last + 0.5, lower.top + 1, (upper.bottom + lower.top) / 2))
    row_edges.append(edge(bottom - 1, bottom + 2 * pad + 2, bottom + pad))

    # The frame of the table, when rules show it, else a little room around the text.
    framing = [(x0, x1) for x0, x1, y in spanning if row_edges[0] - 1 <= y <= row_edges[-1] + 1]
    col_edges = [min([left - 2] + [x0 for x0, _ in framing if x0 <= left])]
    for (_a0, a1), (b0, _b1) in zip(extents, extents[1:]):
        rules = [x for y0, y1, x in vertical if a1 <= x <= b0 and min(y1, bottom) - max(y0, top) > 0.5 * (bottom - top)]
        col_edges.append(rules[0] if rules else (a1 + b0) / 2)
    col_edges.append(max([right + 2] + [x1 for _, x1 in framing if x1 >= right]))
    return col_edges, row_edges


def _aligned_tables(segs: list[Seg], horizontal, vertical) -> list[Table]:
    lines: list[list[Seg]] = []
    for seg in sorted(segs, key=lambda s: (s.baseline, s.x0)):
        if lines and seg.baseline - lines[-1][0].baseline <= BASELINE_TOL:
            lines[-1].append(seg)
        else:
            lines.append([seg])

    tables: list[Table] = []
    index = 0
    while index < len(lines):
        if len(lines[index]) < 2:
            index += 1
            continue
        rows, extents, end = _grow(lines, index)
        rows, extents = _prune(rows, extents)
        big_enough = (len(rows) >= 3 and len(extents) >= 2) or (len(rows) >= 2 and len(extents) >= 3)
        if not big_enough or not _evidence(rows, extents, horizontal):
            index += 1
            continue
        columns, row_edges = _edges(rows, extents, horizontal, vertical)
        if any(b - a <= 0 for a, b in zip(columns, columns[1:])) or any(b - a <= 0 for a, b in zip(row_edges, row_edges[1:])):
            index += 1
            continue
        header = _has_header([[line[0] for line in row.cells.values()] for row in rows])
        tables.append(Table(columns, row_edges, 1 if header else 0, "aligned"))
        index = end
    return tables


# ------------------------------------------------------------------ api
def detect_tables(page: pymupdf.Page, segs: list[Seg]) -> list[Table]:
    """Tables on ``page``. ``segs`` are its upright, visible pieces of text."""
    tables = _ruled_tables(page, segs)
    horizontal, vertical = _rules(page)

    def outside(seg: Seg) -> bool:
        x, y = (seg.x0 + seg.x1) / 2, (seg.top + seg.bottom) / 2
        return all(t.cell_of(x, y) is None for t in tables)

    tables += _row_ruled_tables([s for s in segs if outside(s)], _thin_rules(page), page.rect.width, tables)
    tables += _aligned_tables([s for s in segs if outside(s)], horizontal, vertical)
    tables.sort(key=lambda t: (t.rows[0], t.columns[0]))
    return tables


def refine_alignment(elements: list[dict], tables: list[Table]) -> None:
    """Set the alignment of table cells from their column, so imported or
    edited values line up the way the original ones did."""
    for table in tables:
        columns: dict[int, list[tuple[int, dict]]] = {}
        for el in elements:
            if el["type"] != "text" or el["rotation"] or not el.get("visible", True):
                continue
            cell = table.cell_of(el["x"] + el["width"] / 2, el["y"] + el["height"] / 2)
            if cell is not None:
                columns.setdefault(cell[1], []).append((cell[0], el))
        for column, cells in columns.items():
            body = [el for row, el in cells if row >= table.header_rows and "\n" not in el["content"]]
            if len(body) == 1:
                # One value cannot show an edge lining up. A number sitting
                # against the right of its column is taken as right-aligned.
                el = body[0]
                left_room = el["x"] - table.columns[column]
                right_room = table.columns[column + 1] - (el["x"] + el["width"])
                if _is_numeric(el["content"]) and right_room < left_room:
                    el["align"] = "right"
            if len(body) < 2:
                continue
            lefts = [el["x"] for el in body]
            rights = [el["x"] + el["width"] for el in body]
            centres = [el["x"] + el["width"] / 2 for el in body]
            numeric = sum(_is_numeric(el["content"]) for el in body) * 2 > len(body)
            both = _spread(rights) <= ALIGN_TOL and _spread(lefts) <= ALIGN_TOL
            if both:
                # Every value is the same width, so either edge fits: go by the
                # column heading if it shares one of them, else numbers go right.
                heads = [el for row, el in cells if row < table.header_rows]
                if heads and abs(heads[0]["x"] - statistics.median(lefts)) <= ALIGN_TOL:
                    numeric = False
                elif heads and abs(heads[0]["x"] + heads[0]["width"] - statistics.median(rights)) <= ALIGN_TOL:
                    numeric = True
            if _spread(rights) <= ALIGN_TOL and (_spread(lefts) > ALIGN_TOL or numeric):
                align, anchor = "right", statistics.median(rights)
            elif _spread(lefts) <= ALIGN_TOL:
                align, anchor = "left", statistics.median(lefts)
            elif _spread(centres) <= ALIGN_TOL:
                align, anchor = "center", statistics.median(centres)
            else:
                continue
            for el in body:
                el["align"] = align
            for row, el in cells:
                if row >= table.header_rows or "\n" in el["content"]:
                    continue
                # a heading follows its column when it shares the column's anchor
                edge = {"right": el["x"] + el["width"], "left": el["x"], "center": el["x"] + el["width"] / 2}[align]
                if abs(edge - anchor) <= ALIGN_TOL:
                    el["align"] = align
