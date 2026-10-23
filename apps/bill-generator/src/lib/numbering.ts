import type { Prisma, PrismaClient } from '@prisma/client';
import { DOC_SERIES, type DocType } from './constants';

/** Indian financial year for a date: 1 Apr 2026 - 31 Mar 2027 => "2026-27". */
export function financialYear(date: Date): string {
  const y = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? y : y - 1; // month 3 = April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function fyRange(fy: string): { start: Date; end: Date } {
  const startYear = parseInt(fy.slice(0, 4), 10);
  return {
    start: new Date(startYear, 3, 1, 0, 0, 0, 0),
    end: new Date(startYear + 1, 2, 31, 23, 59, 59, 999),
  };
}

export function currentFinancialYear(): string {
  return financialYear(new Date());
}

const MONTH_FULL = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

export const MONTH_SHORT = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/**
 * How a date is printed on a bill: 15 September 2026 -> "15/SEP/26".
 *
 * Shares MONTH_SHORT with the {MMM} number token, so a bill numbered
 * INDORE/SEP/26/0001 always reads 15/SEP/26 — the two can never drift apart.
 */
export function formatBillDate(d: Date): string {
  return [
    String(d.getDate()).padStart(2, '0'),
    MONTH_SHORT[d.getMonth()],
    String(d.getFullYear() % 100).padStart(2, '0'),
  ].join('/');
}

/**
 * The same thing for the "yyyy-mm-dd" strings that <input type="date"> produces
 * and the preview is handed. Anything unparseable (including "") is passed
 * straight through, so an empty field still renders as empty.
 */
export function formatBillDateInput(value: string): string {
  const m = (value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value ?? '';
  const [, y, mo, d] = m;
  const monthIndex = Number(mo) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value;
  return `${d}/${MONTH_SHORT[monthIndex]}/${y.slice(2)}`;
}

/**
 * Derives initials from a name: "Lx Infrastructure Limited" -> "LIL",
 * "Indore Development Authority" -> "IDA". Short names fall back to their
 * first letters so nothing ever comes out blank.
 */
export function deriveInitials(name: string): string {
  const STOP = new Set([
    'and', 'the', 'of', 'for', 'at', 'in', 'on', '&',
    'pvt', 'private', 'ltd', 'limited', 'llp', 'inc', 'co', 'company', 'corp',
  ]);
  const words = (name ?? '')
    .replace(/[^\p{L}\p{N}\s&]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const significant = words.filter((w) => !STOP.has(w.toLowerCase()));
  const source = significant.length > 0 ? significant : words;
  const letters = source.map((w) => w[0]).join('').toUpperCase();

  if (letters.length >= 2) return letters.slice(0, 4);
  const compact = (name ?? '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
  return compact.slice(0, 3) || 'INV';
}

/**
 * The first N letters of a name, e.g. "Indore Development Authority" -> "INDO".
 * Punctuation and spaces are dropped so the result is always usable in a number.
 */
export function firstLetters(name: string, n = 4): string {
  const compact = (name ?? '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
  return compact.slice(0, n);
}

/**
 * The first word of a name, uppercased: "Trivedi Enterprises Pvt Ltd" -> "TRIVEDI".
 * Anything that is not a letter or digit is dropped from that word.
 */
export function firstWord(name: string): string {
  const word = (name ?? '').trim().split(/\s+/)[0] ?? '';
  return word.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase();
}

export const NUMBER_TOKENS = [
  '{SELLERWORD}', '{MMM}', '{YY}', '{SEQ}',
  '{BUYERWORD}', '{BUYER4}', '{SELLER4}', '{MMMM}',
  '{SELLER}', '{BUYER}', '{MM}', '{YYYY}', '{FY}', '{DOC}', '{PREFIX}',
] as const;

export type NumberingOptions = {
  invoicePrefix: string;
  numberFormat: string;
  includeFyInNo: boolean;
  numberPadding: number;
  numberStart?: number;
  initials?: string | null;
  legalName?: string;
};

export type NumberContext = {
  docType: DocType;
  fy: string;
  seq: number;
  date: Date;
  sellerInitials: string;
  buyerInitials: string;
  /** Full names, so the four-letter tokens can be derived. */
  sellerName?: string;
  buyerName?: string;
};

/** True when the format pins the number to a year, so a yearly reset is safe. */
export function formatHasYear(format: string): boolean {
  return /\{(FY|YYYY|YY)\}/.test(format ?? '');
}

/**
 * Builds the document number from the company's template.
 *
 *   {SELLER}/{MM}/{BUYER}/{SEQ}  ->  LIL/06/IDA/0001
 *
 * Empty segments collapse, so a format keeping {BUYER} still works on a
 * document with no buyer initials.
 */
export function renderInvoiceNumber(opts: NumberingOptions, ctx: NumberContext): string {
  const format = (opts.numberFormat ?? '').trim() || '{PREFIX}/{FY}/{SEQ}';
  const pad = Math.max(1, opts.numberPadding || 4);
  const series = DOC_SERIES[ctx.docType];

  const values: Record<string, string> = {
    // First-word tokens: "Trivedi Enterprises Pvt Ltd" -> TRIVEDI.
    '{SELLERWORD}': firstWord(ctx.sellerName ?? opts.legalName ?? ''),
    '{BUYERWORD}': firstWord(ctx.buyerName ?? ''),
    // Four-letter tokens come from the full name, so "Indore Development
    // Authority" gives INDO rather than the IDA acronym.
    '{BUYER4}': firstLetters(ctx.buyerName ?? '', 4),
    '{SELLER4}': firstLetters(ctx.sellerName ?? opts.legalName ?? '', 4),
    '{MMMM}': MONTH_FULL[ctx.date.getMonth()].slice(0, 4),
    '{SELLER}': opts.initials?.trim() || deriveInitials(opts.legalName ?? ''),
    '{BUYER}': ctx.buyerInitials ?? '',
    '{SEQ}': String(ctx.seq).padStart(pad, '0'),
    '{MM}': String(ctx.date.getMonth() + 1).padStart(2, '0'),
    '{MMM}': MONTH_SHORT[ctx.date.getMonth()],
    '{YYYY}': String(ctx.date.getFullYear()),
    '{YY}': String(ctx.date.getFullYear() % 100).padStart(2, '0'),
    '{FY}': ctx.fy,
    '{DOC}': series,
    '{PREFIX}': (opts.invoicePrefix ?? '').replace(/\/+$/, ''),
  };

  let out = format;
  for (const [token, value] of Object.entries(values)) {
    out = out.split(token).join(value);
  }

  // A non-tax document still needs its own series marker even if {DOC} is absent.
  if (series && !format.includes('{DOC}')) {
    out = `${series}/${out}`;
  }

  // Collapse the gaps left by empty tokens: "LIL//IDA/0001" -> "LIL/IDA/0001"
  return out
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .join('/');
}

type Tx = Prisma.TransactionClient | PrismaClient;

/** True when the format names a month, so the series can restart each month. */
export function formatHasMonth(format: string): boolean {
  return /\{(MM|MMM|MMMM)\}/.test(format ?? '');
}

/** True when the number is prefixed by the buyer, so each buyer gets its own run. */
export function formatHasBuyer(format: string): boolean {
  return /\{BUYER(4|WORD)?\}/.test(format ?? '');
}

/**
 * The counter bucket — what the sequence restarts on.
 *
 *   month + year in the format  ->  one series per calendar month ("2026-09")
 *   year only                   ->  one series per financial year
 *   neither                     ->  a single continuous series, because
 *                                   restarting would repeat earlier numbers
 *
 * The bucket is always scoped to a company and document type on top of this.
 */
export function counterKey(
  format: string,
  fy: string,
  date?: Date,
  /** Identifies the buyer when the number is prefixed by one. */
  buyerKey?: string,
): string {
  let bucket: string;
  if (formatHasMonth(format) && date) {
    bucket = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  } else {
    bucket = formatHasYear(format) ? fy : 'ALL';
  }

  // A buyer-prefixed number gets its own run per buyer, so TRIVEDI and RELIANCE
  // both start at 0001 in the same month instead of sharing one sequence.
  if (formatHasBuyer(format) && buyerKey) bucket = `${bucket}|${buyerKey}`;
  return bucket;
}

/**
 * Atomically reserves the next sequence number for a company + doc type +
 * counter bucket. Numbers are only ever handed out here, and never twice, so a
 * cancelled invoice keeps its number and no gap is reused.
 */
export async function allocateSequence(
  tx: Tx,
  companyId: string,
  docType: DocType,
  bucket: string,
  start = 1,
): Promise<number> {
  const counter = await tx.invoiceCounter.upsert({
    where: { companyId_docType_fy: { companyId, docType, fy: bucket } },
    create: { companyId, docType, fy: bucket, lastNumber: Math.max(1, start) },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  return counter.lastNumber;
}

/** What the next number will look like, without consuming it. */
export async function peekNextNumber(
  tx: Tx,
  companyId: string,
  docType: DocType,
  fy: string,
  opts: NumberingOptions,
  date: Date,
  buyerInitials: string,
  buyerName = '',
  buyerKey = '',
): Promise<string> {
  const bucket = counterKey(opts.numberFormat, fy, date, buyerKey);
  const counter = await tx.invoiceCounter.findUnique({
    where: { companyId_docType_fy: { companyId, docType, fy: bucket } },
    select: { lastNumber: true },
  });
  return renderInvoiceNumber(opts, {
    docType,
    fy,
    seq: counter ? counter.lastNumber + 1 : Math.max(1, opts.numberStart ?? 1),
    date,
    sellerInitials: opts.initials ?? '',
    buyerInitials,
    buyerName,
    sellerName: opts.legalName,
  });
}
