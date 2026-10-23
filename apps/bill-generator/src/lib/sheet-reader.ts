import ExcelJS from 'exceljs';
import { headerScore } from './import-mapping';

export type SheetGrid = {
  sheetName: string;
  /** Names of every sheet in the workbook, so the caller can offer a choice. */
  sheetNames: string[];
  /** Every row as an array of raw cell values, ragged edges padded out. */
  rows: unknown[][];
};

/** ExcelJS hands back rich text, formulas and hyperlinks - flatten to a value. */
function flattenCell(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value instanceof Date) return value;
    const v = value as unknown as Record<string, unknown>;
    if ('result' in v) return flattenCell(v.result as ExcelJS.CellValue); // formula
    if ('richText' in v) {
      return (v.richText as { text: string }[]).map((t) => t.text).join('');
    }
    if ('text' in v) return v.text; // hyperlink
    if ('error' in v) return '';
  }
  return value;
}

export async function readXlsx(buffer: ArrayBuffer, sheetName?: string): Promise<SheetGrid> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheetNames = wb.worksheets.map((s) => s.name);
  const ws =
    (sheetName ? wb.worksheets.find((s) => s.name === sheetName) : undefined) ??
    wb.worksheets.find((s) => s.rowCount > 0) ??
    wb.worksheets[0];
  if (!ws) throw new Error('That workbook has no sheets.');

  const rows: unknown[][] = [];
  ws.eachRow({ includeEmpty: true }, (row) => {
    const cells: unknown[] = [];
    // values is 1-based with a leading hole; drop it
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    for (let i = 0; i < values.length; i++) {
      cells.push(flattenCell(values[i] as ExcelJS.CellValue));
    }
    rows.push(cells);
  });

  return { sheetName: ws.name, sheetNames, rows };
}

/** Minimal RFC-4180 CSV reader: quotes, escaped quotes, embedded newlines. */
export function readCsv(text: string): SheetGrid {
  const clean = text.replace(/^﻿/, '');
  const rows: unknown[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return { sheetName: 'CSV', sheetNames: ['CSV'], rows };
}

/**
 * Spreadsheets rarely start at the header row - a printed bill can carry a
 * letterhead, bank details and buyer block above its item table. Score every
 * candidate row by how many invoice fields its headers would fill and take the
 * best one, rather than trusting the first row that happens to have text in it.
 */
export function findHeaderRow(rows: unknown[][]): number {
  const limit = Math.min(rows.length, 40);
  let bestRow = 0;
  let bestScore = 0;

  for (let i = 0; i < limit; i++) {
    const hasDataBelow = rows
      .slice(i + 1, i + 8)
      .some((r) => r.some((c) => String(c ?? '').trim() !== ''));
    if (!hasDataBelow) continue;

    const score = headerScore(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }

  if (bestScore > 0) return bestRow;

  // Nothing recognisable - fall back to the first row with a couple of values.
  for (let i = 0; i < limit; i++) {
    const filled = rows[i].filter((c) => String(c ?? '').trim() !== '');
    if (filled.length >= 2) return i;
  }
  return 0;
}
