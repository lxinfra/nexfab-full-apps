// Detected tables: finding the text in each cell, and filling a table from a spreadsheet.
//
// A table is only a grid (column and row edges). Which text element belongs to
// which cell is worked out from positions each time, so it stays right after
// the user moves, deletes or adds text.

import type { SheetSpan } from "../api";
import type { TemplateElement, TemplatePage, TemplateTable, TextElement, TextSpan } from "../types";
import { moveElement, newElementId, uniqueFieldName, withZ } from "./elements";
import { r3 } from "./geometry";

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const columnCount = (table: TemplateTable) => table.columns.length - 1;
export const rowCount = (table: TemplateTable) => table.rows.length - 1;

export function cellRect(table: TemplateTable, row: number, column: number): CellRect {
  return {
    x: table.columns[column],
    y: table.rows[row],
    width: table.columns[column + 1] - table.columns[column],
    height: table.rows[row + 1] - table.rows[row],
  };
}

function cellAt(table: TemplateTable, x: number, y: number): [number, number] | null {
  const { columns, rows } = table;
  if (x < columns[0] || x > columns[columns.length - 1] || y < rows[0] || y > rows[rows.length - 1]) return null;
  let column = columns.length - 2;
  while (column > 0 && columns[column] > x) column -= 1;
  let row = rows.length - 2;
  while (row > 0 && rows[row] > y) row -= 1;
  return [row, column];
}

const centre = (el: TemplateElement) => [el.x + el.width / 2, el.y + el.height / 2] as const;

/** The table an element sits in, if any. */
export function tableOf(tables: TemplateTable[], el: TemplateElement): TemplateTable | undefined {
  const [x, y] = centre(el);
  return tables.find((table) => cellAt(table, x, y) !== null);
}

/** Text elements of every cell: grid[row][column], each list in reading order. */
export function tableGrid(table: TemplateTable, elements: TemplateElement[]): TextElement[][][] {
  const grid: TextElement[][][] = Array.from({ length: rowCount(table) }, () =>
    Array.from({ length: columnCount(table) }, () => []),
  );
  for (const el of elements) {
    if (el.type !== "text" || el.visible === false || el.rotation) continue;
    const cell = cellAt(table, ...centre(el));
    if (cell) grid[cell[0]][cell[1]].push(el);
  }
  for (const row of grid) for (const cell of row) cell.sort((a, b) => a.y - b.y || a.x - b.x);
  return grid;
}

export function tableText(table: TemplateTable, elements: TemplateElement[]): string[][] {
  return tableGrid(table, elements).map((row) => row.map((cell) => cell.map((el) => el.content).join(" ").trim()));
}

export interface TableRef {
  pageIndex: number;
  table: TemplateTable;
}

const normalise = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Every table with the same number of columns as `table`, in reading order,
 * itself included. A long table that runs over several pages is detected as
 * one table per page, often with different widths and row counts; this is how
 * the pieces are joined up again. The import dialog lets the user leave out a
 * table that merely happens to have as many columns.
 */
export function tableChain(pages: TemplatePage[], pageIndex: number, table: TemplateTable): TableRef[] {
  const out: TableRef[] = [];
  pages.forEach((page, index) => {
    for (const other of page.tables ?? []) {
      const itself = index === pageIndex && other.id === table.id;
      if (itself || columnCount(other) === columnCount(table)) out.push({ pageIndex: index, table: other });
    }
  });
  return out;
}

/** "page 2" / "pages 2–5" / "pages 1, 3" for the pages a chain of tables sits on. */
export function chainPages(chain: TableRef[]): string {
  const numbers = [...new Set(chain.map((ref) => ref.pageIndex + 1))];
  if (numbers.length === 1) return `page ${numbers[0]}`;
  const consecutive = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
  return `pages ${consecutive ? `${numbers[0]}–${numbers[numbers.length - 1]}` : numbers.join(", ")}`;
}

// ------------------------------------------------------------------ import
export interface ImportOptions {
  /** The sheet's first row holds column headings, not data. */
  hasHeader: boolean;
  /** Also write those headings into the table's own header row. */
  replaceHeader: boolean;
}

export interface ImportPlan {
  /** Sheet column feeding each table column (null = nothing to put there). */
  columnMap: (number | null)[];
  matchedByName: boolean;
  /** New text for the header row, when it is being replaced. */
  header: string[] | null;
  /** New text for every body row of the table (rows the sheet does not cover are empty). */
  body: string[][];
  /** Bold / italic in the sheet's cells, laid out like `header` and `body`. */
  headerStyles: (SheetSpan[] | undefined)[] | null;
  bodyStyles: (SheetSpan[] | undefined)[][];
  /** Data rows in the sheet. */
  sheetRows: number;
  /** Sheet rows / columns that do not fit in the table. */
  skippedRows: number;
  skippedColumns: number;
}

const looksNumeric = (text: string) => /\d/.test(text) && /^[\s$£€¥₹+\-−(]*\d[\d\s.,:/\-]*\)?\s*(%|[A-Za-z]{1,3})?$/.test(text);

/** A sheet's first row is probably a header if it has no numbers and the rows below do. */
export function guessHasHeader(table: TemplateTable, sheet: string[][]): boolean {
  if (sheet.length < 2) return false;
  if (table.headerRows > 0) return !sheet[0].some(looksNumeric) || !sheet.slice(1).some((row) => row.some(looksNumeric));
  return !sheet[0].some(looksNumeric) && sheet.slice(1).some((row) => row.some(looksNumeric));
}

/**
 * Decide what goes where. `offset` is the number of data rows already used
 * by earlier tables when one sheet fills a chain of tables.
 */
export function planImport(
  table: TemplateTable,
  elements: TemplateElement[],
  sheet: string[][],
  options: ImportOptions,
  offset = 0,
  styles?: Record<string, SheetSpan[]>,
): ImportPlan {
  const columns = columnCount(table);
  const bodyRows = rowCount(table) - table.headerRows;
  const sheetHeader = options.hasHeader ? (sheet[0] ?? []) : null;
  const data = options.hasHeader ? sheet.slice(1) : sheet;
  const sheetColumns = Math.max(0, ...sheet.map((row) => row.length));

  // Match columns by heading when every table heading appears in the sheet, else by position.
  let columnMap: (number | null)[] = Array.from({ length: columns }, (_, c) => (c < sheetColumns ? c : null));
  let matchedByName = false;
  if (sheetHeader && table.headerRows > 0) {
    const tableHeader = tableText(table, elements)[0].map(normalise);
    const sheetNames = sheetHeader.map(normalise);
    const byName = tableHeader.map((name) => (name ? sheetNames.indexOf(name) : -1));
    if (byName.every((index) => index >= 0) && new Set(byName).size === byName.length) {
      columnMap = byName;
      matchedByName = true;
    }
  }

  const pick = (row: string[] | undefined) => columnMap.map((index) => (index === null ? "" : (row?.[index] ?? "")));
  const pickStyles = (row: number) => columnMap.map((index) => (index === null ? undefined : styles?.[`${row}:${index}`]));
  const first = options.hasHeader ? 1 : 0;
  const used = new Set(columnMap.filter((index): index is number => index !== null));
  return {
    columnMap,
    matchedByName,
    header: options.replaceHeader && sheetHeader && table.headerRows > 0 ? pick(sheetHeader) : null,
    body: Array.from({ length: bodyRows }, (_, r) => pick(data[offset + r])),
    headerStyles: options.replaceHeader && sheetHeader && table.headerRows > 0 ? pickStyles(0) : null,
    bodyStyles: Array.from({ length: bodyRows }, (_, r) => pickStyles(first + offset + r)),
    sheetRows: data.length,
    skippedRows: Math.max(0, data.length - offset - bodyRows),
    skippedColumns: Array.from({ length: sheetColumns }, (_, c) => c).filter((c) => !used.has(c)).length,
  };
}

export interface ImportResult {
  elements: TemplateElement[];
  /** Cells whose text changed. */
  changed: number;
  /** Values too wide for their cell even after wrapping (they will overlap the next cell). */
  overflowing: number;
  /** Values that could not be placed because nothing in the table shows how to style them. */
  unplaced: number;
  /** The height every row of the table needs for its text now (never less than it has). */
  rowHeights: number[];
}

/** Width of `text` set in the style of `el`, in points. */
export type Measure = (el: TextElement, text: string) => number;

const isBold = (weight: TextElement["fontWeight"] | undefined) =>
  weight === "bold" || (typeof weight === "number" ? weight >= 600 : Number(weight) >= 600);

/** Measure in the boldest / slanted style the text uses anywhere, so a line with bold words still fits. */
function widest(el: TextElement): TextElement {
  if (!el.spans?.length) return el;
  const bold = el.spans.some((span) => isBold(span.fontWeight));
  const italic = el.spans.some((span) => span.fontStyle === "italic");
  if ((!bold || isBold(el.fontWeight)) && (!italic || el.fontStyle === "italic")) return el;
  return { ...el, fontWeight: bold ? "bold" : el.fontWeight, fontStyle: italic ? "italic" : el.fontStyle };
}

const solidCount = (text: string) => [...text].filter((ch) => !/\s/.test(ch)).length;

/**
 * Give a cell the bold / italic its spreadsheet cell has. A cell that is all
 * one style takes it as its own; a mixed one is plain with bold / italic
 * stretches. A plain spreadsheet cell keeps the look the template gives it.
 */
function styleCell(el: TextElement, value: string, styles: SheetSpan[] | undefined): TextElement {
  const spans = (styles ?? []).filter((span) => span.end > span.start && (span.bold || span.italic));
  if (!spans.length) {
    if (!el.spans || value === el.content) return el;
    const next = { ...el };
    delete next.spans; // they belonged to the old text
    return next;
  }
  const whole = spans.length === 1 && spans[0].start <= 0 && spans[0].end >= solidCount(value);
  const next: TextElement = { ...el, fontWeight: "normal", fontStyle: "normal" };
  delete next.spans;
  if (whole) {
    next.fontWeight = spans[0].bold ? "bold" : "normal";
    next.fontStyle = spans[0].italic ? "italic" : "normal";
  } else {
    next.spans = spans.map((span): TextSpan => ({
      start: span.start,
      end: span.end,
      ...(span.bold ? { fontWeight: "bold" as const } : {}),
      ...(span.italic ? { fontStyle: "italic" as const } : {}),
    }));
  }
  const same =
    next.fontWeight === el.fontWeight && next.fontStyle === el.fontStyle &&
    JSON.stringify(next.spans ?? null) === JSON.stringify(el.spans ?? null);
  if (same) return el;
  delete next.layout; // recorded word positions are for the old face
  return next;
}

/** Break a line into lines no wider than `maxWidth`: between words, and inside a word too long for a line. */
function wrap(el: TextElement, line: string, maxWidth: number, measure: Measure): string[] {
  if (measure(el, line) <= maxWidth) return [line];
  const out: string[] = [];
  let current = "";
  for (const word of line.split(" ")) {
    const longer = current ? `${current} ${word}` : word;
    if (measure(el, longer) <= maxWidth) {
      current = longer;
      continue;
    }
    if (current) out.push(current);
    current = word;
    if (measure(el, word) <= maxWidth) continue;
    // a word (an account number, a reference) wider than the cell: break it where the line is full
    let piece = "";
    for (const character of word) {
      if (piece && measure(el, piece + character) > maxWidth) {
        out.push(piece);
        piece = character;
      } else {
        piece += character;
      }
    }
    current = piece;
  }
  if (current) out.push(current);
  return out;
}

/**
 * Replace a cell's text. The box is re-measured and grows from the edge the
 * text is aligned to, so right-aligned numbers stay in their column. Text too
 * wide for the cell is wrapped onto more lines; the row is made taller for
 * them afterwards (see `fitRows`).
 */
function setCellText(el: TextElement, value: string, measure: Measure, cell?: CellRect, rewrap = false): TextElement {
  if (value === el.content && !rewrap) return el;
  const wide = widest(el);
  const next: TextElement = { ...el, content: value };
  delete next.layout; // recorded word positions belong to the old text
  if (value === "") return next; // nothing to draw; the box is kept so the cell can be filled again
  const oldLines = el.content.split("\n").length;
  const firstLine = el.height - (oldLines - 1) * el.lineHeight * el.fontSize;
  const heightOf = (count: number) => firstLine + (count - 1) * el.lineHeight * el.fontSize;
  let lines = value.split("\n");
  if (cell) {
    // keep the same gap to the cell's edge that the text has now
    const gap =
      el.align === "right" ? cell.x + cell.width - (el.x + el.width)
      : el.align === "center" ? 0
      : el.x - cell.x;
    // ... and may run up close to the other edge before it is wrapped
    const room = Math.max(10, cell.width - Math.max(1, gap) - Math.max(1, Math.min(gap, 2)));
    lines = lines.flatMap((line) => wrap(wide, line, room, measure));
    next.content = lines.join("\n");
    if (next.content === el.content) return el;
  }
  const width = Math.max(...lines.map((line) => measure(wide, line)));
  if (el.align === "right") next.x = r3(el.x + el.width - width);
  else if (el.align === "center") next.x = r3(el.x + (el.width - width) / 2);
  next.width = r3(width);
  next.height = r3(heightOf(lines.length));
  return next;
}

/** An existing cell to copy the look of, for a cell that has no text yet. */
function styleSource(
  grid: TextElement[][][],
  table: TemplateTable,
  row: number,
  column: number,
): { el: TextElement; row: number; column: number } | null {
  const isHeader = row < table.headerRows;
  const candidates: { el: TextElement; row: number; column: number; score: number }[] = [];
  grid.forEach((cells, r) =>
    cells.forEach((cell, c) => {
      if (!cell.length) return;
      // same column first, then same kind of row (header / body), then nearest
      const score = (c === column ? 0 : 1000) + (r < table.headerRows === isHeader ? 0 : 100) + Math.abs(r - row) + Math.abs(c - column);
      candidates.push({ el: cell[0], row: r, column: c, score });
    }),
  );
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0] ?? null;
}

export function applyImport(
  table: TemplateTable,
  elements: TemplateElement[],
  plan: ImportPlan,
  pageIndex: number,
  measure: Measure,
): ImportResult {
  const grid = tableGrid(table, elements);
  const replaced = new Map<string, TextElement>();
  const inserted = new Map<string, TextElement[]>(); // new elements, keyed by the element they follow
  const takenIds = new Set(elements.map((el) => el.id));
  const takenNames = new Set(elements.flatMap((el) => (el.type === "text" ? [el.fieldName] : [])));
  let changed = 0;
  let overflowing = 0;
  let unplaced = 0;
  const rowHeights = table.rows.slice(1).map((edge, row) => edge - table.rows[row]);

  // Text keeps its distance from the top of the row; the row must reach below it with a little air.
  const needs = (row: number, rect: CellRect, before: TextElement, after: TextElement) => {
    const inset = before.y - rect.y;
    const gap = rect.y + rect.height - (before.y + before.height);
    const air = Math.max(1, Math.min(inset, gap, 0.4 * after.fontSize));
    rowHeights[row] = Math.max(rowHeights[row], after.y - rect.y + after.height + air);
  };

  const write = (row: number, column: number, value: string, styles?: SheetSpan[]) => {
    const cell = grid[row][column];
    const rect = cellRect(table, row, column);
    let written: TextElement | null = null;
    if (cell.length) {
      const styled = styleCell(cell[0], value, value === "" ? undefined : styles);
      // a new face measures differently: lay the text out again
      written = setCellText(styled, value, measure, rect, styled !== cell[0]);
      if (written !== cell[0]) {
        replaced.set(cell[0].id, written);
        changed += 1;
        if (value !== "") needs(row, rect, cell[0], written);
      }
      // a cell made of several pieces of text becomes one value
      for (const extra of cell.slice(1)) {
        if (extra.content !== "") replaced.set(extra.id, setCellText(extra, "", measure));
      }
    } else if (value !== "") {
      const source = styleSource(grid, table, row, column);
      if (!source) {
        unplaced += 1;
        return;
      }
      // Put a copy of a neighbouring cell's text in the same place within this cell.
      const from = cellRect(table, source.row, source.column);
      const align = source.el.align;
      const dx =
        align === "right" ? rect.x + rect.width - (from.x + from.width)
        : align === "center" ? rect.x + rect.width / 2 - (from.x + from.width / 2)
        : rect.x - from.x;
      // measured from the top of the row: rows can differ in height, text starts at the same inset
      const dy = rect.y - from.y;
      const copy: TextElement = {
        ...moveElement(source.el, dx, dy),
        id: newElementId(pageIndex, takenIds),
        fieldName: uniqueFieldName(source.el.fieldName, takenNames),
        isVariable: false,
      };
      // the copy starts as one line, whatever the cell it was copied from held
      const single = { ...copy, content: "", height: r3(copy.height - (copy.content.split("\n").length - 1) * copy.lineHeight * copy.fontSize) };
      written = setCellText(styleCell(single, value, styles), value, measure, rect);
      inserted.set(source.el.id, [...(inserted.get(source.el.id) ?? []), written]);
      changed += 1;
      // the copy sits in its row as its source sits in the source's row
      const sourceGap = from.y + from.height - (source.el.y + source.el.height);
      const inset = single.y - rect.y;
      const air = Math.max(1, Math.min(inset, sourceGap, 0.4 * written.fontSize));
      rowHeights[row] = Math.max(rowHeights[row], inset + written.height + air);
    }
    if (written && value !== "" && written.x + written.width > rect.x + rect.width + 0.5) overflowing += 1;
    else if (written && value !== "" && written.x < rect.x - 0.5) overflowing += 1;
  };

  if (plan.header) plan.header.forEach((value, column) => write(0, column, value, plan.headerStyles?.[column]));
  plan.body.forEach((values, r) =>
    values.forEach((value, column) => write(table.headerRows + r, column, value, plan.bodyStyles[r]?.[column])),
  );

  const out: TemplateElement[] = [];
  for (const el of elements) {
    out.push(replaced.get(el.id) ?? el);
    const extra = inserted.get(el.id);
    if (extra) out.push(...extra);
  }
  return { elements: changed || replaced.size ? withZ(out) : elements, changed, overflowing, unplaced, rowHeights };
}

// ------------------------------------------------------------ adding rows
const EDGE = 1.5; // pt: how close a shape must come to an edge of the table to count as touching it
const FOOTER_ZONE = 0.9; // what sits in the bottom tenth of a page stays there (page numbers, footers)

const bodyRowHeights = (table: TemplateTable) =>
  table.rows.slice(table.headerRows + 1).map((edge, i) => edge - table.rows[table.headerRows + i]);

/** Height given to rows that are added: the last row's, which is where they follow on. */
export function newRowHeight(table: TemplateTable): number {
  const heights = bodyRowHeights(table);
  return heights[heights.length - 1] ?? table.height;
}

const withinColumns = (el: TemplateElement, table: TemplateTable) =>
  el.x >= table.x - 3 && el.x + el.width <= table.x + table.width + 3;

const centreY = (el: TemplateElement) => el.y + el.height / 2;

/** Page content under the table that moves down with it (not the page footer). */
function isBelow(el: TemplateElement, table: TemplateTable, page: TemplatePage): boolean {
  const bottom = table.rows[table.rows.length - 1];
  return centreY(el) > bottom + 0.75 && centreY(el) <= FOOTER_ZONE * page.height;
}

/**
 * How far (in points) `table` can get longer before it, or what is under it,
 * reaches the footer. `tableLimit`, if given, is a y the table itself must not
 * pass: where the same table ends on a page it fills.
 */
export function roomBelow(page: TemplatePage, table: TemplateTable, tableLimit?: number): number {
  const bottom = table.rows[table.rows.length - 1];
  const visible = page.elements.filter((el) => el.visible !== false);
  const flowBottom = Math.max(bottom, ...visible.filter((el) => isBelow(el, table, page)).map((el) => el.y + el.height));
  const footer = visible.filter((el) => centreY(el) > FOOTER_ZONE * page.height && el.height < 0.5 * page.height);
  const limit = (footer.length ? Math.min(...footer.map((el) => el.y)) : page.height - 36) - 6;
  return Math.min(limit - flowBottom, (tableLimit ?? Infinity) + 0.5 - bottom);
}

/** How many rows (of the height new rows get) fit in that room. */
export function roomToGrow(page: TemplatePage, table: TemplateTable, tableLimit?: number): number {
  return Math.max(0, Math.floor(roomBelow(page, table, tableLimit) / newRowHeight(table)));
}

/** What a table's surroundings do when its bottom edge moves. */
export interface TableFlow {
  /** Elements under the table that move with its bottom edge. */
  below: Set<string>;
  /** Elements under the table that stay where they are: the page footer. */
  fixed: Set<string>;
}

/**
 * Worked out once, before a table is changed in several steps. Afterwards
 * positions no longer tell: something pushed down into the footer's part of the
 * page still belongs to the flow, and a footer the table has grown past (before
 * rows are taken off again) is still not part of the table.
 */
export function flowBelow(page: TemplatePage, table: TemplateTable): TableFlow {
  const bottom = table.rows[table.rows.length - 1];
  const below = new Set(page.elements.filter((el) => isBelow(el, table, page)).map((el) => el.id));
  const fixed = new Set(page.elements.filter((el) => centreY(el) > bottom + 0.75 && !below.has(el.id)).map((el) => el.id));
  return { below, fixed };
}

/** Shift the grids of the tables under `table` when its bottom edge moves by `delta`. */
export function shiftTablesBelow(page: TemplatePage, table: TemplateTable, changed: TemplateTable, bottom: number, delta: number) {
  return (page.tables ?? []).map((other) => {
    if (other.id === table.id) return changed;
    if (other.y < bottom - EDGE) return other;
    return { ...other, y: r3(other.y + delta), rows: other.rows.map((edge) => r3(edge + delta)) };
  });
}

const insideColumns = (el: TemplateElement, table: TemplateTable) => {
  const x = el.x + el.width / 2;
  return x >= table.columns[0] - 3 && x <= table.columns[table.columns.length - 1] + 3;
};

/**
 * Make one row taller by `delta`. What lies at or under the row's bottom edge
 * moves down; lines and boxes that cross that edge (column rules, the frame,
 * the row's own stripe or cell boxes) are stretched.
 */
export function resizeRow(
  page: TemplatePage, table: TemplateTable, row: number, delta: number, flow = flowBelow(page, table),
): TemplatePage {
  if (delta <= 0) return page;
  const edge = table.rows[row + 1];
  const bottom = table.rows[table.rows.length - 1];
  const shifts = (y: number) => y >= edge - EDGE;
  const elements = page.elements.map((el) => {
    if (flow.below.has(el.id)) return moveElement(el, 0, delta);
    if (flow.fixed.has(el.id)) return el;
    if (el.type === "shape" && !el.rotation && withinColumns(el, table) && el.y >= table.y - EDGE && el.y <= bottom + EDGE) {
      if (shifts(el.y)) return moveElement(el, 0, delta);
      if (!shifts(el.y + el.height)) return el;
      if (el.shape === "rect") return { ...el, height: r3(el.height + delta) };
      if (el.shape === "line" && Math.abs(el.x1 - el.x2) <= 0.5) {
        const lowerIsEnd = el.y2 >= el.y1;
        return {
          ...el, height: r3(el.height + delta),
          y1: lowerIsEnd ? el.y1 : r3(el.y1 + delta), y2: lowerIsEnd ? r3(el.y2 + delta) : el.y2,
        };
      }
      return el; // a curve or a slanted line cannot be stretched
    }
    // text and pictures of the rows underneath (by where they start: text wrapped over
    // several lines can reach past the middle of the next row)
    const underneath = insideColumns(el, table) && el.y >= edge - 0.75 && el.y <= bottom + 0.75;
    return underneath ? moveElement(el, 0, delta) : el;
  });
  const resized: TemplateTable = {
    ...table,
    height: r3(table.height + delta),
    rows: table.rows.map((y, i) => (i > row ? r3(y + delta) : y)),
  };
  return { ...page, elements, tables: shiftTablesBelow(page, table, resized, bottom, delta) };
}

/**
 * Give every row at least the height in `heights` (as `applyImport` reports
 * them). Returns the page and how many rows were made taller.
 */
export function fitRows(
  page: TemplatePage, tableId: string, heights: number[], flow?: TableFlow,
): { page: TemplatePage; taller: number } {
  let taller = 0;
  for (let row = 0; row < heights.length; row += 1) {
    const table = (page.tables ?? []).find((t) => t.id === tableId);
    if (!table || row >= rowCount(table)) break;
    const missing = heights[row] - (table.rows[row + 1] - table.rows[row]);
    if (missing > 0.25) {
      page = resizeRow(page, table, row, r3(missing), flow ?? flowBelow(page, table));
      taller += 1;
    }
  }
  return { page, taller };
}

/**
 * Remove the last `count` rows of a table with what is in them. Lines and boxes
 * that ran down to the table's bottom edge are shortened; what is under the
 * table moves up.
 */
export function removeRows(
  page: TemplatePage, table: TemplateTable, count: number, flow = flowBelow(page, table),
): TemplatePage {
  count = Math.min(count, rowCount(table) - table.headerRows - 1); // a table keeps at least one body row
  if (count <= 0) return page;
  const rows = rowCount(table);
  const cut = table.rows[rows - count];
  const bottom = table.rows[rows];
  const delta = bottom - cut;
  const elements: TemplateElement[] = [];
  for (const el of page.elements) {
    if (flow.below.has(el.id)) {
      elements.push(moveElement(el, 0, -delta));
      continue;
    }
    if (flow.fixed.has(el.id)) {
      elements.push(el);
      continue;
    }
    if (el.type === "shape" && !el.rotation && withinColumns(el, table) && el.y >= table.y - EDGE && el.y <= bottom + EDGE) {
      const end = el.y + el.height;
      if (el.y < cut - EDGE) {
        if (end <= cut + EDGE) {
          elements.push(el);
          continue;
        }
        // it reaches into the removed rows: it ends with the table now
        const shorter = Math.abs(end - bottom) <= EDGE ? delta : end - cut;
        if (el.shape === "rect") {
          elements.push({ ...el, height: r3(el.height - shorter) });
        } else if (el.shape === "line" && Math.abs(el.x1 - el.x2) <= 0.5) {
          const lowerIsEnd = el.y2 >= el.y1;
          elements.push({
            ...el, height: r3(el.height - shorter),
            y1: lowerIsEnd ? el.y1 : r3(el.y1 - shorter), y2: lowerIsEnd ? r3(el.y2 - shorter) : el.y2,
          });
        } else {
          elements.push(el);
        }
        continue;
      }
      // the rule on the new bottom edge stays; what belongs to the removed rows goes
      if (centreY(el) <= cut + 0.75) elements.push(el);
      continue;
    }
    const removed = insideColumns(el, table) && el.y >= cut - 0.75 && el.y <= bottom + 0.75;
    if (!removed) elements.push(el);
  }
  const shorter: TemplateTable = { ...table, height: r3(table.height - delta), rows: table.rows.slice(0, rows - count + 1) };
  return { ...page, elements: withZ(elements), tables: shiftTablesBelow(page, table, shorter, bottom, -delta) };
}

/**
 * After the text of a cell was edited by hand: wrap it to the cell's width and
 * make its row tall enough. Returns the same page when nothing has to change.
 */
export function fitEditedCell(page: TemplatePage, elementId: string, measure: Measure): TemplatePage {
  const el = page.elements.find((candidate) => candidate.id === elementId);
  if (!el || el.type !== "text" || el.rotation || el.content.trim() === "") return page;
  // typing makes the box wider from the edge it is aligned to: look up the cell from that edge
  const anchorX = el.align === "right" ? el.x + el.width - 1 : el.align === "center" ? el.x + el.width / 2 : el.x + 1;
  const anchorY = el.y + Math.min(el.height, el.lineHeight * el.fontSize) / 2;
  for (const table of page.tables ?? []) {
    const cell = cellAt(table, anchorX, anchorY);
    if (!cell) continue;
    const [row] = cell;
    const rect = cellRect(table, row, cell[1]);
    const fitted = setCellText(el, el.content, measure, rect, true);
    const inset = fitted.y - rect.y;
    const needed = inset + fitted.height + Math.max(1, Math.min(inset, 0.4 * fitted.fontSize));
    if (fitted === el && needed <= rect.height + 0.25) return page;
    const next = { ...page, elements: page.elements.map((candidate) => (candidate.id === elementId ? fitted : candidate)) };
    return needed > rect.height + 0.25 ? resizeRow(next, table, row, r3(needed - rect.height), flowBelow(page, table)) : next;
  }
  return page;
}

/**
 * Where a table that runs over several pages stops on a full page: the lowest
 * bottom edge among its pieces, when that is well down the page. Rows added to
 * a shorter piece stop there too, so every page keeps the same bottom margin.
 */
export function chainBottom(chain: TableRef[], pages: TemplatePage[]): number | undefined {
  if (chain.length < 2) return undefined;
  const lowest = Math.max(...chain.map((ref) => ref.table.rows[ref.table.rows.length - 1]));
  const height = Math.max(...chain.map((ref) => pages[ref.pageIndex].height));
  return lowest > 0.7 * height ? lowest : undefined;
}

/**
 * Add `extra` empty rows at the bottom of a table.
 *
 * - lines and boxes that run down to the table's bottom edge (column rules, the
 *   frame, a background) are stretched;
 * - what belongs to a single row (its bottom rule, a stripe, cell boxes) is
 *   copied for each new row, alternating the last two rows so stripes carry on;
 * - everything under the table, including other tables, moves down.
 *
 * The new rows have no text yet: importing fills them, copying the look of the
 * cells above.
 */
export function growTable(
  page: TemplatePage, table: TemplateTable, extra: number, flow = flowBelow(page, table),
): TemplatePage {
  if (extra <= 0) return page;
  const rows = rowCount(table);
  const bottom = table.rows[rows];
  const rowHeight = newRowHeight(table);
  const delta = extra * rowHeight;
  const heights = bodyRowHeights(table);
  // the rows whose graphics are copied: the last two when they are alike (stripes alternate), else the last
  const alike = heights.length >= 2 && Math.abs(heights[heights.length - 1] - heights[heights.length - 2]) <= 1;
  const patterns = alike ? [rows - 2, rows - 1] : [rows - 1];

  const taken = new Set(page.elements.map((el) => el.id));
  const stretched = new Set<string>();
  const copies = new Map<string, TemplateElement[]>(); // new shapes, keyed by the shape they follow
  const elements: TemplateElement[] = [];

  for (const el of page.elements) {
    if (el.type === "shape" && withinColumns(el, table) && !el.rotation && el.y >= table.y - EDGE) {
      const reachesBottom = Math.abs(el.y + el.height - bottom) <= EDGE;
      const spansRows = el.height > 1.5 * rowHeight;
      if (el.shape === "line" && Math.abs(el.x1 - el.x2) <= 0.5 && reachesBottom && spansRows) {
        // a column rule: lengthen it
        const lowerIsEnd = el.y2 >= el.y1;
        stretched.add(el.id);
        elements.push({
          ...el, height: r3(el.height + delta),
          y1: lowerIsEnd ? el.y1 : r3(el.y1 + delta), y2: lowerIsEnd ? r3(el.y2 + delta) : el.y2,
        });
        continue;
      }
      if (el.shape === "rect" && reachesBottom && spansRows) {
        // the frame or a background behind the whole table
        stretched.add(el.id);
        elements.push({ ...el, height: r3(el.height + delta) });
        continue;
      }
    }
    elements.push(flow.below.has(el.id) ? moveElement(el, 0, delta) : el);
  }

  for (let added = 0; added < extra; added += 1) {
    const source = patterns[added % patterns.length];
    const shift = bottom + added * rowHeight - table.rows[source];
    for (const el of page.elements) {
      if (el.type !== "shape" || stretched.has(el.id) || !withinColumns(el, table)) continue;
      // a rule on a row's top edge belongs to the row above it
      if (centreY(el) <= table.rows[source] + 0.75 || centreY(el) > table.rows[source + 1] + 0.75) continue;
      const copy = { ...moveElement(el, 0, shift), id: newElementId(page.index, taken) };
      copies.set(el.id, [...(copies.get(el.id) ?? []), copy]);
    }
  }

  const grown: TemplateTable = {
    ...table,
    height: r3(table.height + delta),
    rows: [...table.rows, ...Array.from({ length: extra }, (_, i) => r3(bottom + (i + 1) * rowHeight))],
  };
  const tables = shiftTablesBelow(page, table, grown, bottom, delta);
  return { ...page, tables, elements: withZ(elements.flatMap((el) => [el, ...(copies.get(el.id) ?? [])])) };
}
