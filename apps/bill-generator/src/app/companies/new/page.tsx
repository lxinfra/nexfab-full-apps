import CompanyForm from '@/components/CompanyForm';
import { PageHeader } from '@/components/ui/Field';

export default function NewCompanyPage() {
  return (
    <>
      <PageHeader title="Add company" subtitle="You can fill in GSTIN and bank details later." />
      <CompanyForm />
    </>
  );
}
