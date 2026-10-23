"""Round-trip accuracy test: PDF -> template JSON -> PDF, compared with the original.

    python scripts/diff_test.py                 # every PDF in /samples
    python scripts/diff_test.py path/to/a.pdf   # specific files
    python scripts/diff_test.py --dpi 150 --password secret some.pdf

For each page it reports
  similar   100% = pixel-identical renders (mean absolute difference)
  changed   share of pixels that differ visibly
  img/shape/text  largest position error in PDF points, measured by reading the
                  exported PDF back: image and path boxes are compared one by
                  one in paint order, text by the baseline origin of each glyph

Artifacts go to /test-output/<name>/: template.json, export.pdf and, per page,
a side-by-side PNG (original | export | difference).
Exit code is 1 if any page misses the thresholds.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

from app.export import Exporter  # noqa: E402
from app.extraction import Options, extract_template  # noqa: E402
from app.storage import LocalStorage  # noqa: E402

OUT = ROOT / "test-output"
VISIBLE_DIFF = 40        # per-channel difference (0-255) that counts as a changed pixel


def render(page: pymupdf.Page, dpi: int) -> np.ndarray:
    pix = page.get_pixmap(dpi=dpi, alpha=False)
    return np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3).astype(np.int16)


def max_box_error(a: list, b: list) -> float | None:
    """Largest corner offset between two equally long lists of boxes, else None."""
    if len(a) != len(b):
        return None
    return max((max(abs(p - q) for p, q in zip(ra, rb)) for ra, rb in zip(a, b)), default=0.0)


def nearest_box_error(boxes: list, reference: list) -> float | None:
    """Largest distance from a box to its closest match in ``reference``."""
    if not boxes:
        return 0.0
    if not reference:
        return None
    ref = np.array(reference)
    return max(float(np.abs(ref - np.array(b)).max(axis=1).min()) for b in boxes)


def shape_boxes(page: pymupdf.Page) -> list[tuple]:
    """Path boxes in paint order. A path that is filled and stroked may be
    reported as one entry or two, so identical neighbours are merged."""
    out: list[tuple] = []
    for d in page.get_drawings():
        box = tuple(d["rect"])
        if not out or max(abs(p - q) for p, q in zip(out[-1], box)) > 0.01:
            out.append(box)
    return out


def glyph_origins(page: pymupdf.Page) -> dict[str, np.ndarray]:
    """Baseline origin of every visible glyph, grouped by character."""
    flags = pymupdf.TEXTFLAGS_RAWDICT & ~pymupdf.TEXT_PRESERVE_IMAGES
    found: dict[str, list] = {}
    for block in page.get_text("rawdict", flags=flags)["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                for ch in span["chars"]:
                    if not ch["c"].isspace():
                        found.setdefault(ch["c"], []).append(ch["origin"])
    return {c: np.array(pts) for c, pts in found.items()}


def max_glyph_error(a: dict[str, np.ndarray], b: dict[str, np.ndarray]) -> float | None:
    """Largest distance from a glyph in ``a`` to the nearest same glyph in ``b``."""
    if {c: len(p) for c, p in a.items()} != {c: len(p) for c, p in b.items()}:
        return None
    worst = 0.0
    for c, pts in a.items():
        dist = np.abs(pts[:, None, :] - b[c][None, :, :]).max(axis=2)
        worst = max(worst, float(dist.min(axis=1).max()))
    return worst


def object_boxes(page: pymupdf.Page) -> dict:
    return {
        # zero-area placements (hairline gradient strips etc.) paint nothing
        "img": [b for b in (tuple(i["bbox"]) for i in page.get_image_info())
                if b[2] - b[0] > 0.01 and b[3] - b[1] > 0.01],
        "shape": shape_boxes(page),
        "glyphs": glyph_origins(page),
    }


def compare_page(orig: pymupdf.Page, new: pymupdf.Page, dpi: int, out_png: Path) -> dict:
    if orig.rotation:
        orig.remove_rotation()   # same appearance, coordinates in displayed orientation
    a, b = render(orig, dpi), render(new, dpi)
    h, w = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[:h, :w], b[:h, :w]
    diff = np.abs(a - b)
    result = {
        "similar": 100.0 * (1 - diff.mean() / 255),
        "changed": 100.0 * (diff.max(axis=2) > VISIBLE_DIFF).mean(),
    }
    boxes_a, boxes_b = object_boxes(orig), object_boxes(new)
    result["img"] = max_box_error(boxes_a["img"], boxes_b["img"])
    result["img_n"] = (len(boxes_a["img"]), len(boxes_b["img"]))
    # Every exported shape must sit on an original one. (The reverse need not
    # hold: a fill drawn through a soft mask is exported as an image.)
    result["shape"] = nearest_box_error(boxes_b["shape"], boxes_a["shape"])
    result["shape_n"] = (len(boxes_a["shape"]), len(boxes_b["shape"]))
    result["text"] = max_glyph_error(boxes_a["glyphs"], boxes_b["glyphs"])
    result["text_n"] = tuple(sum(len(p) for p in g.values()) for g in (boxes_a["glyphs"], boxes_b["glyphs"]))

    heat = 255 - np.clip(diff.max(axis=2) * 4, 0, 255).astype(np.uint8)
    panel = np.concatenate([a.astype(np.uint8), b.astype(np.uint8), np.stack([heat] * 3, axis=2)], axis=1)
    Image.fromarray(panel).save(out_png)
    return result


def run(pdf: Path, dpi: int, password: str | None, storage: LocalStorage) -> list[dict]:
    name = pdf.stem
    out_dir = OUT / name
    out_dir.mkdir(parents=True, exist_ok=True)
    storage.delete_prefix(name)

    t0 = time.perf_counter()
    template = extract_template(pdf, name, pdf.stem, storage, password=password, options=Options())
    t1 = time.perf_counter()
    exported = Exporter(template, storage).render()
    t2 = time.perf_counter()
    (out_dir / "template.json").write_text(json.dumps(template, indent=2, ensure_ascii=False), encoding="utf-8")
    (out_dir / "export.pdf").write_bytes(exported)

    orig = pymupdf.open(str(pdf))
    if orig.needs_pass:
        orig.authenticate(password or "")
    new = pymupdf.open(stream=exported, filetype="pdf")
    rows = []
    for i in range(orig.page_count):
        row = compare_page(orig[i], new[i], dpi, out_dir / f"page{i + 1}.png")
        row.update(file=pdf.name, page=i + 1, elements=len(template["pages"][i]["elements"]))
        rows.append(row)
    counts: dict[str, int] = {}
    for page in template["pages"]:
        for el in page["elements"]:
            counts[el["type"]] = counts.get(el["type"], 0) + 1
    print(f"\n{pdf.name}: {orig.page_count} page(s), "
          + ", ".join(f"{v} {k}s" for k, v in sorted(counts.items()))
          + f"  |  extract {t1 - t0:.2f}s, export {t2 - t1:.2f}s")
    for wmsg in template["warnings"]:
        print(f"  warning [{wmsg['code']}] {wmsg['message']}")
    usable = [f["name"] for f in template["fonts"] if f["usable"]]
    if usable:
        print(f"  embedded fonts reused: {', '.join(usable)}")
    return rows


def fmt_err(row: dict, kind: str) -> str:
    value = row[kind]
    if value is None:
        a, b = row[kind + "_n"]
        return f"n/a {a}v{b}" if a != b else "n/a"
    return f"{value:.2f}pt"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pdfs", nargs="*", type=Path, help="PDF files (default: every PDF in /samples)")
    ap.add_argument("--dpi", type=int, default=100)
    ap.add_argument("--password")
    ap.add_argument("--min-similar", type=float, default=99.0, help="fail a page below this similarity %%")
    ap.add_argument("--max-changed", type=float, default=1.5, help="fail a page above this changed-pixel %%")
    ap.add_argument("--max-offset", type=float, default=2.0, help="fail if any object is off by more (pt)")
    args = ap.parse_args()

    pdfs = args.pdfs or sorted((ROOT / "samples").glob("*.pdf"))
    if not pdfs:
        print("no PDFs found; run scripts/make_samples.py first")
        return 1
    storage = LocalStorage(OUT / "storage", "/storage")
    rows: list[dict] = []
    for pdf in pdfs:
        rows += run(pdf, args.dpi, args.password, storage)

    print(f"\n{'file':<18}{'page':>4}{'elements':>10}{'similar':>10}{'changed':>10}{'img':>12}{'shape':>12}{'text':>12}  result")
    failed = 0
    for r in rows:
        offsets = [r[k] for k in ("img", "shape", "text")]
        ok = (r["similar"] >= args.min_similar and r["changed"] <= args.max_changed
              and all(v is not None and v <= args.max_offset for v in offsets))
        failed += not ok
        print(f"{r['file']:<18}{r['page']:>4}{r['elements']:>10}{r['similar']:>9.3f}%{r['changed']:>9.3f}%"
              f"{fmt_err(r, 'img'):>12}{fmt_err(r, 'shape'):>12}{fmt_err(r, 'text'):>12}  {'ok' if ok else 'FAIL'}")
    print(f"\n{len(rows) - failed}/{len(rows)} pages within thresholds "
          f"(similar >= {args.min_similar}%, changed <= {args.max_changed}%, "
          f"image/shape/text offsets <= {args.max_offset}pt). "
          f"Artifacts: {OUT}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
