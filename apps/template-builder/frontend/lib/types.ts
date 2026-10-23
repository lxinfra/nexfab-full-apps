// The template JSON produced by POST /api/upload and stored by the backend.
//
// Coordinates are PDF points with the origin at the page's top-left corner.
// x, y, width and height describe an element's *unrotated* box; `rotation` is
// in degrees, clockwise, about the centre of that box.

export interface Template {
  id: string;
  name: string;
  originalFilename: string;
  sourceFile: string;
  pageCount: number;
  createdAt: string;
  updatedAt: string;
  fonts: TemplateFont[];
  warnings: TemplateWarning[];
  pages: TemplatePage[];
}

export interface TemplateSummary {
  id: string;
  name: string;
  pageCount: number;
  thumbnail: string | null;
  width: number | null;
  height: number | null;
  warnings: number;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateWarning {
  code: string;
  message: string;
  page?: number;
}

export interface TemplateFont {
  id: string;
  /** PDF font name without its subset prefix, e.g. "Arial-BoldMT". */
  name: string;
  /** CSS family to request. */
  family: string;
  generic: "serif" | "sans-serif" | "monospace" | "cursive";
  /** Google Font to load when the original face is unavailable. */
  googleFont: string | null;
  weight: FontWeight;
  style: "normal" | "italic";
  embedded: boolean;
  subset: boolean;
  /** CSS font format of `src`. */
  format: "truetype" | "opentype" | null;
  /** URL of the extracted font for @font-face, when the browser can use it. */
  src: string | null;
  /** URL of the font program used by PDF export. */
  file: string | null;
  /** The extracted font covers every character the PDF uses. */
  usable: boolean;
  license: "installable" | "editable" | "preview-print" | "restricted" | "unknown";
  pages: number[];
}

export interface TemplatePage {
  /**
   * Editor-only: identifies the page while pages are added, duplicated or
   * removed (`index` changes then). Not stored by the server.
   */
  key?: string;
  index: number;
  width: number;
  height: number;
  /** /Rotate of the source page. Coordinates are already in displayed orientation. */
  rotation: number;
  /** Low-res render of the original page (the "ghost" underlay). */
  preview: string | null;
  scanned: boolean;
  /** Tables detected on the page. */
  tables: TemplateTable[];
  elements: TemplateElement[];
}

/**
 * A detected table, as a grid. Which text belongs to which cell is decided by
 * position (an element is in the cell that contains its centre).
 */
export interface TemplateTable {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** x of every column edge, left to right (one more than the number of columns). */
  columns: number[];
  /** y of every row edge, top to bottom (one more than the number of rows). */
  rows: number[];
  /** 1 when the first row holds column headings. */
  headerRows: number;
  /** "ruled": cells boxed in by lines. "aligned": found from text alignment. "manual": marked by hand. */
  source: "ruled" | "aligned" | "manual";
}

export type FontWeight = "normal" | "bold" | number;
export type TemplateElement = ImageElement | TextElement | ShapeElement;

interface BaseElement {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** Stacking order: 0 is painted first. */
  z: number;
  visible?: boolean;
  /**
   * Editor-only: the element cannot be moved or resized on the canvas. When
   * unset, elements that fill the page (backgrounds) are treated as locked.
   */
  locked?: boolean;
  /**
   * Clip paths in the element's own frame (origin at the box's top-left, in the
   * units of refWidth x refHeight), so they follow the element when it moves.
   */
  clip?: ClipPath[];
  refWidth?: number;
  refHeight?: number;
}

export interface ClipPath {
  /** SVG path data using absolute M, L, C and Z only. */
  d: string;
  rule: "nonzero" | "evenodd";
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string;
  opacity: number;
  /** How the picture fills its box. Extracted images are always "stretch". */
  fit: "stretch" | "fit" | "fill";
  naturalWidth: number;
  naturalHeight: number;
  flipX?: boolean;
  flipY?: boolean;
  skewX?: number;
}

export interface TextElement extends BaseElement {
  type: "text";
  /** Lines are separated by "\n". */
  content: string;
  fontFamily: string;
  fontName: string;
  /** Key into Template.fonts. */
  fontId: string | null;
  fontSize: number;
  fontWeight: FontWeight;
  fontStyle: "normal" | "italic";
  color: string;
  opacity: number;
  align: "left" | "center" | "right" | "justify";
  /** Line advance as a multiple of fontSize. */
  lineHeight: number;
  /** Distance from the top of the box to the first baseline. */
  baseline: number;
  editable: boolean;
  fieldName: string;
  isVariable: boolean;
  /** Invisible text recovered by OCR (or a scan's hidden text layer). */
  ocr?: boolean;
  /** Stretches set in another weight or style than the rest (bold words from Excel). */
  spans?: TextSpan[];
  /**
   * Where each line and word sat in the source PDF. Export uses it to put
   * unchanged lines back exactly; it is ignored once the line count or font
   * size changes.
   */
  layout?: TextLayout;
}

/**
 * `start` and `end` count only the characters that are not white space, so a
 * stretch stays on its words when the text is wrapped onto other lines.
 */
export interface TextSpan {
  start: number;
  end: number;
  fontWeight?: FontWeight;
  fontStyle?: "normal" | "italic";
}

export interface TextLayout {
  fontSize: number;
  lines: {
    text: string;
    x: number;
    y: number;
    width: number;
    /** Per word: [offset in line, width, offsets of the 2nd..nth glyph (kerned words only)]. */
    words?: ([number, number] | [number, number, number[]])[];
  }[];
}

interface ShapeStyle {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  fillOpacity: number;
  strokeOpacity: number;
  dash?: number[];
  lineCap?: "butt" | "round" | "square";
  lineJoin?: "miter" | "round" | "bevel";
}

export interface RectElement extends BaseElement, ShapeStyle {
  type: "shape";
  shape: "rect";
}

export interface LineElement extends BaseElement, ShapeStyle {
  type: "shape";
  shape: "line";
  /** End points in page coordinates; x/y/width/height are their bounding box. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PathElement extends BaseElement, ShapeStyle {
  type: "shape";
  shape: "path";
  /** Path data relative to the box's top-left, at refWidth x refHeight. */
  d: string;
  fillRule: "nonzero" | "evenodd";
  refWidth: number;
  refHeight: number;
}

export type ShapeElement = RectElement | LineElement | PathElement;
