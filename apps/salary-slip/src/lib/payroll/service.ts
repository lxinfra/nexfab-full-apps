// Database side of the payroll run. All arithmetic is delegated to calc.ts.
import { prisma } from "@/lib/db";
import { daysInMonth, maskAccount } from "@/lib/format";
import { renderSlipPdf } from "@/lib/pdf/SlipDocument";
import type { EntryData } from "@/lib/validation";
import { employeeComponents, loadStructureContext, monthEnd } from "@/lib/ctc/server";
import type { TdsSettings } from "@/lib/ctc/tds";
import { calculatePayroll, type DeductionRuleInput, type EarningComponent, type NamedAmount, type PayrollInput, type PayrollOverrides } from "./calc";
import { defaultPaidDays, monthsBetween, type Period } from "./joining";
import { parseJson, toRuleInput, type SlipSnapshot, type StoredManualDeductions } from "./types";

export async function loadRun(companyId: number, year: number, month: number) {
  return prisma.payrollRun.findUnique({
    where: { companyId_month_year: { companyId, month, year } },
    include: {
      entries: {
        include: { employee: { include: { components: { orderBy: { sortOrder: "asc" } } } } },
        orderBy: { employee: { code: "asc" } },
      },
      slips: { select: { id: true, employeeId: true } },
    },
  });
}

export type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;
export type LoadedEntry = LoadedRun["entries"][number];

export async function loadRules(companyId: number) {
  return prisma.deductionRule.findMany({
    where: { companyId, active: true },
    include: { employees: { select: { employeeId: true } } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
}

type LoadedRules = Awaited<ReturnType<typeof loadRules>>;

/** Rules that apply to one employee ("all employees" or explicitly selected). */
export function rulesFor(rules: LoadedRules, employeeId: number, tds?: TdsSettings): DeductionRuleInput[] {
  return rules
    .filter((r) => r.appliesToAll || r.employees.some((e) => e.employeeId === employeeId))
    .map((r) => toRuleInput(r, tds));
}

/**
 * Everything needed to calculate a draft month: the deduction rules, and for
 * each entry the employee's salary components (from their CTC structure when
 * they have one) and the rules that apply to them.
 */
export async function loadCalculation(run: { companyId: number; year: number; month: number }) {
  const [rules, structure] = await Promise.all([loadRules(run.companyId), loadStructureContext(run.companyId)]);
  const asOf = monthEnd(run.year, run.month);
  return {
    componentsFor: (entry: LoadedEntry) => employeeComponents(entry.employee, structure, asOf),
    rulesFor: (employeeId: number) => rulesFor(rules, employeeId, structure.settings.tds),
  };
}

export type Calculation = Awaited<ReturnType<typeof loadCalculation>>;

export function entryToInput(entry: LoadedEntry, calc: Calculation): PayrollInput {
  const manual = parseJson<StoredManualDeductions>(entry.manualDeductions, {});
  const components: EarningComponent[] = calc.componentsFor(entry);
  const rules = calc.rulesFor(entry.employeeId);
  return {
    totalDays: entry.totalDays,
    paidDays: entry.paidDays,
    components,
    arrears: entry.arrears,
    oneTimeEarnings: parseJson<NamedAmount[]>(entry.oneTimeEarnings, []),
    rules,
    manualAmounts: manual.rules ?? {},
    adhocDeductions: manual.adhoc ?? [],
    overrides: parseJson<PayrollOverrides>(entry.overrides, {}),
  };
}

/**
 * Starting entries for a month: employees who have joined by then, with full
 * paid days (or, in their joining month, the days from the joining date).
 */
function startingEntries(employees: { id: number; dateOfJoining: Date | null }[], year: number, month: number) {
  const totalDays = daysInMonth(month, year);
  return employees.flatMap((e) => {
    const paidDays = defaultPaidDays(e.dateOfJoining, year, month);
    return paidDays === null ? [] : [{ employeeId: e.id, totalDays, paidDays, lopDays: totalDays - paidDays }];
  });
}

/** Create the month's run with one entry per active employee who has joined by that month. */
export async function createRun(companyId: number, year: number, month: number) {
  const employees = await prisma.employee.findMany({
    where: { companyId, status: "ACTIVE" },
    select: { id: true, dateOfJoining: true },
  });
  return prisma.payrollRun.create({
    data: { companyId, year, month, entries: { create: startingEntries(employees, year, month) } },
  });
}

export interface PastMonthResult extends Period {
  outcome: "ISSUED" | "EXISTS" | "NO_EMPLOYEES";
  slips: number;
}

/**
 * Issue salary slips for a range of months in one go. Months that already have
 * payroll are left alone; months in which nobody had joined yet are skipped.
 * Each new month is finalised with the starting entries above; it can be
 * reopened afterwards like any other month.
 */
export async function issuePastMonths(companyId: number, from: Period, to: Period): Promise<PastMonthResult[]> {
  const results: PastMonthResult[] = [];
  for (const { year, month } of monthsBetween(from, to)) {
    const existing = await prisma.payrollRun.findUnique({
      where: { companyId_month_year: { companyId, month, year } },
      select: { id: true },
    });
    if (existing) {
      results.push({ year, month, outcome: "EXISTS", slips: 0 });
      continue;
    }
    const run = await createRun(companyId, year, month);
    const slips = await prisma.payrollEntry.count({ where: { runId: run.id } });
    if (slips === 0) {
      await prisma.payrollRun.delete({ where: { id: run.id } });
      results.push({ year, month, outcome: "NO_EMPLOYEES", slips: 0 });
      continue;
    }
    await finaliseRun(run.id);
    results.push({ year, month, outcome: "ISSUED", slips });
  }
  return results;
}

/**
 * A draft month always lists the active employees who have joined by that
 * month: add those who were created or re-activated later, drop those who were
 * made inactive.
 * Returns true when anything changed.
 */
export async function syncDraftEmployees(run: { id: number; companyId: number; year: number; month: number }) {
  const candidates = await prisma.employee.findMany({
    where: { companyId: run.companyId, status: "ACTIVE", entries: { none: { runId: run.id } } },
    select: { id: true, dateOfJoining: true },
  });
  // Employees who join after this month are not part of it.
  const missing = startingEntries(candidates, run.year, run.month);
  if (missing.length > 0) {
    await prisma.payrollEntry.createMany({ data: missing.map((e) => ({ ...e, runId: run.id })) });
  }
  const removed = await prisma.payrollEntry.deleteMany({
    where: { runId: run.id, employee: { status: { not: "ACTIVE" } } },
  });
  return missing.length > 0 || removed.count > 0;
}

/** Save the month's inputs and recompute. Returns error messages keyed by employee id. */
export async function saveEntries(run: LoadedRun, data: EntryData[]): Promise<Record<string, string>> {
  const calc = await loadCalculation(run);
  const errors: Record<string, string> = {};
  const updates = [];

  for (const d of data) {
    const entry = run.entries.find((e) => e.employeeId === d.employeeId);
    if (!entry) continue;
    if (d.paidDays > entry.totalDays) {
      errors[d.employeeId] = `Paid days cannot be more than ${entry.totalDays}.`;
      continue;
    }
    const manual: StoredManualDeductions = { rules: d.manualRules, adhoc: d.adhoc };
    const updated: LoadedEntry = {
      ...entry,
      paidDays: d.paidDays,
      lopDays: Number((entry.totalDays - d.paidDays).toFixed(2)),
      arrears: d.arrears,
      oneTimeEarnings: JSON.stringify(d.oneTimeEarnings),
      manualDeductions: JSON.stringify(manual),
      overrides: JSON.stringify(d.overrides),
    };
    const result = calculatePayroll(entryToInput(updated, calc));
    updates.push(
      prisma.payrollEntry.update({
        where: { id: entry.id },
        data: {
          paidDays: updated.paidDays,
          lopDays: updated.lopDays,
          arrears: updated.arrears,
          oneTimeEarnings: updated.oneTimeEarnings,
          manualDeductions: updated.manualDeductions,
          overrides: updated.overrides,
          computed: JSON.stringify(result),
        },
      }),
    );
  }

  if (Object.keys(errors).length === 0) await prisma.$transaction(updates);
  return errors;
}

/** Lock the month: compute every entry, freeze a snapshot and the PDF for each slip. */
export async function finaliseRun(runId: number) {
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId }, include: { company: true } });
  const loaded = await loadRun(run.companyId, run.year, run.month);
  if (!loaded) throw new Error("Payroll run not found.");
  const calc = await loadCalculation(run);
  const { company } = run;
  const logo =
    company.logo && company.logoMime
      ? `data:${company.logoMime};base64,${Buffer.from(company.logo).toString("base64")}`
      : null;

  const slips = [];
  for (const entry of loaded.entries) {
    const result = calculatePayroll(entryToInput(entry, calc));
    const e = entry.employee;
    const snapshot: SlipSnapshot = {
      month: run.month,
      year: run.year,
      company: {
        name: company.name,
        address: company.address,
        phone: company.phone,
        email: company.email,
        website: company.website,
        gstin: company.gstin,
        pan: company.pan,
        tan: company.tan,
        signatoryName: company.signatoryName,
        signatoryDesignation: company.signatoryDesignation,
      },
      employee: {
        code: e.code,
        name: e.name,
        designation: e.designation,
        department: e.department,
        dateOfJoining: e.dateOfJoining ? e.dateOfJoining.toISOString() : null,
        pan: e.pan,
        uan: e.uan,
        esiNumber: e.esiNumber,
        bankName: e.bankName,
        bankAccountMasked: maskAccount(e.bankAccount),
        ifsc: e.ifsc,
      },
      result,
    };
    const pdf = new Uint8Array(await renderSlipPdf(snapshot, logo));
    slips.push({ entry, result, snapshot, pdf });
  }

  await prisma.$transaction([
    // A re-finalised month replaces the slips issued before it was reopened.
    prisma.slip.deleteMany({ where: { runId } }),
    ...slips.map(({ entry, result }) =>
      prisma.payrollEntry.update({ where: { id: entry.id }, data: { computed: JSON.stringify(result) } }),
    ),
    ...slips.map(({ entry, result, snapshot, pdf }) =>
      prisma.slip.create({
        data: {
          runId,
          employeeId: entry.employeeId,
          employeeCode: entry.employee.code,
          employeeName: entry.employee.name,
          month: run.month,
          year: run.year,
          netPay: result.netPay,
          snapshot: JSON.stringify(snapshot),
          pdf,
        },
      }),
    ),
    prisma.payrollRun.update({ where: { id: runId }, data: { status: "FINALISED", finalisedAt: new Date() } }),
  ]);
}
