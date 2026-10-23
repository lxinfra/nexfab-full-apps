import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { formatINR } from "@/lib/format";
import { parseJson } from "@/lib/payroll/types";
import type { Slab } from "@/lib/payroll/calc";
import { addDefaultRules, deleteRule } from "@/app/actions/rules";
import { ConfirmButton } from "@/components/ConfirmButton";

type Rule = Awaited<ReturnType<typeof prisma.deductionRule.findMany>>[number];

const rupees = (n: number) => `₹${formatINR(n, 0)}`;

function baseLabel(rule: Rule) {
  if (rule.baseType === "BASIC") return "Basic";
  if (rule.baseType === "COMPONENTS") return parseJson<string[]>(rule.baseComponents, []).join(" + ");
  return "Gross";
}

function describe(rule: Rule): string {
  const cap = rule.baseCap != null ? ` (base capped at ${rupees(rule.baseCap)})` : "";
  switch (rule.type) {
    case "PERCENTAGE":
      return `${rule.percentage}% of ${baseLabel(rule)}${cap}`;
    case "FIXED":
      return `${rupees(rule.fixedAmount ?? 0)} every month`;
    case "SLAB": {
      const slabs = parseJson<Slab[]>(rule.slabs, []);
      return `Slabs on ${baseLabel(rule)}: ${slabs
        .map((s) => `${rupees(s.from)}${s.to === null ? "+" : `-${rupees(s.to)}`} → ${rupees(s.amount)}`)
        .join(", ")}`;
    }
    case "TDS":
      return "Income tax (new regime) on the yearly salary, one twelfth each month";
    default:
      return "Amount entered each month";
  }
}

function employerLabel(rule: Rule): string {
  if (rule.employerType === "PERCENTAGE") return `${rule.employerValue}% of ${baseLabel(rule)}`;
  if (rule.employerType === "FIXED") return rupees(rule.employerValue ?? 0);
  return "-";
}

export default async function DeductionsPage() {
  const company = await requireCompany();
  const rules = await prisma.deductionRule.findMany({
    where: { companyId: company.id },
    include: { _count: { select: { employees: true } } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Deduction rules</h1>
          <p className="text-sm text-slate-600">
            Rules for {company.name}. They are applied to draft payroll months; finalised months are not affected.
          </p>
        </div>
        <div className="flex gap-2">
          {rules.length === 0 && (
            <ConfirmButton
              action={addDefaultRules}
              title="Add the default rules?"
              confirmLabel="Add default rules"
              className="btn"
              body="This adds PF (0% of Basic), ESI (0% of Gross), PT (₹208 a month) and TDS (10% of Gross). You can edit each one afterwards."
            >
              Add default rules
            </ConfirmButton>
          )}
          <Link href="/deductions/new" className="btn btn-primary">
            + Add rule
          </Link>
        </div>
      </div>

      {rules.length === 0 ? (
        <div className="card text-sm text-slate-600">
          No deduction rules yet, so nothing is deducted from salaries. Add the default rules (PF, ESI, PT, TDS) or
          create your own.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Calculation</th>
                <th>Limits</th>
                <th>Applies to</th>
                <th>Employer contribution</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.name}</td>
                  <td className="max-w-sm">{describe(r)}</td>
                  <td className="text-xs text-slate-600">
                    {r.amountCap != null && <div>Maximum {rupees(r.amountCap)}</div>}
                    {r.eligibilityMaxGross != null && <div>Only if monthly gross ≤ {rupees(r.eligibilityMaxGross)}</div>}
                    {r.amountCap == null && r.eligibilityMaxGross == null && "-"}
                  </td>
                  <td>{r.appliesToAll ? "All employees" : `${r._count.employees} selected`}</td>
                  <td>{employerLabel(r)}</td>
                  <td>
                    <span className={`badge ${r.active ? "bg-green-100 text-green-800" : "bg-slate-200 text-slate-600"}`}>
                      {r.active ? "On" : "Off"}
                    </span>
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <Link href={`/deductions/${r.id}`} className="btn btn-sm">
                        Edit
                      </Link>
                      <ConfirmButton
                        action={deleteRule.bind(null, r.id)}
                        title={`Delete the rule "${r.name}"?`}
                        confirmLabel="Delete rule"
                        body="Draft and future payroll months will no longer include this deduction. Finalised salary slips are not changed."
                      >
                        Delete
                      </ConfirmButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
