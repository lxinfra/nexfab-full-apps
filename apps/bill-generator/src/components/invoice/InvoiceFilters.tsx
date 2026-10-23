'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DOC_LABELS, DOC_TYPES, STATUSES, STATUS_LABELS } from '@/lib/constants';

export default function InvoiceFilters({
  customers,
}: {
  customers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get('q') ?? '');
  const status = params.get('status') ?? '';
  const docType = params.get('docType') ?? '';
  const customerId = params.get('customerId') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  function push(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  // Debounce the free-text box so typing doesn't thrash the server.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) push({ q });
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const hasFilters = Boolean(q || status || docType || customerId || from || to);

  return (
    <div className="card-pad">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <label className="lg:col-span-2">
          <span className="label">Search</span>
          <input
            className="input"
            type="search"
            placeholder="Invoice no, customer, notes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          <span className="label">Status</span>
          <select
            className="input"
            value={status}
            onChange={(e) => push({ status: e.target.value })}
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Type</span>
          <select
            className="input"
            value={docType}
            onChange={(e) => push({ docType: e.target.value })}
          >
            <option value="">All</option>
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>
                {DOC_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">From</span>
          <input
            className="input"
            type="date"
            value={from}
            onChange={(e) => push({ from: e.target.value })}
          />
        </label>
        <label>
          <span className="label">To</span>
          <input
            className="input"
            type="date"
            value={to}
            onChange={(e) => push({ to: e.target.value })}
          />
        </label>
        <label className="lg:col-span-2">
          <span className="label">Customer</span>
          <select
            className="input"
            value={customerId}
            onChange={(e) => push({ customerId: e.target.value })}
          >
            <option value="">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {hasFilters && (
          <div className="flex items-end">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setQ('');
                router.replace(pathname);
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
