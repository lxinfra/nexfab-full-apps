import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import type { Slab } from "@/lib/payroll/calc";
import { parseJson } from "@/lib/payroll/types";
import { ruleFormOptions } from "../options";
import { RuleForm } from "../RuleForm";

const str = (n: number | null) => (n === null ? "" : String(n));

export default async function EditRulePage({ params }: { params: Promise<{ id: string }> }) {
  const company = await requireCompany();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const rule = await prisma.deductionRule.findFirst({
    where: { id, companyId: company.id },
    include: { employees: { select: { employeeId: true } } },
  });
  if (!rule) notFound();
  const options = await ruleFormOptions(company.id);
  const slabs = parseJson<Slab[]>(rule.slabs, []);

  return (
    <div className="space-y-4">
      <h1 className="page-title">Edit deduction rule</h1>
      <RuleForm
        id={rule.id}
        {...options}
        initial={{
          name: rule.name,
          type: rule.type,
          baseType: rule.baseType ?? "BASIC",
          baseComponents: parseJson<string[]>(rule.baseComponents, []),
          percentage: str(rule.percentage),
          fixedAmount: str(rule.fixedAmount),
          slabs:
            slabs.length > 0
              ? slabs.map((s) => ({ from: String(s.from), to: str(s.to), amount: String(s.amount) }))
              : [{ from: "0", to: "", amount: "" }],
          baseCap: str(rule.baseCap),
          amountCap: str(rule.amountCap),
          eligibilityMaxGross: str(rule.eligibilityMaxGross),
          appliesToAll: rule.appliesToAll,
          employeeIds: rule.employees.map((e) => e.employeeId),
          employerType: rule.employerType ?? "NONE",
          employerValue: str(rule.employerValue),
          active: rule.active,
        }}
      />
    </div>
  );
}
