Open fonts bundled with the app (SIL Open Font License / Apache), fetched by
`python scripts/fetch_fonts.py`: Arimo, Tinos, Cousine (metric-compatible with
Arial / Helvetica, Times New Roman and Courier New), Carlito (Calibri), Caladea
(Cambria), Gelasio (Georgia), Noto Sans, Noto Serif, Open Sans (Segoe UI),
Roboto, Lato, Montserrat, EB Garamond and Libre Baskerville, each in Regular,
Bold, Italic and BoldItalic. Drop more `.ttf` / `.otf` files here to make them
available to PDF export.

They are used two ways:

* **Completing a PDF's own fonts.** A PDF embeds only the letters it uses.
  On upload, every piece of an embedded font is merged into one font and the
  letters it lacks are borrowed from the closest open font, sized to match:
  the same family when it is here or on Google Fonts, else its look-alike,
  else Tinos / Arimo / Cousine. Only open fonts are borrowed from.
* **Export.** Each text element is set with, in this order:
  1. the font from the source PDF (completed as above, when it can be reused),
  2. a file for the element's family from this folder or the system font folders,
     named either like the system does (`arial.ttf`) or `Family-Style.ttf`
     (`Roboto-Bold.ttf`, `OpenSans-Italic.ttf`, ...) as Google Fonts ships them,
  3. the family from Google Fonts (downloaded once into the cache folder;
     `GOOGLE_FONTS=off` turns this off),
  4. the matching built-in face (Helvetica / Times / Courier).
