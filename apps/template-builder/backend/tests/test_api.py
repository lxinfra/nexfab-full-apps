from __future__ import annotations

import io
import zipfile

import pymupdf
import pytest
from PIL import Image

from .conftest import upload


@pytest.fixture(scope="module")
def invoice(client, samples) -> dict:
    res = upload(client, samples / "invoice.pdf")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["templateId"] == body["template"]["id"]
    return body["template"]


def pdf_text(data: bytes) -> str:
    return "\n".join(page.get_text() for page in pymupdf.open(stream=data, filetype="pdf"))


def test_upload_returns_template(invoice):
    assert invoice["name"] == "invoice" and invoice["pageCount"] == 1
    page = invoice["pages"][0]
    assert round(page["width"]) == 595 and round(page["height"]) == 842
    kinds = {el["type"] for el in page["elements"]}
    assert kinds == {"image", "text", "shape"}
    assert [el["z"] for el in page["elements"]] == list(range(len(page["elements"])))
    title = next(el for el in page["elements"] if el.get("content") == "INVOICE")
    assert title["fontWeight"] == "bold" and title["color"] == "#ffffff" and title["align"] == "right"
    assert title["editable"] is True and title["fieldName"] == "invoice"


def test_extracted_assets_are_served(client, invoice):
    page = invoice["pages"][0]
    image = next(el for el in page["elements"] if el["type"] == "image")
    for url in (image["src"], page["preview"], invoice["sourceFile"]):
        assert client.get(url).status_code == 200
    # the logo has a soft mask: it must come out as a PNG with an alpha channel
    logo = Image.open(io.BytesIO(client.get(image["src"]).content))
    assert logo.mode == "RGBA" and logo.getextrema()[3][0] == 0


def test_list_get_and_save(client, invoice):
    listing = client.get("/api/templates").json()
    assert any(t["id"] == invoice["id"] and t["thumbnail"] for t in listing)

    template = client.get(f"/api/templates/{invoice['id']}").json()
    page = template["pages"][0]
    for el in page["elements"]:
        if el.get("content") == "Acme Robotics Ltd":
            el["content"] = "{{customer_name}}"
            el["isVariable"] = True
            el["fieldName"] = "customer_name"
    res = client.put(f"/api/templates/{invoice['id']}", json={"name": "Invoice template", "pages": [page]})
    assert res.status_code == 200 and res.json()["name"] == "Invoice template"

    saved = client.get(f"/api/templates/{invoice['id']}").json()
    assert saved["name"] == "Invoice template"
    assert any(el.get("content") == "{{customer_name}}" for el in saved["pages"][0]["elements"])
    assert len(saved["pages"][0]["elements"]) == len(page["elements"])


def test_export_pdf(client, invoice):
    res = client.post(f"/api/export/{invoice['id']}")
    assert res.status_code == 200 and res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF-")
    doc = pymupdf.open(stream=res.content, filetype="pdf")
    assert doc.page_count == 1 and round(doc[0].rect.width) == 595
    text = pdf_text(res.content)
    assert "INVOICE" in text and "{{customer_name}}" in text


def test_export_unsaved_edits(client, invoice):
    template = client.get(f"/api/templates/{invoice['id']}").json()
    for el in template["pages"][0]["elements"]:
        if el.get("content") == "INVOICE":
            el["content"] = "RECEIPT"
    res = client.post(f"/api/export/{invoice['id']}", json=template)
    assert res.status_code == 200
    text = pdf_text(res.content)
    assert "RECEIPT" in text and "INVOICE" not in text
    # the saved template is untouched
    assert "INVOICE" in pdf_text(client.post(f"/api/export/{invoice['id']}").content)


def test_bulk_export(client, invoice):
    csv_data = "customer_name,filename\nGlobex Corporation,globex\nInitech LLC,initech\n"
    res = client.post(f"/api/export/{invoice['id']}/bulk", files={"file": ("rows.csv", csv_data, "text/csv")})
    assert res.status_code == 200 and res.headers["content-type"] == "application/zip"
    archive = zipfile.ZipFile(io.BytesIO(res.content))
    assert sorted(archive.namelist()) == ["globex.pdf", "initech.pdf"]
    assert "Globex Corporation" in pdf_text(archive.read("globex.pdf"))
    assert "Initech LLC" in pdf_text(archive.read("initech.pdf"))

    empty = client.post(f"/api/export/{invoice['id']}/bulk", files={"file": ("rows.csv", "customer_name\n", "text/csv")})
    assert empty.status_code == 400 and empty.json()["error"]["code"] == "invalid_csv"


def test_replace_image(client, invoice):
    buf = io.BytesIO()
    Image.new("RGB", (300, 100), (10, 200, 30)).save(buf, "PNG")
    res = client.post(f"/api/templates/{invoice['id']}/images", files={"file": ("new.png", buf.getvalue(), "image/png")})
    assert res.status_code == 200
    body = res.json()
    assert (body["naturalWidth"], body["naturalHeight"]) == (300, 100)
    assert client.get(body["src"]).status_code == 200

    # swap it into the logo's box with "fit": the exported picture keeps its aspect ratio
    template = client.get(f"/api/templates/{invoice['id']}").json()
    logo = next(el for el in template["pages"][0]["elements"] if el["type"] == "image")
    logo.update(src=body["src"], naturalWidth=300, naturalHeight=100, fit="fit")
    exported = client.post(f"/api/export/{invoice['id']}", json=template).content
    placed = pymupdf.open(stream=exported, filetype="pdf")[0].get_image_info()[0]["bbox"]
    assert placed == pytest.approx((40, 38, 100, 58), abs=0.01)

    bad = client.post(f"/api/templates/{invoice['id']}/images", files={"file": ("x.png", b"not an image", "image/png")})
    assert bad.status_code == 415


def test_duplicate_and_delete(client, invoice):
    copy = client.post(f"/api/templates/{invoice['id']}/duplicate").json()
    assert copy["id"] != invoice["id"] and copy["name"].endswith("(copy)")
    full = client.get(f"/api/templates/{copy['id']}").json()
    image = next(el for el in full["pages"][0]["elements"] if el["type"] == "image")
    assert f"/{copy['id']}/" in image["src"] and client.get(image["src"]).status_code == 200

    assert client.delete(f"/api/templates/{copy['id']}").status_code == 204
    assert client.get(f"/api/templates/{copy['id']}").status_code == 404
    assert client.get(image["src"]).status_code == 404
    assert client.get(f"/api/templates/{invoice['id']}").status_code == 200


def test_password_protected(client, samples):
    path = samples / "edge" / "encrypted.pdf"
    res = upload(client, path)
    assert res.status_code == 401 and res.json()["error"]["code"] == "password_required"
    res = upload(client, path, password="wrong")
    assert res.status_code == 401 and res.json()["error"]["code"] == "password_incorrect"
    res = upload(client, path, password="secret")
    assert res.status_code == 200 and res.json()["template"]["pageCount"] == 1


def test_corrupted_and_wrong_type(client, samples):
    res = upload(client, samples / "edge" / "corrupted.pdf")
    assert res.status_code == 422 and res.json()["error"]["code"] == "invalid_pdf"

    res = client.post("/api/upload", files={"file": ("notes.txt", b"just text", "text/plain")})
    assert res.status_code == 415
    res = client.post("/api/upload", files={"file": ("fake.pdf", b"GIF89a not really a pdf", "application/pdf")})
    assert res.status_code == 415 and res.json()["error"]["code"] == "unsupported_type"
    # nothing half-created is left behind
    assert all(t["name"] not in ("corrupted", "fake") for t in client.get("/api/templates").json())


def test_upload_size_limit(client, samples, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "max_upload_bytes", 4096)
    res = upload(client, samples / "brochure.pdf")
    assert res.status_code == 413 and res.json()["error"]["code"] == "file_too_large"


def test_scanned_page_is_flagged(client, samples):
    res = upload(client, samples / "edge" / "scanned.pdf")
    assert res.status_code == 200
    template = res.json()["template"]
    assert template["pages"][0]["scanned"] is True
    assert [w["code"] for w in template["warnings"]] == ["scanned_page"]


def test_add_duplicate_and_remove_pages(client, samples):
    template = upload(client, samples / "statement.pdf").json()["template"]
    tid = template["id"]
    pages = template["pages"]
    blank = {"width": pages[0]["width"], "height": pages[0]["height"], "rotation": 0, "preview": None,
             "scanned": False, "tables": [], "elements": []}
    copy = {**pages[1], "preview": pages[1]["preview"]}
    # page 1, a blank page, page 2, a copy of page 2 (page 3 is removed)
    res = client.put(f"/api/templates/{tid}", json={"replacePages": True, "pages": [pages[0], blank, pages[1], copy]})
    assert res.status_code == 200 and res.json()["pageCount"] == 4

    saved = client.get(f"/api/templates/{tid}").json()
    assert [p["index"] for p in saved["pages"]] == [0, 1, 2, 3] and saved["pageCount"] == 4
    assert saved["pages"][1]["elements"] == [] and saved["pages"][1]["preview"] is None and saved["pages"][1]["tables"] == []
    assert saved["pages"][3]["elements"] == pages[1]["elements"] and saved["pages"][3]["tables"] == pages[1]["tables"]
    assert saved["pages"][3]["preview"] == pages[1]["preview"]

    exported = pymupdf.open(stream=client.post(f"/api/export/{tid}").content, filetype="pdf")
    assert exported.page_count == 4 and exported[1].get_text().strip() == ""
    assert exported[2].get_text() == exported[3].get_text() != ""

    # ordinary saves still address pages by index afterwards
    edited = saved["pages"][1]
    edited["elements"] = [{**pages[0]["elements"][0]}]
    assert client.put(f"/api/templates/{tid}", json={"pages": [edited]}).status_code == 200
    assert len(client.get(f"/api/templates/{tid}").json()["pages"][1]["elements"]) == 1
    # ... and can update a page's table grid (rows added to a table)
    grown = saved["pages"][2]
    grown["tables"][0]["rows"].append(grown["tables"][0]["rows"][-1] + 30)
    assert client.put(f"/api/templates/{tid}", json={"pages": [grown]}).status_code == 200
    assert client.get(f"/api/templates/{tid}").json()["pages"][2]["tables"] == grown["tables"]

    for bad in ([], [{"width": 0, "height": 100}], [{"width": 100}]):
        res = client.put(f"/api/templates/{tid}", json={"replacePages": True, "pages": bad})
        assert res.status_code == 400 and res.json()["error"]["code"] == "invalid_update"
    # a preview pointing outside the template's own files is dropped
    foreign = {**blank, "preview": "https://example.com/x.png"}
    client.put(f"/api/templates/{tid}", json={"replacePages": True, "pages": [foreign]})
    assert client.get(f"/api/templates/{tid}").json()["pages"][0]["preview"] is None
    client.delete(f"/api/templates/{tid}")


def test_tables_can_be_detected_again(client, samples):
    template = upload(client, samples / "invoice.pdf").json()["template"]
    tid = template["id"]
    try:
        before = template["pages"][0]["tables"]
        # pretend an older version found nothing
        res = client.put(f"/api/templates/{tid}", json={"pages": [{"index": 0, "tables": []}]})
        assert res.status_code == 200
        assert client.get(f"/api/templates/{tid}").json()["pages"][0]["tables"] == []
        res = client.post(f"/api/templates/{tid}/tables")
        assert res.status_code == 200
        assert res.json()["pages"][0]["tables"] == before
        assert client.get(f"/api/templates/{tid}").json()["pages"][0]["tables"] == before
        assert client.post("/api/templates/nope/tables").status_code == 404
    finally:
        client.delete(f"/api/templates/{tid}")


def test_an_image_can_be_copied_to_another_template(client, samples):
    a = upload(client, samples / "brochure.pdf").json()["template"]
    b = upload(client, samples / "invoice.pdf").json()["template"]
    try:
        picture = next(e["src"] for p in a["pages"] for e in p["elements"] if e["type"] == "image")
        res = client.post(f"/api/templates/{b['id']}/images/copy", json={"src": picture})
        assert res.status_code == 200
        src = res.json()["src"]
        assert src.startswith(f"/storage/{b['id']}/images/") and src != picture
        assert client.get(src).content == client.get(picture).content
        assert client.post(f"/api/templates/{b['id']}/images/copy", json={"src": "/storage/nope/images/x.png"}).status_code == 404
        assert client.post(f"/api/templates/{b['id']}/images/copy", json={"src": "https://elsewhere/x.png"}).status_code == 400
    finally:
        client.delete(f"/api/templates/{a['id']}")
        client.delete(f"/api/templates/{b['id']}")
