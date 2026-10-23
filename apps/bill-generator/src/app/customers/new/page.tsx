import CustomerForm from '@/components/CustomerForm';
import { PageHeader } from '@/components/ui/Field';

export default function NewCustomerPage() {
  return (
    <>
      <PageHeader title="Add customer" />
      <CustomerForm />
    </>
  );
}
