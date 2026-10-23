import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { formatINR, monthLabel } from "@/lib/format";
import { buildRegister, registerTable } from "@/lib/register";
import { StatusBadge } from "@/components/StatusBadge";
import { MonthPicker } from "@/app/payroll/MonthPicker";

const FIRST_AMOUNT_COLUMN = 7;

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const company = await requireCompany();
  const sp = await searchParams;

  // Default to the latest month that has payroll.
  const latest = await prisma.payrollRun.findFirst({
    where: { companyId: company.id },
    orderBy: [{ year: "desc" }, { month: "desc" }],
    select: { year: true, month: true },
  });
  const now = new Date();
  const year = Number(sp.year) || latest?.year || now.getFullYear();
  const month = Number(sp.month) || latest?.month || now.getMonth() + 1;
  const valid = Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12;

  const register = valid ? await buildRegister(company.id, year, month) : null;
  const table = register ? registerTable(register) : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Payroll register</h1>
        <p className="text-sm text-slate-600">All employees and all components for one month of {company.name}.</p>
      </div>

      <div className="card">
        <MonthPicker key={`${year}-${month}`} defaultMonth={month} defaultYear={year} target="register" buttonLabel="Show register" />
      </div>

      {!register || !table ? (
        <div className="card text-sm text-slate-600">
          There is no payroll for {valid ? monthLabel(month, year) : "this month"}.{" "}
          <Link href="/payroll" className="text-indigo-700 underline">
            Go to Payroll
          </Link>{" "}
          to start it.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-3 font-semibold">
              {monthLabel(month, year)} <StatusBadge status={register.status} />
            </h2>
            <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/register/export?year=${year}&month=${month}`} className="btn btn-primary">
              Export to Excel
            </a>
          </div>
          {register.status !== "FINALISED" && (
            <p className="alert-info">
              This month is still a draft. The figures below are from the last saved draft and may change until the
              month is finalised.
            </p>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {table.header.map((h, i) => (
                    <th key={i} className={i >= 4 ? "num" : ""}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, i) => (
                      <td key={i} className={`whitespace-nowrap ${i >= 4 ? "num" : ""} ${i === 1 ? "font-medium" : ""}`}>
                        {i >= FIRST_AMOUNT_COLUMN ? formatINR(Number(cell), 0) : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-semibold">
                  {table.totals.map((cell, i) => (
                    <td key={i} className={`px-3 py-2 whitespace-nowrap ${i >= 4 ? "num" : ""}`}>
                      {i >= FIRST_AMOUNT_COLUMN ? formatINR(Number(cell), 0) : cell}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
