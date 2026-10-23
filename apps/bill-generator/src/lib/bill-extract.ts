/**
 * Pulls the *document* fields out of a spreadsheet that holds a whole printed
 * bill — invoice number, dates, buyer block, order references and the tender
 * rebate — so an imported sheet lands in the form as a complete draft rather
 * than just a list of items.
 *
 * Everything is heuristic and advisory: the importer reports what it found and
 * the user edits it before issuing.
 */
import { GSTIN_REGEX } from './validate';
import { STATES, stateByCode, stateByName } from './states';
import { normaliseHeader } from './import-mapping';

export type ExtractedBuyer = {
  name: string | null;
  attention: string | null;
  addressLines: string[];
  gstin: string | null;
  stateCode: string | null;
  stateName: string | null;
  pincode: string | null;
  city: string | null;
  phone: string | null;
};

export type ExtractedBill = {
  originalNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  agreementNo: string | null;
  workOrderDate: string | null;
  rebateLabel: string | null;
  rebatePercent: string | null;
  sellerGstin: string | null;
  buyer: ExtractedBuyer;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

const LABELS = {
  invoiceNo: ['invoiceno', 'invoicenumber', 'billno', 'billnumber', 'invno', 'documentno', 'voucherno'],
  invoiceDate: ['date', 'invoicedate', 'billdate', 'dated', 'documentdate'],
  dueDate: ['duedate', 'paymentdue', 'dueon'],
  pan: ['panno', 'pan', 'pannumber'],
  gstin: ['gstinno', 'gstin', 'gstno', 'gstnumber', 'gstinnumber'],
  cin: ['cinno', 'cin'],
  agreement: ['agreementno', 'agreement', 'workorderno', 'orderno', 'pono', 'purchaseorderno', 'ponumber', 'wono'],
  workOrderDate: ['workorderdate', 'orderdate', 'podate', 'agreementdate', 'wodate'],
  service: ['typesofservices', 'typeofservice', 'typesofservice', 'natureofwork', 'servicedescription', 'services', 'particularsofwork', 'descriptionofservice', 'subject'],
  buyer: ['buyer', 'billto', 'buyername', 'buyersname', 'buyerdetails', 'buyersdetails', 'customer', 'customername', 'consignee', 'to'],
  placeOfSupply: ['placeofsupply', 'pos'],
  rebate: ['below', 'less', 'rebate', 'deduction', 'abatement', 'tenderrebate'],
  /** Never a value — only ever marks the start of another block. */
  stop: [
    'bankdetails', 'bankdetail', 'bank', 'bankname', 'acname', 'accountname', 'acno',
    'accountno', 'accountnumber', 'ifsc', 'ifsccode', 'branch', 'accounttype',
    'termsandconditions', 'terms', 'declaration', 'notes', 'remarks', 'forqueries',
    'amountinwords', 'basictotal', 'grandtotal', 'totalamount', 'sno', 'srno',
  ],
} as const;

type LabelKey = keyof typeof LABELS;

const ALL_LABELS = new Set<string>(Object.values(LABELS).flat() as string[]);

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Strips the trailing ":" / "-" that labels usually carry. */
function labelKey(raw: string): string {
  return normaliseHeader(raw.replace(/[:\-–—=]+\s*$/, ''));
}

function matchesLabel(raw: string, key: LabelKey): boolean {
  const k = labelKey(raw);
  if (!k) return false;
  return (LABELS[key] as readonly string[]).some((a) => k === a || k.startsWith(a));
}

function isAnyLabel(raw: string): boolean {
  const k = labelKey(raw);
  if (!k) return false;
  return [...ALL_LABELS].some((a) => k === a || k.startsWith(a));
}

/**
 * The value belonging to a label: the first useful cell to its right, else the
 * cell directly below. Merged cells repeat their text, so copies of the label
 * itself are skipped.
 */
function valueFor(grid: unknown[][], r: number, c: number): string {
  const label = cellText(grid[r]?.[c]);
  const row = grid[r] ?? [];
  for (let i = c + 1; i < row.length; i++) {
    const t = cellText(row[i]);
    if (!t || t === label) continue;
    if (isAnyLabel(t)) break;
    return stripLeadIn(t);
  }
  const below = cellText(grid[r + 1]?.[c]);
  if (below && below !== label && !isAnyLabel(below)) return stripLeadIn(below);
  return '';
}

/** Printed bills separate a label from its value with ":" or "-". */
function stripLeadIn(value: string): string {
  return value.replace(/^\s*[:\-–—]\s*/, '').trim();
}

/** Finds the first cell matching a label and returns its value. */
function findValue(grid: unknown[][], key: LabelKey): { value: string; row: number; col: number } | null {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const t = cellText(row[c]);
      if (!t || !matchesLabel(t, key)) continue;
      const value = valueFor(grid, r, c);
      if (value) return { value, row: r, col: c };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// value coercion
// ---------------------------------------------------------------------------

/** Indian bills are dd/mm/yyyy. Returns yyyy-mm-dd. */
export function parseSheetDate(raw: unknown): { iso: string | null; ambiguous: boolean } {
  if (raw === null || raw === undefined || raw === '') return { iso: null, ambiguous: false };

  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { iso: raw.toISOString().slice(0, 10), ambiguous: false };
  }

  const text = String(raw).trim();

  // yyyy-mm-dd or yyyy/mm/dd
  let m = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const [, y, mo, d] = m;
    return { iso: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, ambiguous: false };
  }

  // dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (d > 31 || mo > 12) return { iso: null, ambiguous: false };
    return {
      iso: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      // Both readings are valid when neither part exceeds 12.
      ambiguous: d <= 12 && mo <= 12 && d !== mo,
    };
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return { iso: parsed.toISOString().slice(0, 10), ambiguous: false };
  }
  return { iso: null, ambiguous: false };
}

function numberFrom(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const t = String(raw ?? '').replace(/[₹$,%\s]/g, '');
  if (!t || !/[0-9]/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Every GSTIN appearing anywhere in the sheet, in reading order. */
function findGstins(grid: unknown[][]): string[] {
  const found: string[] = [];
  for (const row of grid) {
    for (const cell of row ?? []) {
      const text = cellText(cell).toUpperCase();
      if (!text) continue;
      for (const token of text.split(/[^0-9A-Z]+/)) {
        if (token.length === 15 && GSTIN_REGEX.test(token) && !found.includes(token)) {
          found.push(token);
        }
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// buyer block
// ---------------------------------------------------------------------------

const ATTENTION = /^(the\s|kind\s*attn|kind\s*attention|attn|att\b|to\s*[,:]?$|m\/s\.?\s*$)/i;

function extractBuyer(grid: unknown[][], headerRow: number, gstins: string[], sellerGstin: string | null): ExtractedBuyer {
  const empty: ExtractedBuyer = {
    name: null, attention: null, addressLines: [], gstin: null,
    stateCode: null, stateName: null, pincode: null, city: null, phone: null,
  };

  // Locate the "Buyer" / "Bill To" label above the item table.
  let anchor: { r: number; c: number } | null = null;
  for (let r = 0; r < Math.min(grid.length, headerRow); r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const t = cellText(row[c]);
      if (t && matchesLabel(t, 'buyer')) {
        anchor = { r, c };
        break;
      }
    }
    if (anchor) break;
  }
  if (!anchor) return empty;

  const anchorText = cellText(grid[anchor.r][anchor.c]);

  // Collect the lines below the label, stopping at a blank line, another block's
  // heading, or the PIN code that normally ends a postal address.
  // A PDF interleaves the left and right columns, so the buyer's own lines are
  // separated by rows that only hold right-hand content. Tolerate a short gap
  // rather than stopping at the first one; two in a row really is the end.
  const lines: string[] = [];
  let gap = 0;
  for (let r = anchor.r + 1; r < Math.min(grid.length, headerRow); r++) {
    const t = cellText(grid[r]?.[anchor.c]);
    if (!t || t === anchorText) {
      if (lines.length > 0 && ++gap >= 2) break;
      continue;
    }
    gap = 0;
    if (isAnyLabel(t)) break;
    if (!lines.includes(t)) lines.push(t);
    if (/\b[1-9]\d{5}\b/.test(t)) break; // address complete
    if (lines.length >= 6) break;
  }
  if (lines.length === 0) return empty;

  let attention: string | null = null;
  let rest = [...lines];
  if (ATTENTION.test(rest[0]) && rest.length > 1) {
    attention = rest[0];
    rest = rest.slice(1);
  }

  const name = rest[0] ?? null;
  const addressLines = rest.slice(1);
  const joined = rest.join(' ');

  const pin = joined.match(/\b([1-9]\d{5})\b/);
  const phone = joined.match(/\b((?:\+91[\s-]?)?[6-9]\d{9})\b/);

  // Buyer GSTIN: any GSTIN in the sheet that is not the seller's.
  const buyerGstin = gstins.find((g) => g !== sellerGstin) ?? null;

  // State: from the GSTIN if present, otherwise a state name in the address.
  let stateCode: string | null = buyerGstin ? buyerGstin.slice(0, 2) : null;
  let stateName = stateCode ? (stateByCode(stateCode)?.name ?? null) : null;
  if (!stateCode) {
    const hit = STATES.find((st) => new RegExp(`\\b${st.name}\\b`, 'i').test(joined));
    if (hit) {
      stateCode = hit.code;
      stateName = hit.name;
    } else if (/\bM\.?\s?P\.?\b/i.test(joined)) {
      stateCode = '23';
      stateName = 'Madhya Pradesh';
    }
  }

  // City: the last address part that is not the PIN, a state, or a "(M.P.)" aside.
  let city: string | null = null;
  const cityLine = rest.find((l) => /[1-9]\d{5}/.test(l)) ?? rest[rest.length - 1] ?? '';
  const parts = cityLine
    .replace(/\b[1-9]\d{5}\b/g, '')
    .replace(/\([^)]*\)/g, '') // drop "(M.P.)"
    .split(/[,\-–]/)
    .map((p) => p.replace(/[^\p{L}\p{N}\s.&]/gu, '').trim())
    .filter(
      (p) =>
        p.length > 1 &&
        !/^\d+$/.test(p) &&
        !stateByName(p) &&
        !/^[a-z]\.?\s?[a-z]\.?$/i.test(p), // bare initials like "M.P"
    );
  if (parts.length > 0) city = parts[parts.length - 1];

  return {
    name: name ? name.replace(/\.$/, '') : null,
    attention,
    addressLines,
    gstin: buyerGstin,
    stateCode,
    stateName,
    pincode: pin ? pin[1] : null,
    city,
    phone: phone ? phone[1] : null,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function extractBill(
  grid: unknown[][],
  headerRow: number,
  companyGstin: string | null,
): ExtractedBill {
  const warnings: string[] = [];
  const gstins = findGstins(grid);
  const sellerGstin =
    (companyGstin && gstins.find((g) => g === companyGstin.toUpperCase())) ?? gstins[0] ?? null;

  const take = (key: LabelKey) => findValue(grid, key)?.value ?? null;

  const rawInvoiceDate = take('invoiceDate');
  const invoice = parseSheetDate(rawInvoiceDate);
  if (invoice.ambiguous) {
    warnings.push(
      `Invoice date "${rawInvoiceDate}" could be read either way — taken as day/month (${invoice.iso}).`,
    );
  }

  const rawWorkOrderDate = take('workOrderDate');
  const workOrder = parseSheetDate(rawWorkOrderDate);
  if (workOrder.ambiguous) {
    warnings.push(
      `Work order date "${rawWorkOrderDate}" could be read either way — taken as day/month (${workOrder.iso}).`,
    );
  }

  const due = parseSheetDate(take('dueDate'));

  // Rebate: a "Below" / "Less" label carrying a percentage. A spreadsheet keeps
  // the rate in its own cell ("Below" | 21.01); a printed bill folds it into the
  // label ("Below 21.01%"), so check the label text first.
  let rebateLabel: string | null = null;
  let rebatePercent: string | null = null;
  outer: for (let r = headerRow; r < grid.length; r++) {
    const row = grid[r] ?? [];
    for (let c = 0; c < row.length; c++) {
      const t = cellText(row[c]);
      if (!t || !matchesLabel(t, 'rebate')) continue;

      const inLabel = t.match(/(\d+(?:\.\d+)?)\s*%/);
      if (inLabel) {
        const pct = Number(inLabel[1]);
        if (pct > 0 && pct <= 100) {
          rebateLabel = t.slice(0, inLabel.index).replace(/[:\-–—]+\s*$/, '').trim() || 'Below';
          rebatePercent = String(Math.round(pct * 100) / 100);
          break outer;
        }
      }

      for (let i = c + 1; i < row.length; i++) {
        const n = numberFrom(row[i]);
        if (n === null) continue;
        // A percentage, not the resulting amount.
        const pct = n > 0 && n <= 1 ? n * 100 : n;
        if (pct > 0 && pct <= 100) {
          rebateLabel = t.replace(/[:\-–—]+\s*$/, '').trim();
          rebatePercent = String(Math.round(pct * 100) / 100);
          break outer;
        }
      }
    }
  }

  const buyer = extractBuyer(grid, headerRow, gstins, sellerGstin);
  if (!buyer.name) warnings.push('No buyer block found — pick the customer by hand.');
  if (!invoice.iso) warnings.push('No invoice date found — today’s date will be used.');

  return {
    // A reprinted draft shows a placeholder where its number will go.
    originalNumber: (() => {
      const v = take('invoiceNo');
      return v && /\b(draft|unissued|not\s*issued|n\.?\/?a)\b/i.test(v) ? null : v;
    })(),
    invoiceDate: invoice.iso,
    dueDate: due.iso,
    agreementNo: take('agreement'),
    workOrderDate: workOrder.iso,
    rebateLabel,
    rebatePercent,
    sellerGstin,
    buyer,
    warnings,
  };
}

/** Loose name match so "INDORE Development Authority." finds the saved customer. */
export function matchCustomer(
  name: string | null,
  customers: { id: string; name: string }[],
): string | null {
  if (!name) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(name);
  if (!target) return null;

  const exact = customers.find((c) => norm(c.name) === target);
  if (exact) return exact.id;

  const contains = customers.find(
    (c) => norm(c.name).includes(target) || target.includes(norm(c.name)),
  );
  return contains?.id ?? null;
}
