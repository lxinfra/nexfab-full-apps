"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { loadStructureContext, syncStoredComponents, today } from "@/lib/ctc/server";
import { parseStatutory, statutorySchema } from "@/lib/ctc/settings";
import { SAMPLE_TEMPLATES, ctcYearly, solveCtc, solveParams, validateTemplate, type TemplateComponent } from "@/lib/ctc/structure";
import { zodErrors, type ActionResult } from "@/lib/validation";

const blankToZero = (v: unknown) => (v === "" || v === null || v === undefined ? 0 : v);

const componentSchema = z.object({
  name: z.string().trim().max(60, "Component names can be at most 60 characters."),
  kind: z.enum(["EARNING", "EMPLOYER", "VARIABLE"]),
  method: z.enum(["PCT_CTC", "PCT_GROSS", "PCT_BASIC", "FIXED", "BALANCING", "EMPLOYER_PF", "EMPLOYER_ESIC"]),
  value: z.preprocess(blankToZero, z.coerce.number({ invalid_type_error: "Values must be numbers." })),
  condition: z
    .object({
      basis: z.enum(["BASIC", "GROSS", "CTC"]),
      op: z.enum(["LTE", "GTE"]),
      source: z.enum(["AMOUNT", "STAT_BONUS_LIMIT"]),
      amount: z.preprocess(
        (v) => (v === "" || v === undefined ? null : v),
        z.coerce.number({ invalid_type_error: "The condition amount must be a number." }).nullable(),
      ),
    })
    .nullable()
    .optional(),
});

const templateSchema = z.object({
  name: z.string().trim().min(1, "Template name is required.").max(60, "Template name is too long."),
  components: z.array(componentSchema),
});

const FIX = "Please fix the problems below.";

export async function saveTemplate(id: number | null, input: unknown): Promise<ActionResult> {
  const company = await requireCompany();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) {
    const errors = zodErrors(parsed.error);
    const componentError = Object.entries(errors).find(([k]) => k.startsWith("components"))?.[1];
    return {
      errors: { ...(errors.name ? { name: errors.name } : {}), ...(componentError ? { components: componentError } : {}) },
      message: FIX,
    };
  }
  const { name } = parsed.data;
  const components: TemplateComponent[] = parsed.data.components.map((c) => ({
    name: c.name,
    kind: c.kind,
    method: c.method,
    value: ["PCT_CTC", "PCT_GROSS", "PCT_BASIC", "FIXED"].includes(c.method) ? c.value : 0,
    ...(c.condition && c.method !== "BALANCING"
      ? { condition: { ...c.condition, amount: c.condition.source === "AMOUNT" ? c.condition.amount : null } }
      : {}),
  }));

  const problems = validateTemplate(components);
  if (problems.length > 0) return { errors: { components: problems.join("\n") }, message: FIX };

  const duplicate = await prisma.salaryTemplate.findFirst({
    where: { companyId: company.id, name, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (duplicate) return { errors: { name: "Another template already has this name." }, message: FIX };

  if (id) {
    const existing = await prisma.salaryTemplate.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
    if (!existing) return { message: "Template not found in the selected company." };

    // Do not save a change that breaks the structure of employees already on this template.
    const { settings } = await loadStructureContext(company.id);
    const employees = await prisma.employee.findMany({
      where: { templateId: id },
      select: { code: true, name: true, ctcAmount: true, ctcPeriod: true },
    });
    const broken: string[] = [];
    for (const e of employees) {
      const r = solveCtc(ctcYearly(e.ctcAmount ?? 0, e.ctcPeriod), components, solveParams(settings, today()));
      if (!r.ok) broken.push(`${e.code} ${e.name}: ${r.error}`);
    }
    if (broken.length > 0) {
      return {
        errors: { components: `These changes do not work for employees already on this template:\n${broken.join("\n")}` },
        message: FIX,
      };
    }
    await prisma.salaryTemplate.update({ where: { id }, data: { name, components: JSON.stringify(components) } });
    await syncStoredComponents(company.id, id);
  } else {
    await prisma.salaryTemplate.create({ data: { companyId: company.id, name, components: JSON.stringify(components) } });
  }
  revalidatePath("/", "layout");
  redirect("/templates");
}

export async function deleteTemplate(id: number): Promise<ActionResult> {
  const company = await requireCompany();
  // Employees on the template keep their current components as a hand-entered structure.
  await prisma.$transaction([
    prisma.employee.updateMany({ where: { companyId: company.id, templateId: id }, data: { ctcAmount: null, ctcPeriod: null } }),
    prisma.salaryTemplate.deleteMany({ where: { id, companyId: company.id } }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Add the two templates from the CTC sheet ("M1 to M4", "M5 & Above") if they are not there yet. */
export async function addSampleTemplates(): Promise<ActionResult> {
  const company = await requireCompany();
  const existing = await prisma.salaryTemplate.findMany({ where: { companyId: company.id }, select: { name: true } });
  const missing = SAMPLE_TEMPLATES.filter((t) => !existing.some((e) => e.name === t.name));
  if (missing.length > 0) {
    await prisma.salaryTemplate.createMany({
      data: missing.map((t) => ({ companyId: company.id, name: t.name, components: JSON.stringify(t.components) })),
    });
  }
  revalidatePath("/templates");
  return { ok: true };
}

export async function saveStatutory(input: unknown): Promise<ActionResult> {
  const company = await requireCompany();
  const parsed = statutorySchema.safeParse(input);
  if (!parsed.success) return { errors: zodErrors(parsed.error), message: "Please fix the highlighted fields." };

  const settings = {
    ...parsed.data,
    pfCeilings: [...parsed.data.pfCeilings].sort((a, b) => a.from.localeCompare(b.from)),
    ptSlabs: [...parsed.data.ptSlabs].sort((a, b) => a.from - b.from),
    tds: {
      ...parsed.data.tds,
      slabs: [...parsed.data.tds.slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity)),
      surcharge: [...parsed.data.tds.surcharge].sort((a, b) => a.above - b.above),
    },
  };
  // Round-trip through the reader so what is stored is exactly what will be used.
  await prisma.company.update({
    where: { id: company.id },
    data: { statutory: JSON.stringify(parseStatutory(JSON.stringify(settings))) },
  });
  const failed = await syncStoredComponents(company.id);
  revalidatePath("/", "layout");
  return {
    ok: true,
    message:
      failed.length > 0
        ? `Saved. With these settings the CTC structure no longer works for: ${failed.join(", ")}. Open those employees to fix their CTC.`
        : "Saved.",
  };
}
