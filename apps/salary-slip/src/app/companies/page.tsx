import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentCompany } from "@/lib/company";
import { deleteCompany } from "@/app/actions/companies";
import { ConfirmButton } from "@/components/ConfirmButton";

export default async function CompaniesPage() {
  const current = await getCurrentCompany();
  const companies = await prisma.company.findMany({
    omit: { logo: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { employees: true, payrollRuns: true } } },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Companies</h1>
        <Link href="/companies/new" className="btn btn-primary">
          + Add company
        </Link>
      </div>

      {companies.length === 0 ? (
        <div className="card text-sm text-slate-600">No companies yet. Add your first company to get started.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>GSTIN / PAN / TAN</th>
                <th className="num">Employees</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      {c.logoMime && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/companies/${c.id}/logo?v=${c.updatedAt.getTime()}`}
                          alt=""
                          className="h-10 w-10 rounded object-contain"
                        />
                      )}
                      <div>
                        <div className="font-medium">
                          {c.name}
                          {current?.id === c.id && <span className="badge ml-2 bg-indigo-100 text-indigo-700">Selected</span>}
                        </div>
                        <div className="max-w-md text-xs text-slate-500">{c.address}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-xs text-slate-600">
                    <div>{c.phone}</div>
                    <div>{c.email}</div>
                    <div>{c.website}</div>
                  </td>
                  <td className="text-xs text-slate-600">
                    <div>{c.gstin ?? "-"}</div>
                    <div>{c.pan ?? "-"}</div>
                    <div>{c.tan ?? "-"}</div>
                  </td>
                  <td className="num">{c._count.employees}</td>
                  <td>
                    <div className="flex justify-end gap-2">
                      <Link href={`/companies/${c.id}`} className="btn btn-sm">
                        Edit
                      </Link>
                      <ConfirmButton
                        action={deleteCompany.bind(null, c.id)}
                        title={`Delete ${c.name}?`}
                        confirmLabel="Delete company"
                        body={
                          <>
                            This permanently deletes the company together with its {c._count.employees} employee(s),
                            deduction rules, {c._count.payrollRuns} payroll month(s) and all issued salary slips. This
                            cannot be undone. Consider downloading a backup first.
                          </>
                        }
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
