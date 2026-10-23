import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCompany } from "@/lib/company";
import { loadCtcStatement } from "@/lib/ctc/load-statement";
import { formatDate } from "@/lib/format";
import { CtcBreakupView } from "@/components/CtcBreakup";

export default async function EmployeeCtcPage({ params }: { params: Promise<{ id: string }> }) {
  const company = await requireCompany();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const result = await loadCtcStatement(company.id, id);
  if (!result.ok && result.reason === "NOT_FOUND") notFound();

  const back = (
    <Link href="/employees" className="text-sm text-indigo-700 hover:underline">
      ← Employees
    </Link>
  );

  if (!result.ok) {
    return (
      <div className="space-y-4">
        {back}
        <h1 className="page-title">CTC statement: {result.employeeName}</h1>
        <p className={result.reason === "ERROR" ? "alert-error" : "alert-info"}>
          {result.reason === "ERROR"
            ? result.error
            : "This employee is not on a CTC template, so there is no CTC statement."}{" "}
          <Link href={`/employees/${id}`} className="underline">
            Edit the employee
          </Link>{" "}
          to {result.reason === "ERROR" ? "fix the CTC" : "choose a template and enter the CTC"}.
        </p>
      </div>
    );
  }

  const st = result.statement;
  return (
    <div className="space-y-4">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">CTC statement: {st.employee.name}</h1>
          <p className="text-sm text-slate-600">
            <span className="font-mono">{st.employee.code}</span>
            {st.employee.designation && ` · ${st.employee.designation}`} · as on {formatDate(`${st.asOf}T00:00:00.000Z`)}
            {st.breakup.pfCeiling !== null && ` · PF wage ceiling ₹${st.breakup.pfCeiling.toLocaleString("en-IN")}`}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/employees/${id}/ctc?format=pdf`} className="btn btn-primary">
            Download PDF
          </a>
          <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/employees/${id}/ctc?format=xlsx`} className="btn">
            Download Excel
          </a>
          <Link href={`/employees/${id}`} className="btn">
            Edit employee
          </Link>
        </div>
      </div>
      <CtcBreakupView title={st.templateName} breakup={st.breakup} inHand={st.inHand} />
    </div>
  );
}
