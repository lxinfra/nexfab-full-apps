import Link from 'next/link';
import { Suspense } from 'react';
import { prisma } from '@/lib/db';
import { getActiveCompany } from '@/lib/company-context';
import { EmptyState, PageHeader } from '@/components/ui/Field';
import NoCompany from '@/components/ui/NoCompany';
import InvoiceFilters from '@/components/invoice/InvoiceFilters';
import { formatINR } from '@/lib/money';
import { toDateInput } from '@/lib/invoice-service';
import {
  DOC_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  type DocType,
  type Status,
} from '@/lib/constants';
import {
  buildInvoiceWhere,
  filterQueryString,
  type InvoiceFilterParams,
} from '@/lib/invoice-filters';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<InvoiceFilterParams>;
}) {
  const company = await getActiveCompany();
  if (!company) return <NoCompany />;

  const sp = await searchParams;
  const where = buildInvoiceWhere(company.id, sp);

  const [invoices, customers, agg] = await Promise.all([
    prisma.invoice.findMany({
      where,
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      include: { customer: { select: { name: true, billingState: true } } },
      take: 300,
    }),
    prisma.customer.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.invoice.aggregate({
      where: { ...where, status: { not: 'CANCELLED' } },
      _sum: { totalPaise: true, amountPaidPaise: true },
    }),
  ]);

  const billed = agg._sum.totalPaise ?? 0;
  const received = agg._sum.amountPaidPaise ?? 0;
  const exportQs = filterQueryString(sp);

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle={`${invoices.length} shown · ${formatINR(billed)} billed · ${formatINR(received)} received (excludes cancelled)`}
        actions={
          <>
            <a
              className="btn-secondary"
              href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/export${exportQs ? `?${exportQs}` : ''}`}
            >
              ⬇ Export CSV
            </a>
            <Link href="/invoices/new" className="btn-primary">
              + New invoice
            </Link>
          </>
        }
      />

      <div className="mb-4">
        <Suspense fallback={<div className="card-pad h-20" />}>
          <InvoiceFilters customers={customers} />
        </Suspense>
      </div>

      {invoices.length === 0 ? (
        <EmptyState
          title="Nothing here"
          message="No documents match these filters yet."
          action={
            <Link href="/invoices/new" className="btn-primary">
              Create an invoice
            </Link>
          }
        />
      ) : (
        <div className="card scroll-x">
          <table className="w-full min-w-[54rem]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Number</th>
                <th className="th">Date</th>
                <th className="th">Customer</th>
                <th className="th">Type</th>
                <th className="th">Tax</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Balance</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => {
                const balance = inv.totalPaise - inv.amountPaidPaise;
                return (
                  <tr key={inv.id} className="hover:bg-slate-50">
                    <td className="td">
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {inv.number ?? 'Draft'}
                      </Link>
                    </td>
                    <td className="td whitespace-nowrap">{toDateInput(inv.invoiceDate)}</td>
                    <td className="td">
                      <div>{inv.customer.name}</div>
                      <div className="text-xs text-slate-500">{inv.customer.billingState}</div>
                    </td>
                    <td className="td text-xs">{DOC_LABELS[inv.docType as DocType]}</td>
                    <td className="td text-xs">
                      {inv.supplyType === 'INTER_STATE' ? 'IGST' : 'CGST+SGST'}
                    </td>
                    <td className="td text-right font-medium tabular-nums">
                      {formatINR(inv.totalPaise)}
                    </td>
                    <td className="td text-right tabular-nums">
                      {inv.status === 'CANCELLED' ? (
                        <span className="text-slate-400">—</span>
                      ) : balance > 0 ? (
                        <span className="text-amber-700">{formatINR(balance)}</span>
                      ) : (
                        <span className="text-emerald-700">Settled</span>
                      )}
                    </td>
                    <td className="td">
                      <span className={`badge ${STATUS_CLASSES[inv.status as Status]}`}>
                        {STATUS_LABELS[inv.status as Status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
