'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { CompanyLite } from '@/lib/company-context';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/customers', label: 'Customers' },
  { href: '/products', label: 'Products' },
  { href: '/imports', label: 'Monthly Import' },
  { href: '/companies', label: 'Companies' },
];

export default function TopBar({
  companies,
  activeId,
  activeName,
}: {
  companies: CompanyLite[];
  activeId: string | null;
  activeName: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  function switchCompany(id: string) {
    document.cookie = `bg_company=${id}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => {
      router.push('/');
      router.refresh();
    });
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <header className="no-print sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            ₹
          </span>
          <span className="hidden text-sm font-semibold sm:block">Bill Generator</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                isActive(n.href)
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {companies.length > 0 ? (
            <select
              aria-label="Active company"
              className="input-sm max-w-[11rem] sm:max-w-[16rem]"
              value={activeId ?? ''}
              onChange={(e) => switchCompany(e.target.value)}
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.tradeName || c.legalName}
                </option>
              ))}
            </select>
          ) : (
            <Link href="/companies/new" className="btn-primary btn-sm">
              Add company
            </Link>
          )}
          <Link href="/invoices/new" className="btn-primary btn-sm hidden sm:inline-flex">
            + New invoice
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            className="btn-secondary btn-sm md:hidden"
          >
            ☰
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-slate-200 bg-white px-4 py-2 md:hidden">
          {[
            ...NAV,
            { href: '/invoices/new', label: '+ New invoice' },
            { href: '/imports/new', label: '+ Upload Monthly Details' },
          ].map((n) => (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                isActive(n.href) ? 'bg-brand-50 text-brand-700' : 'text-slate-700'
              }`}
            >
              {n.label}
            </Link>
          ))}
          {activeName && (
            <p className="px-3 py-2 text-xs text-slate-500">Active: {activeName}</p>
          )}
        </nav>
      )}
    </header>
  );
}
