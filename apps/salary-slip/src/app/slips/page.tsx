import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { MONTHS, formatINR, monthLabel } from "@/lib/format";

export default async function SlipsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; month?: string; year?: string; all?: string }>;
}) {
  const company = await requireCompany();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const month = Number(sp.month) || 0;
  const year = Number(sp.year) || 0;
  const allCompanies = sp.all === "1";

  const slips = await prisma.slip.findMany({
    where: {
      ...(allCompanies ? {} : { run: { companyId: company.id } }),
      ...(month >= 1 && month <= 12 ? { month } : {}),
      ...(year ? { year } : {}),
      ...(q ? { OR: [{ employeeName: { contains: q } }, { employeeCode: { contains: q } }] } : {}),
    },
    select: {
      id: true,
      employeeCode: true,
      employeeName: true,
      month: true,
      year: true,
      netPay: true,
      issuedAt: true,
      run: { select: { status: true, company: { select: { name: true } } } },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }, { employeeCode: "asc" }],
    take: 500,
  });
  const filtered = q || month || year || allCompanies;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Salary slips</h1>
        <p className="text-sm text-slate-600">
          Every slip issued when a month was finalised. Downloads are the stored PDF, exactly as issued.
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="label">Employee name or code</span>
          <input name="q" defaultValue={q} className="input w-64" placeholder="Search..." />
        </label>
        <label className="block">
          <span className="label">Month</span>
          <select name="month" defaultValue={month ? String(month) : ""} className="input w-36">
            <option value="">Any month</option>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Year</span>
          <input name="year" type="number" min="2000" max="2100" defaultValue={year || ""} className="input w-24" placeholder="Any" />
        </label>
        <label className="block">
          <span className="label">Company</span>
          <select name="all" defaultValue={allCompanies ? "1" : ""} className="input w-64">
            <option value="">{company.name}</option>
            <option value="1">All companies</option>
          </select>
        </label>
        <button className="btn btn-primary">Search</button>
        {filtered && (
          <Link href="/slips" className="btn">
            Clear
          </Link>
        )}
      </form>

      {slips.length === 0 ? (
        <div className="card text-sm text-slate-600">
          {filtered
            ? "No salary slips match your search."
            : "No salary slips yet. Slips are created when you finalise a payroll month."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Code</th>
                <th>Employee</th>
                {allCompanies && <th>Company</th>}
                <th className="num">Net pay (₹)</th>
                <th>Issued on</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {slips.map((s) => (
                <tr key={s.id}>
                  <td className="whitespace-nowrap">
                    {monthLabel(s.month, s.year)}
                    {s.run.status !== "FINALISED" && (
                      <span className="badge ml-2 bg-amber-100 text-amber-800" title="The month was reopened; this slip will be replaced when it is finalised again.">
                        Month reopened
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs">{s.employeeCode}</td>
                  <td className="font-medium">{s.employeeName}</td>
                  {allCompanies && <td>{s.run.company.name}</td>}
                  <td className="num">{formatINR(s.netPay)}</td>
                  <td>{s.issuedAt.toLocaleDateString("en-GB")}</td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <a className="btn btn-sm" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/slips/${s.id}/pdf`}>
                        Download
                      </a>
                      <a className="btn btn-sm" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/slips/${s.id}/pdf?inline=1`} target="_blank" rel="noreferrer">
                        Print
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-slate-500">
        {slips.length} slip(s) shown{slips.length === 500 ? " (first 500; narrow your search to see others)" : ""}.
      </p>
    </div>
  );
}
