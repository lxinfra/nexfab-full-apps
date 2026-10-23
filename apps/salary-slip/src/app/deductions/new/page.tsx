import { requireCompany } from "@/lib/company";
import { ruleFormOptions } from "../options";
import { RuleForm } from "../RuleForm";

export default async function NewRulePage() {
  const company = await requireCompany();
  const options = await ruleFormOptions(company.id);
  return (
    <div className="space-y-4">
      <h1 className="page-title">Add deduction rule</h1>
      <RuleForm
        id={null}
        {...options}
        initial={{
          name: "",
          type: "PERCENTAGE",
          baseType: "BASIC",
          baseComponents: [],
          percentage: "",
          fixedAmount: "",
          slabs: [{ from: "0", to: "", amount: "" }],
          baseCap: "",
          amountCap: "",
          eligibilityMaxGross: "",
          appliesToAll: true,
          employeeIds: [],
          employerType: "NONE",
          employerValue: "",
          active: true,
        }}
      />
    </div>
  );
}
