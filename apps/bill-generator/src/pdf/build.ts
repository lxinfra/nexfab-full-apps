import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import React from 'react';
import type { Invoice, InvoiceItem } from '@prisma/client';
import { InvoiceDocument, type InvoicePdfData } from './InvoiceDocument';
import { imageDataUrl } from './assets';
import { upiQrDataUrl } from './qr';
import { parseCompanySnapshot, parseCustomerSnapshot } from '@/lib/snapshot';
import type { ComputedLine, SupplyType } from '@/lib/gst';
import { DOC_TITLES, type CopyType, type DocType } from '@/lib/constants';
import { formatBillDate } from '@/lib/numbering';

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

/** Dates print as 15/SEP/26 — see formatBillDate. */
const formatDate = formatBillDate;

/** Stored item rows are already computed — reuse them verbatim, never recalculate. */
function toComputedLines(items: InvoiceItem[]): ComputedLine[] {
  return items.map((i) => ({
    productId: i.productId,
    name: i.name,
    description: i.description,
    hsnSac: i.hsnSac,
    unit: i.unit,
    qtyMilli: i.qtyMilli,
    ratePaise: i.ratePaise,
    discountType: i.discountType as 'PERCENT' | 'AMOUNT',
    discountValue: i.discountValue,
    gstRate: i.gstRate,
    grossPaise: i.grossPaise,
    discountPaise: i.discountPaise,
    taxablePaise: i.taxablePaise,
    cgstPaise: i.cgstPaise,
    sgstPaise: i.sgstPaise,
    igstPaise: i.igstPaise,
    taxPaise: i.cgstPaise + i.sgstPaise + i.igstPaise,
    totalPaise: i.totalPaise,
  }));
}

export async function buildInvoicePdf(
  invoice: InvoiceWithItems,
  copy: CopyType = 'ORIGINAL',
): Promise<Buffer> {
  const company = parseCompanySnapshot(invoice.companySnapshot);
  const customer = parseCustomerSnapshot(invoice.customerSnapshot);

  const [logo, signature, upiQr] = await Promise.all([
    imageDataUrl(company.logoPath),
    imageDataUrl(company.signaturePath),
    upiQrDataUrl({
      upiId: company.upiId ?? '',
      payeeName: company.legalName,
      amountPaise: invoice.totalPaise - invoice.amountPaidPaise,
      note: invoice.number ?? DOC_TITLES[invoice.docType as DocType],
    }),
  ]);

  const data: InvoicePdfData = {
    docType: invoice.docType as DocType,
    number: invoice.number,
    invoiceDate: formatDate(invoice.invoiceDate),
    dueDate: invoice.dueDate ? formatDate(invoice.dueDate) : null,
    placeOfSupply: invoice.placeOfSupply,
    placeOfSupplyCode: invoice.placeOfSupplyCode,
    reverseCharge: invoice.reverseCharge,
    status: invoice.status,
    revision: invoice.revision,
    supplyType: invoice.supplyType as SupplyType,
    company,
    customer,
    lines: toComputedLines(invoice.items),
    agreementNo: invoice.agreementNo,
    workOrderDate: invoice.workOrderDate ? formatDate(invoice.workOrderDate) : null,
    rebateLabel: invoice.rebateLabel,
    rebateBp: invoice.rebateBp,
    totals: {
      subtotalPaise: invoice.subtotalPaise,
      discountPaise: invoice.discountPaise,
      basicTotalPaise: invoice.taxablePaise + invoice.rebatePaise,
      rebatePaise: invoice.rebatePaise,
      taxablePaise: invoice.taxablePaise,
      cgstPaise: invoice.cgstPaise,
      sgstPaise: invoice.sgstPaise,
      igstPaise: invoice.igstPaise,
      roundOffPaise: invoice.roundOffPaise,
      totalPaise: invoice.totalPaise,
    },
    amountPaidPaise: invoice.amountPaidPaise,
    notes: invoice.notes,
    terms: invoice.terms,
    copy,
    logo,
    signature,
    upiQr,
  };

  // renderToBuffer is typed for an element whose props are DocumentProps;
  // InvoiceDocument returns a <Document>, so the cast is safe.
  const element = React.createElement(InvoiceDocument, { data }) as React.ReactElement<DocumentProps>;
  return renderToBuffer(element);
}

/** Safe, descriptive file name for the download. */
export function pdfFileName(invoice: Invoice, copy: CopyType): string {
  const base = (invoice.number ?? `DRAFT-${invoice.id.slice(-6)}`).replace(/[\\/:*?"<>|]/g, '-');
  const suffix = copy === 'NONE' ? '' : `-${copy.toLowerCase()}`;
  return `${base}${suffix}.pdf`;
}
