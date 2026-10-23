import Link from 'next/link';
import { getActiveCompany } from '@/lib/company-context';
import { EmptyState, PageHeader } from '@/components/ui/Field';
import MonthlyImportWizard from '@/components/import/MonthlyImportWizard';

export const metadata = { title: 'Upload Monthly Details' };

export default async function NewImportPage() {
  const company = await getActiveCompany();

  if (!company) {
    return (
      <EmptyState
        title="No company selected"
        message="A monthly import belongs to one selling company, so pick or create one first."
        action={
          <Link href="/companies/new" className="btn-primary">
            Add a company
          </Link>
        }
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Upload Monthly Details"
        subtitle={
          <>
            Generating bills for <strong>{company.tradeName || company.legalName}</strong>. Invoice
            numbers come from this company&apos;s own series.
          </>
        }
        actions={
          <Link href="/imports" className="btn-secondary btn-sm">
            Import history
          </Link>
        }
      />
      <MonthlyImportWizard />
    </>
  );
}
