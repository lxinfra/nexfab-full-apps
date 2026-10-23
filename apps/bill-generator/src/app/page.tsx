import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getActiveCompany } from '@/lib/company-context';
import { PageHeader } from '@/components/ui/Field';
import NoCompany from '@/components/ui/NoCompany';
import { formatINR } from '@/lib/money';
import { toDateInput } from '@/lib/invoice-service';
import { currentFinancialYear, fyRange } from '@/lib/numbering';
import {
  DOC_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  type DocType,
  type Status,
} from '@/lib/constants';

export const dynamic = 'force-dynamic';

/** Cancelled documents never count towards money figures. */
const LIVE = { status: { not: 'CANCELLED' } } as const;

export default async function DashboardPage() {
  const company = await getActiveCompany();
  if (!company) return <NoCompany />;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  const fy = currentFinancialYear();
  const { start: fyStart, end: fyEnd } = fyRange(fy);

  const base = { companyId: company.id, ...LIVE, docType: 'TAX_INVOICE' };

  const [month, year, outstanding, overdue, recent, counts] = await Promise.all([
    prisma.invoice.aggregate({
      where: { ...base, invoiceDate: { gte: monthStart, lte: monthEnd } },
      _sum: { totalPaise: true, amountPaidPaise: true, taxablePaise: true },
      _count: true,
    }),
    prisma.invoice.aggregate({
      where: { ...base, invoiceDate: { gte: fyStart, lte: fyEnd } },
      _sum: {
        totalPaise: true,
        amountPaidPaise: true,
        taxablePaise: true,
        cgstPaise: true,
        sgstPaise: true,
        igstPaise: true,
      },
      _count: true,
    }),
    prisma.invoice.findMany({
      where: { ...base, status: { in: ['SENT', 'PARTIALLY_PAID'] } },
      select: { totalPaise: true, amountPaidPaise: true },
    }),
    prisma.invoice.count({
      where: {
        ...base,
        status: { in: ['SENT', 'PARTIALLY_PAID'] },
        dueDate: { lt: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
      },
    }),
    prisma.invoice.findMany({
      where: { companyId: company.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: { customer: { select: { name: true } } },
    }),
    prisma.invoice.groupBy({
      by: ['status'],
      where: { companyId: company.id },
      _count: { _all: true },
    }),
  ]);

  const outstandingPaise = outstanding.reduce(
    (a, i) => a + (i.totalPaise - i.amountPaidPaise),
    0,
  );
  const fyTax =
    (year._sum.cgstPaise ?? 0) + (year._sum.sgstPaise ?? 0) + (year._sum.igstPaise ?? 0);

  return (
    <>
      <PageHeader
        title={company.tradeName || company.legalName}
        subtitle={`${company.state} (${company.stateCode}) · GSTIN ${company.gstin ?? 'not set'} · FY ${fy}`}
        actions={
          <>
            <Link href="/invoices/new" className="btn-primary">
              + New invoice
            </Link>
            <Link href={`/companies/${company.id}`} className="btn-secondary">
              Company settings
            </Link>
          </>
        }
      />

      {!company.gstin && (
        <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>GSTIN not set.</strong> Invoices will print without it. Add it under{' '}
          <Link href={`/companies/${company.id}`} className="underline">
            company settings
          </Link>
          , along with your bank details and UPI ID.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Billed this month"
          value={formatINR(month._sum.totalPaise ?? 0)}
          sub={`${month._count} tax invoices`}
        />
        <Stat
          label="Received this month"
          value={formatINR(month._sum.amountPaidPaise ?? 0)}
          tone="text-emerald-700"
        />
        <Stat
          label="Outstanding"
          value={formatINR(outstandingPaise)}
          sub={overdue > 0 ? `${overdue} past due date` : 'nothing overdue'}
          tone={outstandingPaise > 0 ? 'text-amber-700' : undefined}
        />
        <Stat
          label={`Billed FY ${fy}`}
          value={formatINR(year._sum.totalPaise ?? 0)}
          sub={`${year._count} invoices`}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <div className="card-pad lg:col-span-1">
          <h2 className="section-title mb-3">This financial year</h2>
          <dl className="space-y-2 text-sm">
            <Row k="Taxable value" v={formatINR(year._sum.taxablePaise ?? 0)} />
            <Row k="CGST collected" v={formatINR(year._sum.cgstPaise ?? 0)} />
            <Row k="SGST collected" v={formatINR(year._sum.sgstPaise ?? 0)} />
            <Row k="IGST collected" v={formatINR(year._sum.igstPaise ?? 0)} />
            <div className="border-t border-slate-200 pt-2">
              <Row k="Total GST" v={formatINR(fyTax)} strong />
            </div>
            <Row k="Received" v={formatINR(year._sum.amountPaidPaise ?? 0)} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {counts.map((c) => (
              <span key={c.status} className={`badge ${STATUS_CLASSES[c.status as Status]}`}>
                {STATUS_LABELS[c.status as Status]}: {c._count._all}
              </span>
            ))}
          </div>
        </div>

        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="section-title">Recent documents</h2>
            <Link href="/invoices" className="text-sm text-brand-700 hover:underline">
              View all →
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              No invoices yet.{' '}
              <Link href="/invoices/new" className="text-brand-700 underline">
                Create your first one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {recent.map((inv) => (
                <li key={inv.id}>
                  <Link
                    href={`/invoices/${inv.id}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">
                        {inv.number ?? 'Draft'} · {inv.customer.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {DOC_LABELS[inv.docType as DocType]} · {toDateInput(inv.invoiceDate)} ·{' '}
                        {inv.supplyType === 'INTER_STATE' ? 'IGST' : 'CGST+SGST'}
                      </p>
                    </div>
                    <span className="text-sm font-semibold tabular-nums">
                      {formatINR(inv.totalPaise)}
                    </span>
                    <span className={`badge ${STATUS_CLASSES[inv.status as Status]}`}>
                      {STATUS_LABELS[inv.status as Status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <div className="card-pad">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? 'font-medium text-slate-800' : 'text-slate-600'}>{k}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>
        {v}
      </dd>
    </div>
  );
}
