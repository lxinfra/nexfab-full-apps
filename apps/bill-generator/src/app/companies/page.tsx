import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getActiveCompany } from '@/lib/company-context';
import { PageHeader, EmptyState } from '@/components/ui/Field';
import { addressLines } from '@/lib/snapshot';
import { fileUrl } from '@/lib/file-url';

export const dynamic = 'force-dynamic';

export default async function CompaniesPage() {
  const [companies, active] = await Promise.all([
    prisma.company.findMany({
      where: { isActive: true },
      orderBy: { legalName: 'asc' },
      include: { _count: { select: { invoices: true, customers: true, products: true } } },
    }),
    getActiveCompany(),
  ]);

  return (
    <>
      <PageHeader
        title="Companies"
        subtitle="Every customer, product and invoice belongs to one company."
        actions={
          <Link href="/companies/new" className="btn-primary">
            + Add company
          </Link>
        }
      />

      {companies.length === 0 ? (
        <EmptyState
          title="No companies yet"
          message="Add your first company to start billing."
          action={
            <Link href="/companies/new" className="btn-primary">
              Add company
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {companies.map((c) => (
            <div key={c.id} className="card-pad">
              <div className="flex items-start gap-3">
                {c.logoPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={fileUrl(c.logoPath) ?? ''}
                    alt=""
                    className="h-12 w-12 shrink-0 rounded-lg object-contain"
                  />
                ) : (
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-500">
                    {c.legalName.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate font-semibold text-slate-900">{c.legalName}</h2>
                    {active?.id === c.id && (
                      <span className="badge bg-brand-50 text-brand-700 ring-brand-200">Active</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {addressLines({ ...c }).join(', ')}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <div>
                      <dt className="text-xs text-slate-500">GSTIN</dt>
                      <dd className="font-mono text-xs text-slate-800">{c.gstin ?? '— not set —'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">State</dt>
                      <dd className="text-slate-800">
                        {c.state} ({c.stateCode})
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Prefix</dt>
                      <dd className="font-mono text-xs text-slate-800">{c.invoicePrefix}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500">Records</dt>
                      <dd className="text-slate-800">
                        {c._count.invoices} invoices · {c._count.customers} customers ·{' '}
                        {c._count.products} products
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Link href={`/companies/${c.id}`} className="btn-secondary btn-sm">
                  Edit
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
