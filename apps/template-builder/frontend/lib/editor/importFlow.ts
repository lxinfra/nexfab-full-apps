// Filling one table, or a table that runs over several pages, from a sheet.
//
// The sheet's rows are poured into the tables in order. Text wraps to its
// column, a row gets as tall as its text needs, and rows that no longer fit on
// a page go on to the next table. When the tables are full, the last one is
// made longer and pages are added (copies of the page that holds the most rows).

import type { SheetSpan } from "../api";
import type { TemplatePage, TemplateTable, TextElement } from "../types";
import { newPageKey } from "./store";
import {
  applyImport, chainBottom, fitRows, flowBelow, growTable, newRowHeight, planImport, removeRows, roomBelow, rowCount,
  type ImportOptions, type ImportPlan, type Measure, type TableRef,
} from "./tables";

const MAX_PAGES = 500; // the server's limit

export interface FlowInput {
  /** Every page of the template. */
  pages: TemplatePage[];
  page: TemplatePage;
  table: TemplateTable;
  /** The table and its continuations on other pages (see `tableChain`). */
  chain: TableRef[];
  /** Fill the whole chain rather than this table alone. */
  all: boolean;
  /** The sheet as rows of text. */
  rows: string[][];
  /** Bold / italic in its cells, keyed "row:column". */
  styles?: Record<string, SheetSpan[]>;
  options: ImportOptions;
  /** Make the table longer, and add pages, for rows that do not fit. */
  addRows: boolean;
  measure: Measure;
}

export interface FlowOutcome {
  /** The plan for the first table (column matching, header). */
  plan: ImportPlan;
  /** Text of every body row after the import, over all tables. */
  body: string[][];
  /** Body rows the tables hold after the import. */
  capacity: number;
  overflowing: number;
  unplaced: number;
  /** Sheet rows that found no place. */
  skippedRows: number;
  /** Rows added to tables that were there before. */
  addedRows: number;
  addedPages: number;
  /** 1-based number of the page the added pages are copies of. */
  copiedPage: number;
  /** Rows made taller so their text fits. */
  tallerRows: number;
  /** The new page list. Pages keep their old `index`. */
  pages: TemplatePage[];
  changed: boolean;
}

const bodyRowsOf = (table: TemplateTable) => rowCount(table) - table.headerRows;
const bottomOf = (table: TemplateTable) => table.rows[table.rows.length - 1];

/** Measuring text is the slow part, and the same words are measured again on every pass. */
function remembered(measure: Measure): Measure {
  const known = new Map<string, number>();
  return (el: TextElement, text: string) => {
    const key = `${el.fontFamily}|${el.fontId}|${el.fontSize}|${el.fontWeight}|${el.fontStyle}|${text}`;
    let width = known.get(key);
    if (width === undefined) {
      width = measure(el, text);
      known.set(key, width);
    }
    return width;
  };
}

export function flowImport(input: FlowInput): FlowOutcome {
  const { pages, page, table, chain, all, rows, styles, options, addRows } = input;
  const measure = remembered(input.measure);
  const dataRows = Math.max(0, rows.length - (options.hasHeader ? 1 : 0));
  const limit = all ? chainBottom(chain, pages) : undefined;
  const base = (all ? chain : [{ pageIndex: page.index, table }]).map((ref, index, refs) => ({
    position: ref.pageIndex,
    tableId: ref.table.id,
    original: ref.table,
    // Only the table the data ends in is made longer, and the tables on added pages:
    // a table that continues on the next page keeps the length it has.
    grows: index === refs.length - 1,
  }));
  type Target = (typeof base)[number];

  // Added pages are copies of the page that holds the most rows, placed right after it.
  const rowsOn = (position: number) =>
    base.filter((t) => t.position === position).reduce((sum, t) => sum + bodyRowsOf(t.original), 0);
  const source = base.reduce((best, t) => (rowsOn(t.position) >= rowsOn(best.position) ? t : best)).position;
  // the most rows one such page can take: the rows it has, plus the ones that still fit under them
  const perPage = base.filter((t) => t.position === source).reduce(
    (sum, t) => sum + bodyRowsOf(t.original)
      + Math.floor((Math.max(0, roomBelow(pages[source], t.original, limit)) + 0.5) / newRowHeight(t.original)),
    0,
  );

  const fill = (copies: number) => {
    const work = [...pages];
    const targets: Target[] = base.map((t) => ({ ...t }));
    const onSource = base.filter((t) => t.position === source);
    for (let n = 1; n <= copies; n += 1) {
      const position = source + n;
      work.splice(position, 0, { ...pages[source], key: newPageKey() });
      for (const t of targets) if (t.position >= position) t.position += 1;
      const after = targets.findLastIndex((t) => t.position === position - 1);
      targets.splice(after + 1, 0, ...onSource.map((t) => ({ ...t, position, grows: true })));
    }

    const body: string[][] = [];
    let first: ImportPlan | null = null;
    let offset = 0;
    let overflowing = 0;
    let unplaced = 0;
    let addedRows = 0;
    let tallerRows = 0;

    targets.forEach((target, index) => {
      let current = work[target.position];
      const find = () => (current.tables ?? []).find((t) => t.id === target.tableId)!;
      // how far this table may get longer, and what moves with its bottom edge: fixed before it changes
      const room = Math.max(0, roomBelow(current, find(), limit));
      const startBottom = bottomOf(find());
      const flow = flowBelow(current, find());

      const fillAndFit = () => {
        const plan = planImport(find(), current.elements, rows, options, offset, styles);
        const result = applyImport(find(), current.elements, plan, target.position, measure);
        if (result.elements !== current.elements) current = { ...current, elements: result.elements };
        current = fitRows(current, target.tableId, result.rowHeights, flow).page;
        return { plan, result };
      };
      let step = fillAndFit();

      // rows are added when the tables from here on cannot hold what is left, as far as the page has room
      const later = targets.slice(index + 1).reduce((sum, t) => sum + bodyRowsOf(t.original), 0);
      const left = dataRows - offset - bodyRowsOf(find()) - later;
      if (addRows && target.grows && left > 0) {
        const free = room - (bottomOf(find()) - startBottom);
        const extra = Math.min(left, Math.floor((free + 0.5) / newRowHeight(find())));
        if (extra > 0) {
          current = growTable(current, find(), extra, flow);
          step = fillAndFit();
        }
      }

      // rows pushed past the end of the page by taller rows above them go on to the next table
      while (bottomOf(find()) - startBottom > room + 0.5 && bodyRowsOf(find()) > 1) {
        current = removeRows(current, find(), 1, flow);
      }

      const kept = bodyRowsOf(find());
      const final = find();
      for (let row = 0; row < Math.min(rowCount(final), rowCount(target.original)); row += 1) {
        const before = target.original.rows[row + 1] - target.original.rows[row];
        if (final.rows[row + 1] - final.rows[row] > before + 0.25) tallerRows += 1;
      }
      addedRows += Math.max(0, kept - bodyRowsOf(target.original));
      first ??= step.plan;
      body.push(...step.plan.body.slice(0, kept));
      overflowing += step.result.overflowing;
      unplaced += step.result.unplaced;
      offset += kept;
      work[target.position] = current;
    });

    return { work, plan: first!, body, capacity: offset, overflowing, unplaced, addedRows, tallerRows, copies };
  };

  let attempt = fill(0);
  while (addRows && perPage > 0 && attempt.capacity < dataRows && pages.length + attempt.copies < MAX_PAGES) {
    // `perPage` is the most a page can take, so this never adds too many pages; the loop adds the rest
    const more = Math.max(1, Math.floor((dataRows - attempt.capacity) / perPage));
    attempt = fill(Math.min(attempt.copies + more, MAX_PAGES - pages.length));
  }

  const { work } = attempt;
  return {
    plan: attempt.plan,
    body: attempt.body,
    capacity: attempt.capacity,
    overflowing: attempt.overflowing,
    unplaced: attempt.unplaced,
    skippedRows: Math.max(0, dataRows - attempt.capacity),
    addedRows: attempt.addedRows,
    addedPages: attempt.copies,
    copiedPage: source + 1,
    tallerRows: attempt.tallerRows,
    pages: work,
    changed: work.length !== pages.length || work.some((p, i) => p !== pages[i]),
  };
}
