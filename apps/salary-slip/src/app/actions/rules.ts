"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { ruleSchema, zodErrors, type ActionResult } from "@/lib/validation";
import defaultRules from "../../../prisma/default-rules.json";

export async function saveRule(id: number | null, input: unknown): Promise<ActionResult> {
  const company = await requireCompany();
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: zodErrors(parsed.error), message: "Please fix the highlighted fields." };
  }
  const d = parsed.data;

  const duplicate = await prisma.deductionRule.findFirst({
    where: { companyId: company.id, name: d.name, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (duplicate) {
    return { errors: { name: "Another rule already has this name." }, message: "Please fix the highlighted fields." };
  }

  const usesBase = d.type === "PERCENTAGE" || d.type === "SLAB" || d.employerType === "PERCENTAGE";
  const baseType = usesBase ? (d.baseType ?? "GROSS") : null;
  const employeeIds = d.appliesToAll
    ? []
    : (
        await prisma.employee.findMany({
          where: { companyId: company.id, id: { in: d.employeeIds } },
          select: { id: true },
        })
      ).map((e) => e.id);

  // Only keep the fields that belong to the chosen rule type.
  const data = {
    name: d.name,
    type: d.type,
    baseType,
    baseComponents: baseType === "COMPONENTS" ? JSON.stringify(d.baseComponents) : null,
    percentage: d.type === "PERCENTAGE" ? d.percentage : null,
    fixedAmount: d.type === "FIXED" ? d.fixedAmount : null,
    slabs: d.type === "SLAB" ? JSON.stringify([...d.slabs].sort((a, b) => a.from - b.from)) : null,
    baseCap: usesBase ? d.baseCap : null,
    amountCap: d.amountCap,
    eligibilityMaxGross: d.eligibilityMaxGross,
    appliesToAll: d.appliesToAll,
    employerType: d.employerType,
    employerValue: d.employerType === "NONE" ? null : d.employerValue,
    active: d.active,
  };
  const links = { create: employeeIds.map((employeeId) => ({ employeeId })) };

  if (id) {
    const existing = await prisma.deductionRule.findFirst({ where: { id, companyId: company.id }, select: { id: true } });
    if (!existing) return { message: "Rule not found in the selected company." };
    await prisma.$transaction([
      prisma.deductionRuleEmployee.deleteMany({ where: { ruleId: id } }),
      prisma.deductionRule.update({ where: { id }, data: { ...data, employees: links } }),
    ]);
  } else {
    await prisma.deductionRule.create({ data: { ...data, companyId: company.id, employees: links } });
  }
  revalidatePath("/deductions");
  redirect("/deductions");
}

/** Add the default rules (PF 0%, ESI 0%, PT 208, TDS 10%) that the company does not have yet. */
export async function addDefaultRules(): Promise<ActionResult> {
  const company = await requireCompany();
  const existing = await prisma.deductionRule.findMany({ where: { companyId: company.id }, select: { name: true } });
  const missing = defaultRules.filter((r) => !existing.some((e) => e.name.toLowerCase() === r.name.toLowerCase()));
  if (missing.length > 0) {
    await prisma.deductionRule.createMany({ data: missing.map((r) => ({ ...r, companyId: company.id })) });
  }
  revalidatePath("/deductions");
  return { ok: true };
}

export async function deleteRule(id: number): Promise<ActionResult> {
  const company = await requireCompany();
  await prisma.deductionRule.deleteMany({ where: { id, companyId: company.id } });
  revalidatePath("/deductions");
  return { ok: true };
}
