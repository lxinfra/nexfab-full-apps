import { NextResponse } from 'next/server';
import { getActiveCompany } from '@/lib/company-context';
import { handleError, fail, ok } from '@/lib/api';
import {
  analyse,
  archiveSheet,
  findDuplicateBatch,
  hashBytes,
  listBatches,
  readSheet,
  saveBatch,
} from '@/lib/monthly-import-service';
import { GROUPING_MODES, type GroupingMode, type MonthlyColumnMap } from '@/lib/monthly-import';
import { WITHIN_STATE_SUPPLY, type WithinStateSupply } from '@/lib/constants';

const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXT = ['.xlsx', '.xlsm', '.xls', '.csv'];

/** Import history for the active company. */
export async function GET() {
  try {
    const company = await getActiveCompany();
    if (!company) return ok({ batches: [] });
    return ok({ batches: await listBatches(company.id) });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Uploads a monthly sheet.
 *
 * Two modes, both driven by the same parse:
 *   `commit` absent  - analyse only, so the mapping and validation screens can
 *                      be shown and re-shown without writing anything.
 *   `commit=1`       - store the batch and its rows, still generating nothing.
 *
 * Invoices are only ever created by POST /api/imports/[id]/generate.
 */
export async function POST(req: Request) {
  try {
    const company = await getActiveCompany();
    if (!company) return fail('Select a company first', 400);

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('No file uploaded', 400);

    const lower = file.name.toLowerCase();
    if (!ALLOWED_EXT.some((ext) => lower.endsWith(ext))) {
      return fail('Upload an .xlsx, .xls or .csv file', 415);
    }
    if (file.size > MAX_BYTES) return fail('File must be 10 MB or smaller', 413);

    const bytes = Buffer.from(await file.arrayBuffer());
    const fileHash = hashBytes(bytes);

    // Duplicate-import protection. Reported, never enforced silently: the user
    // may legitimately re-import after deleting a batch.
    const duplicate = await findDuplicateBatch(company.id, fileHash);
    const confirmDuplicate = form.get('confirmDuplicate') === '1';

    const sheetName = typeof form.get('sheetName') === 'string'
      ? String(form.get('sheetName'))
      : undefined;

    const read = await readSheet(bytes, file.name, sheetName || undefined);
    if (read.headers.filter(Boolean).length === 0) {
      return fail('No column headers were found in that sheet', 422);
    }

    const map = parseMap(form.get('map'));
    const grouping = parseGrouping(form.get('grouping'));
    const defaultSupplyType = parseSupplyType(form.get('defaultSupplyType'));

    const analysis = analyse(read, { map, grouping, defaultSupplyType });

    const duplicateInfo = duplicate
      ? {
          id: duplicate.id,
          fileName: duplicate.fileName,
          createdAt: duplicate.createdAt,
          invoiceCount: duplicate.invoiceCount,
          billCount: duplicate.billCount,
          status: duplicate.status,
        }
      : null;

    const commit = form.get('commit') === '1';
    if (!commit) {
      return ok({
        committed: false,
        fileName: file.name,
        fileSize: file.size,
        fileHash,
        duplicate: duplicateInfo,
        ...serialise(analysis),
      });
    }

    if (duplicate && !confirmDuplicate) {
      return NextResponse.json(
        {
          error: 'This file has already been imported',
          duplicate: duplicateInfo,
          requiresConfirmation: true,
        },
        { status: 409 },
      );
    }

    if (analysis.missing.length > 0) {
      return fail(`Map these columns first: ${analysis.missing.join(', ')}`, 422);
    }
    if (analysis.summary.bills === 0) {
      return fail('No valid rows to import', 422);
    }

    const storagePath = await archiveSheet(
      bytes,
      file.name,
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      company.id,
    );

    const batch = await saveBatch({
      companyId: company.id,
      fileName: file.name,
      fileHash,
      fileSize: file.size,
      storagePath,
      analysis,
    });

    return ok({ committed: true, batchId: batch.id, ...serialise(analysis) });
  } catch (e) {
    return handleError(e);
  }
}

/** The analysis minus the bulky row payloads, which the client does not need. */
function serialise(a: ReturnType<typeof analyse>) {
  return {
    headers: a.headers,
    headerRow: a.headerRow,
    sheetName: a.sheetName,
    sheetNames: a.sheetNames,
    map: a.map,
    detectedMap: a.detectedMap,
    matchedHeaders: a.matchedHeaders,
    unmatchedHeaders: a.unmatchedHeaders,
    missing: a.missing,
    grouping: a.grouping,
    groupingSuggested: a.groupingSuggested,
    hasBillNumbers: a.hasBillNumbers,
    defaultSupplyType: a.defaultSupplyType,
    summary: a.summary,
    preview: a.preview,
    // Capped so a sheet with thousands of problems cannot blow up the response.
    issues: a.issues.slice(0, 500),
    issueCount: a.issues.length,
    sample: a.rows.slice(0, 20).map((r) => ({
      rowNumber: r.rowNumber,
      date: r.date ? r.date.toISOString() : null,
      customerName: r.customerName,
      externalBillNo: r.externalBillNo,
      name: r.name,
      hsnSac: r.hsnSac,
      qtyMilli: r.qtyMilli,
      ratePaise: r.ratePaise,
      gstRate: r.gstRate,
      supplyType: r.supplyType,
      valid: r.valid,
    })),
  };
}

function parseMap(raw: FormDataEntryValue | null): MonthlyColumnMap | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: MonthlyColumnMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0) out[k as keyof MonthlyColumnMap] = n;
    }
    return out;
  } catch {
    return undefined;
  }
}

function parseGrouping(raw: FormDataEntryValue | null): GroupingMode | undefined {
  const v = String(raw ?? '');
  return (GROUPING_MODES as readonly string[]).includes(v) ? (v as GroupingMode) : undefined;
}

function parseSupplyType(raw: FormDataEntryValue | null): WithinStateSupply | undefined {
  const v = String(raw ?? '');
  return (WITHIN_STATE_SUPPLY as readonly string[]).includes(v)
    ? (v as WithinStateSupply)
    : undefined;
}
