"""Image placements: one element per placement, pixel data stored once per image."""
from __future__ import annotations

import io
import logging

import pymupdf
from PIL import Image

from ..geometry import decompose_matrix, hex_to_rgb, r3, rgb_to_hex
from .context import SOFT_MASK_WARNING, ExtractionContext, attach_clip
from .trace import PaintOp, effective_clips

log = logging.getLogger(__name__)

_PASSTHROUGH_CS = ("DeviceRGB", "DeviceGray", "ICCBased", "CalRGB", "CalGray")


def _pil_from_pixmap(pix: pymupdf.Pixmap) -> Image.Image:
    if pix.colorspace is None or pix.colorspace.n not in (1, 3):
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)  # CMYK, Lab, Indexed, ... -> RGB
    mode = {1: "L", 2: "LA", 3: "RGB", 4: "RGBA"}[pix.n]
    return Image.frombytes(mode, (pix.width, pix.height), pix.samples)


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=False)
    return buf.getvalue()


def _decode_xref(doc: pymupdf.Document, xref: int) -> tuple[bytes, str, int, int]:
    """Return (bytes, extension, pixel width, pixel height) for an image xref.

    JPEG/PNG data in a display colourspace is passed through untouched. Anything
    else (CMYK, indexed, JPX, images with a soft mask) is decoded by MuPDF and
    re-encoded: CMYK becomes RGB and an SMask becomes the PNG's alpha channel.
    """
    info = doc.extract_image(xref)
    if not info or not info.get("image"):
        raise ValueError(f"image xref {xref} has no data")
    ext = info["ext"]
    smask = info.get("smask") or 0
    cs_name = str(info.get("cs-name") or "")
    components = info.get("colorspace")
    w, h = info["width"], info["height"]

    if not smask and components in (1, 3) and cs_name.startswith(_PASSTHROUGH_CS):
        if ext in ("jpeg", "jpg"):
            return info["image"], "jpg", w, h
        if ext == "png":
            return info["image"], "png", w, h

    base = _pil_from_pixmap(pymupdf.Pixmap(doc, xref))
    if smask:
        try:
            mask = _pil_from_pixmap(pymupdf.Pixmap(doc, smask)).convert("L")
            if mask.size != base.size:
                mask = mask.resize(base.size, Image.BILINEAR)
            base = base.convert("RGBA") if base.mode in ("RGB", "RGBA") else base.convert("LA")
            base.putalpha(mask)
        except Exception as exc:  # keep the image even if its mask is unreadable
            log.warning("could not merge soft mask %d into image %d: %s", smask, xref, exc)
        return _png(base), "png", base.width, base.height

    if ext in ("jpeg", "jpg") and base.mode in ("RGB", "L"):
        # e.g. a CMYK JPEG: stay lossy so photos do not balloon into huge PNGs
        buf = io.BytesIO()
        base.save(buf, "JPEG", quality=95, subsampling=0)
        return buf.getvalue(), "jpg", base.width, base.height
    return _png(base), "png", base.width, base.height


def _decode_stencil(doc: pymupdf.Document, xref: int, color: tuple[float, ...] | None) -> tuple[bytes, str, int, int]:
    """1-bit image masks are painted in the current fill colour: bake that in."""
    pix = pymupdf.Pixmap(doc, xref)
    if pix.alpha and pix.n == 1:
        alpha = Image.frombytes("L", (pix.width, pix.height), pix.samples)
    else:
        gray = _pil_from_pixmap(pix).convert("L")
        alpha = gray.point(lambda v: 255 - v)  # default /Decode: 0 paints
    rgb = hex_to_rgb(rgb_to_hex(color)) or (0.0, 0.0, 0.0)  # normalises gray/CMYK too
    out = Image.new("RGBA", alpha.size, tuple(round(c * 255) for c in rgb) + (0,))
    out.putalpha(alpha)
    return _png(out), "png", out.width, out.height


def _inline_images(page: pymupdf.Page) -> list[dict]:
    blocks = page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]
    return [b for b in blocks if b.get("type") == 1 and b.get("image")]


def _match_sequence(infos: list[dict], bboxlog: list) -> list[int | None]:
    """Find each placement's position in the page's paint order."""
    slots = [(i, e[1]) for i, e in enumerate(bboxlog) if e[0] in ("fill-image", "fill-imgmask")]
    if len(slots) == len(infos):
        return [i for i, _ in slots]
    out: list[int | None] = []
    used: set[int] = set()
    for info in infos:
        bx = info["bbox"]
        found = None
        for i, sb in slots:
            if i not in used and all(abs(a - b) <= 1.0 for a, b in zip(bx, sb)):
                found = i
                break
        if found is not None:
            used.add(found)
        out.append(found)
    return out


def extract_images(page: pymupdf.Page, page_no: int, ctx: ExtractionContext,
                   ops: list[PaintOp] | None, bboxlog: list) -> list[dict]:
    infos = page.get_image_info(xrefs=True)
    if not infos:
        return []
    seqs = _match_sequence(infos, bboxlog)
    inline: list[dict] | None = None
    elements: list[dict] = []
    saved = 0

    for info, seq in zip(infos, seqs):
        box = decompose_matrix(tuple(info["transform"]))
        if box["width"] < 0.01 or box["height"] < 0.01:
            continue
        op = ops[seq] if ops is not None and seq is not None else None
        in_mask = op is not None and op.in_mask
        stencil = seq is not None and bboxlog[seq][0] == "fill-imgmask"
        xref = info.get("xref") or 0
        cache_key = (xref, op.color if stencil and op else None) if xref else None

        record = ctx.images.get(cache_key) if cache_key and not in_mask else None
        if record is None:
            try:
                if xref and stencil:
                    data, ext, pw, ph = _decode_stencil(ctx.doc, xref, op.color if op else None)
                elif xref:
                    data, ext, pw, ph = _decode_xref(ctx.doc, xref)
                else:
                    if inline is None:
                        inline = _inline_images(page)
                    blk = next((b for b in inline
                                if all(abs(a - b_) <= 1.0 for a, b_ in zip(b["bbox"], info["bbox"]))), None)
                    if blk is None:
                        raise ValueError("inline image data not found")
                    pil = _pil_from_pixmap(pymupdf.Pixmap(blk["image"]))
                    data, ext, pw, ph = _png(pil), "png", pil.width, pil.height
            except Exception as exc:
                log.warning("page %d: skipping unreadable image (xref %s): %s", page_no, xref, exc)
                ctx.warn("image_unreadable", f"An image on page {page_no} could not be decoded and was skipped.", page_no)
                continue
            if in_mask:
                # Paints a soft mask rather than the page: keep the pixels for
                # whatever is drawn through the mask (see drawings.py).
                ctx.mask_images[seq] = (Image.open(io.BytesIO(data)).convert("L"), tuple(info["transform"]))
                continue
            src = ctx.save(data, "images", f"p{page_no}_{saved}.{ext}")
            saved += 1
            record = {"src": src, "naturalWidth": pw, "naturalHeight": ph}
            if cache_key:
                ctx.images[cache_key] = record

        el = {
            "type": "image",
            "src": record["src"],
            **{k: (v if isinstance(v, bool) else r3(v)) for k, v in box.items()},
            "opacity": r3(op.alpha) if op else 1.0,
            "fit": "stretch",
            "naturalWidth": record["naturalWidth"],
            "naturalHeight": record["naturalHeight"],
            "_seq": seq if seq is not None else len(bboxlog),
        }
        clips = effective_clips(op, tuple(info["bbox"]))
        if clips.hidden:
            continue
        attach_clip(el, clips)
        if op is not None and (op.unsupported_clip or op.soft_masks):
            ctx.warn("soft_mask", SOFT_MASK_WARNING.format(page=page_no), page_no)
        elements.append(el)
    return elements
