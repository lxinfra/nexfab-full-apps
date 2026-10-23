import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { batchPreview, getBatch, parseIssues } from '@/lib/monthly-import-service';
import { GROUPING_LABELS, type GroupingMode } from '@/lib/monthly-import';
import { SUPPLY_TYPE_LABELS } from '@/lib/constants';
import { formatINR } from '@/lib/money';
import { PageHeader, SectionCard } from '@/components/ui/Field';
import GenerateRemaining from '@/components/import/GenerateRemaining';

// Querying the DB while prerendering would need a live database during the build.
export const dynamic = 'force-dynamic';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTHS[Number(m) - 1]?.slice(0, 3) ?? m} ${y}`;
}

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const batch = await getBatch(id);
  if (!batch) notFound();

  const [preview, invoices, issueRows] = await Promise.all([
    batchPreview(id),
    prisma.invoice.findMany({
      where: { importBatchId: id },
      include: { customer: { select: { name: true } } },
      orderBy: [{ invoiceDate: 'asc' }, { number: 'asc' }],
      take: 500,
    }),
    prisma.importRow.findMany({
      where: { batchId: id, issues: { not: null } },
      orderBy: { rowNumber: 'asc' },
      select: { rowNumber: true, issues: true, customerName: true, itemName: true },
      take: 500,
    }),
  ]);

  const issues = issueRows.flatMap((r) =>
    parseIssues(r.issues).map((i) => ({ ...i, customerName: r.customerName, itemName: r.itemName })),
  );
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const pending = batch.billCount - batch.invoiceCount;
  const period =
    batch.periodMonth && batch.periodYear
      ? `${MONTHS[batch.periodMonth - 1]} ${batch.periodYear}`
      : 'Unknown period';

  return (
    <>
      <PageHeader
        title={batch.fileName}
        subtitle={
          <>
            {period} · imported{' '}
            {batch.createdAt.toLocaleString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            · {batch.status.charAt(0) + batch.status.slice(1).toLowerCase()}
          </>
        }
        actions={
          <>
            {issues.length > 0 && (
              <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/imports/${id}/issues`} className="btn-secondary btn-sm">
                Download issue report
              </a>
            )}
            <Link href="/imports" className="btn-ghost btn-sm">
              All imports
            </Link>
          </>
        }
      />

      <div className="grid gap-5">
        <SectionCard title="Summary">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Sheet rows" value={batch.totalRows} />
            <Stat label="Valid rows" value={batch.validRows} />
            <Stat label="Rows with errors" value={batch.errorRows} />
            <Stat label="Bills identified" value={batch.billCount} />
            <Stat label="Invoices generated" value={batch.invoiceCount} />
            <Stat label="Still to generate" value={Math.max(0, pending)} />
          </div>

          <dl className="mt-5 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Grouping used</dt>
              <dd>{GROUPING_LABELS[batch.grouping as GroupingMode] ?? batch.grouping}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Default supply type</dt>
              <dd>
                {SUPPLY_TYPE_LABELS[
                  batch.defaultSupplyType as keyof typeof SUPPLY_TYPE_LABELS
                ] ?? batch.defaultSupplyType}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Source file kept</dt>
              <dd>{batch.storagePath ? 'Yes, in Supabase Storage' : 'Not archived'}</dd>
            </div>
          </dl>

          {pending > 0 && batch.status !== 'CANCELLED' && (
            <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">
                {pending} bill(s) from this sheet have not been generated yet.
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Generation is resumable — only rows that have no invoice yet are picked up, so this
                cannot create duplicates.
              </p>
              <div className="mt-3">
                <GenerateRemaining batchId={id} pending={pending} />
              </div>
            </div>
          )}
        </SectionCard>

        {preview.length > 0 && (
          <SectionCard title="Bills by date and company">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Company</th>
                    <th className="py-2 pr-3 text-right">Bills</th>
                    <th className="py-2 pr-3 text-right">Lines</th>
                    <th className="py-2 text-right">Taxable value</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((g) => (
                    <tr key={`${g.date}-${g.customerName}`} className="border-b border-slate-100">
                      <td className="py-2 pr-3 whitespace-nowrap">{shortDate(g.date)}</td>
                      <td className="py-2 pr-3">{g.customerName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.bills}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.lines}</td>
                      <td className="py-2 text-right tabular-nums">{formatINR(g.totalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {invoices.length > 0 && (
          <SectionCard
            title={`Generated invoices (${invoices.length})`}
            description="Each one traces back to the sheet's own bill number."
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Invoice no.</th>
                    <th className="py-2 pr-3">Sheet bill no.</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Company</th>
                    <th className="py-2 pr-3">Supply</th>
                    <th className="py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="font-medium text-brand-700 hover:underline"
                        >
                          {inv.number ?? '(draft)'}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{inv.externalBillNo ?? '—'}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {inv.invoiceDate.toLocaleDateString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          year: '2-digit',
                        })}
                      </td>
                      <td className="py-2 pr-3">{inv.customer.name}</td>
                      <td className="py-2 pr-3 text-xs">
                        {SUPPLY_TYPE_LABELS[inv.supplyType as keyof typeof SUPPLY_TYPE_LABELS] ??
                          inv.supplyType}
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatINR(inv.totalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}

        {issues.length > 0 && (
          <SectionCard
            title="Issues"
            description={`${errors.length} error(s) and ${warnings.length} warning(s) recorded against the sheet's rows.`}
          >
            <div className="max-h-96 overflow-y-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2">Row</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Problem</th>
                    <th className="px-3 py-2">Company</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((i, idx) => (
                    <tr key={idx} className="border-t border-slate-100">
                      <td className="px-3 py-2 tabular-nums text-slate-500">{i.rowNumber}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            i.severity === 'error'
                              ? 'font-medium text-rose-700'
                              : 'font-medium text-amber-700'
                          }
                        >
                          {i.severity === 'error' ? 'Error' : 'Warning'}
                        </span>
                      </td>
                      <td className="px-3 py-2">{i.message}</td>
                      <td className="px-3 py-2 text-slate-600">{i.customerName ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-slate-900">
        {value.toLocaleString('en-IN')}
      </p>
    </div>
  );
}
