/**
 * Turning an uploaded monthly sheet into invoices.
 *
 * The flow is deliberately in two halves. Uploading parses, validates and
 * stores the sheet, and produces nothing else — no invoices exist until the
 * user has seen the report and confirmed. Generating then walks the grouped
 * bills in chunks, so a sheet with hundreds of bills neither blocks a request
 * nor needs the whole job to fit inside one function invocation.
 *
 * Numbers always come from the existing series through `createInvoice`. The
 * sheet's own bill number is recorded on the invoice as `externalBillNo` and
 * never used as the invoice number.
 */
import { createHash } from 'node:crypto';
import { prisma } from './db';
import { createInvoice, toDateInput } from './invoice-service';
import {
  detectMonthlyColumns,
  groupIntoBills,
  markDuplicateRows,
  missingRequiredFields,
  parseMonthlyRows,
  previewGroups,
  suggestGrouping,
  summarise,
  type Bill,
  type GroupingMode,
  type MonthlyColumnMap,
  type MonthlyRow,
  type RowIssue,
} from './monthly-import';
import { invoiceSchema } from './schemas';
import { findHeaderRow, readCsv, readXlsx, type SheetGrid } from './sheet-reader';
import { storeFile } from './storage';
import type { WithinStateSupply } from './constants';

export function hashBytes(bytes: Buffer | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Has this exact file already been imported for this company? */
export async function findDuplicateBatch(companyId: string, fileHash: string) {
  return prisma.importBatch.findFirst({
    where: { companyId, fileHash, status: { in: ['PENDING', 'GENERATING', 'COMPLETED'] } },
    orderBy: { createdAt: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

export type ReadSheetResult = {
  grid: SheetGrid;
  headerRow: number;
  headers: string[];
  dataRows: { rowNumber: number; cells: unknown[] }[];
};

/**
 * Reads the upload into a header row plus data rows.
 *
 * Row numbers are 1-based and count from the top of the file, so an issue
 * reported against "row 127" is the row the user sees in Excel.
 */
export async function readSheet(
  bytes: Buffer,
  fileName: string,
  sheetName?: string,
): Promise<ReadSheetResult> {
  const lower = fileName.toLowerCase();
  const grid = lower.endsWith('.csv')
    ? readCsv(bytes.toString('utf8'))
    : await readXlsx(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        sheetName,
      );

  const headerRow = findHeaderRow(grid.rows);
  const headers = (grid.rows[headerRow] ?? []).map((c) => String(c ?? '').trim());
  const dataRows = grid.rows
    .slice(headerRow + 1)
    .map((cells, i) => ({ rowNumber: headerRow + 2 + i, cells }));

  return { grid, headerRow, headers, dataRows };
}

// ---------------------------------------------------------------------------
// Analysing, without writing anything
// ---------------------------------------------------------------------------

export type AnalyseOptions = {
  map?: MonthlyColumnMap;
  grouping?: GroupingMode;
  defaultSupplyType?: WithinStateSupply;
};

export type Analysis = {
  headers: string[];
  headerRow: number;
  sheetNames: string[];
  sheetName: string;
  detectedMap: MonthlyColumnMap;
  matchedHeaders: Partial<Record<string, string>>;
  unmatchedHeaders: string[];
  missing: string[];
  map: MonthlyColumnMap;
  grouping: GroupingMode;
  groupingSuggested: GroupingMode;
  hasBillNumbers: boolean;
  defaultSupplyType: WithinStateSupply;
  rows: MonthlyRow[];
  bills: Bill[];
  issues: RowIssue[];
  summary: ReturnType<typeof summarise>;
  preview: ReturnType<typeof previewGroups>;
};

/**
 * Parses and validates without touching the database, so the mapping screen
 * can be re-run as the user corrects a column choice.
 */
export function analyse(read: ReadSheetResult, options: AnalyseOptions = {}): Analysis {
  const detect = detectMonthlyColumns(read.headers);
  const map = options.map ?? detect.map;
  const defaultSupplyType = options.defaultSupplyType ?? 'INTRA_STATE';

  const parsed = parseMonthlyRows(read.dataRows, { map, defaultSupplyType });
  const duplicateIssues = markDuplicateRows(parsed.rows);

  const groupingSuggested = suggestGrouping(parsed.rows);
  const grouping = options.grouping ?? groupingSuggested;
  const bills = groupIntoBills(
    parsed.rows.filter((r) => r.valid),
    grouping,
  );

  return {
    headers: read.headers,
    headerRow: read.headerRow,
    sheetNames: read.grid.sheetNames,
    sheetName: read.grid.sheetName,
    detectedMap: detect.map,
    matchedHeaders: detect.matched,
    unmatchedHeaders: detect.unmatched,
    missing: missingRequiredFields(map),
    map,
    grouping,
    groupingSuggested,
    hasBillNumbers: parsed.rows.some((r) => (r.externalBillNo ?? '').trim() !== ''),
    defaultSupplyType,
    rows: parsed.rows,
    bills,
    issues: [...parsed.issues, ...duplicateIssues],
    summary: summarise(parsed, bills),
    preview: previewGroups(bills),
  };
}

// ---------------------------------------------------------------------------
// Saving the batch
// ---------------------------------------------------------------------------

export type SaveBatchInput = {
  companyId: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
  storagePath?: string | null;
  analysis: Analysis;
};

/**
 * Writes the batch and every row of the sheet.
 *
 * Nothing is generated here. The batch sits at PENDING until the user confirms,
 * which is what stops an upload from silently creating hundreds of invoices.
 */
export async function saveBatch(input: SaveBatchInput) {
  const { analysis: a } = input;

  const batch = await prisma.importBatch.create({
    data: {
      companyId: input.companyId,
      fileName: input.fileName,
      fileHash: input.fileHash,
      fileSize: input.fileSize,
      storagePath: input.storagePath ?? null,
      periodMonth: a.summary.periodMonth,
      periodYear: a.summary.periodYear,
      status: 'PENDING',
      grouping: a.grouping,
      mapping: JSON.stringify({ map: a.map, headers: a.headers, headerRow: a.headerRow }),
      defaultSupplyType: a.defaultSupplyType,
      totalRows: a.summary.totalRows,
      validRows: a.summary.validRows,
      errorRows: a.summary.errorRows,
      billCount: a.summary.bills,
      issues: JSON.stringify(a.issues.slice(0, 2000)),
    },
  });

  // Which bill each row landed in, so the audit trail survives the request.
  const billKeyByRow = new Map<number, string>();
  for (const bill of a.bills) {
    for (const row of bill.rows) billKeyByRow.set(row.rowNumber, bill.billKey);
  }

  const data = a.rows.map((r) => ({
    batchId: batch.id,
    rowNumber: r.rowNumber,
    raw: JSON.stringify(r.raw.map((c) => (c instanceof Date ? c.toISOString() : c))),
    billKey: billKeyByRow.get(r.rowNumber) ?? null,
    externalBillNo: r.externalBillNo,
    customerName: r.customerName || null,
    itemName: r.name || null,
    description: r.description,
    hsnSac: r.hsnSac,
    unit: r.unit,
    qtyMilli: r.qtyMilli,
    ratePaise: r.ratePaise,
    gstRate: r.gstRate,
    supplyType: r.supplyType,
    rowDate: r.date,
    status: r.valid ? 'VALID' : 'INVALID',
    issues: r.issues.length ? JSON.stringify(r.issues) : null,
  }));

  // Chunked: a 1,250-row sheet in one statement is a very large query.
  for (let i = 0; i < data.length; i += 500) {
    await prisma.importRow.createMany({ data: data.slice(i, i + 500) });
  }

  return batch;
}

/** Keeps the original sheet, so an import can always be traced to its source. */
export async function archiveSheet(
  bytes: Buffer,
  fileName: string,
  contentType: string,
  companyId: string,
): Promise<string | null> {
  try {
    const stored = await storeFile(
      new File([new Uint8Array(bytes)], fileName, { type: contentType }),
      'monthlyimport',
      companyId,
    );
    // Record it like any other upload, so the archived sheet is listed with the
    // company's files and is not left behind as an untracked object if the
    // import is later deleted.
    await prisma.upload.create({
      data: {
        companyId,
        kind: 'monthlyimport',
        fileName,
        contentType,
        sizeBytes: bytes.length,
        storagePath: stored.storagePath,
        backend: stored.backend,
      },
    });
    return stored.storagePath;
  } catch {
    // Archiving is a convenience; losing it must not fail the import.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generating invoices
// ---------------------------------------------------------------------------

export type GenerateResult = {
  batchId: string;
  done: boolean;
  generatedNow: number;
  generatedTotal: number;
  billsTotal: number;
  failed: { billKey: string; customerName: string; message: string }[];
  warnings: string[];
  createdCustomers: string[];
};

type PendingBill = {
  billKey: string;
  customerName: string;
  externalBillNo: string | null;
  date: Date;
  supplyType: string;
  rows: {
    id: string;
    rowNumber: number;
    itemName: string | null;
    description: string | null;
    hsnSac: string | null;
    unit: string | null;
    qtyMilli: number | null;
    ratePaise: number | null;
    gstRate: number | null;
  }[];
};

/** Rebuilds the outstanding bills from the stored rows. */
async function pendingBills(batchId: string, limit: number): Promise<PendingBill[]> {
  const rows = await prisma.importRow.findMany({
    where: { batchId, status: 'VALID', invoiceId: null, billKey: { not: null } },
    orderBy: [{ rowDate: 'asc' }, { rowNumber: 'asc' }],
  });

  const order: string[] = [];
  const groups = new Map<string, PendingBill>();
  for (const r of rows) {
    const key = r.billKey!;
    let bill = groups.get(key);
    if (!bill) {
      if (order.length >= limit) continue; // leave the rest for the next chunk
      bill = {
        billKey: key,
        customerName: r.customerName ?? '',
        externalBillNo: r.externalBillNo,
        date: r.rowDate!,
        supplyType: r.supplyType ?? 'INTRA_STATE',
        rows: [],
      };
      groups.set(key, bill);
      order.push(key);
    }
    bill.rows.push({
      id: r.id,
      rowNumber: r.rowNumber,
      itemName: r.itemName,
      description: r.description,
      hsnSac: r.hsnSac,
      unit: r.unit,
      qtyMilli: r.qtyMilli,
      ratePaise: r.ratePaise,
      gstRate: r.gstRate,
    });
  }
  return order.map((k) => groups.get(k)!);
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Finds the customer a sheet row names, creating a placeholder if there is no
 * match. A monthly sheet carries only a name, so the address is left as
 * something obviously unfinished rather than invented; the bill still totals
 * correctly and the user can fill the address in afterwards.
 */
async function resolveCustomer(
  companyId: string,
  name: string,
  companyState: { name: string; code: string },
  cache: Map<string, string>,
  created: string[],
): Promise<string> {
  const key = normName(name);
  const hit = cache.get(key);
  if (hit) return hit;

  const existing = await prisma.customer.findFirst({
    where: { companyId, name: { equals: name.trim(), mode: 'insensitive' } },
  });
  if (existing) {
    cache.set(key, existing.id);
    return existing.id;
  }

  const made = await prisma.customer.create({
    data: {
      companyId,
      name: name.trim(),
      billingLine1: 'Address not provided',
      billingCity: '-',
      billingState: companyState.name,
      billingStateCode: companyState.code,
      billingPincode: '000000',
      notes: 'Created automatically by a monthly sheet import. Please complete the address.',
    },
  });
  cache.set(key, made.id);
  created.push(made.name);
  return made.id;
}

/** Links a line to a catalogue product when one already matches by name. */
async function resolveProduct(
  companyId: string,
  name: string,
  cache: Map<string, string | null>,
): Promise<string | null> {
  const key = normName(name);
  if (cache.has(key)) return cache.get(key)!;
  const product = await prisma.product.findFirst({
    where: { companyId, name: { equals: name.trim(), mode: 'insensitive' }, isActive: true },
    select: { id: true },
  });
  cache.set(key, product?.id ?? null);
  return product?.id ?? null;
}

/**
 * Generates up to `limit` more invoices for a batch.
 *
 * Called repeatedly by the client so progress can be shown and no single
 * request has to finish the whole job. Each bill is independent: one that
 * fails is recorded against its rows and the rest still generate.
 */
export async function generateBatch(batchId: string, limit = 25): Promise<GenerateResult> {
  const batch = await prisma.importBatch.findUniqueOrThrow({
    where: { id: batchId },
    include: { company: true },
  });

  if (batch.status === 'COMPLETED') {
    return {
      batchId,
      done: true,
      generatedNow: 0,
      generatedTotal: batch.invoiceCount,
      billsTotal: batch.billCount,
      failed: [],
      warnings: [],
      createdCustomers: [],
    };
  }

  if (batch.status === 'PENDING') {
    await prisma.importBatch.update({ where: { id: batchId }, data: { status: 'GENERATING' } });
  }

  const companyState = { name: batch.company.state, code: batch.company.stateCode };
  const customerCache = new Map<string, string>();
  const productCache = new Map<string, string | null>();
  const createdCustomers: string[] = [];
  const warnings: string[] = [];
  const failed: GenerateResult['failed'] = [];

  const bills = await pendingBills(batchId, limit);
  let generatedNow = 0;

  for (const bill of bills) {
    try {
      const customerId = await resolveCustomer(
        batch.companyId,
        bill.customerName,
        companyState,
        customerCache,
        createdCustomers,
      );
      const customer = await prisma.customer.findUniqueOrThrow({
        where: { id: customerId },
        select: { billingStateCode: true, name: true },
      });

      // The tax engine decides intra vs inter from the two state codes; the
      // sheet only gets to say whether a within-state supply is also
      // within-city. A customer outside the seller's state is IGST whatever
      // the sheet claims, so say so rather than quietly changing it.
      const withinState = bill.supplyType === 'INTRA_CITY' ? 'INTRA_CITY' : 'INTRA_STATE';
      if (customer.billingStateCode !== batch.company.stateCode) {
        warnings.push(
          `${customer.name} is registered in state ${customer.billingStateCode}, not ` +
            `${batch.company.stateCode}, so its bills are inter-state (IGST) regardless of ` +
            `the sheet's supply type.`,
        );
      }

      const items = bill.rows.map((r) => ({
        productId: null as string | null,
        name: r.itemName ?? '',
        description: r.description ?? undefined,
        hsnSac: r.hsnSac ?? undefined,
        unit: r.unit ?? 'PCS',
        qtyMilli: r.qtyMilli ?? 0,
        ratePaise: r.ratePaise ?? 0,
        discountType: 'PERCENT' as const,
        discountValue: 0,
        gstRate: r.gstRate ?? 18,
      }));
      for (const item of items) {
        item.productId = await resolveProduct(batch.companyId, item.name, productCache);
      }

      const input = invoiceSchema.parse({
        docType: 'TAX_INVOICE',
        customerId,
        invoiceDate: toDateInput(bill.date),
        placeOfSupplyCode: customer.billingStateCode,
        withinStateSupply: withinState,
        status: 'SENT',
        items,
      });

      const invoice = await createInvoice(batch.companyId, input, {
        importBatchId: batchId,
        externalBillNo: bill.externalBillNo,
      });

      await prisma.importRow.updateMany({
        where: { id: { in: bill.rows.map((r) => r.id) } },
        data: { invoiceId: invoice.id, status: 'GENERATED' },
      });
      generatedNow++;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      failed.push({ billKey: bill.billKey, customerName: bill.customerName, message });
      await prisma.importRow.updateMany({
        where: { id: { in: bill.rows.map((r) => r.id) } },
        data: {
          status: 'INVALID',
          issues: JSON.stringify([
            { rowNumber: bill.rows[0]?.rowNumber ?? 0, field: 'row', message, severity: 'error' },
          ]),
        },
      });
    }
  }

  const generatedTotal = await prisma.invoice.count({ where: { importBatchId: batchId } });
  const remaining = await prisma.importRow.count({
    where: { batchId, status: 'VALID', invoiceId: null, billKey: { not: null } },
  });
  const done = remaining === 0;

  await prisma.importBatch.update({
    where: { id: batchId },
    data: {
      invoiceCount: generatedTotal,
      status: done ? 'COMPLETED' : 'GENERATING',
      generatedAt: done ? new Date() : null,
    },
  });

  return {
    batchId,
    done,
    generatedNow,
    generatedTotal,
    billsTotal: batch.billCount,
    failed,
    warnings: [...new Set(warnings)],
    createdCustomers,
  };
}

// ---------------------------------------------------------------------------
// Reading batches back
// ---------------------------------------------------------------------------

export async function listBatches(companyId: string, take = 50) {
  return prisma.importBatch.findMany({
    where: { companyId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function getBatch(id: string) {
  return prisma.importBatch.findUnique({
    where: { id },
    include: {
      company: { select: { legalName: true, stateCode: true } },
      _count: { select: { rows: true, invoices: true } },
    },
  });
}

export type StoredIssue = RowIssue;

export function parseIssues(json: string | null): StoredIssue[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as StoredIssue[]) : [];
  } catch {
    return [];
  }
}

/** The date-and-company rollup for a saved batch, read from its rows. */
export async function batchPreview(batchId: string) {
  const rows = await prisma.importRow.findMany({
    where: { batchId, status: { in: ['VALID', 'GENERATED'] }, billKey: { not: null } },
    select: {
      billKey: true,
      customerName: true,
      rowDate: true,
      qtyMilli: true,
      ratePaise: true,
    },
  });

  const out = new Map<
    string,
    { date: string; customerName: string; bills: Set<string>; lines: number; totalPaise: number }
  >();
  for (const r of rows) {
    if (!r.rowDate) continue;
    const day = toDateInput(r.rowDate);
    const key = `${day}|${normName(r.customerName ?? '')}`;
    const entry =
      out.get(key) ??
      {
        date: day,
        customerName: r.customerName ?? '',
        bills: new Set<string>(),
        lines: 0,
        totalPaise: 0,
      };
    entry.bills.add(r.billKey!);
    entry.lines += 1;
    entry.totalPaise += Math.round(((r.qtyMilli ?? 0) * (r.ratePaise ?? 0)) / 1000);
    out.set(key, entry);
  }

  return [...out.values()]
    .map((e) => ({ ...e, bills: e.bills.size }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.customerName.localeCompare(b.customerName));
}
