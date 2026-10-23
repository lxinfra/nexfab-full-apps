"use client";

import Link from "next/link";
import { useState } from "react";
import { issueOlderMonths } from "@/app/actions/payroll";
import { ConfirmButton } from "@/components/ConfirmButton";
import { MONTHS, monthLabel } from "@/lib/format";
import { monthsBetween } from "@/lib/payroll/joining";
import type { PastMonthResult } from "@/lib/payroll/service";

const OUTCOME: Record<PastMonthResult["outcome"], string> = {
  ISSUED: "slips issued",
  EXISTS: "already had payroll, left as it was",
  NO_EMPLOYEES: "skipped, nobody had joined yet",
};

function MonthYear({
  label,
  month,
  year,
  onMonth,
  onYear,
}: {
  label: string;
  month: number;
  year: string;
  onMonth: (m: number) => void;
  onYear: (y: string) => void;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <span className="flex gap-1.5">
        <select className="input w-36" value={month} onChange={(e) => onMonth(Number(e.target.value))} aria-label={`${label} month`}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
        <input className="input w-24" type="number" min="2000" max="2100" value={year} onChange={(e) => onYear(e.target.value)} aria-label={`${label} year`} />
      </span>
    </div>
  );
}

/** Issue slips for a range of older months in one go. */
export function OlderMonths({ defaultFrom, defaultTo }: { defaultFrom: { year: number; month: number }; defaultTo: { year: number; month: number } }) {
  const [fromMonth, setFromMonth] = useState(defaultFrom.month);
  const [fromYear, setFromYear] = useState(String(defaultFrom.year));
  const [toMonth, setToMonth] = useState(defaultTo.month);
  const [toYear, setToYear] = useState(String(defaultTo.year));
  const [results, setResults] = useState<PastMonthResult[] | null>(null);

  const from = { year: Number(fromYear), month: fromMonth };
  const to = { year: Number(toYear), month: toMonth };
  const valid = [from.year, to.year].every((y) => Number.isInteger(y) && y >= 2000 && y <= 2100);
  const count = valid ? monthsBetween(from, to).length : 0;

  const run = async () => {
    const result = await issueOlderMonths(from.year, from.month, to.year, to.month);
    if (result.ok) setResults(result.results ?? []);
    return result;
  };

  return (
    <details className="card py-3" open={!!results}>
      <summary className="cursor-pointer text-sm font-medium text-slate-700">Issue salary slips for older months</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-slate-600">
          Creates and finalises payroll for every month in the range that has none yet, so the slips can be downloaded.
          Each employee is included from their month of joining, with full paid days, using their current salary and
          the current deduction rules. Months that already have payroll are not touched. You can reopen any month
          afterwards to change paid days or amounts.
        </p>
        <div className="flex flex-wrap items-end gap-4">
          <MonthYear label="From" month={fromMonth} year={fromYear} onMonth={setFromMonth} onYear={setFromYear} />
          <MonthYear label="To" month={toMonth} year={toYear} onMonth={setToMonth} onYear={setToYear} />
          {count > 0 ? (
            <ConfirmButton
              action={run}
              title={`Issue slips for ${count} month${count > 1 ? "s" : ""}?`}
              confirmLabel="Issue slips"
              className="btn btn-primary"
              body={
                <>
                  {monthLabel(from.month, from.year)} to {monthLabel(to.month, to.year)}. Months in this range without
                  payroll are created and finalised for all active employees who had joined by then.
                </>
              }
            >
              Issue slips
            </ConfirmButton>
          ) : (
            <button type="button" className="btn btn-primary" disabled>
              Issue slips
            </button>
          )}
        </div>
        {count === 0 && <p className="error-text">Choose a &quot;From&quot; month that is not after the &quot;To&quot; month.</p>}
        {results && (
          <ul className="space-y-0.5">
            {results.map((r) => (
              <li key={`${r.year}-${r.month}`}>
                <Link href={`/payroll/${r.year}/${r.month}`} className="font-medium text-indigo-700 hover:underline">
                  {monthLabel(r.month, r.year)}
                </Link>
                : {r.outcome === "ISSUED" ? `${r.slips} ${OUTCOME.ISSUED}` : OUTCOME[r.outcome]}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
