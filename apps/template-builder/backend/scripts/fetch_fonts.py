"""Download the open fonts bundled in ``backend/fonts``.

They are the substitutes for fonts a PDF names but does not embed, and the
source of letters a PDF's embedded fonts lack (see app/extraction/fontbuild.py).
All are SIL Open Font License or Apache licensed, so their letters may be
copied into new fonts. Variable fonts are cut into static Regular / Bold /
Italic / BoldItalic files.

    python scripts/fetch_fonts.py
"""
from __future__ import annotations

import io
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

BASE = "https://github.com/google/fonts/raw/main/"
OUT = Path(__file__).resolve().parents[1] / "fonts"
STYLES = (("Regular", 400, False), ("Bold", 700, False), ("Italic", 400, True), ("BoldItalic", 700, True))

# family -> (folder in google/fonts, upright file, italic file); None = static files named Family-Style.ttf
FAMILIES: dict[str, tuple[str, str | None, str | None]] = {
    "Arimo": ("ofl/arimo", "Arimo[wght].ttf", "Arimo-Italic[wght].ttf"),            # Arial, Helvetica
    "Tinos": ("ofl/tinos", None, None),                                             # Times New Roman
    "Cousine": ("ofl/cousine", None, None),                                         # Courier New
    "Carlito": ("ofl/carlito", None, None),                                         # Calibri
    "Caladea": ("ofl/caladea", None, None),                                         # Cambria
    "Gelasio": ("ofl/gelasio", "Gelasio[wght].ttf", "Gelasio-Italic[wght].ttf"),    # Georgia
    "NotoSans": ("ofl/notosans", "NotoSans[wdth,wght].ttf", "NotoSans-Italic[wdth,wght].ttf"),
    "NotoSerif": ("ofl/notoserif", "NotoSerif[wdth,wght].ttf", "NotoSerif-Italic[wdth,wght].ttf"),
    "OpenSans": ("ofl/opensans", "OpenSans[wdth,wght].ttf", "OpenSans-Italic[wdth,wght].ttf"),  # Segoe UI
    "Roboto": ("ofl/roboto", "Roboto[wdth,wght].ttf", "Roboto-Italic[wdth,wght].ttf"),
    "Lato": ("ofl/lato", None, None),
    "Montserrat": ("ofl/montserrat", "Montserrat[wght].ttf", "Montserrat-Italic[wght].ttf"),
    "EBGaramond": ("ofl/ebgaramond", "EBGaramond[wght].ttf", "EBGaramond-Italic[wght].ttf"),     # Garamond
    "LibreBaskerville": ("ofl/librebaskerville", "LibreBaskerville[wght].ttf", "LibreBaskerville-Italic[wght].ttf"),
}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def static_cut(data: bytes, weight: int) -> TTFont:
    font = TTFont(io.BytesIO(data))
    axes = {axis.axisTag: axis for axis in font["fvar"].axes}
    location = {tag: (min(max(weight, axis.minValue), axis.maxValue) if tag == "wght" else axis.defaultValue)
                for tag, axis in axes.items()}
    return instantiateVariableFont(font, location, updateFontNames=False)


def main() -> int:
    OUT.mkdir(exist_ok=True)
    failed = 0
    for family, (folder, upright, italic) in FAMILIES.items():
        for style, weight, slanted in STYLES:
            target = OUT / f"{family}-{style}.ttf"
            if target.exists():
                continue
            try:
                variable = italic if slanted else upright
                if variable is None:
                    target.write_bytes(fetch(f"{BASE}{folder}/{family}-{style}.ttf"))
                else:
                    font = static_cut(fetch(f"{BASE}{folder}/{urllib.parse.quote(variable)}"), weight)
                    font.save(target)
                print("saved", target.name)
            except Exception as exc:
                failed += 1
                print(f"could not get {target.name}: {exc}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
