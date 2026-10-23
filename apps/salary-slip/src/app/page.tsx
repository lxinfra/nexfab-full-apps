import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { monthLabel } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export default async function DashboardPage() {
  const company = await requireCompany();
  const [active, inactive, rules, runs] = await Promise.all([
    prisma.employee.count({ where: { companyId: company.id, status: "ACTIVE" } }),
    prisma.employee.count({ where: { companyId: company.id, status: "INACTIVE" } }),
    prisma.deductionRule.count({ where: { companyId: company.id, active: true } }),
    prisma.payrollRun.findMany({
      where: { companyId: company.id },
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: 6,
      include: { _count: { select: { entries: true } } },
    }),
  ]);

  const steps = [
    { done: active > 0, text: "Add your employees and their salary structure", href: "/employees", cta: "Employees" },
    { done: rules > 0, text: "Set up deduction rules (PF, ESI, Professional Tax...)", href: "/deductions", cta: "Deductions" },
    { done: runs.length > 0, text: "Run payroll for a month and finalise it", href: "/payroll", cta: "Payroll" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">{company.name}</h1>
        <p className="text-sm text-slate-600">{company.address}</p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Link href="/employees" className="card hover:border-indigo-300">
          <div className="text-3xl font-semibold">{active}</div>
          <div className="text-sm text-slate-600">
            Active employees{inactive > 0 ? ` (${inactive} inactive)` : ""}
          </div>
        </Link>
        <Link href="/deductions" className="card hover:border-indigo-300">
          <div className="text-3xl font-semibold">{rules}</div>
          <div className="text-sm text-slate-600">Deduction rules</div>
        </Link>
        <Link href="/payroll" className="card hover:border-indigo-300">
          <div className="text-3xl font-semibold">{runs[0] ? monthLabel(runs[0].month, runs[0].year) : "-"}</div>
          <div className="text-sm text-slate-600">Latest payroll month</div>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h2 className="mb-3 font-semibold">Getting started</h2>
          <ol className="space-y-2 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className={s.done ? "text-slate-500" : ""}>
                  {s.done ? "✓" : `${i + 1}.`} {s.text}
                </span>
                <Link href={s.href} className="btn btn-sm shrink-0">
                  {s.cta}
                </Link>
              </li>
            ))}
          </ol>
        </div>

        <div className="card">
          <h2 className="mb-3 font-semibold">Recent payroll months</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No payroll has been run yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between py-1.5">
                  <Link href={`/payroll/${r.year}/${r.month}`} className="font-medium text-indigo-700 hover:underline">
                    {monthLabel(r.month, r.year)}
                  </Link>
                  <span className="flex items-center gap-3 text-slate-500">
                    {r._count.entries} employees <StatusBadge status={r.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
