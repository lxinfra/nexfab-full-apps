from __future__ import annotations

import pymupdf
import pytest
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.ttLib import TTFont

from app.config import settings
from app.extraction import extract_template
from app.extraction.fontbuild import build_font, donor_for, read_program
from app.fontmap import map_font
from app.storage import LocalStorage

from .conftest import SAMPLES

NEW_TEXT = "Quiz Wqxz 0123 €"


@pytest.fixture(scope="module")
def storage(tmp_path_factory) -> LocalStorage:
    return LocalStorage(tmp_path_factory.mktemp("storage"))


def bare_cff(letters: str) -> tuple[bytes, dict[int, int], dict[str, int]]:
    """A bare CFF subset of Tinos holding only ``letters``, as a PDF embeds one
    (no character map: the PDF addresses glyphs by number)."""
    source = TTFont(settings.fonts_dir / "Tinos-Regular.ttf")
    glyph_set, cmap = source.getGlyphSet(), source.getBestCmap()
    names = [".notdef"] + [f"g{i}" for i in range(1, len(letters) + 1)]
    strings, widths = {}, {}
    for name, ch in zip(names, " " + letters):
        width = glyph_set[cmap[ord(ch)]].width if name != ".notdef" else 0
        pen = T2CharStringPen(width, glyph_set)
        if name != ".notdef":
            glyph_set[cmap[ord(ch)]].draw(pen)
            widths[name] = width
        strings[name] = pen.getCharString()
    builder = FontBuilder(source["head"].unitsPerEm, isTTF=False)
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({})
    builder.setupCFF("Subset", {"FullName": "Subset"}, strings, {})
    gids = {ord(ch): i for i, ch in enumerate(letters, start=1)}
    return builder.font["CFF "].compile(builder.font), gids, widths


def test_bare_cff_subset_becomes_a_complete_font():
    data, gids, widths = bare_cff("Helo wrd")
    program = read_program(data, "cff", gids)
    assert program is not None and program.kind == "cff" and set(program.cmap) == set(gids)

    info = map_font("Times-Roman")
    built, own = build_font([program], donor_for(info), info.family, "Regular")
    assert own == set(gids)
    font = pymupdf.Font(fontbuffer=built)
    # the subset's letters keep their widths; letters it never had are borrowed
    assert round(font.glyph_advance(ord("H")) * program.upm) == round(widths["g1"])
    assert all(font.has_glyph(ord(ch)) for ch in "Hello world " + NEW_TEXT)


def test_subsets_of_one_face_are_merged():
    first, first_gids, _ = bare_cff("abc")
    second, second_gids, _ = bare_cff("xyz")
    pieces = [read_program(first, "cff", first_gids), read_program(second, "cff", second_gids)]
    _built, own = build_font(pieces, None, "Times New Roman", "Regular")
    assert own == {ord(ch) for ch in "abcxyz"}


def test_uploaded_fonts_cover_new_text(storage):
    template = extract_template(SAMPLES / "certificate.pdf", "certificate-fonts", "certificate", storage)
    embedded = [f for f in template["fonts"] if f["embedded"]]
    assert embedded and all(f["usable"] and f["format"] == "truetype" and f["completed"] for f in embedded)
    for entry in embedded:
        font = pymupdf.Font(fontbuffer=storage.read(storage.key_from_url(entry["file"])))
        assert all(font.has_glyph(ord(ch)) for ch in NEW_TEXT), entry["name"]


def test_the_pdf_widths_win_over_the_program():
    data, gids, _ = bare_cff("Hi")
    # the PDF's /W widths (1/1000 em) per CID; here CID = glyph id
    program = read_program(data, "cff", gids, ({1: 700}, 250))
    built, _own = build_font([program], None, "Times New Roman", "Regular")
    font = pymupdf.Font(fontbuffer=built)
    assert round(font.glyph_advance(ord("H")), 3) == 0.7
    assert round(font.glyph_advance(ord("i")), 3) == 0.25
