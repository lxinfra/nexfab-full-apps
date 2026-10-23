// Editing a table's grid by hand, with the printed table following: moving a
// column or row edge, adding and removing columns and rows, marking a table the
// detector missed, and removing a wrong one.
//
// The printed table is whatever lines and boxes the page holds. Each operation
// moves, stretches, copies or removes the ones that belong to the edge, row or
// column in question, so the page keeps looking like a table afterwards.

import type { LineElement, RectElement, ShapeElement, TemplateElement, TemplatePage, TemplateTable, TextElement } from "../types";
import { moveElement, newElementId, withZ } from "./elements";
import { r3 } from "./geometry";
import { columnCount, fitEditedCell, flowBelow, rowCount, shiftTablesBelow, type Measure } from "./tables";

const EDGE = 1.5; // pt: how close a line or box must be to an edge to belong to it
export const MIN_COLUMN = 8;
export const MIN_ROW = 6;

const near = (a: number, b: number, tolerance = EDGE) => Math.abs(a - b) <= tolerance;
const bottomOf = (table: TemplateTable) => table.rows[table.rows.length - 1];
const rightOf = (table: TemplateTable) => table.columns[table.columns.length - 1];

const isShape = (el: TemplateElement): el is ShapeElement => el.type === "shape" && !el.rotation;
const isVertical = (el: TemplateElement): el is LineElement => isShape(el) && el.shape === "line" && Math.abs(el.x1 - el.x2) <= 0.5;
const isHorizontal = (el: TemplateElement): el is LineElement => isShape(el) && el.shape === "line" && Math.abs(el.y1 - el.y2) <= 0.5;
const isRect = (el: TemplateElement): el is RectElement => isShape(el) && el.shape === "rect";
// Rules are drawn as lines, or as very thin filled rectangles: both count.
const isHRule = (el: TemplateElement): el is LineElement | RectElement => isHorizontal(el) || (isRect(el) && el.height <= EDGE);
const isVRule = (el: TemplateElement): el is LineElement | RectElement => isVertical(el) || (isRect(el) && el.width <= EDGE);

/** A shape that lies within the table's outline (a little slack for line widths). */
function inTable(el: TemplateElement, table: TemplateTable): boolean {
  return el.x >= table.x - EDGE && el.x + el.width <= rightOf(table) + EDGE
    && el.y >= table.y - EDGE && el.y + el.height <= bottomOf(table) + EDGE;
}

/** Which cell a text or picture is in, by the middle of its first line. Null when it is not in the table. */
function cellOf(table: TemplateTable, el: TemplateElement): [number, number] | null {
  if (el.type === "shape" || el.rotation) return null;
  const x = el.x + el.width / 2;
  const y = el.y + (el.type === "text" ? Math.min(el.height, el.lineHeight * el.fontSize) : el.height) / 2;
  const { columns, rows } = table;
  if (x < columns[0] - 0.5 || x > rightOf(table) + 0.5 || y < rows[0] - 0.5 || y > bottomOf(table) + 0.5) return null;
  let column = columns.length - 2;
  while (column > 0 && columns[column] > x) column -= 1;
  let row = rows.length - 2;
  while (row > 0 && rows[row] > y) row -= 1;
  return [row, column];
}

function withTable(page: TemplatePage, table: TemplateTable, next: TemplateTable): TemplatePage {
  return { ...page, tables: (page.tables ?? []).map((t) => (t.id === table.id ? next : t)) };
}

/** Move a line's end point(s) that sit at `at` (horizontally) by dx. */
function moveLineEndsX(el: LineElement, at: number, dx: number): LineElement {
  const next = { ...el };
  if (near(el.x1, at)) next.x1 = r3(el.x1 + dx);
  if (near(el.x2, at)) next.x2 = r3(el.x2 + dx);
  next.x = r3(Math.min(next.x1, next.x2));
  next.width = r3(Math.abs(next.x2 - next.x1));
  return next;
}

function moveLineEndsY(el: LineElement, at: number, dy: number): LineElement {
  const next = { ...el };
  if (near(el.y1, at)) next.y1 = r3(el.y1 + dy);
  if (near(el.y2, at)) next.y2 = r3(el.y2 + dy);
  next.y = r3(Math.min(next.y1, next.y2));
  next.height = r3(Math.abs(next.y2 - next.y1));
  return next;
}

/** Move a rule's end that sits at `at` (vertically) by `dy`: a line's end point, or a box's top or bottom edge. */
function moveEndY(el: LineElement | RectElement, at: number, dy: number): LineElement | RectElement {
  if (el.shape === "line") return moveLineEndsY(el, at, dy);
  if (near(el.y, at)) return { ...el, y: r3(el.y + dy), height: r3(el.height - dy) };
  return { ...el, height: r3(el.height + dy) };
}

function moveEndX(el: LineElement | RectElement, at: number, dx: number): LineElement | RectElement {
  if (el.shape === "line") return moveLineEndsX(el, at, dx);
  if (near(el.x, at)) return { ...el, x: r3(el.x + dx), width: r3(el.width - dx) };
  return { ...el, width: r3(el.width + dx) };
}

/** Make a shape that reaches down to its bottom edge `delta` longer (or shorter). */
const lengthenV = (el: ShapeElement, delta: number): ShapeElement =>
  el.shape === "line" ? moveLineEndsY(el, el.y2 >= el.y1 ? el.y2 : el.y1, delta) : { ...el, height: r3(el.height + delta) };
const lengthenH = (el: ShapeElement, delta: number): ShapeElement =>
  el.shape === "line" ? moveLineEndsX(el, el.x2 >= el.x1 ? el.x2 : el.x1, delta) : { ...el, width: r3(el.width + delta) };

/** Re-wrap the text of the given cells' columns to their (new) width and make their rows tall enough. */
function refit(page: TemplatePage, table: TemplateTable, columns: number[], measure: Measure | undefined): TemplatePage {
  if (!measure) return page;
  const wanted = new Set(columns);
  const ids = page.elements
    .filter((el) => el.type === "text" && el.content.trim() !== "")
    .filter((el) => {
      const cell = cellOf((page.tables ?? []).find((t) => t.id === table.id) ?? table, el);
      return cell !== null && wanted.has(cell[1]);
    })
    .map((el) => el.id);
  for (const id of ids) page = fitEditedCell(page, id, measure);
  return page;
}

// -------------------------------------------------------------------- edges
/**
 * Move column edge `index` to `x`. Lines on the edge move with it, boxes that
 * end or start on it are resized, and the text of the two cells either side
 * keeps its distance from the edge it is aligned to. Text that no longer fits
 * its (narrower) cell is wrapped.
 */
export function moveColumnEdge(page: TemplatePage, table: TemplateTable, index: number, x: number, measure?: Measure): TemplatePage {
  const { columns } = table;
  const lower = index > 0 ? columns[index - 1] + MIN_COLUMN : 0;
  const upper = index < columns.length - 1 ? columns[index + 1] - MIN_COLUMN : page.width;
  x = r3(Math.min(upper, Math.max(lower, x)));
  const old = columns[index];
  const dx = r3(x - old);
  if (Math.abs(dx) < 0.05) return page;

  const elements = page.elements.map((el): TemplateElement => {
    if (isShape(el) && el.y >= table.y - EDGE && el.y + el.height <= bottomOf(table) + EDGE
        && el.x >= table.x - EDGE && el.x + el.width <= rightOf(table) + EDGE) {
      if (isVRule(el) && near(el.x, old)) return moveElement(el, dx, 0);
      if (isHRule(el) && (near(el.x, old) || near(el.x + el.width, old))) return moveEndX(el, old, dx);
      if (isRect(el)) {
        const left = near(el.x, old), right = near(el.x + el.width, old);
        if (left && !right) return { ...el, x: r3(el.x + dx), width: r3(el.width - dx) };
        if (right && !left) return { ...el, width: r3(el.width + dx) };
      }
      return el;
    }
    const cell = cellOf(table, el);
    if (!cell || el.type !== "text") return el;
    const [, column] = cell;
    if (column === index - 1) {         // the cell on the left: text aligned to the moving edge follows it
      if (el.align === "right") return moveElement(el, dx, 0);
      if (el.align === "center") return moveElement(el, dx / 2, 0);
    } else if (column === index) {      // the cell on the right
      if (el.align === "left" || el.align === "justify") return moveElement(el, dx, 0);
      if (el.align === "center") return moveElement(el, dx / 2, 0);
    }
    return el;
  });
  const next: TemplateTable = { ...table, columns: columns.map((edge, i) => (i === index ? x : edge)) };
  next.x = next.columns[0];
  next.width = r3(rightOf(next) - next.x);
  return refit(withTable({ ...page, elements }, table, next), next, [index - 1, index], measure);
}

/**
 * Move row edge `index` to `y`. The row above gets taller or shorter, the row
 * below the opposite; the table's bottom edge pushes or pulls what is under it.
 */
export function moveRowEdge(page: TemplatePage, table: TemplateTable, index: number, y: number): TemplatePage {
  const { rows } = table;
  const last = index === rows.length - 1;
  // a row never gets shorter than the text in it
  const needs = (row: number) => Math.max(MIN_ROW, ...page.elements
    .filter((el) => el.type === "text" && el.content.trim() !== "" && cellOf(table, el)?.[0] === row)
    .map((el) => el.y + el.height + 1 - rows[row]));
  const lower = index > 0 ? rows[index - 1] + needs(index - 1) : 0;
  const upper = !last ? rows[index + 1] - needs(index) : page.height;
  y = r3(Math.min(upper, Math.max(lower, y)));
  const old = rows[index];
  const dy = r3(y - old);
  if (Math.abs(dy) < 0.05) return page;
  const flow = last ? flowBelow(page, table) : null;

  const elements = page.elements.map((el): TemplateElement => {
    if (flow?.below.has(el.id)) return moveElement(el, 0, dy);
    if (flow?.fixed.has(el.id)) return el;
    if (isShape(el) && inTable(el, table)) {
      if (isHRule(el) && near(el.y, old)) return moveElement(el, 0, dy);
      if (isVRule(el) && (near(el.y, old) || near(el.y + el.height, old))) return moveEndY(el, old, dy);
      if (isRect(el)) {
        const top = near(el.y, old), bottom = near(el.y + el.height, old);
        if (top && !bottom) return { ...el, y: r3(el.y + dy), height: r3(el.height - dy) };
        if (bottom && !top) return { ...el, height: r3(el.height + dy) };
      }
      return el;
    }
    const cell = cellOf(table, el);
    // text of the row below the edge keeps its distance from the top of its row
    return cell && cell[0] === index ? moveElement(el, 0, dy) : el;
  });
  const next: TemplateTable = { ...table, rows: rows.map((edge, i) => (i === index ? y : edge)) };
  next.y = next.rows[0];
  next.height = r3(bottomOf(next) - next.y);
  const tables = last ? shiftTablesBelow(page, table, next, old, dy) : (page.tables ?? []).map((t) => (t.id === table.id ? next : t));
  return { ...page, elements, tables };
}

// --------------------------------------------------------------------- rows
/**
 * Add a row after row `index`, with the height and the look (rules, stripe,
 * cell boxes) of that row. Everything under it moves down.
 */
export function insertRow(page: TemplatePage, table: TemplateTable, index: number): TemplatePage {
  const { rows } = table;
  const top = rows[index], edge = rows[index + 1];
  const h = r3(edge - top);
  const flow = flowBelow(page, table);
  const taken = new Set(page.elements.map((el) => el.id));
  const out: TemplateElement[] = [];
  for (const el of page.elements) {
    if (flow.below.has(el.id)) {
      out.push(moveElement(el, 0, h));
      continue;
    }
    if (flow.fixed.has(el.id)) {
      out.push(el);
      continue;
    }
    if (isShape(el) && inTable(el, table)) {
      const inRow = el.y >= top - EDGE && el.y + el.height <= edge + EDGE && !(isHRule(el) && near(el.y, top));
      if (isHRule(el) && near(el.y, edge)) {
        // the rule under the row: it stays, and the new row gets one too
        out.push(el, { ...moveElement(el, 0, h), id: newElementId(page.index, taken) });
      } else if (inRow) {
        // a stripe, a cell box, a rule inside the row: the new row gets a copy
        out.push(el, { ...moveElement(el, 0, h), id: newElementId(page.index, taken) });
      } else if (el.y >= edge - EDGE) {
        out.push(moveElement(el, 0, h));
      } else if (el.y + el.height > edge - EDGE) {
        // the frame, a column rule, a background: it crosses the edge and gets longer
        out.push(lengthenV(el, h));
      } else {
        out.push(el);
      }
      continue;
    }
    const cell = cellOf(table, el);
    out.push(cell && cell[0] > index ? moveElement(el, 0, h) : el);
  }
  const next: TemplateTable = {
    ...table,
    height: r3(table.height + h),
    rows: [...rows.slice(0, index + 2), ...rows.slice(index + 1).map((y) => r3(y + h))],
  };
  return { ...page, elements: withZ(out), tables: shiftTablesBelow(page, table, next, edge, h) };
}

/** Remove row `index` with everything in it; what is under it moves up. */
export function deleteRow(page: TemplatePage, table: TemplateTable, index: number): TemplatePage {
  if (rowCount(table) <= 1) return page;
  const { rows } = table;
  const top = rows[index], bottom = rows[index + 1];
  const h = r3(bottom - top);
  const flow = flowBelow(page, table);
  const ruleAt = (y: number) => page.elements.some((el) => isHRule(el) && inTable(el, table) && near(el.y, y));
  const out: TemplateElement[] = [];
  for (const el of page.elements) {
    if (flow.below.has(el.id)) {
      out.push(moveElement(el, 0, -h));
      continue;
    }
    if (flow.fixed.has(el.id)) {
      out.push(el);
      continue;
    }
    if (isShape(el) && inTable(el, table)) {
      if (isHRule(el) && near(el.y, top)) {
        out.push(el);
      } else if (isHRule(el) && near(el.y, bottom)) {
        // the rule under the row is only needed when the row above has none
        if (!ruleAt(top)) out.push(moveElement(el, 0, -h));
      } else if (el.y >= bottom - EDGE) {
        out.push(moveElement(el, 0, -h));
      } else if (el.y >= top - EDGE && el.y + el.height <= bottom + EDGE) {
        // inside the row: gone with it
      } else if (el.y + el.height > top + EDGE) {
        // crosses the row: shorter
        out.push(lengthenV(el, -h));
      } else {
        out.push(el);
      }
      continue;
    }
    const cell = cellOf(table, el);
    if (cell && cell[0] === index) continue;
    out.push(cell && cell[0] > index ? moveElement(el, 0, -h) : el);
  }
  const next: TemplateTable = {
    ...table,
    height: r3(table.height - h),
    headerRows: index < table.headerRows ? table.headerRows - 1 : table.headerRows,
    rows: [...rows.slice(0, index + 1), ...rows.slice(index + 2).map((y) => r3(y - h))],
  };
  return { ...page, elements: withZ(out), tables: shiftTablesBelow(page, table, next, bottom, -h) };
}

// ------------------------------------------------------------------ columns
/** The style for a new rule: like the table's own rules, else a thin black line. */
function ruleStyle(page: TemplatePage, table: TemplateTable, vertical: boolean) {
  const shapes = page.elements.filter(isShape).filter((el) => inTable(el, table));
  const like = shapes.find((el) => (vertical ? isVRule(el) : isHRule(el)))
    ?? shapes.find((el) => (vertical ? isHRule(el) : isVRule(el)))
    ?? shapes.find((el) => isRect(el) && el.stroke);
  // a rule drawn as a thin filled box has its colour in the fill
  const thin = like && like.shape === "rect" && (like.width <= EDGE || like.height <= EDGE) && like.fill;
  const stroke = (thin ? like.fill : like?.stroke) ?? "#000000";
  const strokeWidth = thin ? Math.max(0.3, Math.min(like.width, like.height)) : like?.strokeWidth || 0.5;
  return {
    stroke, strokeWidth, strokeOpacity: (thin ? like.fillOpacity : like?.strokeOpacity) ?? 1,
    fill: null, fillOpacity: 1, ...(!thin && like?.dash ? { dash: like.dash } : {}),
  };
}

/**
 * Split column `index` in two at its middle. A rule is drawn between the
 * halves, cell boxes of the column are split, and the text stays where it is
 * (in whichever half it falls).
 */
export function insertColumn(page: TemplatePage, table: TemplateTable, index: number): TemplatePage {
  const { columns } = table;
  const left = columns[index], right = columns[index + 1];
  if (right - left < 2 * MIN_COLUMN) return page;
  const x = r3((left + right) / 2);
  const taken = new Set(page.elements.map((el) => el.id));
  const out: TemplateElement[] = [];
  for (const el of page.elements) {
    if (isRect(el) && inTable(el, table) && near(el.x, left) && near(el.x + el.width, right)) {
      // a box of this column: one for each half
      out.push({ ...el, width: r3(x - el.x) }, { ...el, id: newElementId(page.index, taken), x, width: r3(el.x + el.width - x) });
    } else {
      out.push(el);
    }
  }
  const top = table.y, bottom = bottomOf(table);
  const rule: LineElement = {
    id: newElementId(page.index, taken), type: "shape", shape: "line", rotation: 0, z: out.length,
    x, y: top, width: 0, height: r3(bottom - top), x1: x, y1: top, x2: x, y2: bottom,
    ...ruleStyle(page, table, true),
  };
  out.push(rule);
  const next: TemplateTable = { ...table, columns: [...columns.slice(0, index + 1), x, ...columns.slice(index + 1)] };
  return { ...page, elements: withZ(out), tables: (page.tables ?? []).map((t) => (t.id === table.id ? next : t)) };
}

/** Remove column `index` with everything in it; the columns to its right move left. */
export function deleteColumn(page: TemplatePage, table: TemplateTable, index: number): TemplatePage {
  if (columnCount(table) <= 1) return page;
  const { columns } = table;
  const left = columns[index], right = columns[index + 1];
  const w = r3(right - left);
  const ruleAt = (x: number) => page.elements.some((el) => isVRule(el) && inTable(el, table) && near(el.x, x));
  const out: TemplateElement[] = [];
  for (const el of page.elements) {
    if (isShape(el) && inTable(el, table)) {
      if (isVRule(el) && near(el.x, left)) {
        out.push(el);
      } else if (isVRule(el) && near(el.x, right)) {
        if (!ruleAt(left)) out.push(moveElement(el, -w, 0));
      } else if (el.x >= right - EDGE) {
        out.push(moveElement(el, -w, 0));
      } else if (el.x >= left - EDGE && el.x + el.width <= right + EDGE) {
        // inside the column: gone with it
      } else if (el.x + el.width > left + EDGE) {
        // crosses the column (the frame, a stripe, a rule along a row): narrower
        out.push(lengthenH(el, -w));
      } else {
        out.push(el);
      }
      continue;
    }
    const cell = cellOf(table, el);
    if (cell && cell[1] === index) continue;
    out.push(cell && cell[1] > index ? moveElement(el, -w, 0) : el);
  }
  const next: TemplateTable = {
    ...table,
    width: r3(table.width - w),
    columns: [...columns.slice(0, index + 1), ...columns.slice(index + 2).map((x) => r3(x - w))],
  };
  return { ...page, elements: withZ(out), tables: (page.tables ?? []).map((t) => (t.id === table.id ? next : t)) };
}

// ------------------------------------------------------------ whole tables
export function setHeaderRows(page: TemplatePage, table: TemplateTable, headerRows: number): TemplatePage {
  const next = Math.max(0, Math.min(rowCount(table) - 1, Math.round(headerRows)));
  return next === table.headerRows ? page : withTable(page, table, { ...table, headerRows: next });
}

export function removeTable(page: TemplatePage, tableId: string): TemplatePage {
  return { ...page, tables: (page.tables ?? []).filter((t) => t.id !== tableId) };
}

/** Group values that are close together; returns the middle of each group's gap to the next. */
function gaps(intervals: [number, number][], minGap: number): number[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + minGap) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged.slice(1).map((span, i) => r3((merged[i][1] + span[0]) / 2));
}

/**
 * Make a table of the area `rect` (page points) from the text inside it: a row
 * per line of text, a column wherever there is a clear gap between the words
 * of every row. With no text inside, a 2 x 2 grid to shape by hand.
 */
export function markTable(page: TemplatePage, rect: { x: number; y: number; width: number; height: number }): TemplatePage {
  const inside = page.elements.filter((el): el is TextElement =>
    el.type === "text" && !el.rotation && el.visible !== false && el.content.trim() !== ""
    && el.x + el.width / 2 >= rect.x && el.x + el.width / 2 <= rect.x + rect.width
    && el.y + el.height / 2 >= rect.y && el.y + el.height / 2 <= rect.y + rect.height);
  const lines: [number, number][] = inside.map((el) => [el.y, el.y + Math.min(el.height, el.lineHeight * el.fontSize)]);
  const rowEdges = gaps(lines, 1);
  const columnEdges = gaps(inside.map((el) => [el.x, el.x + el.width]), 4);
  const rows = [r3(rect.y), ...rowEdges, r3(rect.y + rect.height)];
  const columns = [r3(rect.x), ...columnEdges, r3(rect.x + rect.width)];
  if (rows.length < 3) rows.splice(1, 0, r3(rect.y + rect.height / 2));
  if (columns.length < 3) columns.splice(1, 0, r3(rect.x + rect.width / 2));
  const taken = new Set((page.tables ?? []).map((t) => t.id));
  let n = (page.tables ?? []).length + 1;
  while (taken.has(`p${page.index + 1}-t${n}`)) n += 1;
  const table: TemplateTable = {
    id: `p${page.index + 1}-t${n}`,
    x: columns[0], y: rows[0], width: r3(columns[columns.length - 1] - columns[0]), height: r3(rows[rows.length - 1] - rows[0]),
    columns, rows, headerRows: rows.length > 2 ? 1 : 0, source: "manual",
  };
  return { ...page, tables: [...(page.tables ?? []), table] };
}
