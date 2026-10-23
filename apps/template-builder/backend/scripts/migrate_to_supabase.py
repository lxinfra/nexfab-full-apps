"""Copy the templates kept on this computer (SQLite + /storage) into Supabase.

    python scripts/migrate_to_supabase.py            # copy everything not there yet
    python scripts/migrate_to_supabase.py --dry-run  # only say what would be copied

Needs ``backend/.env`` with DATABASE_URL and the SUPABASE_ values. Templates
already in Supabase are skipped, so it is safe to run again; nothing local is
changed or deleted.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, selectinload

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db import Element, Page, Template, engine, init_db  # noqa: E402
from app.storage import SupabaseStorage, get_storage  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="list what would be copied, copy nothing")
    parser.add_argument("--database", type=Path, default=settings.data_dir / "templates.db", help="local SQLite file")
    parser.add_argument("--files", type=Path, default=settings.storage_dir, help="local storage folder")
    args = parser.parse_args()

    storage = get_storage()
    if engine.dialect.name != "postgresql" or not isinstance(storage, SupabaseStorage):
        print("Supabase is not configured: set DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY in backend/.env")
        return 1
    if not args.database.is_file():
        print(f"No local database at {args.database}: nothing to copy.")
        return 0

    init_db()
    local = create_engine(f"sqlite:///{args.database.as_posix()}")
    copied = skipped = 0
    with Session(local) as source, Session(engine, expire_on_commit=False) as target:
        present = set(target.scalars(select(Template.id)))
        templates = source.scalars(
            select(Template).order_by(Template.created_at)
            .options(selectinload(Template.pages).selectinload(Page.elements))
        ).all()
        for template in templates:
            folder = args.files / template.id
            files = [path for path in folder.rglob("*") if path.is_file()] if folder.is_dir() else []
            size = sum(path.stat().st_size for path in files)
            label = f"{template.id}  {template.page_count:3d} page(s)  {len(files):3d} file(s)  {size / 2**20:5.1f} MB"
            if not args.dry_run:
                # the files are already on this computer: no need to download them again later
                for path in files:
                    cached = storage.root / path.relative_to(args.files)
                    if not cached.is_file():
                        cached.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(path, cached)
            if template.id in present:
                print(f"skip    {label}  (already in Supabase)")
                skipped += 1
                continue
            if args.dry_run:
                print(f"would copy  {label}")
                continue
            # files first: a template row never points at files that are not there
            for path in files:
                storage._submit(path.relative_to(args.files).as_posix(), path)
            storage.flush()
            row = Template(
                id=template.id, name=template.name, original_filename=template.original_filename,
                page_count=template.page_count, fonts=template.fonts, warnings=template.warnings,
                created_at=template.created_at, updated_at=template.updated_at,
            )
            for page in template.pages:
                copy = Page(index=page.index, width=page.width, height=page.height, rotation=page.rotation,
                            preview=page.preview, scanned=page.scanned, tables=page.tables)
                copy.elements = [Element(z=el.z, type=el.type, data=el.data) for el in page.elements]
                row.pages.append(copy)
            target.add(row)
            target.commit()
            print(f"copied  {label}")
            copied += 1
    print(f"\n{copied} template(s) copied, {skipped} already there.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
