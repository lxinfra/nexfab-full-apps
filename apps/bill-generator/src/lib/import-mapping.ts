import { GST_RATES, UNITS } from './constants';
import { paiseToInput, toPaise } from './money';

/** The line fields an imported sheet can fill. */
export type ImportField =
  | 'name'
  | 'description'
  | 'hsnSac'
  | 'qty'
  | 'unit'
  | 'rate'
  | 'discountValue'
  | 'discountType'
  | 'gstRate';

/** Header spellings we accept, normalised to lowercase with no punctuation. */
const HEADER_ALIASES: Record<ImportField, string[]> = {
  name: [
    'item', 'items', 'itemname', 'item name', 'name', 'product', 'productname',
    'description', 'descriptionofgoods', 'description of goods', 'goods',
    'particulars', 'particular', 'service', 'details', 'itemdescription',
  ],
  description: [
    'itemdescription', 'subdescription', 'remarks', 'remark', 'note', 'notes',
    'specification', 'specifications', 'longdescription',
  ],
  hsnSac: ['hsn', 'sac', 'hsnsac', 'hsn sac', 'hsncode', 'saccode', 'hsnno', 'hsn/sac'],
  // 'month'/'no' sit last: they only win when there is no proper Qty column,
  // which is how service bills ("Rate x Months") are usually laid out.
  qty: ['qty', 'quantity', 'qnty', 'nos', 'count', 'pcs', 'months', 'month', 'no'],
  unit: ['unit', 'units', 'uom', 'u o m', 'measure', 'unitofmeasure', 'per'],
  rate: ['rate', 'price', 'unitprice', 'unit price', 'rateperunit', 'mrp', 'cost', 'unitrate'],
  discountValue: ['discount', 'disc', 'discountvalue', 'discountamount', 'discountpercent', 'discount%', 'disc%'],
  discountType: ['discounttype', 'disctype'],
  gstRate: ['gst', 'gstrate', 'gst%', 'gstpercent', 'tax', 'taxrate', 'tax%', 'igst', 'cgstsgst', 'gstslab'],
};

/**
 * Columns that exist in bills but are recalculated, so importing them is
 * pointless. Matched as prefixes, so "Amount Rs." and "Total Amount" are caught.
 */
const IGNORED_HEADERS = [
  'sr', 'srno', 'sno', 'serial', 'serialno', '#', 'slno', 'sl',
  'amount', 'total', 'taxable', 'netamount', 'grandtotal', 'basictotal',
  'cgst', 'sgst', 'igst', 'taxamount', 'roundoff',
];

function isIgnoredHeader(key: string): boolean {
  return IGNORED_HEADERS.some((ig) => key === ig || key.startsWith(ig));
}

export function normaliseHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s._\-()/\\]+/g, '')
    .replace(/[^a-z0-9%#]/g, '')
    .trim();
}

/** A "Discount %" header means percent even though it maps to discountValue. */
function headerImpliesPercent(raw: string): boolean {
  const n = normaliseHeader(raw);
  return n.includes('%') || n.includes('percent') || n.includes('pct');
}

export type ColumnMap = Partial<Record<ImportField, number>>;

export type DetectResult = {
  map: ColumnMap;
  /** Original header text keyed by field, for showing the user what matched. */
  matched: Partial<Record<ImportField, string>>;
  ignored: string[];
  unrecognised: string[];
  discountIsPercent: boolean;
  /** Every column index the header row used, mapped or not. */
  headerCols: number[];
};

/**
 * Lines up a data row with the header.
 *
 * In a spreadsheet a value sits exactly under its header. In a PDF there are no
 * columns at all — the grid is rebuilt from glyph positions, so a right-aligned
 * number starts a column or two off from its header. Assigning each cell to the
 * *nearest* header column absorbs that drift and is exact for spreadsheets.
 * Ties go to the earlier column, which is where a right-aligned value belongs.
 */
export function alignToHeader(row: unknown[], headerCols: number[]): Map<number, string> {
  const out = new Map<number, string>();
  if (headerCols.length === 0) return out;

  for (let i = 0; i < row.length; i++) {
    const text = String(row[i] ?? '').trim();
    if (!text) continue;

    let best = headerCols[0];
    let bestGap = Math.abs(headerCols[0] - i);
    for (const col of headerCols) {
      const gap = Math.abs(col - i);
      if (gap < bestGap) {
        bestGap = gap;
        best = col;
      }
    }
    const existing = out.get(best);
    out.set(best, existing ? `${existing} ${text}` : text);
  }
  return out;
}

/** Lower score is a better match: exact alias beats partial, earlier alias wins. */
function scoreHeader(key: string, aliases: string[]): number | null {
  for (let i = 0; i < aliases.length; i++) {
    if (normaliseHeader(aliases[i]) === key) return i; // exact
  }
  for (let i = 0; i < aliases.length; i++) {
    const a = normaliseHeader(aliases[i]);
    if (a.length >= 3 && key.includes(a)) return 1000 + i; // partial
  }
  return null;
}

/**
 * Works out which spreadsheet column feeds which invoice field.
 *
 * Resolved field-first rather than column-first, so a proper "Qty" column always
 * beats a fallback alias like "Month" no matter which comes first in the sheet.
 */
export function detectColumns(headers: string[]): DetectResult {
  const map: ColumnMap = {};
  const matched: Partial<Record<ImportField, string>> = {};
  const ignored: string[] = [];
  let discountIsPercent = false;

  const candidates = headers.map((raw, index) => {
    const header = (raw ?? '').toString().trim();
    return { index, header, key: normaliseHeader(header) };
  });

  const usable: typeof candidates = [];
  for (const c of candidates) {
    if (!c.key) continue;
    if (isIgnoredHeader(c.key)) {
      ignored.push(c.header);
      continue;
    }
    usable.push(c);
  }

  // Every (field, column) pair that matches at all, best matches first.
  const pairs: { field: ImportField; index: number; header: string; score: number }[] = [];
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ImportField, string[]][]) {
    for (const c of usable) {
      const score = scoreHeader(c.key, aliases);
      if (score !== null) pairs.push({ field, index: c.index, header: c.header, score });
    }
  }
  pairs.sort((a, b) => a.score - b.score || a.index - b.index);

  const takenFields = new Set<ImportField>();
  const takenColumns = new Set<number>();
  for (const p of pairs) {
    if (takenFields.has(p.field) || takenColumns.has(p.index)) continue;
    map[p.field] = p.index;
    matched[p.field] = p.header;
    takenFields.add(p.field);
    takenColumns.add(p.index);
    if (p.field === 'discountValue' && headerImpliesPercent(p.header)) discountIsPercent = true;
  }

  const unrecognised = usable.filter((c) => !takenColumns.has(c.index)).map((c) => c.header);
  const headerCols = candidates.filter((c) => c.key).map((c) => c.index);

  return { map, matched, ignored, unrecognised, discountIsPercent, headerCols };
}

/** How many invoice fields a row of headers would fill - used to find the header row. */
export function headerScore(cells: unknown[]): number {
  const headers = cells.map((c) => String(c ?? ''));
  // Merged cells repeat the same text across columns; count each value once.
  const distinct = new Set(headers.map((h) => h.trim()).filter(Boolean));
  if (distinct.size < 2) return 0;
  const detect = detectColumns(headers);
  const fields = Object.keys(detect.map) as ImportField[];
  const core = fields.filter((f) => f === 'name' || f === 'qty' || f === 'rate').length;
  return core === 0 ? 0 : fields.length + core;
}

// ---------------------------------------------------------------------------
// value coercion
// ---------------------------------------------------------------------------

const UNIT_SYNONYMS: Record<string, string> = {
  piece: 'PCS', pieces: 'PCS', pc: 'PCS', pcs: 'PCS', no: 'NOS', nos: 'NOS',
  number: 'NOS', numbers: 'NOS', unit: 'NOS', units: 'NOS', each: 'NOS', ea: 'NOS',
  kg: 'KG', kgs: 'KG', kilo: 'KG', kilos: 'KG', kilogram: 'KG', kilograms: 'KG',
  g: 'GM', gm: 'GM', gms: 'GM', gram: 'GM', grams: 'GM',
  ton: 'TON', tons: 'TON', tonne: 'TON', mt: 'TON', quintal: 'QTL', qtl: 'QTL',
  m: 'MTR', mtr: 'MTR', mtrs: 'MTR', meter: 'MTR', meters: 'MTR', metre: 'MTR', metres: 'MTR',
  cm: 'CM', ft: 'FT', feet: 'FT', foot: 'FT', sqft: 'SQF', sqf: 'SQF', sqm: 'SQM',
  l: 'LTR', ltr: 'LTR', ltrs: 'LTR', litre: 'LTR', litres: 'LTR', liter: 'LTR', liters: 'LTR',
  ml: 'ML', box: 'BOX', boxes: 'BOX', bag: 'BAG', bags: 'BAG', bundle: 'BDL', bdl: 'BDL',
  set: 'SET', sets: 'SET', pair: 'PAIR', pairs: 'PAIR', dozen: 'DOZ', doz: 'DOZ',
  roll: 'ROLL', rolls: 'ROLL',
  hr: 'HRS', hrs: 'HRS', hour: 'HRS', hours: 'HRS',
  day: 'DAY', days: 'DAY', month: 'MONTH', months: 'MONTH', job: 'JOB', lot: 'JOB',
};

export function coerceUnit(raw: unknown): { unit: string; warning?: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { unit: 'PCS' };
  const upper = text.toUpperCase();
  if ((UNITS as readonly string[]).includes(upper)) return { unit: upper };
  const mapped = UNIT_SYNONYMS[text.toLowerCase().replace(/[.\s]/g, '')];
  if (mapped) return { unit: mapped };
  return { unit: 'OTH', warning: `unit "${text}" is not a known code, set to OTH` };
}

/** Pulls a number out of "1,250.50", "₹1250", "18%", or a real number cell. */
export function coerceNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const text = String(raw).replace(/[₹$,\s]/g, '').replace(/%$/, '');
  if (!text || !/[0-9]/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** 18 | "18%" | 0.18 all mean 18%. Snaps to the nearest legal GST slab. */
export function coerceGstRate(raw: unknown): { gstRate: number; warning?: string } {
  const n = coerceNumber(raw);
  if (n === null) return { gstRate: 18 };
  let value = n;
  if (value > 0 && value <= 1) value = value * 100; // 0.18 -> 18
  const rounded = Math.round(value * 100) / 100;
  if ((GST_RATES as readonly number[]).includes(rounded)) return { gstRate: rounded };
  const nearest = GST_RATES.reduce((best, r) =>
    Math.abs(r - rounded) < Math.abs(best - rounded) ? r : best,
  );
  return {
    gstRate: nearest,
    warning: `GST ${rounded}% is not a standard slab, used ${nearest}%`,
  };
}

export type ParsedRow = {
  /** 1-based row number in the sheet, for error messages */
  sheetRow: number;
  name: string;
  description: string;
  hsnSac: string;
  unit: string;
  qty: string;
  rate: string;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: string;
  gstRate: number;
  warnings: string[];
};

/** Labels that mark a footer/summary line rather than a real item. */
const SUMMARY_LABELS =
  /^(sub\s*-?\s*total|grand\s*total|net\s*total|total(\s+(amount|value|qty|quantity))?|amount\s+in\s+words|round\s*(ed)?\s*off|cgst|sgst|igst|gst|tax|taxable\s+value|freight\s*total|discount|balance|advance|less|add)\b[\s:.-]*$/i;

function isSummaryLabel(name: string): boolean {
  return SUMMARY_LABELS.test(name.trim());
}

export type ProductMatch = {
  id: string;
  name: string;
  hsnSac: string | null;
  unit: string;
  ratePaise: number;
  gstRate: number;
};

/** Turns one spreadsheet row into an editable line, filling gaps from the catalogue. */
export function buildRow(
  cells: unknown[],
  detect: DetectResult,
  sheetRow: number,
  products: ProductMatch[],
): ParsedRow | null {
  const aligned = alignToHeader(cells, detect.headerCols);
  const at = (f: ImportField) => {
    const i = detect.map[f];
    return i === undefined ? undefined : aligned.get(i);
  };

  const name = String(at('name') ?? '').trim();
  const qtyNum = coerceNumber(at('qty'));
  const rateNum = coerceNumber(at('rate'));

  // No description means it cannot be a line item. This is what drops the
  // "Below", "CGST 9%" and "Total Amount" rows that sit under a bill's table.
  if (!name) return null;

  // Sheets usually end with a "Total" line. Drop it, but only when it carries no
  // quantity or rate of its own - a real product called "Total Station" stays.
  if (qtyNum === null && (rateNum === null || rateNum === 0) && isSummaryLabel(name)) {
    return null;
  }

  const warnings: string[] = [];

  const match = products.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());

  // A label with neither quantity nor rate is a section heading, not an item -
  // unless the catalogue can supply the missing numbers.
  if (qtyNum === null && rateNum === null && !match) return null;

  let hsnSac = String(at('hsnSac') ?? '').trim().replace(/\D/g, '');
  if (!hsnSac && match?.hsnSac) hsnSac = match.hsnSac;

  const rawUnit = at('unit');
  let unit: string;
  if (rawUnit === undefined || String(rawUnit).trim() === '') {
    unit = match?.unit ?? 'PCS';
  } else {
    const u = coerceUnit(rawUnit);
    unit = u.unit;
    if (u.warning) warnings.push(u.warning);
  }

  let ratePaise: number;
  if (rateNum === null) {
    ratePaise = match?.ratePaise ?? 0;
    if (!match) warnings.push('no rate found, set to 0');
  } else {
    ratePaise = toPaise(rateNum);
  }

  const rawGst = at('gstRate');
  let gstRate: number;
  if (rawGst === undefined || String(rawGst).trim() === '') {
    gstRate = match?.gstRate ?? 18;
  } else {
    const g = coerceGstRate(rawGst);
    gstRate = g.gstRate;
    if (g.warning) warnings.push(g.warning);
  }

  // Discount type comes from an explicit column, a "%" in the cell, or the header.
  const rawDiscount = at('discountValue');
  const discountText = String(rawDiscount ?? '').trim();
  const typeText = String(at('discountType') ?? '').trim().toLowerCase();
  let discountType: 'PERCENT' | 'AMOUNT' = 'PERCENT';
  if (typeText) {
    discountType = /amount|rs|inr|flat|₹/.test(typeText) ? 'AMOUNT' : 'PERCENT';
  } else if (discountText.includes('%')) {
    discountType = 'PERCENT';
  } else if (discountText && !detect.discountIsPercent) {
    discountType = 'AMOUNT';
  }
  const discountNum = coerceNumber(rawDiscount) ?? 0;

  if (qtyNum === null) warnings.push('no quantity found, set to 1');

  return {
    sheetRow,
    name: name || 'Untitled item',
    description: String(at('description') ?? '').trim(),
    hsnSac,
    unit,
    qty: String(qtyNum ?? 1),
    rate: paiseToInput(ratePaise),
    discountType,
    discountValue:
      discountType === 'AMOUNT' ? paiseToInput(toPaise(discountNum)) : String(discountNum),
    gstRate,
    warnings,
  };
}

/** Columns the user must supply for an import to be worth anything. */
export function missingRequired(detect: DetectResult): ImportField[] {
  const required: ImportField[] = ['name', 'qty', 'rate'];
  return required.filter((f) => detect.map[f] === undefined);
}
