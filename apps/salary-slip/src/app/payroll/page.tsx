import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { formatINR, monthLabel } from "@/lib/format";
import type { PayrollResult } from "@/lib/payroll/calc";
import { parseJson } from "@/lib/payroll/types";
import { StatusBadge } from "@/components/StatusBadge";
import { MonthPicker } from "./MonthPicker";
import { OlderMonths } from "./OlderMonths";

export default async function PayrollPage() {
  const company = await requireCompany();
  const runs = await prisma.payrollRun.findMany({
    where: { companyId: company.id },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    include: { entries: { select: { computed: true } } },
  });
  const now = new Date();
  // Default range for older months: the six months before the current one.
  const monthBack = (n: number) => {
    const d = new Date(now.getFullYear(), now.getMonth() - n, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Payroll</h1>
        <p className="text-sm text-slate-600">Monthly payroll runs for {company.name}.</p>
      </div>

      <div className="card">
        <h2 className="mb-2 font-semibold">Open a month</h2>
        <MonthPicker defaultMonth={now.getMonth() + 1} defaultYear={now.getFullYear()} />
      </div>

      <OlderMonths defaultFrom={monthBack(6)} defaultTo={monthBack(1)} />

      {runs.length === 0 ? (
        <div className="card text-sm text-slate-600">No payroll months yet. Pick a month above to start.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Status</th>
                <th className="num">Employees</th>
                <th className="num">Net pay (₹)</th>
                <th>Finalised on</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const net = r.entries.reduce(
                  (a, e) => a + (parseJson<Partial<PayrollResult>>(e.computed, {}).netPay ?? 0),
                  0,
                );
                return (
                  <tr key={r.id}>
                    <td className="font-medium">
                      <Link href={`/payroll/${r.year}/${r.month}`} className="text-indigo-700 hover:underline">
                        {monthLabel(r.month, r.year)}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="num">{r.entries.length}</td>
                    <td className="num">{r.status === "FINALISED" ? formatINR(net) : "-"}</td>
                    <td>{r.finalisedAt ? r.finalisedAt.toLocaleDateString("en-GB") : "-"}</td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <Link href={`/payroll/${r.year}/${r.month}`} className="btn btn-sm">
                          {r.status === "FINALISED" ? "View" : "Continue"}
                        </Link>
                        {r.status === "FINALISED" && (
                          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/runs/${r.id}/zip`} className="btn btn-sm">
                            Slips (ZIP)
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
