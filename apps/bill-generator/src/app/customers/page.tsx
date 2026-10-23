import Link from 'next/link';
import { Suspense } from 'react';
import { prisma } from '@/lib/db';
import { getActiveCompany } from '@/lib/company-context';
import { EmptyState, PageHeader } from '@/components/ui/Field';
import SearchBox from '@/components/ui/SearchBox';
import NoCompany from '@/components/ui/NoCompany';
import { addressLines } from '@/lib/snapshot';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const company = await getActiveCompany();
  if (!company) return <NoCompany />;

  const { q } = await searchParams;
  const term = q?.trim();
  const customers = await prisma.customer.findMany({
    where: {
      companyId: company.id,
      isActive: true,
      ...(term
        ? {
            OR: [
              { name: { contains: term } },
              { gstin: { contains: term } },
              { phone: { contains: term } },
              { billingCity: { contains: term } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    include: { _count: { select: { invoices: true } } },
  });

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} saved for ${company.tradeName || company.legalName}`}
        actions={
          <>
            <Suspense fallback={<div className="input sm:w-64" />}>
              <SearchBox placeholder="Search name, GSTIN, city…" />
            </Suspense>
            <Link href="/customers/new" className="btn-primary">
              + Add customer
            </Link>
          </>
        }
      />

      {customers.length === 0 ? (
        <EmptyState
          title={term ? 'No matches' : 'No customers yet'}
          message={term ? `Nothing matched “${term}”.` : 'Add a customer to start billing them.'}
          action={
            <Link href="/customers/new" className="btn-primary">
              Add customer
            </Link>
          }
        />
      ) : (
        <div className="card scroll-x">
          <table className="w-full min-w-[46rem]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Name</th>
                <th className="th">GSTIN</th>
                <th className="th">State</th>
                <th className="th">Contact</th>
                <th className="th text-right">Invoices</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="td">
                    <div className="font-medium text-slate-900">{c.name}</div>
                    <div className="text-xs text-slate-500">
                      {addressLines({
                        addressLine1: c.billingLine1,
                        addressLine2: c.billingLine2,
                        city: c.billingCity,
                        state: c.billingState,
                        pincode: c.billingPincode,
                      }).join(', ')}
                    </div>
                  </td>
                  <td className="td font-mono text-xs">{c.gstin ?? '—'}</td>
                  <td className="td">
                    {c.billingState}
                    <span className="ml-1 text-xs text-slate-400">({c.billingStateCode})</span>
                  </td>
                  <td className="td text-xs">
                    {c.phone && <div>{c.phone}</div>}
                    {c.email && <div className="text-slate-500">{c.email}</div>}
                    {!c.phone && !c.email && '—'}
                  </td>
                  <td className="td text-right">{c._count.invoices}</td>
                  <td className="td text-right">
                    <Link href={`/customers/${c.id}`} className="btn-secondary btn-sm">
                      Edit
                    </Link>
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
