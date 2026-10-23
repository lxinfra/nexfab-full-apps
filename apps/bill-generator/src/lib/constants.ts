export const DOC_TYPES = ['TAX_INVOICE', 'PROFORMA', 'QUOTATION', 'DELIVERY_CHALLAN'] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_LABELS: Record<DocType, string> = {
  TAX_INVOICE: 'Tax Invoice',
  PROFORMA: 'Proforma Invoice',
  QUOTATION: 'Quotation',
  DELIVERY_CHALLAN: 'Delivery Challan',
};

/** Title printed on the PDF. */
export const DOC_TITLES: Record<DocType, string> = {
  TAX_INVOICE: 'TAX INVOICE',
  PROFORMA: 'PROFORMA INVOICE',
  QUOTATION: 'QUOTATION',
  DELIVERY_CHALLAN: 'DELIVERY CHALLAN',
};

/** Extra token inserted into the number so each series stays separate. */
export const DOC_SERIES: Record<DocType, string> = {
  TAX_INVOICE: '',
  PROFORMA: 'PI',
  QUOTATION: 'QT',
  DELIVERY_CHALLAN: 'DC',
};

export const STATUSES = ['DRAFT', 'SENT', 'PAID', 'PARTIALLY_PAID', 'CANCELLED'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PAID: 'Paid',
  PARTIALLY_PAID: 'Partially Paid',
  CANCELLED: 'Cancelled',
};

export const STATUS_CLASSES: Record<Status, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
  SENT: 'bg-blue-50 text-blue-700 ring-blue-200',
  PAID: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PARTIALLY_PAID: 'bg-amber-50 text-amber-700 ring-amber-200',
  CANCELLED: 'bg-rose-50 text-rose-700 ring-rose-200',
};

export const UNITS = [
  'PCS', 'NOS', 'KG', 'GM', 'QTL', 'TON', 'MTR', 'CM', 'FT', 'SQF', 'SQM',
  'LTR', 'ML', 'BOX', 'BAG', 'BDL', 'SET', 'PAIR', 'DOZ', 'ROLL', 'HRS',
  'DAY', 'MONTH', 'JOB', 'OTH',
] as const;

export const GST_RATES = [0, 5, 12, 18, 28] as const;

export const PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank Transfer',
  CHEQUE: 'Cheque',
  CARD: 'Card',
  OTHER: 'Other',
};

export const COPY_TYPES = ['ORIGINAL', 'DUPLICATE', 'TRIPLICATE', 'NONE'] as const;
export type CopyType = (typeof COPY_TYPES)[number];

export const COPY_LABELS: Record<CopyType, string> = {
  ORIGINAL: 'ORIGINAL FOR RECIPIENT',
  DUPLICATE: 'DUPLICATE FOR TRANSPORTER',
  TRIPLICATE: 'TRIPLICATE FOR SUPPLIER',
  NONE: '',
};

export const COMPANY_COOKIE = 'bg_company';

export function isDocType(v: unknown): v is DocType {
  return typeof v === 'string' && (DOC_TYPES as readonly string[]).includes(v);
}
export function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** A challan or quotation shouldn't call its number an "Invoice No.". */
export const DOC_NUMBER_LABELS: Record<DocType, string> = {
  TAX_INVOICE: 'Invoice No.',
  PROFORMA: 'Proforma No.',
  QUOTATION: 'Quotation No.',
  DELIVERY_CHALLAN: 'Challan No.',
};

export const DOC_DATE_LABELS: Record<DocType, string> = {
  TAX_INVOICE: 'Invoice Date',
  PROFORMA: 'Proforma Date',
  QUOTATION: 'Quotation Date',
  DELIVERY_CHALLAN: 'Challan Date',
};


export const SUPPLY_TYPES = ['INTRA_STATE', 'INTRA_CITY', 'INTER_STATE'] as const;
export type SupplyTypeValue = (typeof SUPPLY_TYPES)[number];

export const SUPPLY_TYPE_LABELS: Record<SupplyTypeValue, string> = {
  INTRA_STATE: 'Intra-State Supply',
  INTRA_CITY: 'Intra-City Supply',
  INTER_STATE: 'Inter-State Supply',
};

/** What the user may pick while the supply stays inside the state. */
export const WITHIN_STATE_SUPPLY = ['INTRA_STATE', 'INTRA_CITY'] as const;
export type WithinStateSupply = (typeof WITHIN_STATE_SUPPLY)[number];
