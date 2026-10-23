// Making a table from scratch, and restyling the printed look of a table:
// borders, heading background, row stripes, text size and colour.

import type { LineElement, RectElement, ShapeElement, TemplateElement, TemplatePage, TemplateTable, TextElement } from "../types";
import { newElementId, updateText, withZ } from "./elements";
import { r3 } from "./geometry";
import { rowCount, type Measure } from "./tables";

export interface TableStyle {
  /** Colour of the rules and the frame; null = no lines. */
  borderColor: string | null;
  borderWidth: number;
  /** Background of the heading rows; null = none. */
  headerFill: string | null;
  /** Background of every second body row; null = none. */
  stripeFill: string | null;
  fontSize: number;
  textColor: string;
}

export const DEFAULT_STYLE: TableStyle = {
  borderColor: "#9ca3af", borderWidth: 0.5, headerFill: "#e5e7eb", stripeFill: null, fontSize: 9, textColor: "#111827",
};

const EDGE = 1.5;
const INSET = 4; // pt from the cell's left edge to its text
const LINE_HEIGHT = 1.25;

const isShape = (el: TemplateElement): el is ShapeElement => el.type === "shape" && !el.rotation;
const inTable = (el: TemplateElement, table: TemplateTable) =>
  el.x >= table.x - EDGE && el.x + el.width <= table.x + table.width + EDGE
  && el.y >= table.y - EDGE && el.y + el.height <= table.y + table.height + EDGE;
const spansWidth = (el: TemplateElement, table: TemplateTable) =>
  Math.abs(el.x - table.x) <= EDGE && Math.abs(el.x + el.width - (table.x + table.width)) <= EDGE;
const isRule = (el: TemplateElement) =>
  isShape(el) && ((el as LineElement | RectElement).shape === "line" || Math.min(el.width, el.height) <= EDGE);
const isBand = (el: TemplateElement, table: TemplateTable, top: number, bottom: number): el is RectElement =>
  el.type === "shape" && el.shape === "rect" && spansWidth(el, table) && Math.abs(el.y - top) <= EDGE && Math.abs(el.y + el.height - bottom) <= EDGE;

function rect(id: string, x: number, y: number, w: number, h: number, fill: string | null, stroke: string | null, strokeWidth: number, z: number): RectElement {
  return {
    id, type: "shape", shape: "rect", x: r3(x), y: r3(y), width: r3(w), height: r3(h), rotation: 0, z,
    fill, stroke, strokeWidth, fillOpacity: 1, strokeOpacity: 1,
  };
}

function line(id: string, x1: number, y1: number, x2: number, y2: number, stroke: string, strokeWidth: number, z: number): LineElement {
  return {
    id, type: "shape", shape: "line", x: r3(Math.min(x1, x2)), y: r3(Math.min(y1, y2)),
    width: r3(Math.abs(x2 - x1)), height: r3(Math.abs(y2 - y1)), rotation: 0, z,
    x1: r3(x1), y1: r3(y1), x2: r3(x2), y2: r3(y2), fill: null, stroke, strokeWidth, fillOpacity: 1, strokeOpacity: 1,
  };
}

/** A text element for a cell, sitting at the cell's top-left inset and vertically centred in a one-line row. */
function cellText(
  id: string, content: string, cell: { x: number; y: number; width: number; height: number },
  style: TableStyle, bold: boolean, fontFamily: string, fieldName: string, measure: Measure, z: number,
): TextElement {
  const height = r3(LINE_HEIGHT * style.fontSize);
  const el: TextElement = {
    id, type: "text", x: r3(cell.x + INSET), y: r3(cell.y + Math.max(1, (cell.height - height) / 2)), width: 0, height,
    rotation: 0, z, content, fontFamily, fontName: fontFamily, fontId: null, fontSize: style.fontSize,
    fontWeight: bold ? "bold" : "normal", fontStyle: "normal", color: style.textColor, opacity: 1, align: "left",
    lineHeight: LINE_HEIGHT, baseline: r3(0.8 * style.fontSize + (height - style.fontSize) / 2),
    editable: true, fieldName, isVariable: false,
  };
  el.width = r3(Math.max(2, measure(el, content || "x")));
  return el;
}

export interface NewTableOptions {
  rows: number;
  columns: number;
  headerRows: number;
  style: TableStyle;
  fontFamily: string;
}

/**
 * Draw a table in `area`: frame, rules, heading background, stripes, and a text
 * field in every cell (headings "Column 1…", body cells empty) so it can be
 * filled by hand or from a spreadsheet.
 */
export function createTable(
  page: TemplatePage, area: { x: number; y: number; width: number; height: number }, options: NewTableOptions, measure: Measure,
): TemplatePage {
  const rows = Math.max(1, Math.round(options.rows)), columns = Math.max(1, Math.round(options.columns));
  const headerRows = Math.max(0, Math.min(rows - 1, Math.round(options.headerRows)));
  const { style } = options;
  const colEdges = Array.from({ length: columns + 1 }, (_, i) => r3(area.x + (area.width * i) / columns));
  const rowEdges = Array.from({ length: rows + 1 }, (_, i) => r3(area.y + (area.height * i) / rows));
  const taken = new Set(page.elements.map((el) => el.id));
  const names = new Set(page.elements.flatMap((el) => (el.type === "text" ? [el.fieldName] : [])));
  const id = () => newElementId(page.index, taken);
  const made: TemplateElement[] = [];
  let z = page.elements.length;

  if (style.headerFill && headerRows) {
    made.push(rect(id(), area.x, area.y, area.width, rowEdges[headerRows] - area.y, style.headerFill, null, 0, z++));
  }
  if (style.stripeFill) {
    for (let r = headerRows + 1; r < rows; r += 2) {
      made.push(rect(id(), area.x, rowEdges[r], area.width, rowEdges[r + 1] - rowEdges[r], style.stripeFill, null, 0, z++));
    }
  }
  if (style.borderColor) {
    for (let r = 1; r < rows; r += 1) made.push(line(id(), area.x, rowEdges[r], area.x + area.width, rowEdges[r], style.borderColor, style.borderWidth, z++));
    for (let c = 1; c < columns; c += 1) made.push(line(id(), colEdges[c], area.y, colEdges[c], area.y + area.height, style.borderColor, style.borderWidth, z++));
    made.push(rect(id(), area.x, area.y, area.width, area.height, null, style.borderColor, style.borderWidth, z++));
  }
  let n = 1;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const cell = { x: colEdges[c], y: rowEdges[r], width: colEdges[c + 1] - colEdges[c], height: rowEdges[r + 1] - rowEdges[r] };
      const heading = r < headerRows;
      let fieldName = heading ? `heading_${c + 1}` : `cell_${r + 1}_${c + 1}`;
      while (names.has(fieldName)) fieldName = `${fieldName}_${n++}`;
      names.add(fieldName);
      made.push(cellText(id(), heading ? `Column ${c + 1}` : "", cell, style, heading, options.fontFamily, fieldName, measure, z++));
    }
  }
  const tableIds = new Set((page.tables ?? []).map((t) => t.id));
  let k = (page.tables ?? []).length + 1;
  while (tableIds.has(`p${page.index + 1}-t${k}`)) k += 1;
  const table: TemplateTable = {
    id: `p${page.index + 1}-t${k}`, x: colEdges[0], y: rowEdges[0], width: r3(area.width), height: r3(area.height),
    columns: colEdges, rows: rowEdges, headerRows, source: "manual",
  };
  return { ...page, elements: withZ([...page.elements, ...made]), tables: [...(page.tables ?? []), table] };
}

/** The style a table has now, as far as it can be read off the page (for the style panel's starting values). */
export function readStyle(page: TemplatePage, table: TemplateTable): TableStyle {
  const inside = page.elements.filter((el) => inTable(el, table));
  const rule = inside.find((el) => isRule(el)) as LineElement | RectElement | undefined;
  const header = table.headerRows ? inside.find((el) => isBand(el, table, table.rows[0], table.rows[table.headerRows])) as RectElement | undefined : undefined;
  const stripe = inside.find((el) => el.type === "shape" && el.shape === "rect" && spansWidth(el, table) && el.fill
    && table.rows.some((y, i) => i >= table.headerRows && i < rowCount(table) && Math.abs(el.y - y) <= EDGE)) as RectElement | undefined;
  const text = inside.find((el) => el.type === "text") as TextElement | undefined;
  return {
    borderColor: rule ? (rule.shape === "line" ? rule.stroke : rule.fill ?? rule.stroke) : null,
    borderWidth: rule ? (rule.shape === "line" ? rule.strokeWidth : Math.min(rule.width, rule.height)) : DEFAULT_STYLE.borderWidth,
    headerFill: header?.fill ?? null,
    stripeFill: stripe?.fill ?? null,
    fontSize: text?.fontSize ?? DEFAULT_STYLE.fontSize,
    textColor: text?.color ?? DEFAULT_STYLE.textColor,
  };
}

/**
 * Change the look of a table: its rules and frame, heading background, stripes
 * and text. Backgrounds are drawn when the table has none, and removed when
 * set to none.
 */
export function restyleTable(page: TemplatePage, table: TemplateTable, style: TableStyle, measure?: Measure): TemplatePage {
  const taken = new Set(page.elements.map((el) => el.id));
  const headerTop = table.rows[0], headerBottom = table.rows[table.headerRows];
  const stripeRows = Array.from({ length: rowCount(table) }, (_, r) => r).filter((r) => r >= table.headerRows && (r - table.headerRows) % 2 === 1);
  const isStripe = (el: TemplateElement) => stripeRows.some((r) => isBand(el, table, table.rows[r], table.rows[r + 1]));
  const isHeader = (el: TemplateElement) => table.headerRows > 0 && isBand(el, table, headerTop, headerBottom);
  let sawHeader = false;
  const sawStripes = new Set<number>();
  const out: TemplateElement[] = [];
  for (const el of page.elements) {
    if (!inTable(el, table)) {
      out.push(el);
      continue;
    }
    if (el.type === "text") {
      let next: TextElement = el;
      if (next.color !== style.textColor) next = { ...next, color: style.textColor };
      if (Math.abs(next.fontSize - style.fontSize) > 0.01) {
        next = updateText(next, { fontSize: style.fontSize });
        if (measure && next.content) {
          const width = Math.max(...next.content.split("\n").map((l) => measure(next, l)));
          if (next.align === "right") next.x = r3(next.x + next.width - width);
          next.width = r3(width);
        }
      }
      out.push(next);
      continue;
    }
    if (isShape(el) && isHeader(el)) {
      sawHeader = true;
      if (style.headerFill) out.push({ ...(el as RectElement), fill: style.headerFill });
      continue;   // none wanted: the band goes
    }
    if (isShape(el) && isStripe(el)) {
      sawStripes.add(stripeRows.find((r) => isBand(el, table, table.rows[r], table.rows[r + 1]))!);
      if (style.stripeFill) out.push({ ...(el as RectElement), fill: style.stripeFill });
      continue;
    }
    if (isRule(el)) {
      if (!style.borderColor) continue;
      const shape = el as LineElement | RectElement;
      if (shape.shape === "line") out.push({ ...shape, stroke: style.borderColor, strokeWidth: style.borderWidth });
      else if (shape.width <= EDGE) out.push({ ...shape, fill: style.borderColor, width: r3(style.borderWidth), stroke: null });
      else out.push({ ...shape, fill: style.borderColor, height: r3(style.borderWidth), stroke: null });
      continue;
    }
    if (el.type === "shape" && el.shape === "rect" && !el.fill && el.stroke && Math.abs(el.x - table.x) <= EDGE && Math.abs(el.y - table.y) <= EDGE
        && Math.abs(el.width - table.width) <= EDGE && Math.abs(el.height - table.height) <= EDGE) {
      // the frame
      if (style.borderColor) out.push({ ...el, stroke: style.borderColor, strokeWidth: style.borderWidth });
      continue;
    }
    out.push(el);
  }
  // backgrounds the table did not have yet go under everything else of the table
  const added: TemplateElement[] = [];
  const id = () => newElementId(page.index, taken);
  if (style.headerFill && table.headerRows && !sawHeader) {
    added.push(rect(id(), table.x, headerTop, table.width, headerBottom - headerTop, style.headerFill, null, 0, 0));
  }
  if (style.stripeFill) {
    for (const r of stripeRows) {
      if (!sawStripes.has(r)) added.push(rect(id(), table.x, table.rows[r], table.width, table.rows[r + 1] - table.rows[r], style.stripeFill, null, 0, 0));
    }
  }
  // lines the table did not have: a frame and rules on every edge
  if (style.borderColor && !page.elements.some((el) => inTable(el, table) && isRule(el))) {
    for (let r = 1; r < rowCount(table); r += 1) added.push(line(id(), table.x, table.rows[r], table.x + table.width, table.rows[r], style.borderColor, style.borderWidth, 0));
    for (let c = 1; c < table.columns.length - 1; c += 1) added.push(line(id(), table.columns[c], table.y, table.columns[c], table.y + table.height, style.borderColor, style.borderWidth, 0));
    added.push(rect(id(), table.x, table.y, table.width, table.height, null, style.borderColor, style.borderWidth, 0));
  }
  if (!added.length) return out.every((el, i) => el === page.elements[i]) && out.length === page.elements.length ? page : { ...page, elements: withZ(out) };
  const first = out.findIndex((el) => inTable(el, table));
  const at = first < 0 ? out.length : first;
  return { ...page, elements: withZ([...out.slice(0, at), ...added, ...out.slice(at)]) };
}
