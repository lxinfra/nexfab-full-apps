"""Choose the font program used to set a text element in an exported PDF.

Order of preference:
1. the font embedded in the source PDF (when it covers the text and the element
   still uses that face),
2. a font file for the family from ``backend/fonts`` or the system font folders,
3. the matching PDF base-14 face (Helvetica / Times / Courier).
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

import pymupdf

from ..config import settings
from ..fontmap import map_font, normalise
from ..googlefonts import google_font_file
from ..storage import Storage

log = logging.getLogger(__name__)

# (regular, bold, italic, bold italic)
_BASE14 = {
    "sans-serif": ("helv", "hebo", "heit", "hebi"),
    "serif": ("tiro", "tibo", "tiit", "tibi"),
    "monospace": ("cour", "cobo", "coit", "cobi"),
}
_BASE14_FAMILIES = {"helvetica": "sans-serif", "timesnewroman": "serif", "times": "serif",
                    "couriernew": "monospace", "courier": "monospace"}

# Well-known file names per family: (regular, bold, italic, bold italic)
_FILES: dict[str, tuple[str | None, ...]] = {
    "arial": ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"),
    "timesnewroman": ("times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"),
    "couriernew": ("cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"),
    "georgia": ("georgia.ttf", "georgiab.ttf", "georgiai.ttf", "georgiaz.ttf"),
    "verdana": ("verdana.ttf", "verdanab.ttf", "verdanai.ttf", "verdanaz.ttf"),
    "tahoma": ("tahoma.ttf", "tahomabd.ttf", None, None),
    "trebuchetms": ("trebuc.ttf", "trebucbd.ttf", "trebucit.ttf", "trebucbi.ttf"),
    "calibri": ("calibri.ttf", "calibrib.ttf", "calibrii.ttf", "calibriz.ttf"),
    "segoeui": ("segoeui.ttf", "segoeuib.ttf", "segoeuii.ttf", "segoeuiz.ttf"),
    "consolas": ("consola.ttf", "consolab.ttf", "consolai.ttf", "consolaz.ttf"),
    "comicsansms": ("comic.ttf", "comicbd.ttf", "comici.ttf", "comicz.ttf"),
    "palatinolinotype": ("pala.ttf", "palab.ttf", "palai.ttf", "palabi.ttf"),
    "impact": ("impact.ttf", None, None, None),
    "arimo": ("LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf",
              "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf"),
    "tinos": ("LiberationSerif-Regular.ttf", "LiberationSerif-Bold.ttf",
              "LiberationSerif-Italic.ttf", "LiberationSerif-BoldItalic.ttf"),
    "cousine": ("LiberationMono-Regular.ttf", "LiberationMono-Bold.ttf",
                "LiberationMono-Italic.ttf", "LiberationMono-BoldItalic.ttf"),
}
_STYLE_SUFFIX = ("Regular", "Bold", "Italic", "BoldItalic")
# Wide-coverage faces tried when nothing else has the characters.
_LAST_RESORT = ("segoeui.ttf", "NotoSans-Regular.ttf", "DejaVuSans.ttf", "arialuni.ttf")

_LIGATURES = {"\ufb00": "ff", "\ufb01": "fi", "\ufb02": "fl", "\ufb03": "ffi", "\ufb04": "ffl",
              "\ufb05": "st", "\ufb06": "st"}

_file_index: dict[str, Path] | None = None


def _font_dirs() -> list[Path]:
    dirs = [settings.fonts_dir]
    if sys.platform == "win32":
        dirs.append(Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts")
        dirs.append(Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "Windows" / "Fonts")
    elif sys.platform == "darwin":
        dirs += [Path("/System/Library/Fonts"), Path("/Library/Fonts"), Path.home() / "Library" / "Fonts"]
    else:
        dirs += [Path("/usr/share/fonts"), Path("/usr/local/share/fonts"), Path.home() / ".fonts"]
    return dirs


def _index() -> dict[str, Path]:
    """Lower-cased file name -> path for every .ttf/.otf we can see (first directory wins)."""
    global _file_index
    if _file_index is None:
        _file_index = {}
        for root in _font_dirs():
            if not root.is_dir():
                continue
            for dirpath, _dirs, files in os.walk(root):
                for name in files:
                    if name.lower().endswith((".ttf", ".otf")):
                        _file_index.setdefault(name.lower(), Path(dirpath) / name)
    return _file_index


def expand_ligatures(text: str) -> str:
    return "".join(_LIGATURES.get(c, c) for c in text)


def _is_bold(el: dict) -> bool:
    weight = el.get("fontWeight", "normal")
    if isinstance(weight, str):
        return weight == "bold" or (weight.isdigit() and int(weight) >= 600)
    return weight >= 600


class FontResolver:
    def __init__(self, fonts: list[dict], storage: Storage) -> None:
        self._entries = {f["id"]: f for f in fonts or []}
        self._storage = storage
        self._cache: dict[str, pymupdf.Font | None] = {}

    # ---- loading -------------------------------------------------------
    def _builtin(self, code: str) -> pymupdf.Font:
        font = self._cache.get(code)
        if font is None:
            font = self._cache[code] = pymupdf.Font(code)
        return font

    def _from_file(self, name: str | None) -> pymupdf.Font | None:
        if not name:
            return None
        key = "file:" + name.lower()
        if key not in self._cache:
            path = _index().get(name.lower())
            try:
                self._cache[key] = pymupdf.Font(fontfile=str(path)) if path else None
            except Exception as exc:
                log.info("cannot load font %s: %s", path, exc)
                self._cache[key] = None
        return self._cache[key]

    def _from_path(self, path: Path | None) -> pymupdf.Font | None:
        if path is None:
            return None
        key = "path:" + str(path)
        if key not in self._cache:
            try:
                self._cache[key] = pymupdf.Font(fontfile=str(path))
            except Exception as exc:
                log.info("cannot load font %s: %s", path, exc)
                self._cache[key] = None
        return self._cache[key]

    def _embedded(self, entry: dict) -> pymupdf.Font | None:
        key = "emb:" + entry["id"]
        if key not in self._cache:
            font = None
            storage_key = self._storage.key_from_url(entry.get("file") or "")
            if entry.get("usable") and storage_key and self._storage.exists(storage_key):
                try:
                    font = pymupdf.Font(fontbuffer=self._storage.read(storage_key))
                except Exception as exc:
                    log.info("cannot load embedded font %s: %s", entry["id"], exc)
            self._cache[key] = font
        return self._cache[key]

    # ---- selection -----------------------------------------------------
    def _candidates(self, el: dict):
        bold, italic = _is_bold(el), el.get("fontStyle") == "italic"
        style = (1 if bold else 0) + (2 if italic else 0)
        family = el.get("fontFamily") or "Helvetica"

        # Each candidate is (font, exact): exact means it is the face the source
        # PDF itself was drawn with, so recorded glyph positions apply to it.
        entry = self._entries.get(el.get("fontId") or "")
        if entry is not None and entry.get("family") == family:
            entry_bold = entry.get("weight") == "bold" or (isinstance(entry.get("weight"), int) and entry["weight"] >= 600)
            if entry_bold == bold and (entry.get("style") == "italic") == italic:
                yield self._embedded(entry), True

        info = map_font(family)
        names = [normalise(family)]
        if info.google and normalise(info.google) not in names:
            names.append(normalise(info.google))
        builtin = _BASE14_FAMILIES.get(names[0])
        if builtin and (entry is None or not entry.get("embedded")):
            # The PDF referenced a standard font without embedding it; viewers
            # (MuPDF included) draw those with the base-14 faces.
            yield self._builtin(_BASE14[builtin][style]), True
        for name in names:
            known = _FILES.get(name)
            if known:
                yield self._from_file(known[style]), False
        for label in (family.replace(" ", ""), (info.google or "").replace(" ", "")):
            if label:
                yield self._from_file(f"{label}-{_STYLE_SUFFIX[style]}.ttf"), False
                yield self._from_file(f"{label}-{_STYLE_SUFFIX[style]}.otf"), False
        # a family nobody installed, as the editor shows it: from Google Fonts
        for name in dict.fromkeys(n for n in (family, info.google) if n):
            yield self._from_path(google_font_file(name, bold, italic)), False
        generic = info.generic if info.generic in _BASE14 else "sans-serif"
        if entry is not None and entry.get("generic") in _BASE14:
            generic = entry["generic"]
        yield self._builtin(_BASE14[generic][style]), False
        for name in _LAST_RESORT:
            yield self._from_file(name), False

    def resolve(self, el: dict, text: str) -> tuple[pymupdf.Font, str, bool]:
        """Return (font, text, exact). ``text`` may have ligature characters
        expanded if that is what it takes for the font to cover it."""
        chars = {c for c in text if not c.isspace()}
        plain = expand_ligatures(text)
        plain_chars = {c for c in plain if not c.isspace()}
        first = None
        for font, exact in self._candidates(el):
            if font is None:
                continue
            first = first or font
            if all(font.has_glyph(ord(c)) for c in chars):
                return font, text, exact
            if plain != text and all(font.has_glyph(ord(c)) for c in plain_chars):
                return font, plain, False
        return first or self._builtin("helv"), plain, False
