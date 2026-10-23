"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveTemplate } from "@/app/actions/templates";
import { CtcBreakupView } from "@/components/CtcBreakup";
import { isoDate, type StatutorySettings } from "@/lib/ctc/settings";
import {
  ctcYearly,
  estimateInHand,
  solveCtc,
  solveParams,
  validateTemplate,
  type CalcMethod,
  type ComponentKind,
  type TemplateComponent,
} from "@/lib/ctc/structure";
import { formatINR } from "@/lib/format";
import type { FieldErrors } from "@/lib/validation";
import { usesValue, type Row } from "./rows";

const KINDS: { value: ComponentKind; label: string }[] = [
  { value: "EARNING", label: "Earning" },
  { value: "EMPLOYER", label: "Employer contribution" },
  { value: "VARIABLE", label: "Variable pay" },
];

const METHODS: Record<ComponentKind, { value: CalcMethod; label: string }[]> = {
  EARNING: [
    { value: "PCT_CTC", label: "% of CTC" },
    { value: "PCT_GROSS", label: "% of Gross" },
    { value: "PCT_BASIC", label: "% of Basic" },
    { value: "FIXED", label: "Fixed monthly amount" },
    { value: "BALANCING", label: "Balancing (whatever is left)" },
  ],
  EMPLOYER: [
    { value: "EMPLOYER_PF", label: "Statutory PF (on Basic, with ceiling)" },
    { value: "EMPLOYER_ESIC", label: "Statutory ESIC (on Gross, if eligible)" },
    { value: "PCT_CTC", label: "% of CTC" },
    { value: "PCT_GROSS", label: "% of Gross" },
    { value: "PCT_BASIC", label: "% of Basic" },
    { value: "FIXED", label: "Fixed monthly amount" },
  ],
  VARIABLE: [
    { value: "PCT_CTC", label: "% of CTC" },
    { value: "FIXED", label: "Fixed monthly amount" },
  ],
};

function toComponents(rows: Row[]): TemplateComponent[] {
  return rows.map((r) => ({
    name: r.name.trim(),
    kind: r.kind,
    method: r.method,
    value: usesValue(r.method) ? (r.value.trim() === "" ? 0 : Number(r.value)) : 0,
    ...(r.when === "STAT" && r.method !== "BALANCING"
      ? { condition: { basis: "BASIC" as const, op: "LTE" as const, source: "STAT_BONUS_LIMIT" as const } }
      : r.when === "CUSTOM" && r.method !== "BALANCING"
        ? { condition: { basis: r.basis, op: r.op, source: "AMOUNT" as const, amount: r.amount.trim() === "" ? null : Number(r.amount) } }
        : {}),
  }));
}

export function TemplateForm({
  id,
  initialName,
  initialRows,
  settings,
  employeeCount,
}: {
  id: number | null;
  initialName: string;
  initialRows: Row[];
  settings: StatutorySettings;
  employeeCount: number;
}) {
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState(initialRows);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [testCtc, setTestCtc] = useState("500000");
  const [testPeriod, setTestPeriod] = useState("YEARLY");

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  const move = (i: number, by: number) =>
    setRows((rs) => {
      const j = i + by;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const changeKind = (i: number, kind: ComponentKind) => {
    const allowed = METHODS[kind].map((m) => m.value);
    patch(i, { kind, method: allowed.includes(rows[i].method) ? rows[i].method : allowed[0] });
  };

  const components = toComponents(rows);
  const problems = validateTemplate(components);
  const ctc = Number(testCtc);
  const preview =
    problems.length === 0 && testCtc.trim() !== "" && Number.isFinite(ctc) && ctc > 0
      ? solveCtc(ctcYearly(ctc, testPeriod), components, solveParams(settings, isoDate(new Date())))
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveTemplate(id, { name, components });
      // On success the action redirects and never returns.
      if (result) {
        setErrors(result.errors ?? {});
        setMessage(result.message ?? null);
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {message && <p className="alert-error">{message}</p>}

      <div className="card space-y-4">
        <label className="block max-w-sm">
          <span className="label">
            Template name<span className="text-red-600"> *</span>
          </span>
          <input
            className={`input ${errors.name ? "input-error" : ""}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. M1 to M4"
            aria-label="Template name"
          />
          {errors.name && <span className="error-text block">{errors.name}</span>}
        </label>

        <div>
          <h2 className="font-semibold">Components</h2>
          <p className="text-sm text-slate-600">
            Listed in the order they appear on the CTC statement. Amounts are per month. Name the basic pay
            &quot;Basic&quot; or &quot;Basic Salary&quot;. Gross Salary, Fixed CTC, Total CTC and Gratuity are added
            automatically.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase">
                <th className="w-16 pb-1 font-semibold">Order</th>
                <th className="pb-1 font-semibold">Name</th>
                <th className="pb-1 font-semibold">Type</th>
                <th className="pb-1 font-semibold">Calculation</th>
                <th className="w-28 pb-1 font-semibold">Value</th>
                <th className="pb-1 font-semibold">Applies</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">
                    <button type="button" className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${r.name || "component"} up`}>
                      ↑
                    </button>{" "}
                    <button type="button" className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label={`Move ${r.name || "component"} down`}>
                      ↓
                    </button>
                  </td>
                  <td className="py-1 pr-2">
                    <input className="input" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} placeholder="Component name" aria-label="Component name" />
                  </td>
                  <td className="py-1 pr-2">
                    <select className="input" value={r.kind} onChange={(e) => changeKind(i, e.target.value as ComponentKind)} aria-label={`Type of ${r.name || "component"}`}>
                      {KINDS.map((k) => (
                        <option key={k.value} value={k.value}>
                          {k.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <select className="input" value={r.method} onChange={(e) => patch(i, { method: e.target.value as CalcMethod })} aria-label={`Calculation of ${r.name || "component"}`}>
                      {METHODS[r.kind].map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    {usesValue(r.method) ? (
                      <span className="flex items-center gap-1">
                        <input className="input num" type="number" min="0" step="any" value={r.value} onChange={(e) => patch(i, { value: e.target.value })} aria-label={`Value of ${r.name || "component"}`} />
                        <span className="w-4 text-slate-500">{r.method === "FIXED" ? "₹" : "%"}</span>
                      </span>
                    ) : (
                      <span className="block py-1.5 text-xs text-slate-500">
                        {r.method === "EMPLOYER_PF" ? `${settings.pfEmployerRate}%` : r.method === "EMPLOYER_ESIC" ? `${settings.esiEmployerRate}%` : "automatic"}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2">
                    {r.method === "BALANCING" ? (
                      <span className="block py-1.5 text-xs text-slate-500">always</span>
                    ) : (
                      <>
                        <select className="input" value={r.when} onChange={(e) => patch(i, { when: e.target.value as Row["when"] })} aria-label={`Condition for ${r.name || "component"}`}>
                          <option value="">Always</option>
                          <option value="STAT">Only if Basic ≤ stat-bonus limit (₹{formatINR(settings.minBasicStatBonusYearly / 12, 0)}/month)</option>
                          <option value="CUSTOM">Only if...</option>
                        </select>
                        {r.when === "CUSTOM" && (
                          <span className="mt-1 flex items-center gap-1">
                            <select className="input" value={r.basis} onChange={(e) => patch(i, { basis: e.target.value as Row["basis"] })} aria-label="Condition basis">
                              <option value="BASIC">Basic</option>
                              <option value="GROSS">Gross</option>
                              <option value="CTC">CTC</option>
                            </select>
                            <select className="input w-16" value={r.op} onChange={(e) => patch(i, { op: e.target.value as Row["op"] })} aria-label="Condition comparison">
                              <option value="LTE">≤</option>
                              <option value="GTE">≥</option>
                            </select>
                            <input className="input num w-28" type="number" min="0" placeholder="₹/month" value={r.amount} onChange={(e) => patch(i, { amount: e.target.value })} aria-label="Condition amount per month" />
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="py-1">
                    <button type="button" className="btn btn-sm mt-0.5" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setRows((rs) => [...rs, { name: "", kind: "EARNING", method: "FIXED", value: "", when: "", basis: "BASIC", op: "LTE", amount: "" }])}
        >
          + Add component
        </button>

        {(problems.length > 0 || errors.components) && (
          <div className="alert-error">
            <ul className="list-disc space-y-0.5 pl-5">
              {(errors.components ? errors.components.split("\n") : problems).map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Try it</h2>
          <p className="text-sm text-slate-600">Enter any CTC to see what this template produces. Nothing is saved.</p>
        </div>
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="label">Test CTC (₹)</span>
            <input className="input num w-40" type="number" min="0" value={testCtc} onChange={(e) => setTestCtc(e.target.value)} aria-label="Test CTC" />
          </label>
          <label className="block">
            <span className="label">Per</span>
            <select className="input w-28" value={testPeriod} onChange={(e) => setTestPeriod(e.target.value)} aria-label="Test CTC period">
              <option value="YEARLY">Year</option>
              <option value="MONTHLY">Month</option>
            </select>
          </label>
        </div>
        {preview && !preview.ok && <p className="alert-error">{preview.error}</p>}
        {preview?.ok && <CtcBreakupView title={name || "Template"} breakup={preview.breakup} inHand={estimateInHand(preview.breakup, settings)} />}
        {!preview && problems.length > 0 && <p className="text-sm text-slate-500">Fix the problems above to see a preview.</p>}
      </div>

      {employeeCount > 0 && (
        <p className="alert-info">
          {employeeCount} employee(s) use this template. Saving changes their salary in draft and future payroll months;
          finalised months are not affected.
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || problems.length > 0}>
          {pending ? "Saving..." : "Save template"}
        </button>
        <Link href="/templates" className="btn">
          Cancel
        </Link>
      </div>
    </form>
  );
}
