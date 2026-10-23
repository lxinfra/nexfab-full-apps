"""Build one complete font per typeface from the pieces a PDF embeds.

A PDF embeds only the letters it uses, often as several subsets of the same
face (one per page or per text run), and often as bare CFF programs that a
browser cannot load. This module:

1. reads every embedded program (TrueType, OpenType or bare CFF) and maps its
   glyphs back to the characters the document set with them,
2. merges all subsets of one face into a single glyph set,
3. fills the characters the PDF never used from an open font of similar
   design (``backend/fonts``), scaled so its letters have the same height and
   width as the original's — measured over every letter both fonts share,
4. writes the result as one TrueType font that the editor and export both use.
"""
from __future__ import annotations

import io
import logging
import statistics
from dataclasses import dataclass, field

from ..config import settings
from ..googlefonts import STYLES, google_font_file

log = logging.getLogger(__name__)

# What a completed font should be able to set: ASCII, Latin-1 and the usual
# typographic punctuation and currency signs.
WANTED = (
    [*range(0x20, 0x7F), *range(0xA0, 0x100)]
    + [0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2022, 0x2026,
       0x2030, 0x2039, 0x203A, 0x20AC, 0x20B9, 0x2122, 0x0152, 0x0153, 0x0160, 0x0161,
       0x0178, 0x017D, 0x017E, 0x0192, 0x02C6, 0x02DC]
)
# Letters whose outlines are compared to size the borrowed ones.
_MEASURED = "ABCDEFGHIJKLMNOPRSTUVWXYZabcdeghkmnopqrsuvwxyz0123456789"


@dataclass
class Program:
    """One embedded font program, readable glyph by glyph."""
    upm: int
    glyphs: object                  # a fontTools glyph set: name -> drawable glyph with .width
    cmap: dict[int, str]            # code point -> glyph name
    ascent: int = 0
    descent: int = 0
    kind: str = "ttf"               # "ttf" (quadratic outlines) or "cff" (cubic)
    # Advances the PDF itself gives (its /W widths), which win over the program's own
    widths: dict[str, float] = field(default_factory=dict)


CidWidths = tuple[dict[int, float], float]   # widths per CID and the default, in 1/1000 em


def _pdf_widths(order: list[str], upm: int, cid_widths: CidWidths | None, cid_named: bool) -> dict[str, float]:
    """Glyph name -> advance in font units, from the PDF's widths per CID."""
    if not cid_widths:
        return {}
    widths, default = cid_widths
    out: dict[str, float] = {}
    for gid, name in enumerate(order):
        # CID-keyed CFF glyphs are named after their CID; otherwise the CID is the glyph id
        cid = int(name[3:]) if cid_named and name.startswith("cid") and name[3:].isdigit() else gid
        out[name] = widths.get(cid, default) * upm / 1000
    return out


def _ttf_program(buf: bytes, gids: dict[int, int], cid_widths: CidWidths | None = None) -> Program | None:
    from fontTools.ttLib import TTFont

    font = TTFont(io.BytesIO(buf), recalcTimestamp=False, lazy=False)
    if "glyf" not in font and "CFF " not in font:
        return None
    order = font.getGlyphOrder()
    known = set(order)
    cmap: dict[int, str] = {}
    if "cmap" in font:
        try:
            for table in font["cmap"].tables:
                if table.isUnicode():
                    cmap.update({c: n for c, n in table.cmap.items() if n in known})
        except Exception:
            cmap = {}
    for uni, gid in gids.items():   # what the PDF itself set with each glyph wins
        if 0 < gid < len(order):
            cmap[uni] = order[gid]
    hhea = font["hhea"] if "hhea" in font else None
    upm = font["head"].unitsPerEm
    return Program(
        upm=upm, glyphs=font.getGlyphSet(), cmap=cmap,
        ascent=hhea.ascent if hhea else 0, descent=hhea.descent if hhea else 0,
        kind="ttf" if "glyf" in font else "cff",
        widths=_pdf_widths(order, upm, cid_widths, "CFF " in font),
    )


def _cff_program(buf: bytes, gids: dict[int, int], cid_widths: CidWidths | None = None) -> Program | None:
    """A bare CFF program (PDF FontFile3 /Type1C or /CIDFontType0C)."""
    from fontTools.cffLib import CFFFontSet

    cff = CFFFontSet()
    cff.decompile(io.BytesIO(buf), otFont=None)
    top = cff[cff.fontNames[0]]
    strings = top.CharStrings
    order = list(top.charset)
    matrix = getattr(top, "FontMatrix", None) or [0.001]
    upm = max(16, round(1 / matrix[0])) if matrix[0] else 1000
    cmap = {uni: order[gid] for uni, gid in gids.items() if 0 < gid < len(order)}
    bbox = getattr(top, "FontBBox", None) or [0, -200, 0, 800]
    return Program(upm=upm, glyphs=_CffGlyphs(strings), cmap=cmap,
                   ascent=round(bbox[3]), descent=round(bbox[1]), kind="cff",
                   widths=_pdf_widths(order, upm, cid_widths, True))


class _CffGlyph:
    def __init__(self, charstring) -> None:
        self._cs = charstring
        self.width = None

    def draw(self, pen) -> None:
        self._cs.draw(pen)
        self.width = self._cs.width

    @property
    def advance(self) -> float:
        if self.width is None:
            from fontTools.pens.basePen import NullPen

            self.draw(NullPen())
        return self.width or 0


class _CffGlyphs:
    def __init__(self, strings) -> None:
        self._strings = strings
        self._made: dict[str, _CffGlyph] = {}

    def __contains__(self, name: str) -> bool:
        return name in self._strings

    def __getitem__(self, name: str) -> _CffGlyph:
        glyph = self._made.get(name)
        if glyph is None:
            glyph = self._made[name] = _CffGlyph(self._strings[name])
        return glyph


def read_program(buf: bytes, ext: str, gids: dict[int, int], cid_widths: CidWidths | None = None) -> Program | None:
    """The embedded program as glyphs per character, or None when it cannot be read.

    ``cid_widths`` are a Type0 font's own widths (see ``CidWidths``).
    """
    try:
        if buf[:4] in (b"\x00\x01\x00\x00", b"OTTO", b"true", b"ttcf") or ext in ("ttf", "otf"):
            return _ttf_program(buf, gids, cid_widths)
        if ext in ("cff", "cid") or buf[:1] == b"\x01":
            return _cff_program(buf, gids, cid_widths)
    except Exception as exc:
        log.info("cannot read font program (%s): %s", ext, exc)
    return None


def _advance(program: Program, name: str) -> float:
    if name in program.widths:
        return program.widths[name]
    glyph = program.glyphs[name]
    width = getattr(glyph, "advance", None)
    if width is None:
        width = glyph.width
    if not width:
        # some producers leave the widths out of the program: go by the outline
        bounds = _bounds(program, name)
        if bounds:
            width = bounds[2] + max(0, bounds[0])
    return float(width or 0)


def _bounds(program: Program, name: str):
    from fontTools.pens.boundsPen import BoundsPen

    pen = BoundsPen(None)
    program.glyphs[name].draw(pen)
    return pen.bounds


def _fit(base: dict[int, tuple[Program, str]], donor: Program, upm: int) -> tuple[float, float]:
    """Scale (x, y) that gives the donor's letters the original's size, in output units.

    Heights come from the outlines of every measured letter both fonts have,
    widths from their advances; the median keeps an odd glyph from skewing it.
    """
    heights: list[float] = []
    widths: list[float] = []
    for ch in _MEASURED:
        code = ord(ch)
        if code not in base or code not in donor.cmap:
            continue
        program, name = base[code]
        own_unit, donor_unit = upm / program.upm, upm / donor.upm
        own, theirs = _bounds(program, name), _bounds(donor, donor.cmap[code])
        if own and theirs and theirs[3] - theirs[1] > 0:
            heights.append(((own[3] - own[1]) * own_unit) / ((theirs[3] - theirs[1]) * donor_unit))
        donor_width = _advance(donor, donor.cmap[code])
        if donor_width > 0:
            widths.append((_advance(program, name) * own_unit) / (donor_width * donor_unit))
    sy = statistics.median(heights) if heights else 1.0
    sx = statistics.median(widths) if widths else sy
    # a borrowed letter may be resized, not distorted beyond recognition
    sy = min(1.6, max(0.6, sy))
    sx = min(sy * 1.35, max(sy / 1.35, sx))
    return sx * upm / donor.upm, sy * upm / donor.upm


def build_font(pieces: list[Program], donor: Program | None, family: str, style: str,
               wanted: list[int] | None = None) -> tuple[bytes, set[int]] | None:
    """One TrueType font from ``pieces`` (subsets of a face), completed from ``donor``.

    Returns the font and the characters taken from the original, or None.
    """
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.cu2quPen import Cu2QuPen
    from fontTools.pens.recordingPen import DecomposingRecordingPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.pens.ttGlyphPen import TTGlyphPen

    pieces = [p for p in pieces if p.cmap]
    if not pieces:
        return None
    upm = pieces[0].upm if 16 <= pieces[0].upm <= 16384 else 1000
    # the first subset that has a character supplies it
    base: dict[int, tuple[Program, str]] = {}
    for program in pieces:
        for code, name in program.cmap.items():
            if code not in base and name in program.glyphs and name != ".notdef":
                base[code] = (program, name)
    own = set(base)

    sources: dict[int, tuple[Program, str, float, float]] = {
        code: (program, name, upm / program.upm, upm / program.upm) for code, (program, name) in base.items()
    }
    if donor is not None:
        sx, sy = _fit(base, donor, upm)
        for code in wanted or WANTED:
            if code not in sources and code in donor.cmap and donor.cmap[code] in donor.glyphs:
                sources[code] = (donor, donor.cmap[code], sx, sy)
    if 0x20 not in sources:
        sources[0x20] = (None, "space", 0.0, 0.0)  # type: ignore[assignment]

    order = [".notdef"]
    cmap: dict[int, str] = {}
    glyphs: dict = {}
    metrics: dict[str, tuple[int, int]] = {}
    empty = TTGlyphPen(None)
    glyphs[".notdef"] = empty.glyph()
    metrics[".notdef"] = (round(upm / 2), 0)
    for code in sorted(sources):
        program, name, sx, sy = sources[code]
        glyph_name = f"uni{code:04X}" if code <= 0xFFFF else f"u{code:06X}"
        pen = TTGlyphPen(None)
        if program is None:  # a space nobody embedded
            glyphs[glyph_name] = pen.glyph()
            metrics[glyph_name] = (round(upm / 4), 0)
        else:
            try:
                target = TransformPen(pen, (sx, 0, 0, sy, 0, 0))
                if program.kind == "cff":
                    # cubic curves become quadratic ones; CFF winds the other way round
                    target = Cu2QuPen(target, max_err=max(0.5, upm / 1000), reverse_direction=True)
                # glyphs built from other glyphs (accented letters) become plain outlines
                recording = DecomposingRecordingPen(program.glyphs)
                program.glyphs[name].draw(recording)
                recording.replay(target)
                glyph = pen.glyph()
            except Exception as exc:
                log.info("glyph %s of %s could not be copied: %s", name, family, exc)
                continue
            glyphs[glyph_name] = glyph
            metrics[glyph_name] = (max(0, round(_advance(program, name) * sx)), 0)
        order.append(glyph_name)
        cmap[code] = glyph_name

    first = pieces[0]
    unit = upm / first.upm
    ascent = round(first.ascent * unit) or round(0.8 * upm)
    descent = round(first.descent * unit) or -round(0.2 * upm)
    if descent > 0:
        descent = -descent

    builder = FontBuilder(upm, isTTF=True)
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap(cmap)
    builder.setupGlyf(glyphs)
    glyf = builder.font["glyf"]
    for name in order:  # left side bearings from the outlines just made
        glyph = glyf[name]
        glyph.recalcBounds(glyf)
        metrics[name] = (metrics[name][0], getattr(glyph, "xMin", 0) or 0)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=ascent, descent=descent)
    ps_name = "".join(ch for ch in f"{family}-{style}" if ch.isalnum() or ch == "-")[:60] or "Font"
    builder.setupNameTable({"familyName": family, "styleName": style, "psName": ps_name})
    builder.setupOS2(sTypoAscender=ascent, sTypoDescender=descent, sTypoLineGap=0,
                     usWinAscent=max(ascent, 0), usWinDescent=max(-descent, 0), fsType=0,
                     usWeightClass=700 if "Bold" in style else 400)
    builder.setupPost()
    out = io.BytesIO()
    builder.font.save(out)
    return out.getvalue(), own


# ------------------------------------------------------------- donors
# Letters are only borrowed from open-licence fonts: the ones bundled in
# FONTS_DIR (backend/fonts, see scripts/fetch_fonts.py) and Google Fonts.
# Bundled look-alikes per generic family, used when nothing closer is found.
_GENERIC = {"serif": "Tinos", "monospace": "Cousine", "sans-serif": "Arimo", "cursive": "Arimo"}
_donors: dict[str, Program | None] = {}


def _load(key: str, read) -> Program | None:
    if key not in _donors:
        program = None
        try:
            data = read()
            program = _ttf_program(data, {}) if data else None
        except Exception as exc:
            log.info("cannot load donor font %s: %s", key, exc)
        _donors[key] = program
    return _donors[key]


def _bundled(family: str, bold: bool, italic: bool) -> Program | None:
    style = STYLES[(1 if bold else 0) + (2 if italic else 0)]
    label = family.replace(" ", "")
    for name in dict.fromkeys((f"{label}-{style}.ttf", f"{label}-{'Bold' if bold else 'Regular'}.ttf")):
        path = settings.fonts_dir / name
        if path.is_file():
            return _load(str(path), path.read_bytes)
    return None


def _google(family: str, bold: bool, italic: bool) -> Program | None:
    """The family from Google Fonts, when Google has it."""
    path = google_font_file(family, bold, italic)
    return _load(str(path), path.read_bytes) if path else None


def donor_for(info) -> Program | None:
    """The font to borrow missing letters from, closest design first: the
    family itself (bundled or on Google Fonts), its known open look-alike,
    then a bundled face of the same kind (serif, sans-serif, monospace)."""
    bold, italic = info.bold, info.italic
    for family in dict.fromkeys(f for f in (info.family, info.google) if f):
        program = _bundled(family, bold, italic) or _google(family, bold, italic)
        if program is not None:
            return program
    return _bundled(_GENERIC.get(info.generic, "Arimo"), bold, italic)
