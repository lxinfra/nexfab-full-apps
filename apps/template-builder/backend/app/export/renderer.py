"""Template JSON -> PDF.

Pages are rebuilt at their original size and elements are painted in ``z``
order: images through ``insert_image`` (with the placement matrix rewritten
for rotated, flipped or clipped images), text through ``TextWriter`` with the
resolved fonts, and shapes as PDF path operators.
"""
from __future__ import annotations

import io
import logging
import re

import pymupdf
from PIL import Image

from ..geometry import (
    Matrix, Segment, concat, d_to_segments, fmt, hex_to_rgb, local_to_page_matrix, transform_segments,
)
from ..storage import Storage
from .fonts import FontResolver, expand_ligatures

log = logging.getLogger(__name__)

_PLACEHOLDER = re.compile(r"\{\{\s*([\w.\- ]+?)\s*\}\}")
_IMAGE_DO = re.compile(rb"/(\S+)\s+Do")
_FIT_MIN, _FIT_MAX = 0.7, 1.4     # limits for squeezing a line to its original width
_MAX_RUN = 16                     # longest string written in one go at body sizes (see Exporter._text)
_BASELINE_NUDGE = 0.001           # em; see Exporter._text


def fill_placeholders(content: str, variables: dict[str, str] | None, blank_missing: bool = False) -> str:
    """Replace ``{{name}}`` placeholders. Unknown names are kept, or blanked for bulk fills."""
    if variables is None:
        return content

    def repl(m: re.Match) -> str:
        key = m.group(1)
        if key in variables:
            return str(variables[key])
        return "" if blank_missing else m.group(0)

    return _PLACEHOLDER.sub(repl, content)


def _pdf_path(segs: list[Segment], page_height: float) -> str:
    """Page-space segments -> PDF path construction operators (PDF's y axis points up)."""
    out: list[str] = []
    for s in segs:
        if s[0] == "Z":
            out.append("h")
            continue
        coords = " ".join(f"{fmt(s[i])} {fmt(page_height - s[i + 1])}" for i in range(1, len(s), 2))
        out.append(f"{coords} {s[0].lower()}")
    return "\n".join(out) + "\n" if out else ""


def _scale_local(el: dict) -> Matrix:
    """Scale from the size local geometry was captured at to the element's current size."""
    rw, rh = el.get("refWidth") or 0, el.get("refHeight") or 0
    sx = el["width"] / rw if rw else 1.0
    sy = el["height"] / rh if rh else 1.0
    return (sx, 0, 0, sy, 0, 0)


class _OwnFiles:
    """The storage, narrowed to one template's folder.

    A template's images and fonts are always files of that template (a copy gets
    its own). Anything else in the JSON, such as an address pointing into another
    account's template, is treated as missing rather than read.
    """

    def __init__(self, storage: Storage, template_id: str) -> None:
        self._storage, self._prefix = storage, f"{template_id}/"
        self.exists, self.read = storage.exists, storage.read

    def key_from_url(self, url: str) -> str | None:
        key = self._storage.key_from_url(url)
        return key if key and key.startswith(self._prefix) else None


class Exporter:
    def __init__(self, template: dict, storage: Storage) -> None:
        self.template = template
        if template.get("id"):
            storage = _OwnFiles(storage, str(template["id"]))  # type: ignore[assignment]
        self.storage = storage
        self.fonts = FontResolver(template.get("fonts") or [], storage)
        self._image_data: dict[tuple[str, float], bytes] = {}
        self._advances: dict[int, dict[str, float]] = {}   # per font: glyph advance at size 1

    # ------------------------------------------------------------------
    def render(self, variables: dict[str, str] | None = None, blank_missing: bool = False) -> bytes:
        doc = pymupdf.open()
        image_xrefs: dict[tuple[str, float], int] = {}
        try:
            for page_data in self.template.get("pages") or []:
                page = doc.new_page(width=page_data["width"], height=page_data["height"])
                self._render_page(doc, page, page_data, variables, blank_missing, image_xrefs)
            if doc.page_count == 0:
                doc.new_page()
            try:
                doc.subset_fonts()
            except Exception as exc:  # subsetting is an optimisation only
                log.info("font subsetting skipped: %s", exc)
            return doc.tobytes(garbage=3, deflate=True)
        finally:
            doc.close()

    def _render_page(self, doc, page, page_data: dict, variables, blank_missing: bool, image_xrefs: dict) -> None:
        height = page.rect.height
        shape = None
        for el in sorted(page_data.get("elements") or [], key=lambda e: e.get("z", 0)):
            if el.get("visible") is False:
                continue
            kind = el.get("type")
            try:
                if kind == "shape":
                    if shape is None:
                        shape = page.new_shape()
                    self._shape(shape, el, height)
                    continue
                if shape is not None:  # keep paint order: flush shapes before text/images
                    shape.commit()
                    shape = None
                if kind == "image":
                    self._image(doc, page, el, height, image_xrefs)
                elif kind == "text":
                    self._text(page, el, variables, blank_missing)
            except Exception:
                log.exception("failed to render element %s", el.get("id"))
        if shape is not None:
            shape.commit()

    # ---- clip paths --------------------------------------------------
    def _clip_ops(self, el: dict, page_height: float) -> str:
        clips = el.get("clip")
        if not clips:
            return ""
        to_page = concat(_scale_local(el), local_to_page_matrix(el))
        out = []
        for clip in clips:
            segs = transform_segments(d_to_segments(clip.get("d", "")), to_page)
            if segs:
                out.append(_pdf_path(segs, page_height) + ("W* n\n" if clip.get("rule") == "evenodd" else "W n\n"))
        return "".join(out)

    # ---- shapes ------------------------------------------------------
    def _shape(self, shape, el: dict, page_height: float) -> None:
        fill = hex_to_rgb(el.get("fill"))
        stroke = hex_to_rgb(el.get("stroke"))
        if fill is None and stroke is None:
            return
        kind = el.get("shape")
        if kind == "line":
            segs: list[Segment] = [("M", el["x1"], el["y1"]), ("L", el["x2"], el["y2"])]
        else:
            if kind == "path":
                local = transform_segments(d_to_segments(el.get("d", "")), _scale_local(el))
            else:
                w, h = el["width"], el["height"]
                local = [("M", 0, 0), ("L", w, 0), ("L", w, h), ("L", 0, h), ("Z",)]
            segs = transform_segments(local, local_to_page_matrix(el))
        if not segs:
            return

        before = shape.totalcont
        # The line width is written here rather than through finish(), which
        # would drop a zero-width (hairline) stroke.
        width = float(el.get("strokeWidth") or 0) if stroke is not None else 0.0
        shape.draw_cont += f"{fmt(width)} w\n" + _pdf_path(segs, page_height)
        dash = el.get("dash")
        shape.finish(
            width=1, color=stroke, fill=fill, closePath=False,
            even_odd=el.get("fillRule") == "evenodd",
            dashes=f"[{' '.join(fmt(v) for v in dash)}] 0" if dash and stroke is not None else None,
            lineCap={"round": 1, "square": 2}.get(el.get("lineCap"), 0),
            lineJoin={"round": 1, "bevel": 2}.get(el.get("lineJoin"), 0),
            fill_opacity=float(el.get("fillOpacity", 1)) if fill is not None else 1,
            stroke_opacity=float(el.get("strokeOpacity", 1)) if stroke is not None else 1,
        )
        clip = self._clip_ops(el, page_height)
        if clip:
            added = shape.totalcont[len(before):]
            shape.totalcont = f"{before}\nq\n{clip}{added}Q\n"

    # ---- images ------------------------------------------------------
    def _image_bytes(self, src: str, opacity: float) -> bytes | None:
        key = (src, opacity)
        if key not in self._image_data:
            storage_key = self.storage.key_from_url(src)
            if not storage_key or not self.storage.exists(storage_key):
                log.warning("image not found in storage: %s", src)
                return None
            data = self.storage.read(storage_key)
            if opacity < 1:
                img = Image.open(io.BytesIO(data)).convert("RGBA")
                img.putalpha(img.getchannel("A").point(lambda a: round(a * opacity)))
                buf = io.BytesIO()
                img.save(buf, "PNG")
                data = buf.getvalue()
            self._image_data[key] = data
        return self._image_data[key]

    def _image(self, doc, page, el: dict, page_height: float, image_xrefs: dict) -> None:
        w, h = float(el["width"]), float(el["height"])
        if w <= 0 or h <= 0:
            return
        opacity = max(0.0, min(1.0, float(el.get("opacity", 1))))
        if opacity <= 0:
            return
        key = (el["src"], round(opacity, 3))

        # Where the picture sits inside the element's box.
        nw, nh = el.get("naturalWidth") or 0, el.get("naturalHeight") or 0
        fit = el.get("fit", "stretch")
        iw, ih, ox, oy = w, h, 0.0, 0.0
        crop_to_box = False
        if fit in ("fit", "fill") and nw and nh:
            scale = min(w / nw, h / nh) if fit == "fit" else max(w / nw, h / nh)
            iw, ih = nw * scale, nh * scale
            ox, oy = (w - iw) / 2, (h - ih) / 2
            crop_to_box = fit == "fill" and (iw > w + 0.01 or ih > h + 0.01)

        to_page = local_to_page_matrix(el)
        m = concat((iw, 0, 0, ih, ox, oy), to_page)
        corners = [(m[4], m[5]), (m[0] + m[4], m[1] + m[5]), (m[2] + m[4], m[3] + m[5]),
                   (m[0] + m[2] + m[4], m[1] + m[3] + m[5])]
        xs, ys = [c[0] for c in corners], [c[1] for c in corners]
        bbox = pymupdf.Rect(min(xs), min(ys), max(xs), max(ys))
        if bbox.is_empty or bbox.is_infinite:
            return

        if key in image_xrefs:
            page.insert_image(bbox, xref=image_xrefs[key], keep_proportion=False)
        else:
            data = self._image_bytes(el["src"], key[1])
            if data is None:
                return
            image_xrefs[key] = page.insert_image(bbox, stream=data, keep_proportion=False)

        clip = self._clip_ops(el, page_height)
        if crop_to_box:
            box = transform_segments([("M", 0, 0), ("L", w, 0), ("L", w, h), ("L", 0, h), ("Z",)], to_page)
            clip += _pdf_path(box, page_height) + "W n\n"
        upright = abs(m[1]) < 1e-6 and abs(m[2]) < 1e-6 and m[0] > 0 and m[3] > 0
        if upright and not clip:
            return

        # insert_image only places upright rectangles. Rewrite the placement it
        # just appended with the real matrix (and clip path, if any).
        contents = page.get_contents()
        stream = doc.xref_stream(contents[-1]) if contents else None
        name = _IMAGE_DO.search(stream) if stream else None
        if name is None:
            log.warning("could not locate image placement for %s; left unrotated", el.get("id"))
            return
        a, b, c, d, e, f = m
        cm = " ".join(fmt(v) for v in (a, -b, -c, d, c + e, page_height - d - f))
        doc.update_stream(contents[-1], f"q\n{clip}{cm} cm\n/{name.group(1).decode()} Do\nQ\n".encode())

    # ---- text --------------------------------------------------------
    def _content(self, el: dict, variables, blank_missing: bool) -> str:
        content = el.get("content") or ""
        if variables is not None and el.get("isVariable") and el.get("fieldName") in variables \
                and not _PLACEHOLDER.search(content):
            return str(variables[el["fieldName"]])
        return fill_placeholders(content, variables, blank_missing)

    @staticmethod
    def _replace_words(words: list[str], placed: list, natural: list[float], left: float, advance,
                       exact: bool, max_run: int) -> list[list]:
        """Put the words of an unchanged line back at their recorded positions.

        Returns pieces of [x, text, x where the text ends, horizontal squeeze].

        With the source's own font (``exact``) nothing is scaled: kerned or
        letter-spaced words are rebuilt from their recorded glyph positions, and
        other words are re-anchored every few glyphs so they span exactly their
        original width (source PDFs round glyph widths, so a word is rarely the
        precise sum of the font's advances). With a substitute font the words
        keep their start positions and are squeezed to the original width.
        """
        kerned = [exact and len(p) > 2 and len(p[2]) == len(word) - 1 for word, p in zip(words, placed)]
        squeeze = 1.0
        if not exact:
            target, measured = sum(float(p[1]) for p in placed), sum(natural)
            if target > 0 and measured > 0:
                ratio = target / measured
                if abs(ratio - 1) >= 0.004 and _FIT_MIN <= ratio <= _FIT_MAX:
                    squeeze = round(ratio, 4)

        pieces: list[list] = []
        for word, p, width, is_kerned in zip(words, placed, natural, kerned):
            if not word:
                continue
            px = left + float(p[0])
            if is_kerned:
                start, text, expected = px, word[0], px + advance(word[0])
                for ch, offset in zip(word[1:], p[2]):
                    pos = px + float(offset)
                    if abs(pos - expected) > 0.03:   # this glyph was nudged: start a new placement
                        pieces.append([start, text, expected, 1.0])
                        start, text, expected = pos, ch, pos + advance(ch)
                    else:
                        text += ch
                        expected += advance(ch)
                pieces.append([start, text, expected, 1.0])
                continue
            # Spread the difference between the recorded and the natural width
            # evenly over the glyphs.
            per_glyph = (float(p[1]) - width) / len(word) if exact else 0.0
            if abs(per_glyph) * len(word) < 0.02 or abs(per_glyph) > 0.05 * width / len(word):
                pieces.append([px, word, px + width, squeeze])
                continue
            step = max(1, min(max_run, int(0.02 / abs(per_glyph))))
            for j in range(0, len(word), step):
                part = word[j:j + step]
                part_width = sum(advance(c) for c in part)
                pieces.append([px, part, px + part_width, 1.0])
                px += part_width + per_glyph * len(part)
        return pieces

    def _text(self, page, el: dict, variables, blank_missing: bool) -> None:
        content = self._content(el, variables, blank_missing).replace("\r\n", "\n").replace("\t", " ")
        if not content.strip():
            return
        spans = el.get("spans")
        if spans and content == (el.get("content") or "").replace("\r\n", "\n").replace("\t", " "):
            self._styled_text(page, el, content, spans)
            return
        size = float(el.get("fontSize") or 12)
        font, content, exact = self.fonts.resolve(el, content)
        lines = content.split("\n")
        x, y, w, h = float(el["x"]), float(el["y"]), float(el.get("width") or 0), float(el.get("height") or 0)
        cx, cy = x + w / 2, y + h / 2
        align = el.get("align", "left")
        has_space = bool(font.has_glyph(32))
        space = (font.text_length(" ", fontsize=size) if has_space else 0.0) or 0.28 * size

        # `layout` records where each line and word sat in the source PDF. It only
        # applies while the element keeps its line count and font size.
        layout = el.get("layout") or {}
        slots = layout.get("lines") or []
        if len(slots) != len(lines) or abs(float(layout.get("fontSize") or 0) - size) > 0.01:
            slots = []
        first_baseline = float(el["baseline"]) if el.get("baseline") is not None else font.ascender * size
        leading = float(el.get("lineHeight") or 1.2) * size

        advances = self._advances.setdefault(id(font), {})

        def advance(ch: str) -> float:
            unit = advances.get(ch)
            if unit is None:
                unit = advances[ch] = font.glyph_advance(ord(ch))
            return unit * size

        max_run = max(2, min(_MAX_RUN, int(_MAX_RUN * 8 / size)))
        writers: dict[float, pymupdf.TextWriter] = {}
        placed_count = 0
        for i, text in enumerate(lines):
            words = text.split(" ")
            if not any(words):
                continue
            natural = [sum(advance(c) for c in word) for word in words]
            slot = slots[i] if slots else None
            baseline = y + (float(slot["y"]) if slot else first_baseline + i * leading)

            # Each piece is [x, text, x where it ends, horizontal squeeze].
            pieces: list[list] | None = None
            if slot is not None and expand_ligatures(slot.get("text") or "") == expand_ligatures(text):
                placed = slot.get("words") or [[0.0, slot.get("width", 0.0)]]
                real = [(word, width) for word, width in zip(words, natural) if word]
                if len(placed) == len(real):
                    # Unchanged line: every word goes back exactly where it was.
                    pieces = self._replace_words([r[0] for r in real], placed, [r[1] for r in real],
                                                 x + float(slot["x"]), advance, exact, max_run)
            if pieces is None:
                # Edited (or newly laid out) line: flow it inside the element's box.
                flow_width = sum(natural) + space * (len(words) - 1)
                left, room = x, w
                gap = space
                if align == "right":
                    pos = left + room - flow_width
                elif align == "center":
                    pos = left + (room - flow_width) / 2
                else:
                    pos = left
                    if align == "justify" and not slot and i < len(lines) - 1 and len(words) > 1 and flow_width < room:
                        gap = space + (room - flow_width) / (len(words) - 1)
                pieces = []
                for word, width in zip(words, natural):
                    if word:
                        pieces.append([pos, word, pos + width, 1.0])
                    pos += width + gap

            # Pieces that simply follow each other at the font's own spacing are
            # written as one string; only real gaps start a new placement.
            merged: list[list] = []
            for piece in pieces:
                last = merged[-1] if merged else None
                if (last is not None and has_space and last[3] == 1.0 == piece[3]
                        and len(last[1]) + len(piece[1]) < max_run
                        and abs(piece[0] - last[2] - space) < 0.03):
                    # last[2] stays the *predicted* end of the merged string, so
                    # small errors cannot pile up along the line
                    last[1] += " " + piece[1]
                    last[2] += space + piece[2] - piece[0]
                else:
                    merged.append(piece)
            runs: list[tuple[float, str, float]] = []
            for px, chunk, _end, squeeze in merged:
                # A PDF stores glyph widths rounded to 1/1000 em, so a long string
                # creeps away from where the font's true advances would put it
                # (more at large sizes). Restart at an exact position every few glyphs.
                while len(chunk) > max_run:
                    cut = max_run
                    runs.append((px, chunk[:cut], squeeze))
                    px += sum(advance(c) if c != " " else space for c in chunk[:cut]) * squeeze
                    chunk = chunk[cut:]
                    if chunk.startswith(" "):
                        px, chunk = px + space * squeeze, chunk[1:]
                if chunk:
                    runs.append((px, chunk, squeeze))
            for px, chunk, squeeze in runs:
                writer = writers.get(squeeze)
                if writer is None:
                    writer = writers[squeeze] = pymupdf.TextWriter(page.rect)
                # MuPDF writes consecutive pieces on one baseline as a single TJ
                # array with adjustments rounded to 1/1000 em, and the rounding
                # accumulates (up to ~0.5 pt by the end of a line). Alternating
                # the baseline by an invisible 1/1000 em makes it emit an exact
                # position for every piece instead.
                nudge = max(0.01, _BASELINE_NUDGE * size) if placed_count % 2 else 0.0
                placed_count += 1
                # Positions are pre-divided so the horizontal squeeze about the
                # box centre lands each chunk on its target.
                writer.append((cx + (px - cx) / squeeze, baseline + nudge), chunk, font=font, fontsize=size)

        color = hex_to_rgb(el.get("color")) or (0.0, 0.0, 0.0)
        opacity = max(0.0, min(1.0, float(el.get("opacity", 1))))
        rotation = float(el.get("rotation") or 0)
        for squeeze, writer in writers.items():
            morph = None
            if squeeze != 1 or rotation:
                # morph matrices act in PDF space (y up), where positive angles
                # turn counter-clockwise; our rotation is clockwise.
                morph = (pymupdf.Point(cx, cy), pymupdf.Matrix(squeeze, 1) * pymupdf.Matrix(-rotation))
            writer.write_text(page, color=color, opacity=opacity, morph=morph)

    def _styled_text(self, page, el: dict, content: str, spans: list[dict]) -> None:
        """Text with bold / italic stretches (``spans``, counted over the characters
        that are not white space). Every line is flowed inside the box at the
        fonts' natural spacing, one font per stretch."""
        size = float(el.get("fontSize") or 12)
        x, y, w, h = float(el["x"]), float(el["y"]), float(el.get("width") or 0), float(el.get("height") or 0)
        cx, cy = x + w / 2, y + h / 2
        align = el.get("align", "left")
        leading = float(el.get("lineHeight") or 1.2) * size
        plain = (el.get("fontWeight", "normal"), el.get("fontStyle", "normal"))

        def style_at(index: int) -> tuple:
            for span in spans:
                if span.get("start", 0) <= index < span.get("end", 0):
                    return span.get("fontWeight", plain[0]), span.get("fontStyle", plain[1])
            return plain

        # Each line as stretches of one style; spaces take the style before them.
        lines: list[list[list]] = []
        index = 0
        for text in content.split("\n"):
            pieces: list[list] = []
            for ch in text:
                if ch.isspace():
                    style = pieces[-1][0] if pieces else style_at(index)
                else:
                    style = style_at(index)
                    index += 1
                if pieces and pieces[-1][0] == style:
                    pieces[-1][1] += ch
                else:
                    pieces.append([style, ch])
            lines.append(pieces)

        fonts: dict[tuple, pymupdf.Font] = {}

        def font_for(style: tuple) -> pymupdf.Font:
            if style not in fonts:
                fonts[style] = self.fonts.resolve({**el, "fontWeight": style[0], "fontStyle": style[1]}, content)[0]
            return fonts[style]

        first_baseline = float(el["baseline"]) if el.get("baseline") is not None else font_for(plain).ascender * size
        writer = pymupdf.TextWriter(page.rect)
        for i, pieces in enumerate(lines):
            if not "".join(text for _, text in pieces).strip():
                continue
            widths = [font_for(style).text_length(text, fontsize=size) for style, text in pieces]
            total = sum(widths)
            pos = x + w - total if align == "right" else x + (w - total) / 2 if align == "center" else x
            baseline = y + first_baseline + i * leading
            for (style, text), width in zip(pieces, widths):
                if text.strip():
                    writer.append((pos, baseline), text, font=font_for(style), fontsize=size)
                pos += width
        color = hex_to_rgb(el.get("color")) or (0.0, 0.0, 0.0)
        opacity = max(0.0, min(1.0, float(el.get("opacity", 1))))
        rotation = float(el.get("rotation") or 0)
        # morph matrices act in PDF space (y up), where positive angles turn counter-clockwise
        morph = (pymupdf.Point(cx, cy), pymupdf.Matrix(-rotation)) if rotation else None
        writer.write_text(page, color=color, opacity=opacity, morph=morph)
