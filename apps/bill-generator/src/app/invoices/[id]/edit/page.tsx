import { notFound, redirect } from 'next/navigation';
import { getActiveCompany } from '@/lib/company-context';
import { formData } from '@/lib/invoice-queries';
import InvoiceForm, { type InvoiceFormInitial } from '@/components/invoice/InvoiceForm';
import { PageHeader } from '@/components/ui/Field';
import NoCompany from '@/components/ui/NoCompany';
import { getInvoice, toDateInput } from '@/lib/invoice-service';
import { formatBasisPoints, paiseToInput, formatQty } from '@/lib/money';
import type { DocType, Status } from '@/lib/constants';
import type { Row } from '@/components/invoice/types';

export const dynamic = 'force-dynamic';

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await getActiveCompany();
  if (!company) return <NoCompany />;

  const invoice = await getInvoice(id);
  if (!invoice) notFound();
  // A cancelled document is void and stays as it is.
  if (invoice.status === 'CANCELLED') redirect(`/invoices/${id}`);

  const issued = Boolean(invoice.number);

  const { customers, products } = await formData(invoice.companyId);

  const initial: InvoiceFormInitial = {
    id: invoice.id,
    docType: invoice.docType as DocType,
    customerId: invoice.customerId,
    invoiceDate: toDateInput(invoice.invoiceDate),
    dueDate: invoice.dueDate ? toDateInput(invoice.dueDate) : '',
    placeOfSupplyCode: invoice.placeOfSupplyCode,
    reverseCharge: invoice.reverseCharge,
    withinStateSupply: invoice.supplyType === 'INTRA_CITY' ? 'INTRA_CITY' : 'INTRA_STATE',
    agreementNo: invoice.agreementNo ?? '',
    workOrderDate: invoice.workOrderDate ? toDateInput(invoice.workOrderDate) : '',
    rebateLabel: invoice.rebateLabel ?? 'Below',
    rebatePercent: formatBasisPoints(invoice.rebateBp),
    number: invoice.number,
    status: invoice.status as Status,
    roundOff: invoice.roundOffPaise !== 0 || invoice.totalPaise % 100 === 0,
    notes: invoice.notes ?? '',
    terms: invoice.terms ?? '',
    rows: invoice.items.map<Row>((it, i) => ({
      key: `${it.id}-${i}`,
      productId: it.productId ?? '',
      name: it.name,
      description: it.description ?? '',
      hsnSac: it.hsnSac ?? '',
      unit: it.unit,
      qty: formatQty(it.qtyMilli),
      rate: paiseToInput(it.ratePaise),
      discountType: it.discountType as Row['discountType'],
      discountValue:
        it.discountType === 'PERCENT'
          ? formatBasisPoints(it.discountValue)
          : paiseToInput(it.discountValue),
      gstRate: it.gstRate,
    })),
  };

  return (
    <>
      <PageHeader
        title={issued ? `Edit ${invoice.number}` : 'Edit draft'}
        subtitle={
          issued
            ? `Issued bill${invoice.revision > 0 ? ` · revision ${invoice.revision}` : ''}`
            : 'Drafts have no number until they are issued.'
        }
      />

      {issued && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">This bill has already been issued as {invoice.number}.</p>
          <p className="mt-1">
            You can correct it. The number, its place in the series and its financial year all
            stay exactly as they are, and the current version is saved to the revision history
            before your changes are applied — so there is always a record of what the customer
            was originally sent.
          </p>
          <p className="mt-1">
            If the customer has already acted on it, a credit note or a fresh bill is usually the
            cleaner route than changing one they hold.
          </p>
        </div>
      )}

      <InvoiceForm
        company={company}
        customers={customers}
        products={products}
        initial={initial}
        issued={issued}
      />
    </>
  );
}
