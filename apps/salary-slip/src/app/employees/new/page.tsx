import { requireCompany } from "@/lib/company";
import { DEFAULT_COMPONENTS } from "@/lib/validation";
import { loadStructureContext } from "@/lib/ctc/server";
import { EmployeeForm } from "../EmployeeForm";

export default async function NewEmployeePage() {
  const company = await requireCompany();
  const structure = await loadStructureContext(company.id);
  const templates = [...structure.templates].map(([id, t]) => ({ id, ...t }));
  return (
    <div className="space-y-4">
      <h1 className="page-title">Add employee</h1>
      <p className="text-sm text-slate-600">Company: {company.name}</p>
      <EmployeeForm
        id={null}
        templates={templates}
        settings={structure.settings}
        initial={{
          code: "",
          name: "",
          designation: "",
          department: "",
          dateOfJoining: "",
          pan: "",
          uan: "",
          esiNumber: "",
          bankName: "",
          bankAccount: "",
          ifsc: "",
          status: "ACTIVE",
          components: DEFAULT_COMPONENTS.map((name) => ({ name, monthlyAmount: "" })),
          templateId: "",
          ctcAmount: "",
          ctcPeriod: "YEARLY",
        }}
      />
    </div>
  );
}
