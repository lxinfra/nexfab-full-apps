import Link from 'next/link';
import { getActiveCompany } from '@/lib/company-context';
import { formData } from '@/lib/invoice-queries';
import InvoiceForm from '@/components/invoice/InvoiceForm';
import { EmptyState, PageHeader } from '@/components/ui/Field';
import NoCompany from '@/components/ui/NoCompany';

export const dynamic = 'force-dynamic';

export default async function NewInvoicePage() {
  const company = await getActiveCompany();
  if (!company) return <NoCompany />;

  const { customers, products } = await formData(company.id);

  if (customers.length === 0) {
    return (
      <>
        <PageHeader title="New invoice" />
        <EmptyState
          title="No customers yet"
          message="You need at least one customer before you can raise an invoice."
          action={
            <Link href="/customers/new" className="btn-primary">
              Add customer
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New invoice"
        subtitle={`Billing from ${company.tradeName || company.legalName} · ${company.state} (${company.stateCode})`}
      />
      <InvoiceForm company={company} customers={customers} products={products} />
    </>
  );
}
