import { prisma } from '@/lib/db';
import { handleError } from '@/lib/api';
import { requireActiveCompany } from '@/lib/company-context';
import { csvResponse, toCsv } from '@/lib/csv';
import { buildInvoiceWhere, type InvoiceFilterParams } from '@/lib/invoice-filters';
import { toDateInput } from '@/lib/invoice-service';
import {
  DOC_LABELS,
  STATUS_LABELS,
  SUPPLY_TYPE_LABELS,
  type DocType,
  type Status,
  type SupplyTypeValue,
} from '@/lib/constants';

const rupees = (paise: number) => (paise / 100).toFixed(2);

/**
 * GET /api/invoices/export - one row per invoice, column names close to the
 * GSTR-1 B2B layout so the file can be pasted straight into a filing sheet.
 */
export async function GET(req: Request) {
  try {
    const company = await requireActiveCompany();
    const sp = Object.fromEntries(new URL(req.url).searchParams) as InvoiceFilterParams;

    const invoices = await prisma.invoice.findMany({
      where: buildInvoiceWhere(company.id, sp),
      orderBy: [{ invoiceDate: 'asc' }, { seq: 'asc' }],
      include: { customer: true, items: true },
    });

    const header = [
      'Invoice No',
      'Invoice Date',
      'Document Type',
      'Status',
      'Financial Year',
      'Customer Name',
      'Customer GSTIN',
      'Customer State',
      'State Code',
      'Place of Supply',
      'Supply Type',
      'Reverse Charge',
      'HSN/SAC Codes',
      'Taxable Value',
      'CGST',
      'SGST',
      'IGST',
      'Total Tax',
      'Round Off',
      'Invoice Total',
      'Amount Received',
      'Balance Due',
      'Due Date',
    ];

    const rows = invoices.map((inv) => {
      const tax = inv.cgstPaise + inv.sgstPaise + inv.igstPaise;
      const hsn = [...new Set(inv.items.map((i) => i.hsnSac).filter(Boolean))].join(' | ');
      return [
        inv.number ?? 'DRAFT',
        toDateInput(inv.invoiceDate),
        DOC_LABELS[inv.docType as DocType] ?? inv.docType,
        STATUS_LABELS[inv.status as Status] ?? inv.status,
        inv.fy,
        inv.customer.name,
        inv.customer.gstin ?? '',
        inv.customer.billingState,
        inv.customer.billingStateCode,
        `${inv.placeOfSupply} (${inv.placeOfSupplyCode})`,
        SUPPLY_TYPE_LABELS[inv.supplyType as SupplyTypeValue] ?? inv.supplyType,
        inv.reverseCharge ? 'Y' : 'N',
        hsn,
        rupees(inv.taxablePaise),
        rupees(inv.cgstPaise),
        rupees(inv.sgstPaise),
        rupees(inv.igstPaise),
        rupees(tax),
        rupees(inv.roundOffPaise),
        rupees(inv.totalPaise),
        rupees(inv.amountPaidPaise),
        rupees(inv.totalPaise - inv.amountPaidPaise),
        inv.dueDate ? toDateInput(inv.dueDate) : '',
      ];
    });

    const stamp = toDateInput(new Date());
    const safeName = (company.tradeName || company.legalName).replace(/[^\w-]+/g, '-');
    return csvResponse(`invoices-${safeName}-${stamp}.csv`, toCsv([header, ...rows]));
  } catch (e) {
    return handleError(e);
  }
}
