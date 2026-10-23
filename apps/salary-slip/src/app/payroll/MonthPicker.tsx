"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MONTHS } from "@/lib/format";

/** Month + year selector that navigates to `${basePath}/${year}/${month}` or a query string. */
export function MonthPicker({
  defaultMonth,
  defaultYear,
  target = "payroll",
  buttonLabel = "Open month",
}: {
  defaultMonth: number;
  defaultYear: number;
  target?: "payroll" | "register";
  buttonLabel?: string;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(String(defaultYear));
  const y = Number(year);
  const valid = Number.isInteger(y) && y >= 2000 && y <= 2100;

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        router.push(target === "payroll" ? `/payroll/${y}/${month}` : `/reports/register?year=${y}&month=${month}`);
      }}
    >
      <label className="block">
        <span className="label">Month</span>
        <select className="input w-40" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Year</span>
        <input
          className={`input w-28 ${valid ? "" : "input-error"}`}
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </label>
      <button className="btn btn-primary" disabled={!valid}>
        {buttonLabel}
      </button>
      {!valid && <span className="error-text pb-2">Enter a year between 2000 and 2100.</span>}
    </form>
  );
}
