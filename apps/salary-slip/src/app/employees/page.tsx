import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { formatDate, formatINR } from "@/lib/format";
import { deleteEmployee } from "@/app/actions/employees";
import { ConfirmButton } from "@/components/ConfirmButton";
import { StatusBadge } from "@/components/StatusBadge";
import { ImportBox } from "./ImportBox";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const company = await requireCompany();
  const { q = "", status = "" } = await searchParams;
  const term = q.trim();

  const employees = await prisma.employee.findMany({
    where: {
      companyId: company.id,
      ...(status === "ACTIVE" || status === "INACTIVE" ? { status } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term } },
              { code: { contains: term } },
              { designation: { contains: term } },
              { department: { contains: term } },
            ],
          }
        : {}),
    },
    include: { components: true, template: { select: { name: true } } },
    orderBy: { code: "asc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="page-title">Employees</h1>
        <div className="flex flex-wrap gap-2">
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/employees/export?format=xlsx`} className="btn">
            Export Excel
          </a>
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/employees/export?format=csv`} className="btn">
            Export CSV
          </a>
          <Link href="/employees/new" className="btn btn-primary">
            + Add employee
          </Link>
        </div>
      </div>

      <ImportBox />

      <form className="flex flex-wrap items-end gap-2" method="get">
        <label className="block">
          <span className="label">Search</span>
          <input name="q" defaultValue={q} placeholder="Name, code, designation..." className="input w-72" />
        </label>
        <label className="block">
          <span className="label">Status</span>
          <select name="status" defaultValue={status} className="input w-36">
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </label>
        <button className="btn">Search</button>
        {(q || status) && (
          <Link href="/employees" className="btn">
            Clear
          </Link>
        )}
      </form>

      {employees.length === 0 ? (
        <div className="card text-sm text-slate-600">
          {q || status
            ? "No employees match your search."
            : "No employees yet. Add one, or import a CSV / Excel file."}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Designation</th>
                <th>Department</th>
                <th>Joined</th>
                <th>CTC structure</th>
                <th className="num">Monthly gross (₹)</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id}>
                  <td className="font-mono text-xs">{e.code}</td>
                  <td className="font-medium">
                    <Link href={`/employees/${e.id}`} className="text-indigo-700 hover:underline">
                      {e.name}
                    </Link>
                  </td>
                  <td>{e.designation}</td>
                  <td>{e.department}</td>
                  <td>{formatDate(e.dateOfJoining)}</td>
                  <td className="text-xs">
                    {e.template && e.ctcAmount !== null ? (
                      <Link href={`/employees/${e.id}/ctc`} className="text-indigo-700 hover:underline">
                        {e.template.name} · ₹{formatINR(e.ctcAmount, 0)}/{e.ctcPeriod === "MONTHLY" ? "month" : "year"}
                      </Link>
                    ) : (
                      <span className="text-slate-400">by hand</span>
                    )}
                  </td>
                  <td className="num">{formatINR(e.components.reduce((a, c) => a + c.monthlyAmount, 0))}</td>
                  <td>
                    <StatusBadge status={e.status} />
                  </td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <Link href={`/employees/${e.id}/slips`} className="btn btn-sm">
                        Slips
                      </Link>
                      <Link href={`/employees/${e.id}`} className="btn btn-sm">
                        Edit
                      </Link>
                      <ConfirmButton
                        action={deleteEmployee.bind(null, e.id)}
                        title={`Delete ${e.name}?`}
                        confirmLabel="Delete employee"
                        body="This removes the employee and their salary structure. Employees who already appear in a payroll month cannot be deleted; mark them Inactive instead."
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
      <p className="text-xs text-slate-500">{employees.length} employee(s) shown.</p>
    </div>
  );
}
