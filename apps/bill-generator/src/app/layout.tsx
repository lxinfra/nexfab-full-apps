import type { Metadata, Viewport } from 'next';
import './globals.css';
import TopBar from '@/components/TopBar';
import { listCompanies, getActiveCompany } from '@/lib/company-context';

export const metadata: Metadata = {
  title: 'GST Bill Generator',
  description: 'Multi-company GST invoicing',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [companies, active] = await Promise.all([listCompanies(), getActiveCompany()]);
  return (
    <html lang="en">
      <body className="min-h-full">
        <TopBar
          companies={companies}
          activeId={active?.id ?? null}
          activeName={active ? active.tradeName || active.legalName : null}
        />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </body>
    </html>
  );
}
