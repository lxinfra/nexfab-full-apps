import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { formatINR, monthLabel } from "@/lib/format";

export default async function EmployeeSlipsPage({ params }: { params: Promise<{ id: string }> }) {
  const company = await requireCompany();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const employee = await prisma.employee.findFirst({
    where: { id, companyId: company.id },
    select: { id: true, code: true, name: true, designation: true },
  });
  if (!employee) notFound();

  const slips = await prisma.slip.findMany({
    where: { employeeId: id, run: { companyId: company.id } },
    select: { id: true, month: true, year: true, netPay: true, issuedAt: true, run: { select: { status: true } } },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  const bundle = (last: number | null, format: "zip" | "pdf") =>
    `${base}/api/employees/${id}/slips?format=${format}${last ? `&last=${last}` : ""}`;

  return (
    <div className="space-y-4">
      <Link href="/employees" className="text-sm text-indigo-700 hover:underline">
        ← Employees
      </Link>
      <div>
        <h1 className="page-title">Salary slips: {employee.name}</h1>
        <p className="text-sm text-slate-600">
          <span className="font-mono">{employee.code}</span>
          {employee.designation && ` · ${employee.designation}`} · every slip issued to this employee, newest first.
        </p>
      </div>

      {slips.length === 0 ? (
        <div className="card text-sm text-slate-600">
          No salary slips have been issued to this employee yet. Slips are created when a payroll month is finalised.
          For months in the past, use &quot;Issue salary slips for older months&quot; on the{" "}
          <Link href="/payroll" className="text-indigo-700 underline">
            Payroll
          </Link>{" "}
          page.
        </div>
      ) : (
        <>
          <div className="card flex flex-wrap items-center gap-2 py-3 text-sm">
            <span className="mr-1 font-medium">Download together:</span>
            {[3, 6, 12].map((n) => (
              <a key={n} href={bundle(n, "pdf")} className="btn btn-sm" target="_blank" rel="noreferrer">
                Last {n} months (one PDF)
              </a>
            ))}
            <a href={bundle(null, "pdf")} className="btn btn-sm" target="_blank" rel="noreferrer">
              All (one PDF)
            </a>
            <a href={bundle(null, "zip")} className="btn btn-sm">
              All (ZIP)
            </a>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th className="num">Net pay (₹)</th>
                  <th>Issued on</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {slips.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">
                      {monthLabel(s.month, s.year)}
                      {s.run.status !== "FINALISED" && <span className="badge ml-2 bg-amber-100 text-amber-800">Month reopened</span>}
                    </td>
                    <td className="num">{formatINR(s.netPay)}</td>
                    <td>{s.issuedAt.toLocaleDateString("en-GB")}</td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <a className="btn btn-sm" href={`${base}/api/slips/${s.id}/pdf`}>
                          Download
                        </a>
                        <a className="btn btn-sm" href={`${base}/api/slips/${s.id}/pdf?inline=1`} target="_blank" rel="noreferrer">
                          Print
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500">
            {slips.length} slip(s). Missing an older month? Use &quot;Issue salary slips for older months&quot; on the{" "}
            <Link href="/payroll" className="text-indigo-700 underline">
              Payroll
            </Link>{" "}
            page.
          </p>
        </>
      )}
    </div>
  );
}
