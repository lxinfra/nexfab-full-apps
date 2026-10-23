import { requireCompany } from "@/lib/company";
import { loadStructureContext } from "@/lib/ctc/server";
import { TemplateForm } from "../TemplateForm";
import { toRows } from "../rows";

export default async function NewTemplatePage() {
  const company = await requireCompany();
  const { settings } = await loadStructureContext(company.id);
  return (
    <div className="space-y-4">
      <h1 className="page-title">Add CTC template</h1>
      <TemplateForm
        id={null}
        initialName=""
        settings={settings}
        employeeCount={0}
        initialRows={toRows([
          { name: "Basic Salary", kind: "EARNING", method: "PCT_CTC", value: 50 },
          { name: "House Rent Allowance", kind: "EARNING", method: "PCT_BASIC", value: 50 },
          { name: "Special Allowance", kind: "EARNING", method: "BALANCING", value: 0 },
          { name: "Employer PF", kind: "EMPLOYER", method: "EMPLOYER_PF", value: 0 },
          { name: "Employer ESIC", kind: "EMPLOYER", method: "EMPLOYER_ESIC", value: 0 },
        ])}
      />
    </div>
  );
}
