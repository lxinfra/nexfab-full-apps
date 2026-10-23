import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { formatINR } from "@/lib/format";
import { parseJson } from "@/lib/payroll/types";
import { SAMPLE_TEMPLATES, type TemplateComponent } from "@/lib/ctc/structure";
import { addSampleTemplates, deleteTemplate } from "@/app/actions/templates";
import { ConfirmButton } from "@/components/ConfirmButton";

function describe(c: TemplateComponent): string {
  switch (c.method) {
    case "PCT_CTC":
      return `${c.value}% of CTC`;
    case "PCT_GROSS":
      return `${c.value}% of Gross`;
    case "PCT_BASIC":
      return `${c.value}% of Basic`;
    case "FIXED":
      return `₹${formatINR(c.value, 0)}`;
    case "BALANCING":
      return "balancing";
    case "EMPLOYER_PF":
      return "statutory PF";
    case "EMPLOYER_ESIC":
      return "statutory ESIC";
  }
}

export default async function TemplatesPage() {
  const company = await requireCompany();
  const templates = await prisma.salaryTemplate.findMany({
    where: { companyId: company.id },
    include: { _count: { select: { employees: true } } },
    orderBy: { name: "asc" },
  });
  const samplesMissing = SAMPLE_TEMPLATES.filter((s) => !templates.some((t) => t.name === s.name));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="page-title">CTC templates</h1>
          <p className="text-sm text-slate-600">
            Salary structures for {company.name}, one per grade. An employee on a template gets their salary
            components from their CTC.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/templates/settings" className="btn">
            Statutory settings
          </Link>
          <Link href="/templates/new" className="btn btn-primary">
            + Add template
          </Link>
        </div>
      </div>

      {samplesMissing.length > 0 && (
        <div className="card flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <span>
            Start from the CTC sheet: add the ready-made template{samplesMissing.length > 1 ? "s" : ""}{" "}
            {samplesMissing.map((s) => `"${s.name}"`).join(" and ")}. You can edit them afterwards.
          </span>
          <ConfirmButton
            action={addSampleTemplates}
            title="Add the ready-made templates?"
            confirmLabel="Add templates"
            className="btn"
            body={`This adds ${samplesMissing.map((s) => `"${s.name}"`).join(" and ")} to ${company.name}.`}
          >
            Add ready-made templates
          </ConfirmButton>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="card text-sm text-slate-600">No templates yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Components</th>
                <th className="num">Employees</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => {
                const components = parseJson<TemplateComponent[]>(t.components, []);
                return (
                  <tr key={t.id}>
                    <td className="font-medium whitespace-nowrap">{t.name}</td>
                    <td className="text-xs text-slate-600">
                      {components.map((c) => `${c.name} (${describe(c)}${c.condition ? ", conditional" : ""})`).join(" · ")}
                    </td>
                    <td className="num">{t._count.employees}</td>
                    <td>
                      <div className="flex justify-end gap-2">
                        <Link href={`/templates/${t.id}`} className="btn btn-sm">
                          Edit
                        </Link>
                        <ConfirmButton
                          action={deleteTemplate.bind(null, t.id)}
                          title={`Delete the template "${t.name}"?`}
                          confirmLabel="Delete template"
                          body={
                            t._count.employees > 0
                              ? `${t._count.employees} employee(s) use this template. They keep their current monthly components as a hand-entered salary structure, but lose the link to their CTC.`
                              : "No employees use this template."
                          }
                        >
                          Delete
                        </ConfirmButton>
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
