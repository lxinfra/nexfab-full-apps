import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import CustomerForm from '@/components/CustomerForm';
import { PageHeader } from '@/components/ui/Field';

export const dynamic = 'force-dynamic';

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) notFound();
  return (
    <>
      <PageHeader title={customer.name} subtitle="Customer details" />
      <CustomerForm customer={customer} />
    </>
  );
}
