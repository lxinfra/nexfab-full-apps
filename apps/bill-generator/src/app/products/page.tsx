import Link from 'next/link';
import { Suspense } from 'react';
import { prisma } from '@/lib/db';
import { getActiveCompany } from '@/lib/company-context';
import { EmptyState, PageHeader } from '@/components/ui/Field';
import SearchBox from '@/components/ui/SearchBox';
import NoCompany from '@/components/ui/NoCompany';
import { formatINR } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const company = await getActiveCompany();
  if (!company) return <NoCompany />;

  const { q } = await searchParams;
  const term = q?.trim();
  const products = await prisma.product.findMany({
    where: {
      companyId: company.id,
      isActive: true,
      ...(term ? { OR: [{ name: { contains: term } }, { hsnSac: { contains: term } }] } : {}),
    },
    orderBy: { name: 'asc' },
  });

  return (
    <>
      <PageHeader
        title="Products & services"
        subtitle={`${products.length} saved for ${company.tradeName || company.legalName}`}
        actions={
          <>
            <Suspense fallback={<div className="input sm:w-64" />}>
              <SearchBox placeholder="Search name or HSN…" />
            </Suspense>
            <Link href="/products/new" className="btn-primary">
              + Add item
            </Link>
          </>
        }
      />

      {products.length === 0 ? (
        <EmptyState
          title={term ? 'No matches' : 'No items yet'}
          message={
            term ? `Nothing matched “${term}”.` : 'Save your products so billing is a dropdown away.'
          }
          action={
            <Link href="/products/new" className="btn-primary">
              Add item
            </Link>
          }
        />
      ) : (
        <div className="card scroll-x">
          <table className="w-full min-w-[42rem]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Item</th>
                <th className="th">HSN / SAC</th>
                <th className="th">Unit</th>
                <th className="th text-right">Rate</th>
                <th className="th text-right">GST</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="td">
                    <div className="font-medium text-slate-900">{p.name}</div>
                    {p.description && (
                      <div className="line-clamp-1 text-xs text-slate-500">{p.description}</div>
                    )}
                  </td>
                  <td className="td font-mono text-xs">{p.hsnSac ?? '—'}</td>
                  <td className="td">{p.unit}</td>
                  <td className="td text-right tabular-nums">{formatINR(p.ratePaise)}</td>
                  <td className="td text-right">{p.gstRate}%</td>
                  <td className="td text-right">
                    <Link href={`/products/${p.id}`} className="btn-secondary btn-sm">
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
