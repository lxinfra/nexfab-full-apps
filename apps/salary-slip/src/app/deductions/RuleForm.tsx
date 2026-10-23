"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveRule } from "@/app/actions/rules";
import type { FieldErrors } from "@/lib/validation";

export interface RuleFormValues {
  name: string;
  type: string;
  baseType: string;
  baseComponents: string[];
  percentage: string;
  fixedAmount: string;
  slabs: { from: string; to: string; amount: string }[];
  baseCap: string;
  amountCap: string;
  eligibilityMaxGross: string;
  appliesToAll: boolean;
  employeeIds: number[];
  employerType: string;
  employerValue: string;
  active: boolean;
}

const TYPES = [
  { value: "PERCENTAGE", label: "Percentage", help: "A percentage of Basic, Gross or chosen components." },
  { value: "FIXED", label: "Fixed amount", help: "The same amount every month." },
  { value: "SLAB", label: "Slab-based", help: "The amount depends on the salary range." },
  { value: "MANUAL", label: "Manual entry", help: "You type the amount each month (e.g. advances)." },
  { value: "TDS", label: "TDS (new tax regime)", help: "One twelfth of the yearly income tax on the monthly salary x 12, using the tax settings under CTC Templates." },
];

function Num({
  label,
  value,
  onChange,
  error,
  hint,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  hint?: string;
  suffix?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="number"
          min="0"
          step="any"
          className={`input ${error ? "input-error" : ""}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
      </span>
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="error-text block">{error}</span>}
    </label>
  );
}

export function RuleForm({
  id,
  initial,
  componentNames,
  employees,
}: {
  id: number | null;
  initial: RuleFormValues;
  componentNames: string[];
  employees: { id: number; code: string; name: string }[];
}) {
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof RuleFormValues>(field: K, value: RuleFormValues[K]) =>
    setV((prev) => ({ ...prev, [field]: value }));
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const setSlab = (i: number, patch: Partial<RuleFormValues["slabs"][number]>) =>
    set(
      "slabs",
      v.slabs.map((s, k) => (k === i ? { ...s, ...patch } : s)),
    );

  const usesBase = v.type === "PERCENTAGE" || v.type === "SLAB" || v.employerType === "PERCENTAGE";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const result = await saveRule(id, { ...v, baseType: usesBase ? v.baseType : null });
      if (result) {
        setErrors(result.errors ?? {});
        setMessage(result.message ?? null);
      }
    });
  };

  return (
    <form onSubmit={submit} className="max-w-3xl space-y-4" noValidate>
      {message && <p className="alert-error">{message}</p>}

      <div className="card space-y-4">
        <label className="block max-w-sm">
          <span className="label">
            Rule name<span className="text-red-600"> *</span>
          </span>
          <input
            className={`input ${errors.name ? "input-error" : ""}`}
            value={v.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. PF, ESI, Professional Tax, TDS, Advance"
          />
          {errors.name && <span className="error-text block">{errors.name}</span>}
          <span className="mt-1 block text-xs text-slate-500">This name is printed on the salary slip.</span>
        </label>

        <fieldset>
          <legend className="label">How is it calculated?</legend>
          <div className="grid grid-cols-2 gap-2">
            {TYPES.map((t) => (
              <label
                key={t.value}
                className={`flex cursor-pointer gap-2 rounded-md border p-2.5 text-sm ${
                  v.type === t.value ? "border-indigo-500 bg-indigo-50" : "border-slate-200"
                }`}
              >
                <input type="radio" name="type" checked={v.type === t.value} onChange={() => set("type", t.value)} className="mt-0.5" />
                <span>
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-xs text-slate-600">{t.help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {v.type === "PERCENTAGE" && (
          <div className="max-w-xs">
            <Num label="Percentage" suffix="%" value={v.percentage} onChange={(x) => set("percentage", x)} error={errors.percentage} />
          </div>
        )}

        {v.type === "FIXED" && (
          <div className="max-w-xs">
            <Num label="Amount per month (₹)" value={v.fixedAmount} onChange={(x) => set("fixedAmount", x)} error={errors.fixedAmount} />
          </div>
        )}

        {usesBase && (
          <div className="space-y-2">
            <label className="block max-w-xs">
              <span className="label">
                {v.type === "SLAB" ? "Slabs are based on" : v.type === "PERCENTAGE" ? "Percentage of" : "Employer percentage is of"}
              </span>
              <select className="input" value={v.baseType} onChange={(e) => set("baseType", e.target.value)}>
                <option value="BASIC">Basic</option>
                <option value="GROSS">Gross earnings</option>
                <option value="COMPONENTS">Selected components</option>
              </select>
              {errors.baseType && <span className="error-text block">{errors.baseType}</span>}
            </label>
            {v.baseType === "COMPONENTS" && (
              <div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {componentNames.map((n) => (
                    <label key={n} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={v.baseComponents.includes(n)}
                        onChange={() => set("baseComponents", toggle(v.baseComponents, n))}
                      />
                      {n}
                    </label>
                  ))}
                </div>
                {errors.baseComponents && <span className="error-text block">{errors.baseComponents}</span>}
              </div>
            )}
            <p className="text-xs text-slate-500">
              The amounts actually earned in the month (after pro-rating for paid days) are used.
            </p>
          </div>
        )}

        {v.type === "SLAB" && (
          <div>
            <span className="label">Slabs</span>
            <table className="text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase">
                  <th className="pr-2 pb-1 font-semibold">From (₹)</th>
                  <th className="pr-2 pb-1 font-semibold">To (₹)</th>
                  <th className="pr-2 pb-1 font-semibold">Deduction (₹)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {v.slabs.map((s, i) => {
                  const err = errors[`slabs.${i}.from`] ?? errors[`slabs.${i}.to`] ?? errors[`slabs.${i}.amount`];
                  return (
                    <tr key={i} className="align-top">
                      <td className="py-1 pr-2">
                        <input type="number" min="0" className="input w-32" value={s.from} onChange={(e) => setSlab(i, { from: e.target.value })} aria-label="Slab from" />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" min="0" className="input w-32" value={s.to} placeholder="and above" onChange={(e) => setSlab(i, { to: e.target.value })} aria-label="Slab to" />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" min="0" className="input w-32" value={s.amount} onChange={(e) => setSlab(i, { amount: e.target.value })} aria-label="Slab deduction" />
                      </td>
                      <td className="py-1">
                        <button type="button" className="btn btn-sm mt-0.5" onClick={() => set("slabs", v.slabs.filter((_, k) => k !== i))}>
                          Remove
                        </button>
                        {err && <span className="error-text ml-2">{err}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {errors.slabs && <span className="error-text block">{errors.slabs}</span>}
            <button type="button" className="btn btn-sm mt-1" onClick={() => set("slabs", [...v.slabs, { from: "", to: "", amount: "" }])}>
              + Add slab
            </button>
            <p className="mt-1 text-xs text-slate-500">
              Both ends are included. Leave &quot;To&quot; empty for &quot;and above&quot;. Salaries outside every slab get no deduction.
            </p>
          </div>
        )}
      </div>

      <div className="card space-y-4">
        <h2 className="font-semibold">Limits (optional)</h2>
        <div className="grid grid-cols-3 gap-4">
          {usesBase && (
            <Num
              label="Cap on the base (₹)"
              value={v.baseCap}
              onChange={(x) => set("baseCap", x)}
              error={errors.baseCap}
              hint="e.g. 15000 so PF is charged on at most ₹15,000."
            />
          )}
          <Num
            label="Maximum deduction (₹)"
            value={v.amountCap}
            onChange={(x) => set("amountCap", x)}
            error={errors.amountCap}
            hint="The deduction never goes above this."
          />
          <Num
            label="Only if monthly gross is at or below (₹)"
            value={v.eligibilityMaxGross}
            onChange={(x) => set("eligibilityMaxGross", x)}
            error={errors.eligibilityMaxGross}
            hint="Compared with the full monthly salary, e.g. 21000 for ESI."
          />
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Who does it apply to?</h2>
        <div className="flex gap-6 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={v.appliesToAll} onChange={() => set("appliesToAll", true)} /> All employees
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={!v.appliesToAll} onChange={() => set("appliesToAll", false)} /> Selected employees only
          </label>
        </div>
        {!v.appliesToAll && (
          <div>
            {employees.length === 0 ? (
              <p className="text-sm text-slate-500">This company has no employees yet.</p>
            ) : (
              <div className="grid max-h-56 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto rounded-md border border-slate-200 p-3">
                {employees.map((e) => (
                  <label key={e.id} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={v.employeeIds.includes(e.id)}
                      onChange={() => set("employeeIds", toggle(v.employeeIds, e.id))}
                    />
                    <span className="font-mono text-xs text-slate-500">{e.code}</span> {e.name}
                  </label>
                ))}
              </div>
            )}
            {errors.employeeIds && <span className="error-text block">{errors.employeeIds}</span>}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Employer contribution (optional)</h2>
          <p className="text-sm text-slate-600">Shown separately on the slip and the register. It is not deducted from net pay.</p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <label className="block">
            <span className="label">Type</span>
            <select className="input" value={v.employerType} onChange={(e) => set("employerType", e.target.value)}>
              <option value="NONE">None</option>
              <option value="PERCENTAGE">Percentage</option>
              <option value="FIXED">Fixed amount</option>
            </select>
          </label>
          {v.employerType !== "NONE" && (
            <Num
              label={v.employerType === "PERCENTAGE" ? "Employer percentage" : "Employer amount (₹)"}
              suffix={v.employerType === "PERCENTAGE" ? "%" : undefined}
              value={v.employerValue}
              onChange={(x) => set("employerValue", x)}
              error={errors.employerValue}
              hint={v.employerType === "PERCENTAGE" ? "Uses the same base (and base cap) as above." : undefined}
            />
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={v.active} onChange={(e) => set("active", e.target.checked)} />
        Rule is switched on
      </label>

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving..." : "Save rule"}
        </button>
        <Link href="/deductions" className="btn">
          Cancel
        </Link>
      </div>
    </form>
  );
}
