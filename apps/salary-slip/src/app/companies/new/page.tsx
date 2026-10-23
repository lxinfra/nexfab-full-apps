import { CompanyForm } from "../CompanyForm";

export default function NewCompanyPage() {
  return (
    <div className="space-y-4">
      <h1 className="page-title">Add company</h1>
      <CompanyForm
        initial={{
          name: "",
          address: "",
          phone: "",
          email: "",
          website: "",
          gstin: "",
          pan: "",
          tan: "",
          signatoryName: "",
          signatoryDesignation: "",
        }}
      />
    </div>
  );
}
