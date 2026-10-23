"""Embedded fonts: extract, make reusable, and describe for the editor/export.

Fonts embedded in PDFs are usually subsets whose character map was stripped
(the PDF addresses glyphs by id), so they cannot set text from Unicode as they
are. We know which glyph id each character used, so we write that mapping back
into the font. All subsets of one face are then merged into a single font and
completed with the letters the document never used (see ``fontbuild``), so
new text can be set in the original face too.
"""
from __future__ import annotations

import io
import logging
import re
import struct

import pymupdf

from ..fontmap import map_font, normalise
from .context import ExtractionContext, FontUse
from .fontbuild import build_font, donor_for, read_program

log = logging.getLogger(__name__)

_WEB_FORMATS = {"ttf": "truetype", "otf": "opentype"}


def _covers(buf: bytes, chars: set[int]) -> bool:
    try:
        font = pymupdf.Font(fontbuffer=buf)
    except Exception:
        return False
    return all(font.has_glyph(c) for c in chars)


def embedding_license(buf: bytes) -> str:
    """Read OS/2.fsType from an sfnt font: installable | editable | preview-print | restricted | unknown."""
    try:
        if buf[:4] not in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
            return "unknown"
        num_tables = struct.unpack(">H", buf[4:6])[0]
        for i in range(num_tables):
            tag, _sum, offset, length = struct.unpack(">4sLLL", buf[12 + 16 * i: 28 + 16 * i])
            if tag == b"OS/2" and length >= 10:
                fs_type = struct.unpack(">H", buf[offset + 8: offset + 10])[0]
                if fs_type & 0x0002:
                    return "restricted"
                if fs_type & 0x0008:
                    return "editable"
                if fs_type & 0x0004:
                    return "preview-print"
                return "installable"
    except (struct.error, IndexError):
        pass
    return "unknown"


def repair_sfnt(buf: bytes, gids: dict[int, int], family: str, style: str) -> bytes | None:
    """Give a (subset) TrueType/OpenType font a Unicode cmap and the tables browsers require."""
    try:
        from fontTools.fontBuilder import FontBuilder
        from fontTools.ttLib import TTFont, newTable
        from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
    except ImportError:
        return None
    try:
        font = TTFont(io.BytesIO(buf), recalcTimestamp=False)
        is_ttf = "glyf" in font
        if not is_ttf and "CFF " not in font:
            return None
        if any(t not in font for t in ("head", "hhea", "hmtx", "maxp")):
            return None
        if is_ttf:
            count = font["maxp"].numGlyphs
            font.setGlyphOrder([".notdef"] + [f"glyph{i:05d}" for i in range(1, count)])
        order = font.getGlyphOrder()
        known = set(order)

        mapping: dict[int, str] = {}
        if "cmap" in font:
            try:
                for table in font["cmap"].tables:
                    if table.isUnicode():
                        mapping.update({c: n for c, n in table.cmap.items() if n in known})
            except Exception:
                mapping = {}
        for uni, gid in gids.items():
            if 0 < gid < len(order):
                mapping[uni] = order[gid]
        if not mapping:
            return None

        cmap = newTable("cmap")
        cmap.tableVersion = 0
        bmp = CmapSubtable.newSubtable(4)
        bmp.platformID, bmp.platEncID, bmp.language = 3, 1, 0
        bmp.cmap = {c: n for c, n in mapping.items() if c <= 0xFFFF}
        cmap.tables = [bmp]
        if any(c > 0xFFFF for c in mapping):
            full = CmapSubtable.newSubtable(12)
            full.platformID, full.platEncID, full.language = 3, 10, 0
            full.cmap = dict(mapping)
            cmap.tables.append(full)
        font["cmap"] = cmap

        builder = FontBuilder(font=font)
        if "name" not in font:
            builder.setupNameTable({"familyName": family, "styleName": style})
        if "OS/2" not in font:
            hhea = font["hhea"]
            builder.setupOS2(sTypoAscender=hhea.ascent, sTypoDescender=hhea.descent,
                             usWinAscent=max(hhea.ascent, 0), usWinDescent=max(-hhea.descent, 0))
        if is_ttf or "post" not in font:
            builder.setupPost(keepGlyphNames=False)

        out = io.BytesIO()
        font.save(out)
        return out.getvalue()
    except Exception as exc:
        log.info("font repair failed for %s: %s", family, exc)
        return None


def _describe(use: FontUse) -> dict:
    info = map_font(use.name, use.flags)
    return {
        "id": use.id,
        "name": use.name,
        "family": info.family,
        "generic": info.generic,
        "googleFont": info.google,
        "weight": info.css_weight,
        "style": "italic" if info.italic else "normal",
        "embedded": use.ext != "n/a",
        "subset": use.basefont != use.name,
        "format": None,       # CSS font format when `src` is set
        "src": None,          # URL the browser can load with @font-face
        "file": None,         # URL of the font program used by PDF export
        "usable": False,      # the stored program covers every character the PDF uses
        "license": "unknown",
        "pages": sorted(use.pages),
    }


def _cid_widths(doc: pymupdf.Document, xref: int) -> tuple[dict[int, float], float] | None:
    """A Type0 font's widths per CID and its default width (the descendant's /W and /DW)."""
    def value(obj: int, key: str) -> str:
        kind, text = doc.xref_get_key(obj, key)
        if kind == "xref":
            text = doc.xref_object(int(text.split()[0]), compressed=True)
        return "" if kind == "null" else text

    try:
        match = re.search(r"(\d+)\s+0\s+R", value(xref, "DescendantFonts"))
        if not match:
            return None
        descendant = int(match.group(1))
        if doc.xref_get_key(descendant, "CIDToGIDMap")[0] == "xref":
            return None  # CIDs are not glyph ids here: the widths could not be matched to glyphs
        default = float(value(descendant, "DW") or 1000)
        tokens = re.findall(r"\[|\]|-?\d+(?:\.\d+)?", value(descendant, "W"))[1:-1]
    except Exception:
        return None
    widths: dict[int, float] = {}
    i = 0
    try:
        while i < len(tokens):
            if tokens[i + 1] == "[":     # c [w1 w2 ...]
                cid, i = int(float(tokens[i])), i + 2
                while tokens[i] != "]":
                    widths[cid] = float(tokens[i])
                    cid, i = cid + 1, i + 1
                i += 1
            else:                        # c_first c_last w
                for cid in range(int(float(tokens[i])), int(float(tokens[i + 1])) + 1):
                    widths[cid] = float(tokens[i + 2])
                i += 3
    except (IndexError, ValueError):
        pass  # a malformed tail: keep what was read
    return widths, default


def _complete_fonts(ctx: ExtractionContext, programs: dict[str, tuple[bytes, str]],
                    entries: dict[str, dict]) -> set[str]:
    """Build one completed font per face from all its subsets (see ``fontbuild``).

    Returns the ids of the fonts that now use it.
    """
    groups: dict[str, list[FontUse]] = {}
    for fid, use in ctx.fonts.items():
        if fid in programs:
            groups.setdefault(normalise(use.name), []).append(use)
    done: set[str] = set()
    for uses in groups.values():
        pieces = []
        for use in uses:
            buf, ext = programs[use.id]
            widths = _cid_widths(ctx.doc, use.xref) if use.kind == "Type0" else None
            program = read_program(buf, ext, use.gids, widths)
            if program is not None:
                pieces.append(program)
        if not pieces:
            continue
        info = map_font(uses[0].name, uses[0].flags)
        style = ("Bold " if info.bold else "") + ("Italic" if info.italic else "")
        style = style.strip() or "Regular"
        try:
            donor = donor_for(info)
            built = build_font(pieces, donor, info.family, style)
        except Exception as exc:
            log.info("could not build a font for %s: %s", uses[0].name, exc)
            built = None
        if built is None:
            continue
        data = built[0]
        url = None
        for use in uses:
            if not _covers(data, use.chars):
                continue
            url = url or ctx.save(data, "fonts", f"{use.id}.ttf")
            entries[use.id].update(usable=True, file=url, src=url, format="truetype", completed=donor is not None)
            done.add(use.id)
    return done


def finalize_fonts(ctx: ExtractionContext) -> list[dict]:
    """Extract every font used by visible text and report what can be reused."""
    out: list[dict] = []
    programs: dict[str, tuple[bytes, str]] = {}
    entries: dict[str, dict] = {}
    for use in ctx.fonts.values():
        if not use.chars:
            continue
        entry = _describe(use)
        out.append(entry)
        entries[use.id] = entry
        if use.ext == "n/a" or not use.xref:
            continue
        try:
            _name, ext, _kind, buf = ctx.doc.extract_font(use.xref)
        except Exception as exc:
            log.info("extract_font(%d) failed: %s", use.xref, exc)
            continue
        if not buf or ext == "n/a":
            continue  # e.g. Type3 fonts have no extractable program

        entry["license"] = embedding_license(buf)
        if entry["license"] == "restricted":
            ctx.warn("font_restricted", f'Font "{use.name}" forbids embedding; a substitute will be used.')
            continue
        programs[use.id] = (buf, ext)

    completed = _complete_fonts(ctx, programs, entries)
    for fid, (buf, ext) in programs.items():
        if fid in completed:
            continue
        use, entry = ctx.fonts[fid], entries[fid]
        info = map_font(use.name, use.flags)
        style = ("Bold " if info.bold else "") + ("Italic" if info.italic else "") or "Regular"
        usable = _covers(buf, use.chars)
        web_ready = False
        if ext in _WEB_FORMATS:
            fixed = repair_sfnt(buf, use.gids, info.family, style.strip())
            if fixed is not None and _covers(fixed, use.chars):
                buf, usable, web_ready = fixed, True, True
        if not usable:
            ctx.warn("font_unusable", f'Embedded font "{use.name}" could not be reused; '
                                      f'text will use "{info.google or info.family}" instead.')
            continue

        url = ctx.save(buf, "fonts", f"{use.id}.{ext}")
        entry.update(usable=True, file=url)
        if web_ready:
            entry.update(src=url, format=_WEB_FORMATS[ext])
    return out
