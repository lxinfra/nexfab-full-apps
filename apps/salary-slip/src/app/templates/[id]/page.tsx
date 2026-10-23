import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { loadStructureContext } from "@/lib/ctc/server";
import type { TemplateComponent } from "@/lib/ctc/structure";
import { parseJson } from "@/lib/payroll/types";
import { TemplateForm } from "../TemplateForm";
import { toRows } from "../rows";

export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const company = await requireCompany();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const template = await prisma.salaryTemplate.findFirst({
    where: { id, companyId: company.id },
    include: { _count: { select: { employees: true } } },
  });
  if (!template) notFound();
  const { settings } = await loadStructureContext(company.id);

  return (
    <div className="space-y-4">
      <h1 className="page-title">Edit CTC template</h1>
      <TemplateForm
        id={template.id}
        initialName={template.name}
        settings={settings}
        employeeCount={template._count.employees}
        initialRows={toRows(parseJson<TemplateComponent[]>(template.components, []))}
      />
    </div>
  );
}
