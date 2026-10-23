from __future__ import annotations

import math
from pathlib import Path

import pymupdf
import pytest

from app.export import Exporter, fill_placeholders
from app.extraction import extract_template
from app.fontmap import map_font
from app.geometry import (
    apply, axis_aligned_rect, d_to_segments, decompose_matrix, segments_to_d, unit_to_page_matrix,
)
from app.storage import LocalStorage


@pytest.mark.parametrize("matrix", [
    (80, 0, 0, 40, 20, 20),                      # plain
    (69.282, -40, 20, 34.641, 180, 115.359),     # rotated 30 degrees counter-clockwise
    (-80, 0, 0, 40, 380, 60),                    # mirrored horizontally
    (80, 0, 0, -40, 20, 100),                    # mirrored vertically
    (0, 80, -40, 0, 240, 30),                    # quarter turn
    (80, 0, 25, 40, 20, 20),                     # sheared
])
def test_matrix_roundtrip(matrix):
    box = decompose_matrix(matrix)
    rebuilt = unit_to_page_matrix(box)
    for corner in ((0, 0), (1, 0), (0, 1), (1, 1)):
        assert apply(rebuilt, *corner) == pytest.approx(apply(matrix, *corner), abs=1e-6)


def test_matrix_decomposition_fields():
    rotated = decompose_matrix((69.282, -40, 20, 34.641, 180, 115.359))
    assert rotated["rotation"] == pytest.approx(-30, abs=1e-3)
    assert (rotated["width"], rotated["height"]) == pytest.approx((80, 40), abs=1e-3)
    assert decompose_matrix((-80, 0, 0, 40, 380, 60)).get("flipX") is True


def test_path_strings():
    segs = d_to_segments("M 0 0 L 10 0 L 10 5 L 0 5 Z M 2 2 C 3 3 4 4 5 5")
    assert segs[4] == ("Z",) and segs[-1][0] == "C"
    assert d_to_segments(segments_to_d(segs)) == segs
    assert axis_aligned_rect(segs[:5]) == (0, 0, 10, 5)
    assert axis_aligned_rect([("M", 0, 0), ("L", 10, 0), ("L", 10, 5), ("L", 0, 5)], closed_only=True) is None


@pytest.mark.parametrize("name,family,weight,italic", [
    ("ABCDEF+Arial-BoldMT", "Arial", "bold", False),
    ("TimesNewRomanPS-ItalicMT", "Times New Roman", "normal", True),
    ("Helvetica-BoldOblique", "Helvetica", "bold", True),
    ("OpenSans-SemiBold", "Open Sans", 600, False),
    ("Roboto-Light", "Roboto", 300, False),
    ("SegoeUI", "Segoe UI", "normal", False),
])
def test_font_mapping(name, family, weight, italic):
    info = map_font(name)
    assert (info.family, info.css_weight, info.italic) == (family, weight, italic)


def test_placeholders():
    assert fill_placeholders("Dear {{ name }},", {"name": "Ada"}) == "Dear Ada,"
    assert fill_placeholders("{{a}} {{b}}", {"a": "1"}) == "1 {{b}}"
    assert fill_placeholders("{{a}} {{b}}", {"a": "1"}, blank_missing=True) == "1 "


@pytest.fixture(scope="module")
def storage(tmp_path_factory) -> LocalStorage:
    return LocalStorage(tmp_path_factory.mktemp("storage"))


def test_brochure_images(samples: Path, storage):
    template = extract_template(samples / "brochure.pdf", "brochure", "brochure", storage)
    first, second = template["pages"]
    images = [el for el in first["elements"] if el["type"] == "image"]
    assert len(images) == 13
    # the logo is placed twice on page 1 and once on page 2 but stored once
    logos = [el for page in template["pages"] for el in page["elements"]
             if el["type"] == "image" and el["naturalWidth"] == 160]
    assert len(logos) == 3 and len({el["src"] for el in logos}) == 1
    assert sum(1 for el in images if el["rotation"]) == 1
    assert next(el for el in images if el["rotation"])["rotation"] == pytest.approx(8, abs=0.01)
    clipped = [el for el in images if el.get("clip")]
    assert len(clipped) == 1 and " C " in clipped[0]["clip"][0]["d"]      # the circular crop
    assert sum(1 for el in second["elements"] if el.get("flipX")) == 1
    # the CMYK JPEG was converted: every stored image opens as RGB(A) or gray
    from PIL import Image
    for el in images:
        with Image.open(storage.local_path(storage.key_from_url(el["src"]))) as img:
            assert img.mode in ("RGB", "RGBA", "L")


def test_rotated_page_is_normalised(samples: Path, storage):
    template = extract_template(samples / "multipage.pdf", "multipage", "multipage", storage)
    page = template["pages"][5]
    assert page["rotation"] == 90 and page["width"] > page["height"]
    texts = [el for el in page["elements"] if el["type"] == "text"]
    assert texts and all(el["rotation"] == 0 for el in texts)
    title = next(el for el in texts if el["content"].startswith("6."))
    assert title["x"] == pytest.approx(40, abs=0.5)
    justified = [el for p in template["pages"] for el in p["elements"] if el.get("align") == "justify"]
    assert justified and all("\n" in el["content"] for el in justified)


def test_embedded_fonts_are_reused(samples: Path, storage):
    template = extract_template(samples / "certificate.pdf", "certificate", "certificate", storage)
    embedded = [f for f in template["fonts"] if f["embedded"]]
    if not embedded:
        pytest.skip("sample was generated without an embeddable TrueType font")
    assert all(f["usable"] and f["src"] and f["format"] == "truetype" for f in embedded)
    font = pymupdf.Font(fontbuffer=storage.read(storage.key_from_url(embedded[0]["file"])))
    assert font.has_glyph(ord("C"))   # the repaired subset can be addressed by Unicode
    rotated = [el for el in template["pages"][0]["elements"] if el["type"] == "text" and el["rotation"]]
    assert len(rotated) == 1 and rotated[0]["rotation"] == pytest.approx(-90)


def test_roundtrip_positions(samples: Path, storage):
    """Export and re-read: every image and shape lands where the original had it."""
    source = samples / "brochure.pdf"
    template = extract_template(source, "roundtrip", "roundtrip", storage)
    exported = pymupdf.open(stream=Exporter(template, storage).render(), filetype="pdf")
    original = pymupdf.open(str(source))
    for a, b in zip(original, exported):
        boxes_a = [i["bbox"] for i in a.get_image_info()]
        boxes_b = [i["bbox"] for i in b.get_image_info()]
        assert len(boxes_a) == len(boxes_b)
        for ra, rb in zip(boxes_a, boxes_b):
            assert max(abs(p - q) for p, q in zip(ra, rb)) < 0.05


def test_edited_text_keeps_alignment(samples: Path, storage):
    template = extract_template(samples / "invoice.pdf", "edit", "edit", storage)
    total = next(el for el in template["pages"][0]["elements"] if el.get("content", "").startswith("£10,344"))
    assert total["align"] == "right"
    right_edge = total["x"] + total["width"]
    total["content"] = "£99.00"
    page = pymupdf.open(stream=Exporter(template, storage).render(), filetype="pdf")[0]
    word = next(w for w in page.get_text("words") if w[4] == "£99.00")
    assert word[2] == pytest.approx(right_edge, abs=0.3)   # still ends at the column's right edge
    assert not math.isclose(word[0], total["x"], abs_tol=1)


def test_edited_text_follows_its_box(samples: Path, storage):
    """The editor re-measures edited text and moves the box; export must follow the box."""
    template = extract_template(samples / "invoice.pdf", "edit2", "edit2", storage)
    title = next(el for el in template["pages"][0]["elements"] if el.get("content") == "INVOICE")
    right_edge = title["x"] + title["width"]
    title.update(content="RECEIPT", width=130.0, x=right_edge - 130.0)
    page = pymupdf.open(stream=Exporter(template, storage).render(), filetype="pdf")[0]
    word = next(w for w in page.get_text("words") if w[4] == "RECEIPT")
    assert word[2] == pytest.approx(right_edge, abs=0.3)


def test_runs_of_spaces_are_kept(samples: Path, storage):
    template = extract_template(samples / "invoice.pdf", "spaces", "spaces", storage)
    texts = [el["content"] for el in template["pages"][0]["elements"] if el["type"] == "text"]
    assert any("20-45-11   Account" in t for t in texts)
    # and they still round-trip to the same place
    original = pymupdf.open(str(samples / "invoice.pdf"))[0]
    exported = pymupdf.open(stream=Exporter(template, storage).render(), filetype="pdf")[0]
    a = {w[4]: w[0] for w in original.get_text("words")}
    b = {w[4]: w[0] for w in exported.get_text("words")}
    assert b["Account:"] == pytest.approx(a["Account:"], abs=0.05)
