"""Generate the sample PDFs in /samples.

The samples are written with ReportLab (not PyMuPDF) so the extraction pipeline
is tested against PDFs it did not produce itself. Photos are synthetic.

    python scripts/make_samples.py

Main samples (compared pixel-by-pixel by scripts/diff_test.py):
    invoice.pdf      table, logo with transparency, right-aligned numbers, stamp
    brochure.pdf     many photos: rotated, flipped, clipped, repeated, CMYK
    certificate.pdf  embedded TrueType fonts, curves, centred and rotated text
    multipage.pdf    8 pages: justified paragraphs, table, chart, a rotated page
    statement.pdf    a ruled transaction table running over three pages
Edge cases in /samples/edge:
    scanned.pdf, encrypted.pdf (password "secret"), corrupted.pdf, large_60p.pdf
"""
from __future__ import annotations

import io
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from reportlab.lib.enums import TA_JUSTIFY
from reportlab.lib.pagesizes import A4, landscape, letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "samples"
EDGE = SAMPLES / "edge"

NAVY = (0.043, 0.239, 0.569)
LOREM = (
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et "
    "dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip "
    "ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu "
    "fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia "
    "deserunt mollit anim id est laborum."
)


# --------------------------------------------------------------------- images
def photo(seed: int, size=(640, 420)) -> Image.Image:
    """A synthetic 'photo': smooth gradient, soft blobs and a horizon line."""
    rnd = random.Random(seed)
    w, h = size
    c1 = [rnd.randint(20, 235) for _ in range(3)]
    c2 = [rnd.randint(20, 235) for _ in range(3)]
    column = Image.new("RGB", (1, h))
    for yy in range(h):
        t = yy / (h - 1)
        column.putpixel((0, yy), tuple(round(c1[i] * (1 - t) + c2[i] * t) for i in range(3)))
    img = column.resize(size)
    draw = ImageDraw.Draw(img, "RGBA")
    for _ in range(9):
        cx, cy, r = rnd.randint(0, w), rnd.randint(0, h), rnd.randint(30, 160)
        col = tuple(rnd.randint(0, 255) for _ in range(3)) + (rnd.randint(60, 150),)
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=col)
    pts = [(0, h)] + [(xx, h * 0.62 + math.sin(xx / 53 + seed) * 28) for xx in range(0, w + 1, 16)] + [(w, h)]
    draw.polygon(pts, fill=(15, 30, 20, 190))
    # an orientation marker so flips and rotations are visible
    draw.rectangle((10, 10, 54, 34), fill=(255, 255, 255, 230))
    draw.polygon([(14, 30), (32, 14), (50, 30)], fill=(200, 30, 30, 255))
    return img.filter(ImageFilter.GaussianBlur(0.6))


def jpeg(img: Image.Image, cmyk: bool = False, quality: int = 86) -> ImageReader:
    buf = io.BytesIO()
    (img.convert("CMYK") if cmyk else img).save(buf, "JPEG", quality=quality)
    buf.seek(0)
    return ImageReader(buf)


def logo(size: int = 240) -> ImageReader:
    """A round logo on a transparent background (becomes an image + soft mask)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((6, 6, size - 6, size - 6), fill=(255, 196, 37, 255), outline=(255, 255, 255, 255), width=8)
    d.polygon([(size * 0.28, size * 0.72), (size * 0.5, size * 0.22), (size * 0.72, size * 0.72)], fill=(11, 61, 145, 255))
    d.ellipse((size * 0.42, size * 0.5, size * 0.58, size * 0.66), fill=(255, 196, 37, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    buf.seek(0)
    return ImageReader(buf)


# ---------------------------------------------------------------------- fonts
def register_serif() -> tuple[str, str, str]:
    """Register an embeddable TrueType serif (regular, bold, italic); fall back to Times."""
    candidates = [
        (r"C:\Windows\Fonts\georgia.ttf", r"C:\Windows\Fonts\georgiab.ttf", r"C:\Windows\Fonts\georgiai.ttf"),
        ("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
         "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Italic.ttf"),
        ("/System/Library/Fonts/Supplemental/Georgia.ttf", "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
         "/System/Library/Fonts/Supplemental/Georgia Italic.ttf"),
    ]
    for files in candidates:
        if all(Path(f).is_file() for f in files):
            names = ("SampleSerif", "SampleSerif-Bold", "SampleSerif-Italic")
            for name, f in zip(names, files):
                pdfmetrics.registerFont(TTFont(name, f))
            return names
    print("  note: no TrueType serif found; certificate uses Times (not embedded)")
    return ("Times-Roman", "Times-Bold", "Times-Italic")


class Page:
    """Thin wrapper so coordinates can be given from the top-left, like the template JSON."""

    def __init__(self, c: canvas.Canvas, width: float, height: float) -> None:
        self.c, self.w, self.h = c, width, height

    def y(self, top: float) -> float:
        return self.h - top

    def rect(self, x, top, w, h, fill=None, stroke=None, width=1.0, alpha=1.0) -> None:
        c = self.c
        c.saveState()
        if fill:
            c.setFillColorRGB(*fill)
            c.setFillAlpha(alpha)
        if stroke:
            c.setStrokeColorRGB(*stroke)
            c.setLineWidth(width)
        c.rect(x, self.h - top - h, w, h, stroke=1 if stroke else 0, fill=1 if fill else 0)
        c.restoreState()

    def line(self, x1, top1, x2, top2, color=(0, 0, 0), width=1.0, dash=None) -> None:
        c = self.c
        c.saveState()
        c.setStrokeColorRGB(*color)
        c.setLineWidth(width)
        if dash:
            c.setDash(*dash)
        c.line(x1, self.h - top1, x2, self.h - top2)
        c.restoreState()

    def text(self, x, baseline, s, font="Helvetica", size=10, color=(0, 0, 0), align="left") -> None:
        c = self.c
        c.setFont(font, size)
        c.setFillColorRGB(*color)
        draw = {"left": c.drawString, "right": c.drawRightString, "center": c.drawCentredString}[align]
        draw(x, self.h - baseline, s)

    def image(self, img, x, top, w, h, **kw) -> None:
        self.c.drawImage(img, x, self.h - top - h, w, h, **kw)


# -------------------------------------------------------------------- invoice
def make_invoice(path: Path) -> None:
    W, H = A4
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle("Sample invoice")
    p = Page(c, W, H)

    p.rect(0, 0, W, 96, fill=NAVY)
    p.image(logo(), 40, 18, 60, 60, mask="auto")
    p.text(112, 46, "Northwind Studio", "Helvetica-Bold", 18, (1, 1, 1))
    p.text(112, 63, "42 Harbour Road, Bristol BS1 5TT", "Helvetica", 9, (0.85, 0.9, 1))
    p.text(112, 75, "hello@northwind.example  |  +44 117 496 0142", "Helvetica", 9, (0.85, 0.9, 1))
    p.text(W - 40, 58, "INVOICE", "Helvetica-Bold", 30, (1, 1, 1), "right")

    p.text(40, 132, "BILL TO", "Helvetica-Bold", 8, (0.45, 0.45, 0.5))
    p.text(40, 150, "Acme Robotics Ltd", "Helvetica-Bold", 12)
    for i, s in enumerate(["Attn: Dana Whitfield", "17 Foundry Lane", "Leeds LS9 8AG", "United Kingdom"]):
        p.text(40, 166 + i * 13, s, "Helvetica", 10, (0.2, 0.2, 0.2))

    meta = [("Invoice number", "INV-2026-0142"), ("Issue date", "1 October 2026"),
            ("Due date", "31 October 2026"), ("PO reference", "PO-88310")]
    for i, (label, value) in enumerate(meta):
        p.text(W - 170, 132 + i * 16, label, "Helvetica", 9, (0.45, 0.45, 0.5), "right")
        p.text(W - 40, 132 + i * 16, value, "Helvetica-Bold", 10, (0.1, 0.1, 0.1), "right")

    top, row_h = 240, 24
    cols = [40, 300, 370, 460, W - 40]
    p.rect(40, top, W - 80, row_h, fill=(0.93, 0.95, 0.98))
    for x, label, align in [(48, "Description", "left"), (362, "Qty", "right"),
                            (452, "Unit price", "right"), (W - 48, "Amount", "right")]:
        p.text(x, top + 16, label, "Helvetica-Bold", 9, NAVY, align)
    items = [("Brand identity workshop", 1, 1800.00), ("Logo design and guidelines", 1, 2400.00),
             ("Website UI design (per page)", 8, 320.00), ("Illustration pack", 12, 85.00),
             ("Project management", 14, 60.00)]
    subtotal = 0.0
    for i, (desc, qty, price) in enumerate(items):
        base = top + row_h * (i + 1) + 16
        amount = qty * price
        subtotal += amount
        if i % 2 == 1:
            p.rect(40, top + row_h * (i + 1), W - 80, row_h, fill=(0.975, 0.975, 0.98))
        p.text(48, base, desc, "Helvetica", 10)
        p.text(362, base, str(qty), "Helvetica", 10, align="right")
        p.text(452, base, f"£{price:,.2f}", "Helvetica", 10, align="right")
        p.text(W - 48, base, f"£{amount:,.2f}", "Helvetica", 10, align="right")
    bottom = top + row_h * (len(items) + 1)
    p.rect(40, top, W - 80, bottom - top, stroke=(0.75, 0.78, 0.85), width=0.75)
    for x in cols[1:-1]:
        p.line(x, top, x, bottom, (0.85, 0.87, 0.92), 0.5)
    p.line(40, top + row_h, W - 40, top + row_h, NAVY, 1.2)

    vat = subtotal * 0.2
    for i, (label, value, bold) in enumerate([("Subtotal", subtotal, False), ("VAT (20%)", vat, False)]):
        p.text(452, bottom + 24 + i * 18, label, "Helvetica", 10, (0.3, 0.3, 0.3), "right")
        p.text(W - 48, bottom + 24 + i * 18, f"£{value:,.2f}", "Helvetica", 10, align="right")
    p.rect(340, bottom + 50, W - 380, 30, fill=NAVY)
    p.text(452, bottom + 70, "Total due", "Helvetica-Bold", 11, (1, 1, 1), "right")
    p.text(W - 48, bottom + 70, f"£{subtotal + vat:,.2f}", "Helvetica-Bold", 13, (1, 1, 1), "right")

    # semi-transparent rotated stamp
    c.saveState()
    c.translate(150, H - (bottom + 78))
    c.rotate(14)
    c.setStrokeColorRGB(0.8, 0.1, 0.1)
    c.setFillColorRGB(0.8, 0.1, 0.1)
    c.setStrokeAlpha(0.55)
    c.setFillAlpha(0.55)
    c.setLineWidth(2.5)
    c.roundRect(-58, -12, 116, 38, 6, stroke=1, fill=0)
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(0, -2, "PAID")
    c.restoreState()

    p.text(40, bottom + 150, "Payment details", "Helvetica-Bold", 10, NAVY)
    for i, s in enumerate(["Bank: Severn Mutual", "Sort code: 20-45-11   Account: 4039 2217",
                           "Please quote the invoice number as your payment reference."]):
        p.text(40, bottom + 166 + i * 13, s, "Helvetica", 9, (0.25, 0.25, 0.25))

    p.line(40, H - 70, W - 40, H - 70, (0.6, 0.63, 0.7), 0.75, dash=([3, 2], 0))
    p.text(W / 2, H - 52, "Thank you for your business", "Helvetica-Oblique", 10, (0.35, 0.35, 0.4), "center")
    p.text(W / 2, H - 38, "Northwind Studio Ltd  -  Registered in England No. 09481726  -  VAT GB 284 7731 09",
           "Helvetica", 7.5, (0.5, 0.5, 0.55), "center")
    c.showPage()
    c.save()


# ------------------------------------------------------------------- brochure
def make_brochure(path: Path) -> None:
    W, H = landscape(A4)
    c = canvas.Canvas(str(path), pagesize=(W, H))
    c.setTitle("Sample brochure")
    p = Page(c, W, H)
    mark = logo(160)

    # ---- page 1: hero + photo grid
    p.image(jpeg(photo(1, (1400, 620))), 0, 0, W, 300)
    p.rect(0, 0, W, 300, fill=(0, 0.05, 0.15), alpha=0.45)
    p.image(mark, 36, 28, 46, 46, mask="auto")
    p.text(96, 58, "Coastline Journeys", "Helvetica-Bold", 16, (1, 1, 1))
    p.text(60, 170, "Slow travel along", "Helvetica-Bold", 44, (1, 1, 1))
    p.text(60, 220, "the Atlantic edge", "Helvetica-Bold", 44, (1, 0.77, 0.15))
    p.text(60, 252, "Twelve small-group routes for 2027, on foot and by boat.", "Helvetica", 13, (0.92, 0.95, 1))

    gw, gh, gap = 150, 100, 14
    for i in range(8):
        col, row = i % 4, i // 4
        x, top = 40 + col * (gw + gap), 322 + row * (gh + gap)
        p.image(jpeg(photo(10 + i), cmyk=(i == 5)), x, top, gw, gh)   # one CMYK JPEG
        p.rect(x, top + gh - 20, gw, 20, fill=(0, 0, 0), alpha=0.5)
        p.text(x + 8, top + gh - 6, ["Cabo da Roca", "Ericeira", "Peniche", "Nazaré", "Aveiro",
                                     "Porto", "Viana", "Caminha"][i], "Helvetica-Bold", 9, (1, 1, 1))

    # rotated photo with a white frame
    c.saveState()
    c.translate(742, H - 420)
    c.rotate(-8)
    c.setFillColorRGB(1, 1, 1)
    c.setStrokeColorRGB(0.8, 0.8, 0.8)
    c.setLineWidth(0.5)
    c.rect(-70, -52, 140, 104, stroke=1, fill=1)
    c.drawImage(jpeg(photo(30)), -64, -46, 128, 92)
    c.restoreState()

    # photo cropped to a circle by a clip path
    c.saveState()
    clip = c.beginPath()
    clip.circle(742, H - 520, 42)
    c.clipPath(clip, stroke=0, fill=0)
    c.drawImage(jpeg(photo(31)), 688, H - 566, 108, 92)
    c.restoreState()
    c.setStrokeColorRGB(1, 0.77, 0.15)
    c.setLineWidth(3)
    c.circle(742, H - 520, 42, stroke=1, fill=0)

    p.image(mark, W - 70, H - 70, 40, 40, mask="auto")   # the logo again (same image, second placement)
    c.showPage()

    # ---- page 2: three columns
    p.rect(0, 0, W, H, fill=(0.97, 0.96, 0.93))
    p.rect(0, 0, W, 64, fill=NAVY)
    p.image(mark, 36, 12, 40, 40, mask="auto")
    p.text(88, 39, "Three routes to start with", "Helvetica-Bold", 18, (1, 1, 1))
    p.text(W - 40, 39, "coastline.example/2027", "Helvetica", 10, (0.8, 0.87, 1), "right")
    style = ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=(0.2, 0.2, 0.2))
    names = ["The Lighthouse Way", "Salt Marsh Loop", "Harbour to Harbour"]
    for i in range(3):
        x = 40 + i * 258
        # rounded card
        c.setFillColorRGB(1, 1, 1)
        c.setStrokeColorRGB(0.86, 0.85, 0.8)
        c.setLineWidth(0.75)
        c.roundRect(x, H - 540, 240, 440, 10, stroke=1, fill=1)
        # photo clipped to the card's rounded top
        c.saveState()
        clip = c.beginPath()
        clip.roundRect(x + 10, H - 250, 220, 140, 8)
        c.clipPath(clip, stroke=0, fill=0)
        if i == 1:   # mirrored placement
            c.translate(x + 240, 0)
            c.scale(-1, 1)
            c.drawImage(jpeg(photo(40 + i, (900, 620))), 0, H - 262, 240, 164)
        else:
            c.drawImage(jpeg(photo(40 + i, (900, 620))), x, H - 262, 240, 164)
        c.restoreState()
        p.text(x + 16, 280, names[i], "Helvetica-Bold", 14, NAVY)
        p.text(x + 16, 296, ["6 days  -  84 km", "4 days  -  52 km", "8 days  -  120 km"][i],
               "Helvetica-Oblique", 9.5, (0.45, 0.45, 0.45))
        para = Paragraph(LOREM[: 330 + i * 40], style)
        _, ph = para.wrapOn(c, 208, 300)
        para.drawOn(c, x + 16, H - 310 - ph)
        for j in range(3):   # thumbnails
            p.image(jpeg(photo(50 + i * 3 + j, (320, 240))), x + 16 + j * 72, 462, 64, 48)
        p.rect(x + 16, 520, 72, 3, fill=(1, 0.77, 0.15))
    p.text(W / 2, H - 24, "Prices and dates are indicative. Photos are illustrative.", "Helvetica", 8,
           (0.5, 0.5, 0.5), "center")
    c.showPage()
    c.save()


# ---------------------------------------------------------------- certificate
def make_certificate(path: Path) -> None:
    W, H = landscape(letter)
    serif, serif_bold, serif_italic = register_serif()
    c = canvas.Canvas(str(path), pagesize=(W, H))
    c.setTitle("Sample certificate")
    p = Page(c, W, H)
    gold, ink = (0.72, 0.58, 0.2), (0.12, 0.14, 0.22)

    p.rect(0, 0, W, H, fill=(0.995, 0.985, 0.955))
    p.rect(24, 24, W - 48, H - 48, stroke=gold, width=3)
    p.rect(34, 34, W - 68, H - 68, stroke=gold, width=0.75)
    # corner flourishes (Bezier curves)
    for sx, sy in [(1, 1), (-1, 1), (1, -1), (-1, -1)]:
        c.saveState()
        c.translate(W / 2 + sx * (W / 2 - 48), H / 2 + sy * (H / 2 - 48))
        c.scale(-sx, -sy)
        c.setStrokeColorRGB(*gold)
        c.setLineWidth(1.2)
        path_ = c.beginPath()
        path_.moveTo(0, 46)
        path_.curveTo(4, 18, 18, 4, 46, 0)
        path_.moveTo(0, 30)
        path_.curveTo(10, 22, 22, 10, 30, 0)
        c.drawPath(path_, stroke=1, fill=0)
        c.restoreState()

    p.text(W / 2, 112, "CERTIFICATE", serif_bold, 40, ink, "center")
    p.text(W / 2, 140, "OF ACHIEVEMENT", serif, 15, gold, "center")
    p.line(W / 2 - 110, 156, W / 2 + 110, 156, gold, 1)
    p.text(W / 2, 196, "This certificate is proudly presented to", serif_italic, 14, (0.3, 0.3, 0.35), "center")
    p.text(W / 2, 256, "Priya Raman", serif_italic, 46, NAVY, "center")
    p.line(W / 2 - 190, 272, W / 2 + 190, 272, (0.6, 0.6, 0.65), 0.6)
    for i, s in enumerate(["for outstanding contribution to the Open Cartography Programme,",
                           "completing all six modules with distinction during the 2026 cohort."]):
        p.text(W / 2, 306 + i * 20, s, serif, 13, ink, "center")

    # signatures
    for x, name, role in [(190, "Helena Ortiz", "Programme Director"), (W - 190, "Marcus Bell", "Head of Faculty")]:
        p.line(x - 90, 470, x + 90, 470, ink, 0.8)
        p.text(x, 486, name, serif_bold, 12, ink, "center")
        p.text(x, 501, role, serif, 10, (0.4, 0.4, 0.45), "center")
    c.saveState()   # a scribbled signature
    c.setStrokeColorRGB(0.1, 0.15, 0.5)
    c.setLineWidth(1.4)
    sig = c.beginPath()
    sig.moveTo(120, H - 462)
    sig.curveTo(140, H - 420, 150, H - 480, 172, H - 446)
    sig.curveTo(186, H - 426, 196, H - 470, 214, H - 448)
    sig.curveTo(226, H - 436, 240, H - 456, 262, H - 444)
    c.drawPath(sig, stroke=1, fill=0)
    c.restoreState()

    # seal: scalloped ring, filled circles, a star
    cx, cy = W / 2, H - 452
    c.setFillColorRGB(*gold)
    seal = c.beginPath()
    for i in range(48):
        ang = i * math.pi / 24
        r = 46 if i % 2 == 0 else 41
        (seal.moveTo if i == 0 else seal.lineTo)(cx + r * math.cos(ang), cy + r * math.sin(ang))
    seal.close()
    c.drawPath(seal, stroke=0, fill=1)
    c.setFillColorRGB(0.995, 0.985, 0.955)
    c.circle(cx, cy, 35, stroke=0, fill=1)
    c.setFillColorRGB(*NAVY)
    c.circle(cx, cy, 31, stroke=0, fill=1)
    c.setFillColorRGB(*gold)
    star = c.beginPath()
    for i in range(10):
        ang = math.pi / 2 + i * math.pi / 5
        r = 17 if i % 2 == 0 else 7
        (star.moveTo if i == 0 else star.lineTo)(cx + r * math.cos(ang), cy + r * math.sin(ang))
    star.close()
    c.drawPath(star, stroke=0, fill=1)
    p.text(W / 2, 520, "Awarded 1 October 2026", serif_italic, 10, (0.4, 0.4, 0.45), "center")

    # vertical serial number along the left edge (rotated text)
    c.saveState()
    c.translate(58, H / 2 - 70)
    c.rotate(90)
    c.setFont("Courier", 8)
    c.setFillColorRGB(0.5, 0.5, 0.55)
    c.drawString(0, 0, "Certificate No. OCP-2026-00417")
    c.restoreState()
    c.showPage()
    c.save()


# ------------------------------------------------------------------ multipage
def _report_header(p: Page, mark, title: str, page_no: int, total: int) -> None:
    p.rect(0, 0, p.w, 54, fill=NAVY)
    p.image(mark, 36, 9, 36, 36, mask="auto")
    p.text(84, 33, "Annual Field Report 2026", "Helvetica-Bold", 13, (1, 1, 1))
    p.text(p.w - 40, 33, title, "Helvetica", 10, (0.8, 0.87, 1), "right")
    p.line(40, p.h - 46, p.w - 40, p.h - 46, (0.8, 0.82, 0.88), 0.5)
    p.text(p.w / 2, p.h - 30, f"Page {page_no} of {total}", "Helvetica", 9, (0.45, 0.45, 0.5), "center")


def make_multipage(path: Path, pages: int = 8, title: str = "Sample multi-page report") -> None:
    W, H = A4
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle(title)
    mark = logo(160)
    justified = ParagraphStyle("j", fontName="Times-Roman", fontSize=11, leading=15.5, alignment=TA_JUSTIFY)
    ragged = ParagraphStyle("r", fontName="Helvetica", fontSize=10, leading=14, textColor=(0.2, 0.2, 0.25))

    for n in range(1, pages + 1):
        variant = (n - 1) % 8
        if variant == 5:
            # A landscape page the way scanners and some print drivers store it:
            # a portrait MediaBox with sideways content and /Rotate 90.
            pw, ph = H, W
            c.setPageSize((pw, ph))
            c.setPageRotation(90)
            c.translate(W, 0)
            c.rotate(90)
        else:
            pw, ph = W, H
            c.setPageSize((pw, ph))
            c.setPageRotation(0)
        p = Page(c, pw, ph)
        section = ["Overview", "Method", "Findings", "Regional data", "Trends", "Site map", "Appendix A", "Appendix B"][variant]
        _report_header(p, mark, section, n, pages)
        p.text(40, 96, f"{n}. {section}", "Helvetica-Bold", 20, NAVY)
        p.rect(40, 104, 48, 3, fill=(1, 0.77, 0.15))
        top = 128

        if variant == 3:      # table
            rows = [("Region", "Sites", "Visits", "Change")] + [
                (r, str(18 + i * 7), f"{1240 + i * 315:,}", f"{'+' if i % 3 else '-'}{3.2 + i * 1.7:.1f}%")
                for i, r in enumerate(["North", "North-east", "Midlands", "East", "South-west", "South", "Islands"])]
            for i, row in enumerate(rows):
                yy = top + i * 22
                if i == 0:
                    p.rect(40, yy, pw - 80, 22, fill=NAVY)
                elif i % 2 == 0:
                    p.rect(40, yy, pw - 80, 22, fill=(0.95, 0.96, 0.98))
                for j, cell in enumerate(row):
                    x = [48, 300, 410, pw - 48][j]
                    p.text(x, yy + 15, cell, "Helvetica-Bold" if i == 0 else "Helvetica", 10,
                           (1, 1, 1) if i == 0 else (0.15, 0.15, 0.2), "left" if j == 0 else "right")
                p.line(40, yy + 22, pw - 40, yy + 22, (0.85, 0.87, 0.92), 0.5)
            top += len(rows) * 22 + 24
        elif variant == 4:    # bar chart with a trend line
            base, left = top + 190, 70
            p.line(left, top, left, base, (0.3, 0.3, 0.35), 0.8)
            p.line(left, base, pw - 60, base, (0.3, 0.3, 0.35), 0.8)
            values = [62, 88, 74, 120, 143, 131, 168, 150]
            for i, v in enumerate(values):
                x = left + 18 + i * 54
                p.rect(x, base - v, 34, v, fill=(0.25 + i * 0.04, 0.45, 0.8))
                p.text(x + 17, base + 14, str(2019 + i), "Helvetica", 8, (0.35, 0.35, 0.4), "center")
                p.text(x + 17, base - v - 5, str(v), "Helvetica-Bold", 8, NAVY, "center")
            c.saveState()
            c.setStrokeColorRGB(0.9, 0.35, 0.1)
            c.setLineWidth(1.6)
            c.setDash([5, 3], 0)
            trend = c.beginPath()
            for i, v in enumerate(values):
                (trend.moveTo if i == 0 else trend.lineTo)(left + 35 + i * 54, ph - (base - v * 0.9 - 12))
            c.drawPath(trend, stroke=1, fill=0)
            c.restoreState()
            for g in range(1, 5):
                p.line(left, base - g * 40, pw - 60, base - g * 40, (0.88, 0.89, 0.92), 0.4)
            top = base + 40
        elif variant in (1, 6):   # photo with caption
            p.image(jpeg(photo(70 + n, (900, 420))), 40, top, pw - 80, 180)
            p.text(40, top + 196, f"Figure {n}. Survey transect photographed at low tide.", "Helvetica-Oblique", 9,
                   (0.4, 0.4, 0.45))
            top += 216

        for k in range(3 if variant in (3, 4, 1, 6) else 5):
            style = justified if k % 2 == 0 else ragged
            para = Paragraph(LOREM if k % 2 == 0 else LOREM[:260], style)
            _, para_h = para.wrapOn(c, pw - 80, 400)
            if top + para_h > ph - 70:
                break
            para.drawOn(c, 40, ph - top - para_h)
            top += para_h + 14
        c.showPage()
    c.save()


# ------------------------------------------------------------------ statement
def make_statement(path: Path) -> None:
    """An account statement whose transaction table runs over three pages:
    a fully ruled grid, wrapped text in one column, empty cells, and a small
    summary table above it."""
    W, H = A4
    c = canvas.Canvas(str(path), pagesize=A4)
    c.setTitle("Sample account statement")
    rnd = random.Random(11)
    grid, ink = (0.72, 0.74, 0.8), (0.12, 0.13, 0.18)
    xs = [40, 98, 156, 330, 378, 437, 496, W - 40]            # column edges
    heads = ["Date", "Value date", "Particulars", "Cheque", "Debit", "Credit", "Balance"]
    payees = ["UPI/Greenleaf Grocers/Payment", "NEFT/Meridian Payroll Services Private Limited/Salary credit for the month",
              "ATM withdrawal/High Street", "POS/Bluebird Books", "IMPS/Rent/Harbour View Apartments, Flat 12B, second instalment",
              "Card/Metro Rail recharge", "Interest credited", "UPI/Corner Pharmacy"]
    balance = 48250.75
    rows_per_page = [9, 12, 12]
    day = 1

    def table(p: Page, top: float, rows: int) -> None:
        nonlocal balance, day
        head_h, row_h = 22, 30
        p.rect(xs[0], top, xs[-1] - xs[0], head_h, fill=(0.9, 0.92, 0.96))
        for i, label in enumerate(heads):
            p.text(xs[i] + 5, top + 14.5, label, "Helvetica-Bold", 8.5, NAVY)
        for r in range(rows):
            y = top + head_h + r * row_h
            credit = rnd.random() < 0.3
            amount = round(rnd.uniform(120, 9800), 2)
            balance += amount if credit else -amount
            date = f"{day:02d}/09/2026"
            day = min(30, day + rnd.randint(0, 2))
            p.text(xs[0] + 5, y + 12, date, "Helvetica", 8.5, ink)
            p.text(xs[1] + 5, y + 12, date, "Helvetica", 8.5, ink)
            # the particulars wrap onto a second line when they are long
            words, line, lines = payees[rnd.randrange(len(payees))].replace("/", "/ ").split(), "", []
            for word in words:
                if pdfmetrics.stringWidth((line + " " + word).strip(), "Helvetica", 8.5) > xs[3] - xs[2] - 10:
                    lines.append(line)
                    line = word
                else:
                    line = (line + " " + word).strip()
            lines.append(line)
            for k, text in enumerate(lines[:2]):
                p.text(xs[2] + 5, y + 12 + k * 10.5, text, "Helvetica", 8.5, ink)
            if r % 5 == 3:
                p.text(xs[3] + 5, y + 12, str(100200 + r), "Helvetica", 8.5, ink)
            p.text(xs[6 if credit else 5] - 5, y + 12, f"{amount:,.2f}", "Helvetica", 8.5, ink, "right")
            p.text(xs[7] - 5, y + 12, f"{balance:,.2f}", "Helvetica", 8.5, ink, "right")
        bottom = top + head_h + rows * row_h
        for x in xs:
            p.line(x, top, x, bottom, grid, 0.6)
        for r in range(rows + 1):
            p.line(xs[0], top + head_h + r * row_h, xs[-1], top + head_h + r * row_h, grid, 0.6)
        p.line(xs[0], top, xs[-1], top, grid, 0.6)

    for page_no, rows in enumerate(rows_per_page, start=1):
        p = Page(c, W, H)
        p.rect(0, 0, W, 60, fill=NAVY)
        p.image(logo(160), 40, 12, 36, 36, mask="auto")
        p.text(88, 36, "Severn Mutual", "Helvetica-Bold", 15, (1, 1, 1))
        p.text(W - 40, 36, "Statement of account", "Helvetica", 10, (0.8, 0.87, 1), "right")
        top = 84
        if page_no == 1:
            p.text(40, 96, "Dana Whitfield", "Helvetica-Bold", 12, ink)
            for i, text in enumerate(["17 Foundry Lane, Leeds LS9 8AG", "Account 4039 2217  ·  Sort code 20-45-11",
                                      "1 September 2026 to 30 September 2026"]):
                p.text(40, 112 + i * 13, text, "Helvetica", 9, (0.3, 0.3, 0.35))
            # summary: a small ruled table with a header row
            sx = [40, 169, 298, 427, W - 40]
            for i, label in enumerate(["Opening balance", "Total debits", "Total credits", "Closing balance"]):
                p.text(sx[i] + 6, 176, label, "Helvetica-Bold", 8.5, NAVY)
                p.text(sx[i] + 6, 194, ["48,250.75", "31,904.10", "18,220.00", "34,566.65"][i], "Helvetica", 9.5, ink)
            p.rect(40, 164, W - 80, 36, stroke=grid, width=0.6)
            p.line(40, 182, W - 40, 182, grid, 0.6)
            for x in sx[1:-1]:
                p.line(x, 164, x, 200, grid, 0.6)
            top = 226
        table(p, top, rows)
        p.text(W / 2, H - 30, f"Page {page_no} of {len(rows_per_page)}", "Helvetica", 8.5, (0.45, 0.45, 0.5), "center")
        c.showPage()
    c.save()


# ----------------------------------------------------------------- edge cases
def make_scanned(path: Path) -> None:
    """One full-page image and no text layer, like a flatbed scan."""
    W, H = A4
    img = Image.new("RGB", (1240, 1754), (250, 248, 242))
    d = ImageDraw.Draw(img)
    for i in range(26):
        d.rectangle((120, 180 + i * 52, 120 + 900 - (i * 37) % 300, 196 + i * 52), fill=(40, 40, 46))
    img = img.rotate(0.7, resample=Image.BICUBIC, fillcolor=(250, 248, 242)).filter(ImageFilter.GaussianBlur(0.8))
    c = canvas.Canvas(str(path), pagesize=A4)
    c.drawImage(jpeg(img, quality=70), 0, 0, W, H)
    c.showPage()
    c.save()


def make_encrypted(path: Path, source: Path) -> None:
    import pymupdf

    doc = pymupdf.open(str(source))
    doc.save(str(path), encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="secret", owner_pw="owner-secret")
    doc.close()


def make_corrupted(path: Path, source: Path) -> None:
    data = source.read_bytes()
    path.write_bytes(data[:700] + bytes(random.Random(7).randrange(256) for _ in range(900)))


def main() -> int:
    SAMPLES.mkdir(exist_ok=True)
    EDGE.mkdir(exist_ok=True)
    for name, fn in [("invoice.pdf", make_invoice), ("brochure.pdf", make_brochure),
                     ("certificate.pdf", make_certificate), ("multipage.pdf", make_multipage),
                     ("statement.pdf", make_statement)]:
        fn(SAMPLES / name)
        print(f"wrote samples/{name}")
    make_scanned(EDGE / "scanned.pdf")
    make_encrypted(EDGE / "encrypted.pdf", SAMPLES / "invoice.pdf")
    make_corrupted(EDGE / "corrupted.pdf", SAMPLES / "invoice.pdf")
    make_multipage(EDGE / "large_60p.pdf", pages=60, title="Sample 60-page report")
    for name in ("scanned.pdf", "encrypted.pdf", "corrupted.pdf", "large_60p.pdf"):
        print(f"wrote samples/edge/{name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
