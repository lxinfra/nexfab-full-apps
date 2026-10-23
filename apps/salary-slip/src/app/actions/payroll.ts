"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { createRun, finaliseRun, issuePastMonths, loadRun, saveEntries, type PastMonthResult } from "@/lib/payroll/service";
import { monthsBetween } from "@/lib/payroll/joining";
import { entrySchema, zodErrors } from "@/lib/validation";

export interface PayrollActionResult {
  ok?: boolean;
  message?: string;
  /** Error messages keyed by employee id. */
  rowErrors?: Record<string, string>;
}

const periodOk = (year: number, month: number) =>
  Number.isInteger(year) && Number.isInteger(month) && year >= 2000 && year <= 2100 && month >= 1 && month <= 12;

export async function startRun(year: number, month: number): Promise<PayrollActionResult> {
  const company = await requireCompany();
  if (!periodOk(year, month)) return { message: "Choose a valid month and year." };
  const existing = await loadRun(company.id, year, month);
  if (!existing) await createRun(company.id, year, month);
  revalidatePath("/payroll");
  redirect(`/payroll/${year}/${month}`);
}

async function saveDraft(year: number, month: number, input: unknown): Promise<PayrollActionResult & { runId?: number }> {
  const company = await requireCompany();
  const run = await loadRun(company.id, year, month);
  if (!run) return { message: "This payroll month does not exist." };
  if (run.status !== "DRAFT") return { message: "This month is finalised. Reopen it to make changes." };

  const parsed = z.array(entrySchema).safeParse(input);
  if (!parsed.success) {
    // Issue paths look like "3.paidDays": map the array index back to the employee.
    const rowErrors: Record<string, string> = {};
    const list = Array.isArray(input) ? input : [];
    for (const [path, message] of Object.entries(zodErrors(parsed.error))) {
      const employeeId = list[Number(path.split(".")[0])]?.employeeId;
      if (employeeId !== undefined && !rowErrors[employeeId]) rowErrors[employeeId] = message;
    }
    return { message: "Some rows have errors. Nothing was saved.", rowErrors };
  }

  const rowErrors = await saveEntries(run, parsed.data);
  if (Object.keys(rowErrors).length > 0) {
    return { message: "Some rows have errors. Nothing was saved.", rowErrors };
  }
  return { ok: true, runId: run.id };
}

export async function saveRun(year: number, month: number, input: unknown): Promise<PayrollActionResult> {
  const { runId: _runId, ...result } = await saveDraft(year, month, input);
  if (result.ok) revalidatePath(`/payroll/${year}/${month}`);
  return result.ok ? { ok: true, message: "Saved." } : result;
}

export async function finaliseMonth(year: number, month: number, input: unknown): Promise<PayrollActionResult> {
  const saved = await saveDraft(year, month, input);
  if (!saved.ok || !saved.runId) return { message: saved.message, rowErrors: saved.rowErrors };
  const count = await prisma.payrollEntry.count({ where: { runId: saved.runId } });
  if (count === 0) return { message: "There are no employees in this month, so there is nothing to finalise." };
  await finaliseRun(saved.runId);
  revalidatePath("/", "layout");
  return { ok: true, message: "Month finalised. Salary slips are ready." };
}

const MAX_PAST_MONTHS = 36;

/** Issue slips for a range of older months that have no payroll yet. */
export async function issueOlderMonths(
  fromYear: number,
  fromMonth: number,
  toYear: number,
  toMonth: number,
): Promise<PayrollActionResult & { results?: PastMonthResult[] }> {
  const company = await requireCompany();
  if (!periodOk(fromYear, fromMonth) || !periodOk(toYear, toMonth)) return { message: "Choose valid months and years." };
  const from = { year: fromYear, month: fromMonth };
  const to = { year: toYear, month: toMonth };
  const count = monthsBetween(from, to).length;
  if (count === 0) return { message: 'The "From" month must not be after the "To" month.' };
  if (count > MAX_PAST_MONTHS) return { message: `Choose at most ${MAX_PAST_MONTHS} months at a time.` };
  const now = new Date();
  if (toYear > now.getFullYear() || (toYear === now.getFullYear() && toMonth >= now.getMonth() + 1)) {
    return { message: "This is for months before the current one. Run the current month from the payroll list." };
  }
  const results = await issuePastMonths(company.id, from, to);
  revalidatePath("/", "layout");
  return { ok: true, results };
}

export async function reopenMonth(year: number, month: number): Promise<PayrollActionResult> {
  const company = await requireCompany();
  const run = await loadRun(company.id, year, month);
  if (!run) return { message: "This payroll month does not exist." };
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: "DRAFT", finalisedAt: null } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Month reopened." };
}

export async function deleteDraftRun(year: number, month: number): Promise<PayrollActionResult> {
  const company = await requireCompany();
  const run = await loadRun(company.id, year, month);
  if (!run) return { message: "This payroll month does not exist." };
  if (run.status !== "DRAFT") return { message: "Only draft months can be deleted." };
  if (run.slips.length > 0) {
    return {
      message:
        "Salary slips were already issued for this month, so it cannot be deleted. Finalise it again instead.",
    };
  }
  await prisma.payrollRun.delete({ where: { id: run.id } });
  revalidatePath("/payroll");
  redirect("/payroll");
}
