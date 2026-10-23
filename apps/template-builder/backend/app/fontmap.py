"""Map PDF font names to web font families (Google Fonts / web-safe)."""
from __future__ import annotations

import re
from dataclasses import dataclass

_SUBSET_PREFIX = re.compile(r"^[A-Z]{6}\+")

# normalised base name -> (CSS family, generic fallback, Google Font to load or None)
# For proprietary faces the Google Font is the metric-compatible open substitute.
_FAMILIES: dict[str, tuple[str, str, str | None]] = {
    # PDF base-14 and the usual office fonts
    "helvetica": ("Helvetica", "sans-serif", "Arimo"),
    "helveticaneue": ("Helvetica Neue", "sans-serif", "Arimo"),
    "arial": ("Arial", "sans-serif", "Arimo"),
    "arialnarrow": ("Arial Narrow", "sans-serif", "Archivo Narrow"),
    "arialblack": ("Arial Black", "sans-serif", "Archivo Black"),
    "times": ("Times New Roman", "serif", "Tinos"),
    "timesroman": ("Times New Roman", "serif", "Tinos"),
    "timesnewroman": ("Times New Roman", "serif", "Tinos"),
    "courier": ("Courier New", "monospace", "Cousine"),
    "couriernew": ("Courier New", "monospace", "Cousine"),
    "symbol": ("Symbol", "serif", None),
    "zapfdingbats": ("ZapfDingbats", "serif", None),
    "calibri": ("Calibri", "sans-serif", "Carlito"),
    "cambria": ("Cambria", "serif", "Caladea"),
    "georgia": ("Georgia", "serif", "Gelasio"),
    "verdana": ("Verdana", "sans-serif", None),
    "tahoma": ("Tahoma", "sans-serif", None),
    "trebuchet": ("Trebuchet MS", "sans-serif", None),
    "trebuchetms": ("Trebuchet MS", "sans-serif", None),
    "segoeui": ("Segoe UI", "sans-serif", "Open Sans"),
    "impact": ("Impact", "sans-serif", "Anton"),
    "comicsans": ("Comic Sans MS", "cursive", "Comic Neue"),
    "comicsansms": ("Comic Sans MS", "cursive", "Comic Neue"),
    "garamond": ("Garamond", "serif", "EB Garamond"),
    "palatino": ("Palatino Linotype", "serif", "Noto Serif"),
    "palatinolinotype": ("Palatino Linotype", "serif", "Noto Serif"),
    "bookantiqua": ("Book Antiqua", "serif", "Noto Serif"),
    "centurygothic": ("Century Gothic", "sans-serif", "Questrial"),
    "consolas": ("Consolas", "monospace", "Inconsolata"),
    "lucidaconsole": ("Lucida Console", "monospace", "Cousine"),
    "gillsans": ("Gill Sans", "sans-serif", "Lato"),
    "futura": ("Futura", "sans-serif", "Jost"),
    "myriadpro": ("Myriad Pro", "sans-serif", "Source Sans 3"),
    "minionpro": ("Minion Pro", "serif", "Crimson Text"),
    # open substitutes that show up in PDFs made on Linux
    "liberationsans": ("Arimo", "sans-serif", "Arimo"),
    "liberationserif": ("Tinos", "serif", "Tinos"),
    "liberationmono": ("Cousine", "monospace", "Cousine"),
    "nimbussans": ("Helvetica", "sans-serif", "Arimo"),
    "nimbussansl": ("Helvetica", "sans-serif", "Arimo"),
    "nimbusroman": ("Times New Roman", "serif", "Tinos"),
    "nimbusromno9l": ("Times New Roman", "serif", "Tinos"),
    "nimbusmonops": ("Courier New", "monospace", "Cousine"),
    "dejavusans": ("DejaVu Sans", "sans-serif", "Noto Sans"),
    "dejavuserif": ("DejaVu Serif", "serif", "Noto Serif"),
    "dejavusansmono": ("DejaVu Sans Mono", "monospace", "Noto Sans Mono"),
    "sourcesanspro": ("Source Sans 3", "sans-serif", "Source Sans 3"),
    "sourceserifpro": ("Source Serif 4", "serif", "Source Serif 4"),
}

# Families that are on Google Fonts under their own name.
_GOOGLE = [
    "Roboto", "Roboto Condensed", "Roboto Slab", "Roboto Mono", "Open Sans", "Lato", "Montserrat",
    "Poppins", "Inter", "Noto Sans", "Noto Serif", "Noto Sans Mono", "Raleway", "Oswald", "Merriweather",
    "Playfair Display", "Nunito", "Nunito Sans", "Ubuntu", "Ubuntu Mono", "PT Sans", "PT Serif", "Work Sans",
    "DM Sans", "DM Serif Display", "Fira Sans", "Fira Mono", "Fira Code", "Barlow", "Rubik", "Mulish", "Karla",
    "Libre Baskerville", "Libre Franklin", "Lora", "Quicksand", "Cabin", "Dosis", "Titillium Web",
    "Josefin Sans", "Bebas Neue", "Anton", "IBM Plex Sans", "IBM Plex Serif", "IBM Plex Mono",
    "Crimson Text", "EB Garamond", "Cormorant Garamond", "Source Sans 3", "Source Serif 4",
    "Source Code Pro", "Inconsolata", "Arimo", "Tinos", "Cousine", "Carlito", "Caladea", "Gelasio",
    "Manrope", "Space Grotesk", "Outfit", "Figtree", "Plus Jakarta Sans", "Archivo", "Bitter",
    "Dancing Script", "Great Vibes", "Pacifico", "Lobster", "Abril Fatface", "Cinzel", "Jost",
    "Exo 2", "Heebo", "Hind", "Kanit", "Oxygen", "Assistant", "Catamaran", "Overpass", "Asap",
    "Zilla Slab", "Arvo", "Vollkorn", "Alegreya", "Alegreya Sans", "Spectral", "Comic Neue",
]
for _name in _GOOGLE:
    _FAMILIES.setdefault(re.sub(r"[^a-z0-9]", "", _name.lower()), (_name, "", _name))

_WEIGHTS = [
    ("extralight", 200), ("ultralight", 200), ("thin", 100), ("hairline", 100),
    ("semibold", 600), ("demibold", 600), ("demi", 600),
    ("extrabold", 800), ("ultrabold", 800), ("black", 900), ("heavy", 900),
    ("bold", 700), ("medium", 500), ("light", 300), ("book", 400), ("regular", 400), ("roman", 400),
]
_STYLE_WORDS = re.compile(
    r"(extra|ultra|semi|demi)?(thin|hairline|light|book|regular|roman|medium|bold|black|heavy)"
    r"|italic|oblique|ital|it|bd",
    re.IGNORECASE,
)
_SERIF_HINT = re.compile(r"serif|roman|times|garamond|georgia|minion|baskerville|caslon|bodoni|didot|palatino", re.I)
_MONO_HINT = re.compile(r"mono|courier|consol|code|typewriter", re.I)


@dataclass(frozen=True)
class FontInfo:
    name: str            # PDF font name without the subset prefix
    family: str          # CSS family to request
    generic: str         # serif | sans-serif | monospace | cursive
    google: str | None   # Google Font to load when the original is unavailable
    weight: int          # 100..900
    italic: bool

    @property
    def bold(self) -> bool:
        return self.weight >= 600

    @property
    def css_weight(self) -> str | int:
        return "bold" if self.weight == 700 else "normal" if self.weight == 400 else self.weight

    @property
    def css_stack(self) -> str:
        parts = [self.family]
        if self.google and self.google != self.family:
            parts.append(self.google)
        return ", ".join(f'"{p}"' for p in parts) + f", {self.generic}"


def strip_subset_prefix(name: str) -> str:
    return _SUBSET_PREFIX.sub("", name or "")


def normalise(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", strip_subset_prefix(name).lower())


def map_font(pdf_name: str, flags: int = 0) -> FontInfo:
    """``flags`` are PyMuPDF span flags (bit 1 italic, 2 serif, 3 monospace, 4 bold)."""
    name = strip_subset_prefix(pdf_name) or "Helvetica"
    base, _, style = name.replace(",", "-").partition("-")
    style_src = style or ""
    base_clean = re.sub(r"(PS)?MT$|PS$", "", base) or base
    if re.sub(r"[^a-z0-9]", "", base_clean.lower()) not in _FAMILIES:
        # style words glued onto the family ("ArialBold", "Roboto Medium Italic")
        words = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", base_clean).split()
        while len(words) > 1 and _STYLE_WORDS.fullmatch(words[-1]):
            style_src = words.pop() + style_src
        base_clean = "".join(words)

    low_style = style_src.lower()
    weight = next((w for key, w in _WEIGHTS if key in low_style), 400)
    if flags & 16 and weight < 600:
        weight = 700
    italic = bool(flags & 2) or "italic" in low_style or "oblique" in low_style or low_style in ("it", "i")

    key = re.sub(r"[^a-z0-9]", "", base_clean.lower())
    if key in _FAMILIES:
        family, generic, google = _FAMILIES[key]
    else:
        family = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", base_clean).strip() or name
        generic, google = "", None
    if not generic:
        if flags & 8 or _MONO_HINT.search(family):
            generic = "monospace"
        elif (flags & 4 or _SERIF_HINT.search(family)) and "sans" not in family.lower():
            generic = "serif"
        else:
            generic = "sans-serif"
    return FontInfo(name=name, family=family, generic=generic, google=google, weight=weight, italic=italic)
