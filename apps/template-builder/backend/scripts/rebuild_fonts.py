"""Rebuild the fonts of templates uploaded before fonts were completed.

Each template's source PDF is read again for its fonts only: every embedded
font is merged and completed (see app/extraction/fontbuild.py), stored next
to the template's other files, and the template's font list is replaced.
Pages, text and everything edited in the editor are left as they are.

    python scripts/rebuild_fonts.py --dry-run     # say what would change, change nothing
    python scripts/rebuild_fonts.py               # every template
    python scripts/rebuild_fonts.py ID [ID ...]   # only these templates

Works on whatever backend/.env points at (this computer or Supabase).
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal, Template  # noqa: E402
from app.extraction.context import ExtractionContext, Options  # noqa: E402
from app.extraction.fonts import finalize_fonts  # noqa: E402
from app.extraction.pipeline import open_pdf  # noqa: E402
from app.extraction.text import extract_text  # noqa: E402
from app.storage import LocalStorage, Storage, get_storage  # noqa: E402


def font_list(path: Path, template_id: str, storage: Storage) -> list[dict]:
    doc = open_pdf(path, None)
    try:
        ctx = ExtractionContext(doc, template_id, storage, Options())
        for page in doc:
            extract_text(page, page.number + 1, ctx, ctx.page_fonts(page))
        return finalize_fonts(ctx)
    finally:
        doc.close()


def summary(fonts: list[dict]) -> str:
    embedded = [f for f in fonts if f.get("embedded")]
    shown = sum(1 for f in embedded if f.get("src"))
    return f"{shown} of {len(embedded)} embedded fonts usable in the editor"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("ids", nargs="*", help="template ids (default: all)")
    parser.add_argument("--dry-run", action="store_true", help="change nothing, only report")
    args = parser.parse_args()

    storage = get_storage()
    scratch = LocalStorage(Path(tempfile.mkdtemp(prefix="ptb-fonts-")))
    failed = 0
    with SessionLocal() as db:
        query = select(Template).order_by(Template.created_at)
        if args.ids:
            query = query.where(Template.id.in_(args.ids))
        for template in db.execute(query).scalars():
            label = f"{template.name} ({template.id})"
            try:
                source = storage.local_path(f"{template.id}/source.pdf")
                fonts = font_list(source, template.id, scratch if args.dry_run else storage)
            except Exception as exc:   # e.g. password-protected or missing source
                failed += 1
                print(f"skipped  {label}: {exc}")
                continue
            print(f"{'would be' if args.dry_run else 'rebuilt '} {label}: "
                  f"{summary(template.fonts or [])} -> {summary(fonts)}")
            if not args.dry_run:
                storage.flush()            # the font files are stored before the list points at them
                template.fonts = fonts
                db.commit()
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
