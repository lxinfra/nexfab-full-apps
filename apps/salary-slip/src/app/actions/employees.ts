"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { mapImportRows, readTable } from "@/lib/employees-io";
import { employeeSchema, zodErrors, type ActionResult, type EmployeeData } from "@/lib/validation";
import { employeeBreakup, loadStructureContext, today } from "@/lib/ctc/server";
import { payrollComponents } from "@/lib/ctc/structure";

/** The plain employee columns (no salary components, no CTC structure). */
function employeeFields(data: EmployeeData) {
  const { components: _components, templateId: _t, ctcAmount: _a, ctcPeriod: _p, ...fields } = data;
  return fields;
}

const componentRows = (data: EmployeeData) =>
  data.components.map((c, i) => ({ name: c.name, monthlyAmount: c.monthlyAmount, sortOrder: i }));

export async function saveEmployee(id: number | null, input: unknown): Promise<ActionResult> {
  const company = await requireCompany();
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: zodErrors(parsed.error), message: "Please fix the highlighted fields." };
  }
  const data = parsed.data;
  const FIX = "Please fix the highlighted fields.";

  // On a CTC template, the salary components come from the structure.
  let structure: { templateId: number | null; ctcAmount: number | null; ctcPeriod: string | null } = {
    templateId: null,
    ctcAmount: null,
    ctcPeriod: null,
  };
  if (data.templateId !== null) {
    structure = { templateId: data.templateId, ctcAmount: data.ctcAmount, ctcPeriod: data.ctcPeriod };
    const result = employeeBreakup(structure, await loadStructureContext(company.id), today());
    if (!result) return { errors: { templateId: "This template no longer exists. Choose another one." }, message: FIX };
    if (!result.ok) return { errors: { ctcAmount: result.error }, message: FIX };
    data.components = payrollComponents(result.breakup);
  }

  const duplicate = await prisma.employee.findFirst({
    where: { companyId: company.id, code: data.code, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (duplicate) {
    return { errors: { code: "Another employee already has this code." }, message: "Please fix the highlighted fields." };
  }

  if (id) {
    const existing = await prisma.employee.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
    if (!existing) return { message: "Employee not found in the selected company." };
    await prisma.$transaction([
      prisma.salaryComponent.deleteMany({ where: { employeeId: id } }),
      prisma.employee.update({
        where: { id },
        data: { ...employeeFields(data), ...structure, components: { create: componentRows(data) } },
      }),
    ]);
  } else {
    await prisma.employee.create({
      data: { ...employeeFields(data), ...structure, companyId: company.id, components: { create: componentRows(data) } },
    });
  }
  revalidatePath("/employees");
  redirect("/employees");
}

export async function deleteEmployee(id: number): Promise<ActionResult> {
  const company = await requireCompany();
  const employee = await prisma.employee.findFirst({
    where: { id, companyId: company.id },
    select: { id: true, _count: { select: { entries: true } } },
  });
  if (!employee) return { message: "Employee not found." };
  if (employee._count.entries > 0) {
    return {
      message: "This employee appears in payroll months and cannot be deleted. Mark them Inactive instead.",
    };
  }
  await prisma.employee.delete({ where: { id } });
  revalidatePath("/employees");
  return { ok: true };
}

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
  message?: string;
}

export async function importEmployees(_prev: ImportResult | null, form: FormData): Promise<ImportResult> {
  const company = await requireCompany();
  const result: ImportResult = { created: 0, updated: 0, errors: [] };
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ...result, message: "Choose a CSV or Excel file first." };

  let mapped;
  try {
    mapped = mapImportRows(await readTable(file.name, await file.arrayBuffer()));
  } catch (e) {
    return { ...result, message: e instanceof Error ? e.message : "The file could not be read." };
  }
  if (mapped.rows.length === 0) return { ...result, message: "The file has a header but no employee rows." };

  const seenCodes = new Set<string>();
  for (const row of mapped.rows) {
    if (row.error) {
      result.errors.push({ row: row.rowNumber, message: row.error });
      continue;
    }
    const parsed = employeeSchema.safeParse(row.data);
    if (!parsed.success) {
      result.errors.push({ row: row.rowNumber, message: Object.values(zodErrors(parsed.error)).join(" ") });
      continue;
    }
    const data = parsed.data;
    if (seenCodes.has(data.code)) {
      result.errors.push({ row: row.rowNumber, message: `Employee code "${data.code}" appears more than once in the file.` });
      continue;
    }
    seenCodes.add(data.code);

    const existing = await prisma.employee.findUnique({
      where: { companyId_code: { companyId: company.id, code: data.code } },
      select: { id: true, templateId: true },
    });
    if (existing) {
      // Keep the current salary structure when the file has no salary columns,
      // or when the employee's salary comes from a CTC template.
      const replace = mapped.hasComponents && existing.templateId === null;
      await prisma.$transaction([
        ...(replace ? [prisma.salaryComponent.deleteMany({ where: { employeeId: existing.id } })] : []),
        prisma.employee.update({
          where: { id: existing.id },
          data: {
            ...employeeFields(data),
            ...(replace ? { components: { create: componentRows(data) } } : {}),
          },
        }),
      ]);
      result.updated++;
    } else {
      await prisma.employee.create({
        data: { ...employeeFields(data), companyId: company.id, components: { create: componentRows(data) } },
      });
      result.created++;
    }
  }
  revalidatePath("/employees");
  return result;
}
