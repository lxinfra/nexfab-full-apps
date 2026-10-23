// Fonts for the editor canvas: the template's own (extracted) fonts where the
// browser can use them, otherwise the mapped family with a Google Font fallback.

import { apiUrl, assetUrl } from "../api";
import type { FontWeight, Template, TemplateFont, TextElement } from "../types";

const SUBSTITUTES: Record<string, { google: string | null; generic: string }> = {
  Helvetica: { google: "Arimo", generic: "sans-serif" },
  Arial: { google: "Arimo", generic: "sans-serif" },
  "Times New Roman": { google: "Tinos", generic: "serif" },
  Georgia: { google: "Gelasio", generic: "serif" },
  "Courier New": { google: "Cousine", generic: "monospace" },
  Calibri: { google: "Carlito", generic: "sans-serif" },
  Cambria: { google: "Caladea", generic: "serif" },
  "Segoe UI": { google: "Open Sans", generic: "sans-serif" },
  Garamond: { google: "EB Garamond", generic: "serif" },
  Verdana: { google: null, generic: "sans-serif" },
};

/** Google Fonts offered by name; export uses the same files (bundled or downloaded by the server). */
const GOOGLE_FAMILIES = [
  "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins", "Inter", "Noto Sans", "Noto Serif", "Raleway",
  "Oswald", "Merriweather", "Playfair Display", "Nunito", "Source Sans 3", "PT Sans", "PT Serif", "Ubuntu",
  "Work Sans", "Quicksand", "Rubik", "Mulish", "Fira Sans", "DM Sans", "Lora", "Barlow", "Josefin Sans",
  "Libre Baskerville", "EB Garamond", "Crimson Text", "Bebas Neue", "Anton", "Cinzel", "Dancing Script",
  "Great Vibes", "Pacifico", "Arimo", "Tinos", "Cousine", "Carlito", "Caladea", "Gelasio",
];

/** Families offered in the editor's font menu besides the template's own. */
export const COMMON_FAMILIES = [...Object.keys(SUBSTITUTES), ...[...GOOGLE_FAMILIES].sort()];

export const isBold = (weight: FontWeight | undefined): boolean =>
  weight === "bold" || (typeof weight === "number" && weight >= 600);

const numericWeight = (weight: FontWeight | undefined): number =>
  weight === "bold" ? 700 : typeof weight === "number" ? weight : 400;

const faceName = (templateId: string, fontId: string) => `tpl-${templateId}-${fontId}`;

/** The template font an element is drawn with, if it still uses that face. */
function ownFont(el: TextElement, fonts: TemplateFont[]): TemplateFont | undefined {
  const font = fonts.find((f) => f.id === el.fontId);
  if (!font?.src || font.family !== el.fontFamily) return undefined;
  if (isBold(font.weight) !== isBold(el.fontWeight) || font.style !== el.fontStyle) return undefined;
  return font;
}

/** CSS font-family value for the canvas. */
export function canvasFontFamily(el: TextElement, template: Pick<Template, "id" | "fonts">): string {
  const known = template.fonts.find((f) => f.family === el.fontFamily);
  const google = known?.googleFont ?? SUBSTITUTES[el.fontFamily]?.google ?? null;
  const generic = known?.generic ?? SUBSTITUTES[el.fontFamily]?.generic ?? "sans-serif";
  const stack: string[] = [];
  const own = ownFont(el, template.fonts);
  if (own) stack.push(faceName(template.id, own.id));
  stack.push(el.fontFamily);
  if (google && google !== el.fontFamily) stack.push(google);
  return `${stack.map((name) => `"${name}"`).join(", ")}, ${generic}`;
}

let measuring: CanvasRenderingContext2D | null = null;

/** Width in points of `text` set in the element's font, as the canvas will draw it. */
export function measureText(el: TextElement, text: string, template: Pick<Template, "id" | "fonts">): number {
  measuring ??= document.createElement("canvas").getContext("2d");
  if (!measuring) return text.length * el.fontSize * 0.5;
  measuring.font = `${el.fontStyle} ${numericWeight(el.fontWeight)} ${el.fontSize}px ${canvasFontFamily(el, template)}`;
  return measuring.measureText(text).width;
}

const loadedFaces = new Set<string>();
const requestedGoogle = new Set<string>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(resolve, ms))]);
}

/**
 * Load everything the template's text needs. Never rejects: a font that fails
 * to load just falls through to the next family in the stack.
 */
export async function loadTemplateFonts(template: Template, extraFamilies: string[] = []): Promise<void> {
  const jobs: Promise<unknown>[] = [];

  for (const font of template.fonts) {
    if (!font.src) continue;
    const name = faceName(template.id, font.id);
    if (loadedFaces.has(name)) continue;
    loadedFaces.add(name);
    const face = new FontFace(name, `url("${assetUrl(font.src)}")`, {
      weight: String(numericWeight(font.weight)),
      style: font.style,
    });
    jobs.push(
      face.load().then(
        (loaded) => document.fonts.add(loaded),
        () => console.warn(`Could not load ${font.name} from ${apiUrl()}; using a substitute.`),
      ),
    );
  }

  // Substitutes for fonts the PDF did not embed (or that could not be reused).
  const google = new Set<string>();
  for (const font of template.fonts) if (!font.src && font.googleFont) google.add(font.googleFont);
  for (const family of extraFamilies) {
    const substitute = SUBSTITUTES[family]?.google ?? (GOOGLE_FAMILIES.includes(family) ? family : null);
    if (substitute) google.add(substitute);
  }
  for (const family of google) {
    if (requestedGoogle.has(family)) continue;
    requestedGoogle.add(family);
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:ital,wght@0,400;0,700;1,400;1,700&display=swap`;
    document.head.appendChild(link);
    jobs.push(
      new Promise<void>((resolve) => {
        link.onload = () => resolve();
        link.onerror = () => resolve();
      }).then(() =>
        Promise.all(
          ["400", "700", "italic 400", "italic 700"].map((variant) =>
            document.fonts.load(`${variant} 16px "${family}"`).catch(() => undefined),
          ),
        ),
      ),
    );
  }

  await withTimeout(Promise.all(jobs), 5000);
}
