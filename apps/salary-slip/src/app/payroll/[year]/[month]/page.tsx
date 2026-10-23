import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireCompany } from "@/lib/company";
import { monthLabel } from "@/lib/format";
import type { NamedAmount, PayrollOverrides, PayrollResult } from "@/lib/payroll/calc";
import { loadCalculation, loadRun, syncDraftEmployees } from "@/lib/payroll/service";
import { parseJson, type StoredManualDeductions } from "@/lib/payroll/types";
import { StatusBadge } from "@/components/StatusBadge";
import { PayrollTable, type PayrollRow } from "./PayrollTable";
import { StartRunButton } from "./StartRunButton";

export default async function PayrollMonthPage({ params }: { params: Promise<{ year: string; month: string }> }) {
  const company = await requireCompany();
  const p = await params;
  const year = Number(p.year);
  const month = Number(p.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
    notFound();
  }
  const label = monthLabel(month, year);

  let run = await loadRun(company.id, year, month);
  if (run?.status === "DRAFT" && (await syncDraftEmployees(run))) {
    run = await loadRun(company.id, year, month);
  }

  const heading = (
    <div>
      <Link href="/payroll" className="text-sm text-indigo-700 hover:underline">
        ← All payroll months
      </Link>
      <h1 className="page-title mt-1 flex items-center gap-3">
        Payroll for {label} {run && <StatusBadge status={run.status} />}
      </h1>
      <p className="text-sm text-slate-600">{company.name}</p>
    </div>
  );

  if (!run) {
    const active = await prisma.employee.count({ where: { companyId: company.id, status: "ACTIVE" } });
    return (
      <div className="space-y-4">
        {heading}
        <div className="card max-w-xl space-y-3 text-sm">
          <p>
            Payroll for {label} has not been started. Starting it lists the {active} active employee(s) of{" "}
            {company.name} with full paid days, ready for you to adjust.
          </p>
          {active === 0 ? (
            <p className="alert-info">
              There are no active employees yet.{" "}
              <Link href="/employees" className="underline">
                Add employees
              </Link>{" "}
              first.
            </p>
          ) : (
            <StartRunButton year={year} month={month} label={label} />
          )}
        </div>
      </div>
    );
  }

  const calc = run.status === "DRAFT" ? await loadCalculation(run) : null;
  const rows: PayrollRow[] = run.entries.map((entry) => {
    const manual = parseJson<StoredManualDeductions>(entry.manualDeductions, {});
    const issued = run.status === "FINALISED" ? parseJson<PayrollResult | null>(entry.computed, null) : null;
    return {
      employeeId: entry.employeeId,
      code: entry.employee.code,
      name: entry.employee.name,
      designation: entry.employee.designation ?? "",
      totalDays: entry.totalDays,
      components: calc ? calc.componentsFor(entry) : [],
      rules: calc ? calc.rulesFor(entry.employeeId) : [],
      initial: {
        paidDays: entry.paidDays,
        arrears: entry.arrears,
        oneTimeEarnings: parseJson<NamedAmount[]>(entry.oneTimeEarnings, []),
        manualRules: manual.rules ?? {},
        adhoc: manual.adhoc ?? [],
        overrides: parseJson<PayrollOverrides>(entry.overrides, {}),
      },
      ...(issued?.earnings ? { issued } : {}),
      slipId: run.slips.find((s) => s.employeeId === entry.employeeId)?.id,
    };
  });

  return (
    <div className="space-y-4">
      {heading}
      <PayrollTable
        key={`${run.id}-${run.status}`}
        year={year}
        month={month}
        label={label}
        status={run.status === "FINALISED" ? "FINALISED" : "DRAFT"}
        runId={run.id}
        rows={rows}
      />
    </div>
  );
}
