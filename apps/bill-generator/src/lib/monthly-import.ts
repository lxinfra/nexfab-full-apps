/**
 * Monthly details sheet -> individual bills.
 *
 * This is deliberately separate from `import-mapping.ts`, which imports the
 * line items of *one* bill. A monthly sheet is a different shape: every row
 * carries its own date and customer, and many rows belong to many bills.
 *
 * The central rule here is that rows are never merged just because their
 * values match. Two rows with the same date, customer, product, HSN and rate
 * are two bills unless something says they are one — and the only things that
 * say so are the sheet's own bill number, or an explicit instruction from the
 * user to group by date and customer.
 */
import { WITHIN_STATE_SUPPLY, type WithinStateSupply } from './constants';
import { validateHsn } from './hsn';
import { coerceGstRate, coerceNumber, coerceUnit, normaliseHeader } from './import-mapping';
import { toPaise } from './money';

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

export type MonthlyField =
  | 'date'
  | 'customer'
  | 'billNo'
  | 'name'
  | 'description'
  | 'hsnSac'
  | 'qty'
  | 'unit'
  | 'rate'
  | 'gstRate'
  | 'supplyType'
  | 'amount';

export const MONTHLY_FIELD_LABELS: Record<MonthlyField, string> = {
  date: 'Date',
  customer: 'Company / Customer',
  billNo: 'Bill / Invoice No.',
  name: 'Product',
  description: 'Product description',
  hsnSac: 'HSN / SAC code',
  qty: 'Quantity',
  unit: 'Unit',
  rate: 'Rate',
  gstRate: 'GST',
  supplyType: 'Supply type',
  amount: 'Amount',
};

/** Without these a row cannot become a line on a bill. */
export const REQUIRED_FIELDS: MonthlyField[] = ['date', 'customer', 'name', 'qty', 'rate'];

/**
 * Accepted header spellings, normalised to lowercase with punctuation removed.
 * Order matters within a list: earlier entries are stronger matches.
 */
const ALIASES: Record<MonthlyField, string[]> = {
  date: [
    'date', 'invoicedate', 'billdate', 'transactiondate', 'saledate', 'salesdate',
    'dateofsupply', 'dateofinvoice', 'dt', 'invdate', 'voucherdate', 'entrydate',
  ],
  customer: [
    'company', 'companyname', 'customer', 'customername', 'client', 'clientname',
    'partyname', 'party', 'buyer', 'buyername', 'billto', 'billedto', 'account',
    'accountname', 'consignee', 'firmname', 'firm', 'dealer', 'distributor',
    'customercompany', 'nameofcompany', 'nameofparty', 'purchaser',
  ],
  billNo: [
    'billno', 'bill', 'billnumber', 'invoiceno', 'invoicenumber', 'invno',
    'transactionid', 'transactionno', 'txnid', 'orderno', 'ordernumber',
    'referenceno', 'refno', 'reference', 'ref', 'voucherno', 'vouchernumber',
    'documentno', 'docno', 'challanno', 'slipno', 'receiptno', 'billid',
  ],
  name: [
    'product', 'productname', 'item', 'itemname', 'goods', 'particulars',
    'particular', 'descriptionofgoods', 'itemdescription', 'service',
    'servicename', 'material', 'materialname', 'productdetails', 'commodity',
  ],
  description: [
    'productdescription', 'description', 'subdescription', 'remarks', 'remark',
    'note', 'notes', 'specification', 'specifications', 'longdescription',
    'itemremarks',
  ],
  hsnSac: [
    'hsn', 'hsncode', 'hsnsac', 'hsnsaccode', 'sac', 'saccode', 'hsnno',
    'hsnnumber', 'hsncodesac', 'tariffcode', 'tariff',
  ],
  qty: ['qty', 'quantity', 'qnty', 'qtty', 'nos', 'noofunits', 'units', 'count', 'pcs', 'pieces'],
  unit: ['unit', 'uom', 'unitofmeasure', 'measure', 'per', 'unitname'],
  rate: [
    'rate', 'price', 'unitprice', 'unitrate', 'rateperunit', 'rateperqty',
    'sellingprice', 'mrp', 'cost', 'costperunit', 'basicrate',
  ],
  gstRate: [
    'gst', 'gstrate', 'gst%', 'gstpercent', 'gstpercentage', 'tax', 'taxrate',
    'tax%', 'taxpercent', 'gstslab', 'igst', 'cgstsgst', 'gsttax', 'taxslab',
  ],
  supplyType: [
    'supplytype', 'typeofsupply', 'supply', 'supplynature', 'natureofsupply',
    'interintra', 'statetype', 'suppliestype',
  ],
  amount: [
    'amount', 'amountrs', 'value', 'taxablevalue', 'taxableamount', 'netamount',
    'basicamount', 'basictotal', 'lineamount', 'total', 'totalamount', 'grossamount',
  ],
};

/**
 * Exact-match first, then a contains fallback. "Name" must not steal the
 * customer column from "Company Name", so the two passes are kept apart.
 */
function matchField(header: string): MonthlyField | null {
  const key = normaliseHeader(header);
  if (!key) return null;

  for (const field of Object.keys(ALIASES) as MonthlyField[]) {
    if (ALIASES[field].includes(key)) return field;
  }

  // A longer alias inside a longer header, e.g. "Party Name (Buyer)".
  let best: { field: MonthlyField; len: number } | null = null;
  for (const field of Object.keys(ALIASES) as MonthlyField[]) {
    for (const alias of ALIASES[field]) {
      if (alias.length >= 4 && key.includes(alias)) {
        if (!best || alias.length > best.len) best = { field, len: alias.length };
      }
    }
  }
  return best?.field ?? null;
}

export type MonthlyColumnMap = Partial<Record<MonthlyField, number>>;

export type MonthlyDetect = {
  map: MonthlyColumnMap;
  /** The header text that produced each match, for the mapping screen. */
  matched: Partial<Record<MonthlyField, string>>;
  headers: string[];
  /** Headers that matched nothing, so the user can see what was ignored. */
  unmatched: string[];
};

export function detectMonthlyColumns(headers: string[]): MonthlyDetect {
  const map: MonthlyColumnMap = {};
  const matched: Partial<Record<MonthlyField, string>> = {};
  const unmatched: string[] = [];

  headers.forEach((header, index) => {
    const text = String(header ?? '').trim();
    if (!text) return;
    const field = matchField(text);
    // First column to claim a field keeps it; a sheet with both "Amount" and
    // "Total Amount" should not flip-flop.
    if (field && map[field] === undefined) {
      map[field] = index;
      matched[field] = text;
    } else if (!field) {
      unmatched.push(text);
    }
  });

  return { map, matched, headers: headers.map((h) => String(h ?? '').trim()), unmatched };
}

export function missingRequiredFields(map: MonthlyColumnMap): MonthlyField[] {
  return REQUIRED_FIELDS.filter((f) => map[f] === undefined);
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/** A date at local noon, so no timezone shift can move it to the day before. */
function makeDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d, 12, 0, 0, 0);
  // Rejects 31 February, which would otherwise roll into March.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  return date;
}

function fullYear(y: number): number {
  if (y >= 1000) return y;
  // A two-digit year in a billing sheet is this century.
  return y < 70 ? 2000 + y : 1900 + y;
}

/**
 * Reads a date cell.
 *
 * Indian sheets are day-first, so "05/09/2026" is 5 September. An ambiguous
 * pair is therefore read as day/month; only an impossible day (13+) forces the
 * month-first reading, and that is reported as a warning because a sheet
 * mixing both conventions is a real risk.
 */
export function coerceDate(raw: unknown): { date: Date | null; warning?: string } {
  if (raw === null || raw === undefined || raw === '') return { date: null };

  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { date: null };
    return { date: makeDate(raw.getFullYear(), raw.getMonth() + 1, raw.getDate()) };
  }

  // Excel serial number: days since 1899-12-30.
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw < 1 || raw > 80000) return { date: null };
    const ms = Math.round(raw) * 86400000;
    const base = Date.UTC(1899, 11, 30);
    const d = new Date(base + ms);
    return { date: makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()) };
  }

  const text = String(raw).trim();
  if (!text) return { date: null };

  // 5-Sep-2026, 5 September 26, Sep 5 2026
  const named = text.match(/^(\d{1,2})[\s\-/.]+([A-Za-z]{3,9})[\s\-/.]+(\d{2,4})$/);
  if (named) {
    const m = MONTH_NAMES[named[2].toLowerCase()];
    if (m) return { date: makeDate(fullYear(Number(named[3])), m, Number(named[1])) };
  }
  const namedFirst = text.match(/^([A-Za-z]{3,9})[\s\-/.]+(\d{1,2}),?[\s\-/.]+(\d{2,4})$/);
  if (namedFirst) {
    const m = MONTH_NAMES[namedFirst[1].toLowerCase()];
    if (m) return { date: makeDate(fullYear(Number(namedFirst[3])), m, Number(namedFirst[2])) };
  }

  // 2026-09-05 — unambiguous, year first.
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return { date: makeDate(Number(iso[1]), Number(iso[2]), Number(iso[3])) };

  // 05/09/2026 — day first.
  const slash = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const y = fullYear(Number(slash[3]));
    if (a > 12 && b <= 12) return { date: makeDate(y, b, a) };
    if (b > 12 && a <= 12) {
      return {
        date: makeDate(y, a, b),
        warning: `"${text}" was read as month/day because ${b} cannot be a month`,
      };
    }
    return { date: makeDate(y, b, a) };
  }

  return { date: null };
}

// ---------------------------------------------------------------------------
// Supply type
// ---------------------------------------------------------------------------

/**
 * Recognises a supply type written in any of the usual ways. Returns null when
 * the cell says nothing useful, so the import's default applies.
 *
 * Inter-state is deliberately *not* accepted from the sheet: whether a supply
 * crosses a state line is decided by comparing the seller's state with the
 * place of supply, and the tax engine already does that. A sheet claiming
 * "inter-state" for a customer in the seller's own state would be wrong.
 */
export function coerceSupplyType(raw: unknown): WithinStateSupply | null {
  const key = normaliseHeader(String(raw ?? ''));
  if (!key) return null;
  if (key.includes('city') || key === 'intracity' || key === 'local') return 'INTRA_CITY';
  if (key.includes('intrastate') || key.includes('withinstate') || key === 'intra') {
    return 'INTRA_STATE';
  }
  if (key.includes('state')) return 'INTRA_STATE';
  return null;
}

export function isWithinStateSupply(v: string): v is WithinStateSupply {
  return (WITHIN_STATE_SUPPLY as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type RowIssue = {
  rowNumber: number;
  field: MonthlyField | 'row';
  message: string;
  severity: 'error' | 'warning';
};

export type MonthlyRow = {
  /** 1-based row number in the sheet, as the user sees it. */
  rowNumber: number;
  raw: unknown[];

  date: Date | null;
  customerName: string;
  externalBillNo: string | null;
  name: string;
  description: string | null;
  hsnSac: string | null;
  qtyMilli: number;
  unit: string;
  ratePaise: number;
  gstRate: number;
  supplyType: WithinStateSupply | null;
  /** The sheet's own amount, kept only to cross-check our arithmetic. */
  amountPaise: number | null;

  valid: boolean;
  issues: RowIssue[];
};

const SUMMARY_LABELS = [
  'total', 'totals', 'grandtotal', 'subtotal', 'sum', 'net', 'nettotal',
  'closingbalance', 'balance', 'cgst', 'sgst', 'igst', 'roundoff', 'grand',
];

/** A trailing "TOTAL" line is not a bill. */
function looksLikeSummaryRow(cells: unknown[]): boolean {
  const texts = cells
    .map((c) => normaliseHeader(String(c ?? '')))
    .filter((t) => t.length > 0 && !/^[0-9.]+$/.test(t));
  if (texts.length === 0 || texts.length > 3) return false;
  return texts.some((t) => SUMMARY_LABELS.includes(t));
}

function isBlankRow(cells: unknown[]): boolean {
  return cells.every((c) => c === null || c === undefined || String(c).trim() === '');
}

function cell(row: unknown[], index: number | undefined): unknown {
  if (index === undefined) return '';
  return row[index];
}

function text(row: unknown[], index: number | undefined): string {
  const v = cell(row, index);
  if (v instanceof Date) return v.toISOString();
  return String(v ?? '').trim();
}

export type ParseOptions = {
  map: MonthlyColumnMap;
  /** Applied to rows whose supply-type cell is absent or unrecognised. */
  defaultSupplyType: WithinStateSupply;
};

export type ParsedSheet = {
  rows: MonthlyRow[];
  /** Rows that were skipped as blank or as summary lines. */
  skipped: number;
  issues: RowIssue[];
};

/**
 * Turns the data rows of a sheet into typed rows, recording every problem
 * instead of dropping the row silently.
 */
export function parseMonthlyRows(
  dataRows: { rowNumber: number; cells: unknown[] }[],
  options: ParseOptions,
): ParsedSheet {
  const { map, defaultSupplyType } = options;
  const rows: MonthlyRow[] = [];
  const issues: RowIssue[] = [];
  let skipped = 0;

  for (const { rowNumber, cells } of dataRows) {
    if (isBlankRow(cells) || looksLikeSummaryRow(cells)) {
      skipped++;
      continue;
    }

    const rowIssues: RowIssue[] = [];
    const add = (field: MonthlyField | 'row', message: string, severity: 'error' | 'warning') =>
      rowIssues.push({ rowNumber, field, message, severity });

    // --- date ---
    const dateCell = cell(cells, map.date);
    const { date, warning: dateWarning } = coerceDate(dateCell);
    if (!date) {
      if (String(dateCell ?? '').trim() === '') add('date', 'Date is missing', 'error');
      else add('date', `Date "${String(dateCell).trim()}" could not be read`, 'error');
    } else if (dateWarning) {
      add('date', dateWarning, 'warning');
    }

    // --- customer ---
    const customerName = text(cells, map.customer);
    if (!customerName) add('customer', 'Company name is missing', 'error');

    // --- product ---
    const name = text(cells, map.name);
    if (!name) add('name', 'Product name is missing', 'error');

    // --- hsn ---
    const hsnRaw = text(cells, map.hsnSac).replace(/\s+/g, '');
    let hsnSac: string | null = null;
    if (!hsnRaw) {
      if (map.hsnSac !== undefined) add('hsnSac', 'HSN code is missing', 'warning');
    } else {
      const hsnError = validateHsn(hsnRaw);
      if (hsnError) add('hsnSac', `HSN "${hsnRaw}": ${hsnError}`, 'warning');
      else hsnSac = hsnRaw.replace(/\D/g, '');
    }

    // --- quantity ---
    const qtyRaw = cell(cells, map.qty);
    const qtyNum = coerceNumber(qtyRaw);
    let qtyMilli = 0;
    if (qtyNum === null) {
      if (String(qtyRaw ?? '').trim() === '') add('qty', 'Quantity is missing', 'error');
      else add('qty', `Quantity "${String(qtyRaw).trim()}" is not a number`, 'error');
    } else if (qtyNum <= 0) {
      add('qty', `Quantity must be greater than zero, got ${qtyNum}`, 'error');
    } else {
      qtyMilli = Math.round(qtyNum * 1000);
    }

    // --- rate ---
    const rateRaw = cell(cells, map.rate);
    const rateNum = coerceNumber(rateRaw);
    let ratePaise = 0;
    if (rateNum === null) {
      if (String(rateRaw ?? '').trim() === '') add('rate', 'Rate is missing', 'error');
      else add('rate', `Rate "${String(rateRaw).trim()}" is not a number`, 'error');
    } else if (rateNum < 0) {
      add('rate', `Rate cannot be negative, got ${rateNum}`, 'error');
    } else {
      ratePaise = toPaise(rateNum);
    }

    // --- gst ---
    let gstRate = 18;
    if (map.gstRate !== undefined) {
      const gstRaw = cell(cells, map.gstRate);
      if (String(gstRaw ?? '').trim() === '') {
        add('gstRate', 'GST is missing, used 18%', 'warning');
      } else {
        const coerced = coerceGstRate(gstRaw);
        gstRate = coerced.gstRate;
        if (coerced.warning) add('gstRate', coerced.warning, 'warning');
      }
    }

    // --- unit ---
    const { unit, warning: unitWarning } = coerceUnit(cell(cells, map.unit));
    if (unitWarning) add('unit', unitWarning, 'warning');

    // --- supply type ---
    let supplyType: WithinStateSupply | null = null;
    if (map.supplyType !== undefined) {
      const raw = text(cells, map.supplyType);
      supplyType = coerceSupplyType(raw);
      if (raw && !supplyType) {
        add(
          'supplyType',
          `Supply type "${raw}" was not recognised, used the import default`,
          'warning',
        );
      }
    }

    // --- amount cross-check ---
    let amountPaise: number | null = null;
    if (map.amount !== undefined) {
      const amt = coerceNumber(cell(cells, map.amount));
      if (amt !== null) {
        amountPaise = toPaise(amt);
        const computed = Math.round((qtyMilli * ratePaise) / 1000);
        // A rupee of slack covers the sheet having rounded each line.
        if (amountPaise > 0 && Math.abs(computed - amountPaise) > 100) {
          add(
            'amount',
            `Sheet says ${(amountPaise / 100).toFixed(2)} but quantity x rate is ` +
              `${(computed / 100).toFixed(2)} - the invoice uses quantity x rate`,
            'warning',
          );
        }
      }
    }

    const externalBillNo = map.billNo !== undefined ? text(cells, map.billNo) || null : null;
    const description = map.description !== undefined ? text(cells, map.description) || null : null;

    const valid = !rowIssues.some((i) => i.severity === 'error');
    issues.push(...rowIssues);

    rows.push({
      rowNumber,
      raw: cells,
      date,
      customerName,
      externalBillNo,
      name,
      description,
      hsnSac,
      qtyMilli,
      unit,
      ratePaise,
      gstRate,
      supplyType: supplyType ?? defaultSupplyType,
      amountPaise,
      valid,
      issues: rowIssues,
    });
  }

  return { rows, skipped, issues };
}

// ---------------------------------------------------------------------------
// Duplicate rows
// ---------------------------------------------------------------------------

/**
 * Flags rows that are identical in every imported field.
 *
 * This is reported, never acted on. Two identical rows are usually two real
 * bills for the same thing on the same day, which is exactly the case the
 * grouping rules must not collapse. The warning exists so the user can tell
 * the difference between that and a copy-paste accident.
 */
export function markDuplicateRows(rows: MonthlyRow[]): RowIssue[] {
  const seen = new Map<string, number>();
  const out: RowIssue[] = [];
  for (const r of rows) {
    const key = [
      r.date?.toISOString().slice(0, 10) ?? '',
      r.customerName.toLowerCase(),
      r.externalBillNo ?? '',
      r.name.toLowerCase(),
      r.hsnSac ?? '',
      r.qtyMilli,
      r.ratePaise,
      r.gstRate,
    ].join('|');
    const first = seen.get(key);
    if (first !== undefined) {
      const issue: RowIssue = {
        rowNumber: r.rowNumber,
        field: 'row',
        message: r.externalBillNo
          ? `Identical to row ${first}; both belong to bill ${r.externalBillNo}`
          : `Identical to row ${first}. Kept as a separate bill - change the grouping if these are one bill.`,
        severity: 'warning',
      };
      r.issues.push(issue);
      out.push(issue);
    } else {
      seen.set(key, r.rowNumber);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

export const GROUPING_MODES = ['BILL_NO', 'PER_ROW', 'DATE_CUSTOMER'] as const;
export type GroupingMode = (typeof GROUPING_MODES)[number];

export const GROUPING_LABELS: Record<GroupingMode, string> = {
  BILL_NO: "Use the sheet's own bill / invoice number",
  PER_ROW: 'Treat every row as a separate bill',
  DATE_CUSTOMER: 'Group rows by date and company',
};

export const GROUPING_HINTS: Record<GroupingMode, string> = {
  BILL_NO:
    'Rows sharing a bill number become one invoice with several line items. Rows with no bill number are kept as separate bills.',
  PER_ROW: 'One invoice per row. Nothing is ever combined.',
  DATE_CUSTOMER:
    'Every row for one company on one date becomes a single invoice. Only choose this if the sheet really holds one bill per company per day.',
};

export type Bill = {
  /** What the rows were grouped by. Shown in the audit trail. */
  billKey: string;
  externalBillNo: string | null;
  customerName: string;
  date: Date;
  supplyType: WithinStateSupply;
  rows: MonthlyRow[];
};

function customerKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Groups valid rows into bills.
 *
 * Every mode produces a stable `billKey`, and rows only ever share an invoice
 * when they share that key. Under BILL_NO a row with no bill number falls back
 * to its own row-unique key rather than joining whatever else sits on that
 * date — merging on absence of evidence is the one thing this must not do.
 */
export function groupIntoBills(rows: MonthlyRow[], mode: GroupingMode): Bill[] {
  const order: string[] = [];
  const groups = new Map<string, Bill>();

  for (const row of rows) {
    if (!row.valid || !row.date) continue;

    const cust = customerKey(row.customerName);
    const day = dayKey(row.date);
    let billKey: string;

    if (mode === 'PER_ROW') {
      billKey = `row:${row.rowNumber}`;
    } else if (mode === 'DATE_CUSTOMER') {
      billKey = `dc:${day}|${cust}`;
    } else if (row.externalBillNo) {
      // Scoped by customer and date so the same running number reused by two
      // customers, or in two months, does not collapse into one invoice.
      billKey = `bill:${day}|${cust}|${row.externalBillNo.trim().toLowerCase()}`;
    } else {
      billKey = `row:${row.rowNumber}`;
    }

    const existing = groups.get(billKey);
    if (existing) {
      existing.rows.push(row);
      // A bill is one supply type; the first row with an explicit value wins.
      continue;
    }

    groups.set(billKey, {
      billKey,
      externalBillNo: mode === 'DATE_CUSTOMER' ? null : row.externalBillNo,
      customerName: row.customerName.trim(),
      date: row.date,
      supplyType: row.supplyType ?? 'INTRA_STATE',
      rows: [row],
    });
    order.push(billKey);
  }

  // Oldest first, so the generated sequence runs in date order.
  return order
    .map((k) => groups.get(k)!)
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.billKey.localeCompare(b.billKey));
}

/** Does the sheet actually carry usable bill numbers? */
export function hasBillNumbers(rows: MonthlyRow[]): boolean {
  return rows.some((r) => (r.externalBillNo ?? '').trim() !== '');
}

export function suggestGrouping(rows: MonthlyRow[]): GroupingMode {
  return hasBillNumbers(rows) ? 'BILL_NO' : 'PER_ROW';
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export type ImportSummary = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  skippedRows: number;
  warningRows: number;
  customers: number;
  dates: number;
  bills: number;
  periodMonth: number | null;
  periodYear: number | null;
};

export function summarise(parsed: ParsedSheet, bills: Bill[]): ImportSummary {
  const valid = parsed.rows.filter((r) => r.valid);
  const customers = new Set(valid.map((r) => customerKey(r.customerName)));
  const dates = new Set(valid.filter((r) => r.date).map((r) => dayKey(r.date!)));

  // The period is whichever month most of the rows fall in.
  const monthTally = new Map<string, number>();
  for (const r of valid) {
    if (!r.date) continue;
    const k = `${r.date.getFullYear()}-${r.date.getMonth() + 1}`;
    monthTally.set(k, (monthTally.get(k) ?? 0) + 1);
  }
  let period: { month: number; year: number } | null = null;
  let bestCount = 0;
  for (const [k, count] of monthTally) {
    if (count > bestCount) {
      const [y, m] = k.split('-').map(Number);
      period = { month: m, year: y };
      bestCount = count;
    }
  }

  return {
    totalRows: parsed.rows.length + parsed.skipped,
    validRows: valid.length,
    errorRows: parsed.rows.length - valid.length,
    skippedRows: parsed.skipped,
    warningRows: parsed.rows.filter(
      (r) => r.valid && r.issues.some((i) => i.severity === 'warning'),
    ).length,
    customers: customers.size,
    dates: dates.size,
    bills: bills.length,
    periodMonth: period?.month ?? null,
    periodYear: period?.year ?? null,
  };
}

/** Date-and-company rollup for the preview screen. */
export type PreviewGroup = {
  date: string;
  customerName: string;
  bills: number;
  lines: number;
  totalPaise: number;
};

export function previewGroups(bills: Bill[]): PreviewGroup[] {
  const out = new Map<string, PreviewGroup>();
  for (const bill of bills) {
    const key = `${dayKey(bill.date)}|${customerKey(bill.customerName)}`;
    const entry = out.get(key) ?? {
      date: dayKey(bill.date),
      customerName: bill.customerName,
      bills: 0,
      lines: 0,
      totalPaise: 0,
    };
    entry.bills += 1;
    entry.lines += bill.rows.length;
    for (const r of bill.rows) {
      entry.totalPaise += Math.round((r.qtyMilli * r.ratePaise) / 1000);
    }
    out.set(key, entry);
  }
  return [...out.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.customerName.localeCompare(b.customerName),
  );
}
