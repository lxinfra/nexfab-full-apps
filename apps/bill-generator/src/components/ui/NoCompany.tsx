import Link from 'next/link';
import { EmptyState } from '@/components/ui/Field';

export default function NoCompany() {
  return (
    <EmptyState
      title="No company selected"
      message="Create a company first — customers, products and invoices all belong to one."
      action={
        <Link href="/companies/new" className="btn-primary">
          Add company
        </Link>
      }
    />
  );
}
