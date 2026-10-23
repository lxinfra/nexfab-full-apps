import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getInvoice, toDateInput } from '@/lib/invoice-service';
import { PageHeader, SectionCard } from '@/components/ui/Field';
import InvoiceActions from '@/components/invoice/InvoiceActions';
import PaymentsPanel from '@/components/invoice/PaymentsPanel';
import RevisionHistory from '@/components/invoice/RevisionHistory';
import InvoicePreview from '@/components/invoice/InvoicePreview';
import {
  DOC_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  type DocType,
  type Status,
} from '@/lib/constants';
import type { ComputedLine, SupplyType } from '@/lib/gst';
import { computeTotals } from '@/lib/gst';

export const dynamic = 'force-dynamic';

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  const status = invoice.status as Status;
  const docType = invoice.docType as DocType;

  // The stored rows are authoritative; rebuild the view model from them.
  const lines: ComputedLine[] = invoice.items.map((i) => ({
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

  const totals = {
    ...computeTotals(lines, false, {
      basicTotalPaise: invoice.taxablePaise + invoice.rebatePaise,
      rebatePaise: invoice.rebatePaise,
    }),
    roundOffPaise: invoice.roundOffPaise,
    totalPaise: invoice.totalPaise,
  };

  return (
    <>
      <PageHeader
        title={invoice.number ?? `Draft ${DOC_LABELS[docType]}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className={`badge ${STATUS_CLASSES[status]}`}>{STATUS_LABELS[status]}</span>
            <span>{DOC_LABELS[docType]}</span>
            <span>·</span>
            <span>{invoice.customer.name}</span>
            <span>·</span>
            <span>{toDateInput(invoice.invoiceDate)}</span>
            <span>·</span>
            <span>FY {invoice.fy}</span>
          </span>
        }
        actions={
          <Link href="/invoices" className="btn-secondary">
            ← All invoices
          </Link>
        }
      />

      {invoice.status === 'CANCELLED' && (
        <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <strong>Cancelled</strong>
          {invoice.cancelReason ? ` — ${invoice.cancelReason}` : ''}. The number stays reserved so
          the series has no gaps.
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="space-y-5">
          <SectionCard title="Actions">
            <InvoiceActions
              invoiceId={invoice.id}
              status={status}
              isDraft={status === 'DRAFT'}
              hasNumber={Boolean(invoice.number)}
            />
          </SectionCard>

          <SectionCard title="Payments">
            <PaymentsPanel
              invoiceId={invoice.id}
              totalPaise={invoice.totalPaise}
              paidPaise={invoice.amountPaidPaise}
              disabled={status === 'CANCELLED'}
              payments={invoice.payments.map((p) => ({
                id: p.id,
                paidOn: toDateInput(p.paidOn),
                amountPaise: p.amountPaise,
                method: p.method,
                reference: p.reference,
              }))}
            />
          </SectionCard>

          {(invoice.revision > 0 || invoice.number) && (
            <SectionCard
              title="Revision history"
              description={
                invoice.revision > 0
                  ? `This bill has been corrected ${invoice.revision} time${invoice.revision === 1 ? '' : 's'} since it was issued.`
                  : undefined
              }
            >
              <RevisionHistory
                revisions={invoice.revisions}
                currentTotalPaise={invoice.totalPaise}
              />
            </SectionCard>
          )}
        </div>

        <aside>
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Document
          </p>
          <InvoicePreview
            company={invoice.company}
            customer={invoice.customer}
            docType={docType}
            number={invoice.number}
            invoiceDate={toDateInput(invoice.invoiceDate)}
            dueDate={invoice.dueDate ? toDateInput(invoice.dueDate) : ''}
            placeOfSupply={invoice.placeOfSupply}
            placeOfSupplyCode={invoice.placeOfSupplyCode}
            reverseCharge={invoice.reverseCharge}
            revision={invoice.revision}
            lines={lines}
            totals={totals}
            supplyType={invoice.supplyType as SupplyType}
            notes={invoice.notes ?? ''}
            terms={invoice.terms ?? ''}
            agreementNo={invoice.agreementNo ?? ''}
            workOrderDate={invoice.workOrderDate ? toDateInput(invoice.workOrderDate) : ''}
            rebateLabel={invoice.rebateLabel ?? ''}
            rebateBp={invoice.rebateBp}
          />
        </aside>
      </div>
    </>
  );
}
