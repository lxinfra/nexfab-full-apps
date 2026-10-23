"""Compare two Supabase projects after a copy: templates, pages, elements per
template, files in the bucket, and sign-in accounts. Prints counts only.

    python scripts/compare_supabase_projects.py --from old.env --to new.env
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import create_engine, func, select, text

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import Element, Page, Template  # noqa: E402
from app.storage import SupabaseStorage  # noqa: E402
from scripts.migrate_supabase_project import read_env  # noqa: E402


def counts(engine) -> dict[str, tuple[int, int]]:
    with engine.connect() as conn:
        rows = conn.execute(
            select(Template.id, func.count(func.distinct(Page.id)), func.count(Element.id))
            .select_from(Template).outerjoin(Page, Page.template_id == Template.id).outerjoin(Element, Element.page_id == Page.id)
            .group_by(Template.id)
        ).all()
        users = conn.execute(text("select count(*) from auth.users")).scalar()
    return {r[0]: (r[1], r[2]) for r in rows}, users


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="source", type=Path, required=True)
    parser.add_argument("--to", dest="target", type=Path, required=True)
    parser.add_argument("--files", action="store_true", help="also compare the files of every template (slow)")
    args = parser.parse_args()
    src, dst = read_env(args.source), read_env(args.target)
    a, users_a = counts(create_engine(src["DATABASE_URL"]))
    b, users_b = counts(create_engine(dst["DATABASE_URL"]))
    missing = [t for t in a if t not in b]
    different = [t for t in a if t in b and a[t] != b[t]]
    print(f"source: {len(a)} templates, target: {len(b)} templates; missing in target: {len(missing)}; different: {len(different)}")
    for t in missing:
        print(f"   missing {t}  pages/elements {a[t]}")
    for t in different:
        print(f"   differs {t}  source {a[t]} target {b[t]}")
    print(f"accounts: source {users_a}, target {users_b}")
    if args.files:
        cache = Path(__file__).resolve().parents[2] / "data"
        sa = SupabaseStorage(src["SUPABASE_URL"], src["SUPABASE_SERVICE_KEY"], src["SUPABASE_BUCKET"], cache / "cache")
        sb = SupabaseStorage(dst["SUPABASE_URL"], dst["SUPABASE_SERVICE_KEY"], dst["SUPABASE_BUCKET"], cache / "migration-cache" / "to")
        short = 0
        for t in b:
            try:
                fa = set(sa._list(t))
            except Exception:  # noqa: BLE001
                fa = {p.relative_to(cache / "cache").as_posix() for p in (cache / "cache" / t).rglob("*") if p.is_file()}
            fb = set(sb._list(t))
            if fa - fb:
                short += 1
                print(f"   {t}: {len(fa - fb)} file(s) not in target")
        print(f"files: {short} template(s) short of files")
    return 0 if not missing and not different else 1


if __name__ == "__main__":
    sys.exit(main())
