import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { requireActiveCompany } from '@/lib/company-context';
import { findHeaderRow, readCsv, readXlsx } from '@/lib/sheet-reader';
import { readPdf } from '@/lib/pdf-reader';
import { extractBill, matchCustomer } from '@/lib/bill-extract';
import {
  buildRow,
  detectColumns,
  missingRequired,
  type ParsedRow,
  type ProductMatch,
} from '@/lib/import-mapping';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 500;

/**
 * POST a .xlsx or .csv of line items; get back editable rows plus a report of
 * what was matched. Nothing is written to the database here - the user reviews
 * the preview and the invoice form takes it from there.
 */
export async function POST(req: Request) {
  try {
    const company = await requireActiveCompany();
    const form = await req.formData();
    const file = form.get('file');
    const wantedSheet = form.get('sheet');

    if (!(file instanceof File)) return fail('No file uploaded', 400);
    if (file.size > MAX_BYTES) return fail('File must be 5 MB or smaller', 413);

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.xls')) {
      return fail(
        'Old .xls files are not supported. Open it in Excel and use Save As → .xlsx (or .csv).',
        415,
      );
    }

    let grid;
    if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
      grid = readCsv(await file.text());
    } else if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) {
      grid = await readXlsx(
        await file.arrayBuffer(),
        typeof wantedSheet === 'string' && wantedSheet ? wantedSheet : undefined,
      );
    } else if (lower.endsWith('.pdf')) {
      grid = await readPdf(await file.arrayBuffer());
    } else {
      return fail('Upload a .pdf, .xlsx or .csv file', 415);
    }

    if (grid.rows.length === 0) return fail('That file is empty', 422);

    const headerIndex = findHeaderRow(grid.rows);
    const headers = (grid.rows[headerIndex] ?? []).map((c) => String(c ?? ''));
    const detect = detectColumns(headers);

    const missing = missingRequired(detect);
    if (missing.length > 0) {
      return fail(
        `Could not find a column for: ${missing.join(', ')}. ` +
          `Headers found on row ${headerIndex + 1}: ${headers.filter(Boolean).join(', ') || '(none)'}. ` +
          `Download the template to see the expected layout.`,
        422,
        { headers, headerRow: headerIndex + 1, missing, sheetName: grid.sheetName, sheetNames: grid.sheetNames },
      );
    }

    const products = (await prisma.product.findMany({
      where: { companyId: company.id, isActive: true },
      select: { id: true, name: true, hsnSac: true, unit: true, ratePaise: true, gstRate: true },
    })) as ProductMatch[];

    const rows: ParsedRow[] = [];
    let skipped = 0;
    for (let i = headerIndex + 1; i < grid.rows.length; i++) {
      if (rows.length >= MAX_ROWS) break;
      const built = buildRow(grid.rows[i], detect, i + 1, products);
      if (built) rows.push(built);
      else skipped++;
    }

    if (rows.length === 0) {
      return fail(
        `No item rows found below the header row in sheet "${grid.sheetName}"`,
        422,
        { headers, sheetName: grid.sheetName, sheetNames: grid.sheetNames },
      );
    }

    // Read the document-level fields too, so a whole bill lands in the form.
    const customers = await prisma.customer.findMany({
      where: { companyId: company.id, isActive: true },
      select: { id: true, name: true },
    });
    const bill = extractBill(grid.rows, headerIndex, company.gstin);
    const matchedCustomerId = matchCustomer(bill.buyer.name, customers);

    const matchedNames = new Set(products.map((p) => p.name.trim().toLowerCase()));
    const knownCount = rows.filter((r) => matchedNames.has(r.name.trim().toLowerCase())).length;

    return ok({
      sheetName: grid.sheetName,
      sheetNames: grid.sheetNames,
      headerRow: headerIndex + 1,
      matched: detect.matched,
      ignored: detect.ignored,
      unrecognised: detect.unrecognised,
      rows,
      skippedBlankRows: skipped,
      truncated: grid.rows.length - headerIndex - 1 > MAX_ROWS,
      productMatches: knownCount,
      bill,
      matchedCustomerId,
    });
  } catch (e) {
    return handleError(e);
  }
}
