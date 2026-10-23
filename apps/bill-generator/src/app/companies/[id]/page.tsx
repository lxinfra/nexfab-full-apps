import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import CompanyForm from '@/components/CompanyForm';
import { PageHeader } from '@/components/ui/Field';

export const dynamic = 'force-dynamic';

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) notFound();
  return (
    <>
      <PageHeader title={company.legalName} subtitle="Company settings" />
      <CompanyForm company={company} />
    </>
  );
}
