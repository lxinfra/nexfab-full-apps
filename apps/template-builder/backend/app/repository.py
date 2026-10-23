"""Template JSON <-> database rows."""
from __future__ import annotations

import json
import uuid
from datetime import timezone

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session, selectinload

from .db import Element, Page, Template, utcnow
from .storage import Storage


def _iso(moment) -> str:
    """ISO timestamp in UTC (SQLite hands datetimes back without their timezone)."""
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc)
    return moment.replace(tzinfo=None).isoformat(timespec="seconds") + "Z"


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def _element_row(el: dict, fallback_z: int) -> Element:
    return Element(z=int(el.get("z", fallback_z)), type=str(el.get("type", "")), data=el)


def add_page(db: Session, template_id: str, page: dict) -> None:
    row = Page(
        template_id=template_id, index=page["index"], width=page["width"], height=page["height"],
        rotation=page.get("rotation", 0), preview=page.get("preview"), scanned=bool(page.get("scanned")),
        tables=page.get("tables") or [],
    )
    row.elements = [_element_row(el, z) for z, el in enumerate(page.get("elements") or [])]
    db.add(row)


def page_json(page: Page) -> dict:
    return {
        "index": page.index, "width": page.width, "height": page.height, "rotation": page.rotation,
        "preview": page.preview, "scanned": page.scanned,
        "tables": page.tables or [],
        "elements": [el.data for el in page.elements],
    }


def template_json(template: Template, storage: Storage) -> dict:
    return {
        "id": template.id,
        "name": template.name,
        "originalFilename": template.original_filename,
        "sourceFile": storage.url(f"{template.id}/source.pdf"),
        "pageCount": template.page_count,
        "createdAt": _iso(template.created_at),
        "updatedAt": _iso(template.updated_at),
        "fonts": template.fonts or [],
        "warnings": template.warnings or [],
        "pages": [page_json(p) for p in template.pages],
    }


def summary_json(template: Template) -> dict:
    first = template.pages[0] if template.pages else None
    return {
        "id": template.id,
        "name": template.name,
        "pageCount": template.page_count,
        "thumbnail": first.preview if first else None,
        "width": first.width if first else None,
        "height": first.height if first else None,
        "warnings": len(template.warnings or []),
        "createdAt": _iso(template.created_at),
        "updatedAt": _iso(template.updated_at),
    }


def get_template(db: Session, template_id: str, elements: bool = True, owner: str | None = None) -> Template | None:
    """The template with its pages; ``elements=False`` leaves the (large) page contents in the database.

    With ``owner`` (sign-in is on) a template of another account does not exist.
    """
    pages = selectinload(Template.pages)
    query = select(Template).where(Template.id == template_id)
    if owner is not None:
        query = query.where(Template.owner_id == owner)
    return db.scalar(query.options(pages.selectinload(Page.elements) if elements else pages))


def list_templates(db: Session, owner: str | None = None) -> list[Template]:
    query = select(Template).order_by(Template.updated_at.desc()).options(selectinload(Template.pages))
    if owner is not None:
        query = query.where(Template.owner_id == owner)
    return list(db.scalars(query))


def owner_of(db: Session, template_id: str) -> str | None:
    return db.scalar(select(Template.owner_id).where(Template.id == template_id))


def claim_unowned(db: Session, owner: str) -> int:
    """Give the templates made before there were accounts to ``owner``."""
    return db.execute(update(Template).where(Template.owner_id.is_(None)).values(owner_id=owner)).rowcount


def has_unowned(db: Session) -> bool:
    return db.scalar(select(Template.id).where(Template.owner_id.is_(None)).limit(1)) is not None


MAX_PAGES = 500
MAX_PAGE_SIZE = 14400   # pt; the PDF limit


class InvalidUpdate(ValueError):
    """The payload cannot be applied; the message is safe to show."""


def _replace_pages(template: Template, pages: list, storage: Storage) -> None:
    """Rebuild the template's page list (pages were added, duplicated, removed or reordered)."""
    if not 1 <= len(pages) <= MAX_PAGES:
        raise InvalidUpdate(f"A template needs between 1 and {MAX_PAGES} pages.")
    own_files = storage.url(template.id + "/")
    rows: list[Page] = []
    for index, page in enumerate(pages):
        if not isinstance(page, dict):
            raise InvalidUpdate("Each page must be an object.")
        width, height = page.get("width"), page.get("height")
        if not all(isinstance(v, (int, float)) and 0 < v <= MAX_PAGE_SIZE for v in (width, height)):
            raise InvalidUpdate(f"Page {index + 1} has an invalid size.")
        preview = page.get("preview")
        row = Page(
            index=index, width=float(width), height=float(height),
            rotation=page.get("rotation") if isinstance(page.get("rotation"), int) else 0,
            # previews are files of this template; anything else is dropped
            preview=preview if isinstance(preview, str) and preview.startswith(own_files) else None,
            scanned=bool(page.get("scanned")),
            tables=[t for t in page.get("tables") or [] if isinstance(t, dict)],
        )
        row.elements = [_element_row(el, z) for z, el in enumerate(page.get("elements") or []) if isinstance(el, dict)]
        rows.append(row)
    template.pages = rows          # the old rows are orphaned and deleted with their elements
    template.page_count = len(rows)


def apply_update(db: Session, template: Template, payload: dict, storage: Storage) -> None:
    """Save edits.

    Normally only the pages present in the payload are rewritten (matched by
    ``index``), so the editor can autosave the page being worked on without
    resending the rest. With ``replacePages: true`` the payload's ``pages`` is
    the complete new page list instead.

    The template's elements need not be loaded: pages are rewritten without
    reading what they held.
    """
    if isinstance(payload.get("name"), str) and payload["name"].strip():
        template.name = payload["name"].strip()[:255]
    if isinstance(payload.get("fonts"), list):
        template.fonts = payload["fonts"]
    if payload.get("replacePages"):
        if not isinstance(payload.get("pages"), list):
            raise InvalidUpdate("replacePages needs the full list of pages.")
        _replace_pages(template, payload["pages"], storage)
        template.updated_at = utcnow()
        return
    by_index = {p.index: p for p in template.pages}
    for page in payload.get("pages") or []:
        row = by_index.get(page.get("index"))
        if row is None:
            continue
        for field in ("width", "height"):
            if isinstance(page.get(field), (int, float)) and page[field] > 0:
                setattr(row, field, float(page[field]))
        if isinstance(page.get("elements"), list):
            db.execute(delete(Element).where(Element.page_id == row.id))
            db.expire(row, ["elements"])
            for z, el in enumerate(page["elements"]):
                if isinstance(el, dict):
                    element = _element_row(el, z)
                    element.page_id = row.id
                    db.add(element)
        if isinstance(page.get("tables"), list):   # a table's grid changes when rows are added to it
            row.tables = [t for t in page["tables"] if isinstance(t, dict)]
    template.updated_at = utcnow()


def duplicate_template(db: Session, source: Template, storage: Storage, name: str | None = None) -> Template:
    new = new_id()
    storage.copy_prefix(source.id, new)
    old_prefix, new_prefix = storage.url(source.id + "/"), storage.url(new + "/")

    def relink(value):
        # every stored URL (images, fonts, previews) points into the copy
        return json.loads(json.dumps(value).replace(old_prefix, new_prefix))

    copy = Template(
        id=new, name=name or f"{source.name} (copy)", original_filename=source.original_filename,
        owner_id=source.owner_id,
        page_count=source.page_count, fonts=relink(source.fonts or []), warnings=list(source.warnings or []),
    )
    for page in source.pages:
        row = Page(index=page.index, width=page.width, height=page.height, rotation=page.rotation,
                   preview=relink(page.preview), scanned=page.scanned, tables=page.tables)
        row.elements = [Element(z=el.z, type=el.type, data=relink(el.data)) for el in page.elements]
        copy.pages.append(row)
    db.add(copy)
    return copy
