import Link from 'next/link';
import { getActiveCompany } from '@/lib/company-context';
import { listBatches } from '@/lib/monthly-import-service';
import { EmptyState, PageHeader } from '@/components/ui/Field';

export const metadata = { title: 'Monthly imports' };

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const STATUS_TONE: Record<string, string> = {
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  GENERATING: 'bg-sky-100 text-sky-800',
  PENDING: 'bg-amber-100 text-amber-800',
  FAILED: 'bg-rose-100 text-rose-800',
  CANCELLED: 'bg-slate-200 text-slate-700',
};

export default async function ImportsPage() {
  const company = await getActiveCompany();

  if (!company) {
    return (
      <EmptyState
        title="No company selected"
        message="Pick or create a company to see its monthly imports."
        action={
          <Link href="/companies/new" className="btn-primary">
            Add a company
          </Link>
        }
      />
    );
  }

  const batches = await listBatches(company.id);

  return (
    <>
      <PageHeader
        title="Monthly imports"
        subtitle="Every sheet uploaded for this company, and the invoices it produced."
        actions={
          <Link href="/imports/new" className="btn-primary btn-sm">
            + Upload Monthly Details
          </Link>
        }
      />

      {batches.length === 0 ? (
        <EmptyState
          title="No imports yet"
          message="Upload a month's sales sheet and the bills are grouped, previewed and generated for you. Nothing is created until you confirm."
          action={
            <Link href="/imports/new" className="btn-primary">
              Upload Monthly Details
            </Link>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">Month</th>
                <th className="px-4 py-3">Imported on</th>
                <th className="px-4 py-3 text-right">Rows</th>
                <th className="px-4 py-3 text-right">Bills</th>
                <th className="px-4 py-3 text-right">Invoices</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/imports/${b.id}`} className="font-medium text-brand-700 hover:underline">
                      {b.fileName}
                    </Link>
                    {b.errorRows > 0 && (
                      <span className="ml-2 text-xs text-rose-600">{b.errorRows} issue(s)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {b.periodMonth && b.periodYear
                      ? `${MONTHS[b.periodMonth - 1]} ${b.periodYear}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {b.createdAt.toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.totalRows.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{b.billCount.toLocaleString('en-IN')}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium">
                    {b.invoiceCount.toLocaleString('en-IN')}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_TONE[b.status] ?? 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {b.status.charAt(0) + b.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
