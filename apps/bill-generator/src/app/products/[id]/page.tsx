import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import ProductForm from '@/components/ProductForm';
import { PageHeader } from '@/components/ui/Field';

export const dynamic = 'force-dynamic';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) notFound();
  return (
    <>
      <PageHeader title={product.name} subtitle="Item details" />
      <ProductForm product={product} />
    </>
  );
}
