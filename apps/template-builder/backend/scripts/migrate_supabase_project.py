"""Copy everything from one Supabase project to another: templates (database rows),
their files (Storage bucket) and the sign-in accounts (Supabase Auth, with their
passwords, so nobody has to sign up again).

    python scripts/migrate_supabase_project.py --from old.env --to new.env [--dry-run]

Each env file holds DATABASE_URL, SUPABASE_URL and SUPABASE_SERVICE_KEY (and
optionally SUPABASE_BUCKET). Templates already present in the target are skipped,
so the script can be run again. The source project is never changed.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, selectinload

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import Base, Element, Page, Template  # noqa: E402
from app.storage import SupabaseStorage  # noqa: E402

AUTH_TABLES = ("users", "identities")   # what a password sign-in needs


def retry(action, session: Session, attempts: int = 4):
    """Run a read again when the connection drops (the session is rolled back in between)."""
    import time
    for attempt in range(attempts):
        try:
            return action()
        except Exception as exc:  # noqa: BLE001
            if attempt == attempts - 1:
                raise
            print(f"   connection trouble ({str(exc).splitlines()[0][:60]}), trying again")
            session.rollback()
            time.sleep(3 * (attempt + 1))
    return None


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("'\"")
    for key in ("DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"):
        if not values.get(key):
            sys.exit(f"{path}: {key} is missing")
    values["DATABASE_URL"] = re.sub(r"^postgres(ql)?://", "postgresql+psycopg://", values["DATABASE_URL"])
    values.setdefault("SUPABASE_BUCKET", "templates")
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--from", dest="source", type=Path, required=True)
    parser.add_argument("--to", dest="target", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--cache", type=Path, default=Path(__file__).resolve().parents[2] / "data" / "migration-cache")
    parser.add_argument("--source-cache", type=Path, default=Path(__file__).resolve().parents[2] / "data" / "cache",
                        help="this computer's cache of the source project's files (used before downloading)")
    args = parser.parse_args()
    src, dst = read_env(args.source), read_env(args.target)
    if src["SUPABASE_URL"] == dst["SUPABASE_URL"]:
        sys.exit("source and target are the same project")

    src_engine = create_engine(src["DATABASE_URL"], pool_pre_ping=True)
    dst_engine = create_engine(dst["DATABASE_URL"], pool_pre_ping=True)
    src_store = SupabaseStorage(src["SUPABASE_URL"], src["SUPABASE_SERVICE_KEY"], src["SUPABASE_BUCKET"], args.source_cache)
    dst_store = SupabaseStorage(dst["SUPABASE_URL"], dst["SUPABASE_SERVICE_KEY"], dst["SUPABASE_BUCKET"], args.cache / "to")

    # the (empty) tables are made even on a dry run, so that "already there" can be checked
    Base.metadata.create_all(dst_engine)
    with dst_engine.begin() as conn:
        for table in Base.metadata.sorted_tables:
            conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ENABLE ROW LEVEL SECURITY')
    if not args.dry_run:
        dst_store.ensure_bucket()

    # ---- templates, pages, elements, and every file under the template's folder
    copied = skipped = 0
    with Session(src_engine) as source, Session(dst_engine, expire_on_commit=False) as target:
        present = set(target.scalars(select(Template.id)))
        ids = list(source.scalars(select(Template.id).order_by(Template.created_at)))
        for template_id in ids:
            # one template at a time, its elements page by page: a distant database drops a
            # connection that carries too much at once, and a dropped one is tried again
            template = retry(lambda: source.scalar(select(Template).where(Template.id == template_id)
                                                   .options(selectinload(Template.pages))), source)
            if template is None:
                continue
            if template.id in present:
                print(f"skip    {template.id}  {template.page_count:3d} page(s)")
                skipped += 1
                continue
            elements_of = {page.id: retry(lambda page=page: list(source.scalars(
                select(Element).where(Element.page_id == page.id).order_by(Element.z))), source) for page in template.pages}
            # the files: what the bucket lists, or, when it cannot be reached, what this computer has cached
            cached = [p.relative_to(args.source_cache).as_posix() for p in (args.source_cache / template.id).rglob("*") if p.is_file()]
            try:
                files = sorted(set(src_store._list(template.id)) | set(cached))
            except Exception as exc:  # noqa: BLE001
                print(f"   (bucket not reachable for {template.id}: {str(exc)[:50]}; using {len(cached)} cached files)")
                files = cached
            label = f"{template.id}  {template.page_count:3d} page(s)  {len(files):3d} file(s)"
            if args.dry_run:
                print(f"would copy  {label}")
                continue
            for key in files:
                try:
                    path = src_store.local_path(key)      # from the cache, else downloaded into it
                except Exception as exc:  # noqa: BLE001
                    print(f"   file {key} could not be fetched: {str(exc)[:60]}")
                    continue
                if path.is_file():
                    dst_store._submit(key, path)
            dst_store.flush()
            row = Template(
                id=template.id, name=template.name, owner_id=template.owner_id, original_filename=template.original_filename,
                page_count=template.page_count, fonts=template.fonts, warnings=template.warnings,
                created_at=template.created_at, updated_at=template.updated_at,
            )
            for page in template.pages:
                copy = Page(index=page.index, width=page.width, height=page.height, rotation=page.rotation,
                            preview=page.preview, scanned=page.scanned, tables=page.tables)
                copy.elements = [Element(z=el.z, type=el.type, data=el.data) for el in elements_of[page.id]]
                row.pages.append(copy)
            target.add(row)
            target.commit()
            source.expunge_all()
            print(f"copied  {label}")
            copied += 1
    print(f"{copied} template(s) copied, {skipped} already there.")

    # ---- sign-in accounts: the rows of Supabase Auth, password hashes included
    with src_engine.connect() as source, dst_engine.begin() as target:
        have = {r[0] for r in target.execute(text("select id from auth.users"))}
        for table in AUTH_TABLES:
            # (generated columns cannot be written)
            columns = [r[0] for r in source.execute(text(
                "select column_name from information_schema.columns where table_schema='auth' and table_name=:t "
                "and is_generated = 'NEVER' order by ordinal_position"
            ), {"t": table})]
            target_columns = {r[0] for r in target.execute(text(
                "select column_name from information_schema.columns where table_schema='auth' and table_name=:t and is_generated = 'NEVER'"), {"t": table})}
            columns = [c for c in columns if c in target_columns]
            rows = source.execute(text(f"select {', '.join(columns)} from auth.{table}")).mappings().all()
            key = "id" if table == "users" else "user_id"
            rows = [r for r in rows if r[key] not in have]
            print(f"auth.{table}: {len(rows)} to copy")
            if args.dry_run or not rows:
                continue
            placeholders = ", ".join(f":{c}" for c in columns)
            from psycopg.types.json import Jsonb
            jsonish = lambda v: Jsonb(v) if isinstance(v, (dict, list)) else v  # noqa: E731
            target.execute(text(f"insert into auth.{table} ({', '.join(columns)}) values ({placeholders}) on conflict do nothing"),
                           [{k: jsonish(v) for k, v in dict(r).items()} for r in rows])
    return 0


if __name__ == "__main__":
    sys.exit(main())
