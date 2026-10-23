/**
 * Every fixed word printed on a bill, as a per-company override map.
 *
 * Stored on Company as JSON and copied into the invoice snapshot, so changing a
 * label later never rewrites the wording of a bill that has already been issued.
 * An empty or missing entry falls back to the default below.
 */

export const DEFAULT_LABELS = {
  // block headings
  buyerBlock: 'BUYER',
  shipBlock: 'SHIP TO',
  bankBlock: 'BANK DETAILS',
  orderBlock: 'ORDER DETAILS',
  hsnBlock: 'HSN / SAC WISE TAX SUMMARY',
  notesBlock: 'NOTES',
  termsBlock: 'TERMS & CONDITIONS',

  // document meta rows
  dueDate: 'Due Date',
  panNo: 'PAN No.',
  gstinNo: 'GSTIN No.',
  status: 'Status',
  agreementNo: 'Agreement No',
  workOrderDate: 'Work Order Date',
  placeOfSupply: 'Place of Supply',
  supplyType: 'Supply Type',
  reverseCharge: 'Reverse Charge',
  intraState: 'Intra-State',
  interState: 'Inter-State',
  yes: 'Yes',
  no: 'No',

  // buyer block rows
  buyerGstin: 'GSTIN No.',
  buyerState: 'State',
  buyerPhone: 'Mobile No.',
  unregistered: 'Unregistered',

  // bank block rows
  bankAcName: 'A/c Name',
  bankNameRow: 'Bank Name -',
  bankAcNo: 'A/c No.',
  bankIfscRow: 'IFSC Code -',
  bankTypeRow: 'Account Type -',
  bankBranchRow: 'Branch -',
  bankUpiRow: 'UPI -',
  scanToPay: 'Scan to pay',

  // item table headers
  colSn: 'S. No.',
  colDesc: 'Description',
  colHsn: 'HSN/SAC',
  colQty: 'Qty',
  colUnit: 'Unit',
  colRate: 'Rate',
  colAmount: 'Amount Rs.',
  lineDiscount: 'Less discount',

  // hsn summary headers
  hsnColCode: 'HSN',
  hsnColRate: 'Rate',
  hsnColTaxable: 'Taxable',

  // totals
  totalBasic: 'Basic Total',
  totalTaxable: 'Taxable Value',
  totalRoundOff: 'Round Off',
  totalGrand: 'Total Amount',
  totalReceived: 'Received',
  totalBalance: 'Balance Due',

  // footer
  amountInWords: 'Amount in words:',
  thanks: 'Thank You',
  forCompany: 'For',
  signatory: 'Authorised Signatory',
  computerGenerated: 'This is a computer-generated document.',
  page: 'Page',
} as const;

export type LabelKey = keyof typeof DEFAULT_LABELS;
export type Labels = Record<LabelKey, string>;

/** Grouped for the settings form so 60-odd inputs stay navigable. */
export const LABEL_GROUPS: { title: string; keys: LabelKey[] }[] = [
  {
    title: 'Block headings',
    keys: ['buyerBlock', 'shipBlock', 'bankBlock', 'orderBlock', 'hsnBlock', 'notesBlock', 'termsBlock'],
  },
  {
    title: 'Document details',
    keys: [
      'dueDate', 'panNo', 'gstinNo', 'status', 'agreementNo', 'workOrderDate',
      'placeOfSupply', 'supplyType', 'reverseCharge', 'intraState', 'interState', 'yes', 'no',
    ],
  },
  {
    title: 'Buyer block',
    keys: ['buyerGstin', 'buyerState', 'buyerPhone', 'unregistered'],
  },
  {
    title: 'Bank block',
    keys: [
      'bankAcName', 'bankNameRow', 'bankAcNo', 'bankIfscRow',
      'bankTypeRow', 'bankBranchRow', 'bankUpiRow', 'scanToPay',
    ],
  },
  {
    title: 'Item table',
    keys: ['colSn', 'colDesc', 'colHsn', 'colQty', 'colUnit', 'colRate', 'colAmount', 'lineDiscount'],
  },
  {
    title: 'Tax summary',
    keys: ['hsnColCode', 'hsnColRate', 'hsnColTaxable'],
  },
  {
    title: 'Totals',
    keys: ['totalBasic', 'totalTaxable', 'totalRoundOff', 'totalGrand', 'totalReceived', 'totalBalance'],
  },
  {
    title: 'Footer',
    keys: ['amountInWords', 'thanks', 'forCompany', 'signatory', 'computerGenerated', 'page'],
  },
];

const KEYS = Object.keys(DEFAULT_LABELS) as LabelKey[];

/** Merges stored overrides over the defaults. Unknown keys and blanks are dropped. */
export function resolveLabels(stored?: string | null): Labels {
  const out = { ...DEFAULT_LABELS } as Labels;
  if (!stored) return out;
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    for (const key of KEYS) {
      const v = parsed[key];
      if (typeof v === 'string' && v.trim() !== '') out[key] = v;
    }
  } catch {
    /* corrupt JSON just falls back to the defaults */
  }
  return out;
}

/** Keeps only the entries that actually differ, so the column stays small. */
export function serialiseLabels(values: Partial<Record<LabelKey, string>>): string | null {
  const diff: Record<string, string> = {};
  for (const key of KEYS) {
    const v = (values[key] ?? '').trim();
    if (v && v !== DEFAULT_LABELS[key]) diff[key] = v;
  }
  return Object.keys(diff).length === 0 ? null : JSON.stringify(diff);
}
