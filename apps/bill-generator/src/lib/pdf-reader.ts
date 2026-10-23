/**
 * Reads a PDF bill back into the same row/column grid the spreadsheet importer
 * works on, so one pipeline handles both.
 *
 * A PDF has no table structure — only glyphs at coordinates. Text runs are
 * grouped into rows by their y position, then the x positions are clustered
 * across the page into column anchors, which reconstructs the table well enough
 * for the header/column detection to take over.
 *
 * Scanned PDFs have no text layer at all; those are detected and reported
 * rather than silently returning an empty bill.
 */
import type { SheetGrid } from './sheet-reader';

type TextRun = { text: string; x: number; y: number; width: number };

/** Runs closer than this vertically belong to the same visual row (in points). */
const ROW_TOLERANCE = 3.2;
/** Column anchors closer than this are the same column. */
const COLUMN_TOLERANCE = 9;

type PdfTextItem = { str?: string; transform?: number[]; width?: number };

/** Only the slice of pdf.js this file touches, so its types stay out of the build. */
type PdfjsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(opts: {
    data: Uint8Array;
    useSystemFonts?: boolean;
    disableFontFace?: boolean;
    verbosity?: number;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{
        getViewport(o: { scale: number }): { height: number };
        getTextContent(): Promise<{ items: unknown[] }>;
        cleanup(): void;
      }>;
      cleanup(): Promise<void>;
    }>;
  };
};

async function loadPdfjs() {
  // The legacy build is the one that runs under Node without a DOM.
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfjsModule;

  // Under Node there is no browser worker, so pdf.js has to be pointed at the
  // worker module on disk; without this it throws "fake worker failed".
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const path = await import('node:path');
    let workerPath: string;
    try {
      workerPath = createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    } catch {
      workerPath = path.join(
        process.cwd(),
        'node_modules',
        'pdfjs-dist',
        'legacy',
        'build',
        'pdf.worker.mjs',
      );
    }
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }
  return pdfjs;
}

export async function readPdf(buffer: ArrayBuffer): Promise<SheetGrid & { pageCount: number }> {
  const pdfjs = await loadPdfjs();

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;

  const runs: TextRun[] = [];
  let pageOffset = 0;

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    for (const raw of content.items as PdfTextItem[]) {
      const text = (raw.str ?? '').trim();
      if (!text || !raw.transform) continue;
      const x = raw.transform[4];
      const y = raw.transform[5];
      runs.push({
        text,
        x,
        // PDF y grows upwards; flip it and stack pages so reading order is top-down.
        y: pageOffset + (viewport.height - y),
        width: raw.width ?? 0,
      });
    }
    pageOffset += viewport.height + 40;
    page.cleanup();
  }

  const pageCount = doc.numPages;
  await doc.cleanup();

  if (runs.length === 0) {
    throw new Error(
      'That PDF has no selectable text — it looks like a scan or an image. ' +
        'Export the bill as a text PDF (or send the Excel/CSV) and try again.',
    );
  }

  return { sheetName: 'PDF', sheetNames: ['PDF'], rows: toGrid(runs), pageCount };
}

/** Groups runs into rows by y, then into columns by clustered x anchors. */
function toGrid(runs: TextRun[]): unknown[][] {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x);

  // --- rows -----------------------------------------------------------------
  const rows: TextRun[][] = [];
  let current: TextRun[] = [];
  let rowY = Number.NEGATIVE_INFINITY;

  for (const run of sorted) {
    if (current.length === 0 || Math.abs(run.y - rowY) <= ROW_TOLERANCE) {
      if (current.length === 0) rowY = run.y;
      current.push(run);
    } else {
      rows.push(current);
      current = [run];
      rowY = run.y;
    }
  }
  if (current.length > 0) rows.push(current);

  // --- column anchors -------------------------------------------------------
  // Every run's left edge is a candidate; nearby ones collapse into one column.
  const xs = sorted.map((r) => r.x).sort((a, b) => a - b);
  const anchors: number[] = [];
  for (const x of xs) {
    if (anchors.length === 0 || x - anchors[anchors.length - 1] > COLUMN_TOLERANCE) {
      anchors.push(x);
    }
  }

  const columnOf = (x: number): number => {
    let best = 0;
    let bestGap = Infinity;
    for (let i = 0; i < anchors.length; i++) {
      const gap = Math.abs(anchors[i] - x);
      if (gap < bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return best;
  };

  // --- place runs into cells ------------------------------------------------
  return rows.map((row) => {
    const cells: string[] = [];
    for (const run of row.sort((a, b) => a.x - b.x)) {
      const col = columnOf(run.x);
      // Runs landing in the same cell are pieces of one phrase.
      cells[col] = cells[col] ? `${cells[col]} ${run.text}` : run.text;
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    return cells;
  });
}
