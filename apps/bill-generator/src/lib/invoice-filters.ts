import type { Prisma } from '@prisma/client';
import { isDocType, isStatus } from './constants';

export type InvoiceFilterParams = {
  q?: string;
  status?: string;
  customerId?: string;
  docType?: string;
  from?: string;
  to?: string;
  /** Narrows the list to the invoices one monthly import produced. */
  importBatchId?: string;
};

/** Shared by the list page and the CSV export so both filter identically. */
export function buildInvoiceWhere(
  companyId: string,
  p: InvoiceFilterParams,
): Prisma.InvoiceWhereInput {
  const q = p.q?.trim();
  const from = p.from ? new Date(`${p.from}T00:00:00`) : null;
  const to = p.to ? new Date(`${p.to}T23:59:59.999`) : null;

  return {
    companyId,
    ...(isStatus(p.status) ? { status: p.status } : {}),
    ...(isDocType(p.docType) ? { docType: p.docType } : {}),
    ...(p.customerId ? { customerId: p.customerId } : {}),
    ...(p.importBatchId ? { importBatchId: p.importBatchId } : {}),
    ...(from || to
      ? { invoiceDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q } },
            { externalBillNo: { contains: q } },
            { customer: { name: { contains: q } } },
            { notes: { contains: q } },
          ],
        }
      : {}),
  };
}

export function filterQueryString(p: InvoiceFilterParams): string {
  return new URLSearchParams(
    Object.entries(p).filter(([, v]) => typeof v === 'string' && v !== '') as [string, string][],
  ).toString();
}
