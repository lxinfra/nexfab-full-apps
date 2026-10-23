// Database side of the CTC structure feature.
import { prisma } from "@/lib/db";
import { daysInMonth } from "@/lib/format";
import type { EarningComponent } from "@/lib/payroll/calc";
import { parseJson } from "@/lib/payroll/types";
import { isoDate, parseStatutory, type StatutorySettings } from "./settings";
import { ctcYearly, payrollComponents, solveCtc, solveParams, type SolveResult, type TemplateComponent } from "./structure";

export interface StructureContext {
  settings: StatutorySettings;
  templates: Map<number, { name: string; components: TemplateComponent[] }>;
}

export async function loadStructureContext(companyId: number): Promise<StructureContext> {
  const [company, templates] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { statutory: true } }),
    prisma.salaryTemplate.findMany({ where: { companyId } }),
  ]);
  return {
    settings: parseStatutory(company?.statutory),
    templates: new Map(
      templates.map((t) => [t.id, { name: t.name, components: parseJson<TemplateComponent[]>(t.components, []) }]),
    ),
  };
}

interface StructuredEmployee {
  templateId: number | null;
  ctcAmount: number | null;
  ctcPeriod: string | null;
}

/** The CTC breakup of an employee on a date, or null if they have no template. */
export function employeeBreakup(employee: StructuredEmployee, ctx: StructureContext, asOf: string): SolveResult | null {
  const template = employee.templateId !== null ? ctx.templates.get(employee.templateId) : undefined;
  if (!template || employee.ctcAmount === null) return null;
  return solveCtc(ctcYearly(employee.ctcAmount, employee.ctcPeriod), template.components, solveParams(ctx.settings, asOf));
}

/**
 * Monthly salary components used by payroll. Employees on a template get them
 * from their CTC structure as it stands on `asOf`; everyone else (and anyone
 * whose structure cannot be worked out) uses the components stored on the employee.
 */
export function employeeComponents(
  employee: StructuredEmployee & { components: { name: string; monthlyAmount: number }[] },
  ctx: StructureContext,
  asOf: string,
): EarningComponent[] {
  const result = employeeBreakup(employee, ctx, asOf);
  if (result?.ok) return payrollComponents(result.breakup);
  return employee.components.map((c) => ({ name: c.name, monthlyAmount: c.monthlyAmount }));
}

/** Payroll months use the statutory figures in force on the last day of the month. */
export function monthEnd(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(month, year)).padStart(2, "0")}`;
}

export const today = () => isoDate(new Date());

/**
 * Refresh the components stored on templated employees (used by lists, exports
 * and as the fallback above) after a template or the statutory settings change.
 * Employees whose structure no longer works keep what they had.
 * Returns the names of those employees.
 */
export async function syncStoredComponents(companyId: number, templateId?: number): Promise<string[]> {
  const ctx = await loadStructureContext(companyId);
  const employees = await prisma.employee.findMany({
    where: { companyId, templateId: templateId ?? { not: null } },
    select: { id: true, name: true, templateId: true, ctcAmount: true, ctcPeriod: true },
  });
  const failed: string[] = [];
  for (const e of employees) {
    const result = employeeBreakup(e, ctx, today());
    if (!result?.ok) {
      failed.push(e.name);
      continue;
    }
    await prisma.$transaction([
      prisma.salaryComponent.deleteMany({ where: { employeeId: e.id } }),
      prisma.salaryComponent.createMany({
        data: payrollComponents(result.breakup).map((c, i) => ({ ...c, employeeId: e.id, sortOrder: i })),
      }),
    ]);
  }
  return failed;
}
