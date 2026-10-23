// Template element <-> Fabric object.
//
// The template stores an element's unrotated box (x, y, width, height) and a
// clockwise rotation about the box centre. Fabric objects are positioned by
// their own centre, so both directions go through the centre point.

import { FabricImage, FabricObject, IText, Line, Path, Point, Rect, util } from "fabric";
import type {
  ImageElement, LineElement, PathElement, RectElement, Template, TemplateElement, TextElement, TextSpan,
} from "../types";
import { canvasFontFamily } from "./fonts";
import { mapPath, parsePath, r3, rgba, rotate } from "./geometry";

export interface ObjectContext {
  template: Pick<Template, "id" | "fonts">;
  page: { width: number; height: number };
  /** Already-loaded image for a `src`, if any. */
  image(src: string): HTMLImageElement | undefined;
}

export interface ReadResult {
  element: TemplateElement;
  /** The object no longer matches the element one-to-one and must be recreated. */
  rebuild: boolean;
}

const ACCENT = "#4f46e5";
const VARIABLE_TINT = "rgba(124, 58, 237, 0.14)";
const MIN_STROKE = 0.3; // hairlines (width 0) still need to be visible on screen

const CONTROLS = {
  borderColor: ACCENT,
  cornerColor: "#ffffff",
  cornerStrokeColor: ACCENT,
  cornerStyle: "circle" as const,
  cornerSize: 9,
  transparentCorners: false,
  borderScaleFactor: 1.5,
};

// Image shown with fit: "fit" is smaller than its box; remember by how much.
const boxRatio = new WeakMap<FabricObject, { kx: number; ky: number }>();

const centre = (el: TemplateElement) => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

/** An element that fills the page (a background) is locked unless the user says otherwise. */
export function isLocked(el: TemplateElement, page: { width: number; height: number }): boolean {
  if (el.locked !== undefined) return el.locked;
  return el.type !== "text" && !el.rotation && el.width * el.height >= 0.85 * page.width * page.height;
}

function lockProps(locked: boolean) {
  return locked
    ? { lockMovementX: true, lockMovementY: true, lockRotation: true, lockScalingX: true, lockScalingY: true,
        hasControls: false, hoverCursor: "default" }
    : {};
}

function clipPath(el: TemplateElement, toLocal: (x: number, y: number) => [number, number]): Path | undefined {
  if (!el.clip?.length) return undefined;
  // Fabric takes one clip per object, but a clip can itself be clipped: chain
  // them so the element shows only where every clip overlaps.
  const paths = el.clip.map(
    (clip) => new Path(mapPath(parsePath(clip.d), toLocal), { fillRule: clip.rule, originX: "center", originY: "center" }),
  );
  paths.forEach((path, i) => {
    // A clip is positioned relative to the centre of what it clips. Placing a
    // path's centre at its own pathOffset draws its points where they are written.
    const parent = i === 0 ? { x: 0, y: 0 } : paths[i - 1].pathOffset;
    path.set({ left: path.pathOffset.x - parent.x, top: path.pathOffset.y - parent.y });
    if (i > 0) paths[i - 1].clipPath = path;
  });
  return paths[0];
}

/** Decompose an object's full transform (including a multi-selection it may be part of). */
function readTransform(obj: FabricObject) {
  const q = util.qrDecompose(obj.calcTransformMatrix());
  let angle = q.angle;
  let flipX = false;
  let flipY = q.scaleY < 0;
  if (flipY && Math.abs(angle) > 90) {
    // a vertical flip plus a half turn is a horizontal flip
    angle += angle > 0 ? -180 : 180;
    flipX = true;
    flipY = false;
  }
  return { angle: r3(angle), flipX, flipY, scaleX: Math.abs(q.scaleX), scaleY: Math.abs(q.scaleY),
           skewX: q.skewX, cx: q.translateX, cy: q.translateY };
}

const moved = (a: TemplateElement, b: TemplateElement, keys: string[]) =>
  keys.some((k) => {
    const va = (a as unknown as Record<string, unknown>)[k];
    const vb = (b as unknown as Record<string, unknown>)[k];
    return typeof va === "number" && typeof vb === "number" ? Math.abs(va - vb) > 0.0015 : (va ?? false) !== (vb ?? false);
  });

// ------------------------------------------------------------------ images
function createImage(el: ImageElement, ctx: ObjectContext): FabricObject {
  const { x: cx, y: cy } = centre(el);
  const locked = isLocked(el, ctx.page);
  const img = ctx.image(el.src);
  if (!img || !img.naturalWidth || !img.naturalHeight) {
    // not loaded (yet, or missing): a placeholder with the same box
    return new Rect({
      ...CONTROLS, ...lockProps(locked), originX: "center", originY: "center", left: cx, top: cy,
      width: el.width, height: el.height, angle: el.rotation, fill: "#e2e8f0", stroke: "#94a3b8",
      strokeDashArray: [4, 3], strokeWidth: 1, strokeUniform: true,
    });
  }
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  let crop = { cropX: 0, cropY: 0, width: nw, height: nh };
  let shownW = el.width;
  let shownH = el.height;
  if (el.fit === "fill") {
    const s = Math.max(el.width / nw, el.height / nh);
    crop = { cropX: (nw - el.width / s) / 2, cropY: (nh - el.height / s) / 2, width: el.width / s, height: el.height / s };
  } else if (el.fit === "fit") {
    const s = Math.min(el.width / nw, el.height / nh);
    shownW = nw * s;
    shownH = nh * s;
  }
  const image = new FabricImage(img, {
    ...CONTROLS, ...lockProps(locked), ...crop, originX: "center", originY: "center", left: cx, top: cy,
    scaleX: shownW / crop.width, scaleY: shownH / crop.height, angle: el.rotation,
    flipX: !!el.flipX, flipY: !!el.flipY, skewX: el.skewX ?? 0, opacity: el.opacity ?? 1,
  });
  boxRatio.set(image, { kx: el.width / shownW, ky: el.height / shownH });
  if (el.fit === "stretch" && el.refWidth && el.refHeight) {
    const fx = nw / el.refWidth;
    const fy = nh / el.refHeight;
    image.clipPath = clipPath(el, (x, y) => [x * fx - nw / 2, y * fy - nh / 2]);
  }
  return image;
}

function readBox<T extends ImageElement | RectElement>(obj: FabricObject, el: T): T {
  const t = readTransform(obj);
  const ratio = boxRatio.get(obj) ?? { kx: 1, ky: 1 };
  const width = r3(obj.width * t.scaleX * ratio.kx);
  const height = r3(obj.height * t.scaleY * ratio.ky);
  const next = { ...el, x: r3(t.cx - width / 2), y: r3(t.cy - height / 2), width, height, rotation: t.angle } as T;
  if (el.type === "image") {
    const image = next as ImageElement;
    for (const [key, on] of [["flipX", t.flipX], ["flipY", t.flipY]] as const) {
      if (on) image[key] = true;
      else delete image[key];
    }
  }
  return moved(el, next, ["x", "y", "width", "height", "rotation", "flipX", "flipY"]) ? next : el;
}

// -------------------------------------------------------------------- text
const anchorX = (align: TextElement["align"], width: number) =>
  align === "right" ? width : align === "center" ? width / 2 : 0;

/**
 * Vector from the element's centre to the Fabric text object's centre (before
 * rotation). The two boxes differ because the browser measures text with its
 * own font metrics, so they are tied together where it matters: the first
 * baseline, and the edge the text is aligned to.
 */
function textOffset(el: TextElement, shownW: number, shownH: number, fabricBaseline: number) {
  return {
    x: anchorX(el.align, el.width) - el.width / 2 + (shownW / 2 - anchorX(el.align, shownW)),
    y: el.baseline - el.height / 2 + (shownH / 2 - fabricBaseline),
  };
}

// Fabric puts a line's baseline at fontSize * _fontSizeMult * (1 - _fontSizeFraction)
// below the top of its line box, and advances lines by fontSize * lineHeight * _fontSizeMult.
const fabricBaseline = (text: IText, fontSize: number) => fontSize * text._fontSizeMult * (1 - text._fontSizeFraction);

/**
 * Text that has not been edited since import is spaced out (or tightened) to
 * the width it had in the PDF. This reproduces letter-spacing and hides the
 * small width differences of a substitute font, so the canvas lines up with
 * the original. Edited text is left at the font's natural spacing, which is
 * also how export sets it.
 */
function fitToRecordedWidth(text: IText, el: TextElement): void {
  const lines = el.layout?.lines;
  if (!lines || el.align === "justify" || el.layout?.fontSize !== el.fontSize) return;
  if (lines.map((line) => line.text).join("\n") !== el.content) return;
  const index = lines.reduce((best, line, i) => (line.width > lines[best].width ? i : best), 0);
  const gaps = [...lines[index].text].length - 1;
  const extra = lines[index].width - text.getLineWidth(index);
  if (gaps < 1 || Math.abs(extra) < 0.3 || Math.abs(extra) > 0.2 * lines[index].width) return;
  text.set({ charSpacing: (extra / gaps / el.fontSize) * 1000 });
  text.initDimensions();
}

type CharStyles = Record<number, Record<number, { fontWeight?: TextElement["fontWeight"]; fontStyle?: string }>>;

/** `spans` (counted over characters that are not white space) as Fabric's per-character styles. */
function spansToStyles(content: string, spans: TextSpan[]): CharStyles {
  const styles: CharStyles = {};
  let solid = 0;
  content.split("\n").forEach((line, row) => {
    [...line].forEach((ch, column) => {
      if (/\s/.test(ch)) return;
      const span = spans.find((s) => s.start <= solid && solid < s.end);
      solid += 1;
      if (!span) return;
      const style: CharStyles[number][number] = {};
      if (span.fontWeight !== undefined) style.fontWeight = span.fontWeight;
      if (span.fontStyle !== undefined) style.fontStyle = span.fontStyle;
      (styles[row] ??= {})[column] = style;
    });
  });
  return styles;
}

/** The other way: what is set in another weight / style than the element itself. */
function stylesToSpans(content: string, styles: CharStyles | undefined, el: TextElement): TextSpan[] {
  const spans: TextSpan[] = [];
  let solid = 0;
  content.split("\n").forEach((line, row) => {
    [...line].forEach((ch, column) => {
      if (/\s/.test(ch)) return;
      const style = styles?.[row]?.[column];
      const fontWeight = style?.fontWeight !== undefined && style.fontWeight !== el.fontWeight ? style.fontWeight : undefined;
      const fontStyle = style?.fontStyle !== undefined && style.fontStyle !== el.fontStyle ? (style.fontStyle as TextSpan["fontStyle"]) : undefined;
      if (fontWeight !== undefined || fontStyle !== undefined) {
        const last = spans[spans.length - 1];
        if (last && last.end === solid && last.fontWeight === fontWeight && last.fontStyle === fontStyle) last.end += 1;
        else spans.push({ start: solid, end: solid + 1, ...(fontWeight !== undefined ? { fontWeight } : {}), ...(fontStyle !== undefined ? { fontStyle } : {}) });
      }
      solid += 1;
    });
  });
  return spans;
}

function createText(el: TextElement, ctx: ObjectContext): FabricObject {
  const text = new IText(el.content, {
    ...CONTROLS,
    fontFamily: canvasFontFamily(el, ctx.template),
    fontSize: el.fontSize,
    fontWeight: el.fontWeight,
    fontStyle: el.fontStyle,
    fill: el.color,
    opacity: el.opacity ?? 1,
    // Fabric's plain "justify" also stretches the last line
    textAlign: el.align === "justify" ? "justify-left" : el.align,
    angle: el.rotation,
    // typing grows the text away from the edge it is aligned to
    originX: el.align === "right" ? "right" : el.align === "center" ? "center" : "left",
    originY: "top",
    textBackgroundColor: el.isVariable ? VARIABLE_TINT : "",
    lockScalingFlip: true,
    ...lockProps(el.locked === true),
  });
  if (el.spans?.length) text.set({ styles: spansToStyles(el.content, el.spans) });
  text.set({ lineHeight: el.lineHeight / text._fontSizeMult });
  text.initDimensions();
  fitToRecordedWidth(text, el);
  text.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false });
  const offset = textOffset(el, text.width, text.height, fabricBaseline(text, el.fontSize));
  const [dx, dy] = rotate(offset.x, offset.y, el.rotation);
  const c = centre(el);
  text.setPositionByOrigin(new Point(c.x + dx, c.y + dy), "center", "center");
  return text;
}

function readText(obj: IText, el: TextElement): ReadResult {
  const t = readTransform(obj);
  const scaled = Math.abs(t.scaleY - 1) > 1e-3;
  const fontSize = scaled ? r3(el.fontSize * t.scaleY) : el.fontSize;
  const k = fontSize / el.fontSize;
  const content = obj.text;
  const sameText = content === el.content && !scaled;

  const oldLines = el.content.split("\n").length;
  const lines = content.split("\n").length;
  const firstLine = el.height - (oldLines - 1) * el.lineHeight * el.fontSize;
  const next: TextElement = {
    ...el,
    content,
    fontSize,
    rotation: t.angle,
    baseline: r3(el.baseline * k),
    // The box keeps the PDF's own measurements until the text actually changes.
    width: sameText ? el.width : r3(obj.width * t.scaleX),
    height: sameText ? el.height : r3(firstLine * k + (lines - 1) * el.lineHeight * fontSize),
  };
  if (el.spans?.length && !sameText) {
    // typed text takes the style of the letters around it, as Fabric keeps it
    const spans = stylesToSpans(content, obj.styles as CharStyles, el);
    if (spans.length) next.spans = spans;
    else delete next.spans;
  }
  if (scaled || lines !== oldLines) {
    delete next.layout; // recorded line positions no longer apply
  } else if (next.layout && next.width !== el.width) {
    // The box grew or shrank around the edge the text is aligned to. Recorded
    // line positions are relative to the box's left edge: shift them so the
    // lines that were not edited stay exactly where they are.
    const shift = (el.width - next.width) * (el.align === "right" ? 1 : el.align === "center" ? 0.5 : 0);
    if (shift) {
      next.layout = { ...next.layout, lines: next.layout.lines.map((line) => ({ ...line, x: r3(line.x + shift) })) };
    }
  }

  const offset = textOffset(next, obj.width * t.scaleX, obj.height * t.scaleY, fabricBaseline(obj, fontSize));
  const [dx, dy] = rotate(offset.x, offset.y, t.angle);
  next.x = r3(t.cx - dx - next.width / 2);
  next.y = r3(t.cy - dy - next.height / 2);
  const changed = !sameText || moved(el, next, ["x", "y", "rotation"]);
  return { element: changed ? next : el, rebuild: scaled };
}

// ------------------------------------------------------------------ shapes
function shapeStyle(el: RectElement | LineElement | PathElement) {
  return {
    fill: rgba(el.fill, el.fillOpacity ?? 1),
    stroke: rgba(el.stroke, el.strokeOpacity ?? 1),
    strokeWidth: el.stroke ? Math.max(el.strokeWidth, MIN_STROKE) : 0,
    strokeUniform: true,
    strokeDashArray: el.dash?.length ? el.dash : null,
    strokeLineCap: el.lineCap ?? "butt",
    strokeLineJoin: el.lineJoin ?? "miter",
    // An outline (a table frame, a border) must not swallow clicks meant for
    // what is inside it: without a fill, only the stroke itself is clickable.
    perPixelTargetFind: !el.fill || el.shape !== "rect",
  };
}

function createRect(el: RectElement, ctx: ObjectContext): FabricObject {
  const c = centre(el);
  const rect = new Rect({
    ...CONTROLS, ...lockProps(isLocked(el, ctx.page)), ...shapeStyle(el), originX: "center", originY: "center",
    left: c.x, top: c.y, width: el.width, height: el.height, angle: el.rotation,
  });
  if (el.refWidth && el.refHeight) {
    const fx = el.width / el.refWidth;
    const fy = el.height / el.refHeight;
    rect.clipPath = clipPath(el, (x, y) => [x * fx - el.width / 2, y * fy - el.height / 2]);
  }
  return rect;
}

function createLine(el: LineElement, ctx: ObjectContext): FabricObject {
  return new Line([el.x1, el.y1, el.x2, el.y2], {
    ...CONTROLS, ...lockProps(isLocked(el, ctx.page)), ...shapeStyle(el), fill: "",
    originX: "center", originY: "center", padding: 4,
  });
}

function readLine(obj: Line, el: LineElement): LineElement {
  const p = obj.calcLinePoints();
  const m = obj.calcTransformMatrix();
  const a = new Point(p.x1, p.y1).transform(m);
  const b = new Point(p.x2, p.y2).transform(m);
  const next: LineElement = {
    ...el, x1: r3(a.x), y1: r3(a.y), x2: r3(b.x), y2: r3(b.y),
    x: r3(Math.min(a.x, b.x)), y: r3(Math.min(a.y, b.y)),
    width: r3(Math.abs(a.x - b.x)), height: r3(Math.abs(a.y - b.y)),
  };
  return moved(el, next, ["x1", "y1", "x2", "y2"]) ? next : el;
}

function createPath(el: PathElement, ctx: ObjectContext): FabricObject {
  const sx = el.refWidth ? el.width / el.refWidth : 1;
  const sy = el.refHeight ? el.height / el.refHeight : 1;
  const path = new Path(el.d, {
    ...CONTROLS, ...lockProps(isLocked(el, ctx.page)), ...shapeStyle(el), fillRule: el.fillRule,
    originX: "center", originY: "center", scaleX: sx, scaleY: sy, angle: el.rotation,
  });
  // `d` is written relative to the box's top-left; Fabric centres the path on
  // its true outline, which is not the box centre when curves are involved.
  const po = path.pathOffset;
  const [dx, dy] = rotate((po.x - el.refWidth / 2) * sx, (po.y - el.refHeight / 2) * sy, el.rotation);
  const c = centre(el);
  path.set({ left: c.x + dx, top: c.y + dy });
  path.clipPath = clipPath(el, (x, y) => [x - po.x, y - po.y]);
  return path;
}

function readPath(obj: Path, el: PathElement): PathElement {
  const t = readTransform(obj);
  const width = el.refWidth ? r3(el.refWidth * t.scaleX) : el.width;
  const height = el.refHeight ? r3(el.refHeight * t.scaleY) : el.height;
  const po = obj.pathOffset;
  const [dx, dy] = rotate((el.refWidth / 2 - po.x) * t.scaleX, (el.refHeight / 2 - po.y) * t.scaleY, t.angle);
  const next: PathElement = {
    ...el, width, height, rotation: t.angle,
    x: r3(t.cx + dx - width / 2), y: r3(t.cy + dy - height / 2),
  };
  return moved(el, next, ["x", "y", "width", "height", "rotation"]) ? next : el;
}

// --------------------------------------------------------------------- api
export function createObject(el: TemplateElement, ctx: ObjectContext): FabricObject | null {
  if (el.visible === false) return null;
  switch (el.type) {
    case "image":
      return createImage(el, ctx);
    case "text":
      return createText(el, ctx);
    case "shape":
      if (el.shape === "line") return createLine(el, ctx);
      if (el.shape === "path") return createPath(el, ctx);
      return createRect(el, ctx);
  }
}

/** Read an object's current geometry (and text) back into its element. */
export function readObject(obj: FabricObject, el: TemplateElement): ReadResult {
  if (el.type === "text" && obj instanceof IText) return readText(obj, el);
  if (el.type === "shape" && el.shape === "line" && obj instanceof Line) return { element: readLine(obj, el), rebuild: false };
  if (el.type === "shape" && el.shape === "path" && obj instanceof Path) return { element: readPath(obj, el), rebuild: false };
  if (el.type === "image" || (el.type === "shape" && el.shape === "rect")) {
    return { element: readBox(obj, el), rebuild: false };
  }
  return { element: el, rebuild: false };
}
