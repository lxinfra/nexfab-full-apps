import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { toDateInput } from "@/lib/format";
import Link from "next/link";
import { loadStructureContext } from "@/lib/ctc/server";
import { EmployeeForm } from "../EmployeeForm";

export default async function EditEmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const company = await requireCompany();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const e = await prisma.employee.findFirst({
    where: { id, companyId: company.id },
    include: { components: { orderBy: { sortOrder: "asc" } } },
  });
  if (!e) notFound();
  const structure = await loadStructureContext(company.id);
  const templates = [...structure.templates].map(([id, t]) => ({ id, ...t }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Edit employee</h1>
        {e.templateId !== null && (
          <Link href={`/employees/${e.id}/ctc`} className="btn">
            CTC statement
          </Link>
        )}
      </div>
      <p className="text-sm text-slate-600">
        Changes apply to draft and future payroll months. Finalised salary slips are never changed.
      </p>
      <EmployeeForm
        id={e.id}
        templates={templates}
        settings={structure.settings}
        initial={{
          code: e.code,
          name: e.name,
          designation: e.designation ?? "",
          department: e.department ?? "",
          dateOfJoining: toDateInput(e.dateOfJoining),
          pan: e.pan ?? "",
          uan: e.uan ?? "",
          esiNumber: e.esiNumber ?? "",
          bankName: e.bankName ?? "",
          bankAccount: e.bankAccount ?? "",
          ifsc: e.ifsc ?? "",
          status: e.status,
          components: e.components.map((c) => ({ name: c.name, monthlyAmount: String(c.monthlyAmount) })),
          templateId: e.templateId === null ? "" : String(e.templateId),
          ctcAmount: e.ctcAmount === null ? "" : String(e.ctcAmount),
          ctcPeriod: e.ctcPeriod ?? "YEARLY",
        }}
      />
    </div>
  );
}
