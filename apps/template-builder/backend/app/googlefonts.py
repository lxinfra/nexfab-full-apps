"""Font files from Google Fonts, downloaded once and kept in the cache folder.

Used to complete a PDF's own fonts with the letters it lacks (extraction) and
to set text in a Google family nobody installed (export). GOOGLE_FONTS=off
switches it off; without a network it gives up quickly and retries later.
"""
from __future__ import annotations

import logging
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .config import settings

log = logging.getLogger(__name__)

STYLES = ("Regular", "Bold", "Italic", "BoldItalic")
_offline_until = 0.0


def google_font_file(family: str, bold: bool, italic: bool) -> Path | None:
    """The family's TrueType file for this style (the upright one when Google
    has no italic), or None when Google does not have the family."""
    global _offline_until
    if not settings.google_fonts:
        return None
    slug = re.sub(r"[^A-Za-z0-9]", "", family)
    if not slug:
        return None
    cache = settings.cache_dir / "google-fonts"
    for slanted in dict.fromkeys((italic, False)):
        file = cache / f"{slug}-{STYLES[(1 if bold else 0) + (2 if slanted else 0)]}.ttf"
        missing = file.with_suffix(".none")
        if file.is_file():
            return file
        if missing.exists() or time.time() < _offline_until:
            continue
        query = urllib.parse.urlencode({"family": f"{family}:ital,wght@{int(slanted)},{700 if bold else 400}"})
        try:
            # without a browser's User-Agent the API answers with plain TrueType files
            with urllib.request.urlopen(f"https://fonts.googleapis.com/css2?{query}", timeout=6) as response:
                css = response.read().decode("utf-8", "replace")
            match = re.search(r"url\((https://fonts\.gstatic\.com/[^)]+\.ttf)\)", css)
            if not match:
                raise ValueError("no TrueType file in the answer")
            with urllib.request.urlopen(match.group(1), timeout=15) as response:
                data = response.read()
        except (urllib.error.HTTPError, ValueError):
            cache.mkdir(parents=True, exist_ok=True)
            missing.touch()   # Google has no such family / style: do not ask again
            continue
        except OSError as exc:
            log.info("Google Fonts unreachable: %s", exc)
            _offline_until = time.time() + 600
            return None
        cache.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        return file
    return None
