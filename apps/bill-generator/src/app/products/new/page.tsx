import ProductForm from '@/components/ProductForm';
import { PageHeader } from '@/components/ui/Field';

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="Add product or service" />
      <ProductForm />
    </>
  );
}
