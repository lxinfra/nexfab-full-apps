"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveStatutory } from "@/app/actions/templates";
import type { StatutorySettings } from "@/lib/ctc/settings";
import type { ActionResult } from "@/lib/validation";

/** The settings as typed in the form: every number is text until it is saved. */
type Text<T> = { [K in keyof T]: T[K] extends boolean ? boolean : string };
interface FormState {
  minBasicStatBonusYearly: string;
  minBasicHraYearly: string;
  pfEmployerRate: string;
  pfEmployeeRate: string;
  pfOnActualBasic: boolean;
  pfCeilings: Text<{ from: string; amount: number }>[];
  esiEmployerRate: string;
  esiEmployeeRate: string;
  esiGrossLimit: string;
  gratuityRate: string;
  ptSlabs: Text<{ from: number; to: number; monthly: number }>[];
  tds: {
    standardDeduction: string;
    slabs: Text<{ upTo: number; rate: number }>[];
    rebateLimit: string;
    surcharge: Text<{ above: number; rate: number }>[];
    cessRate: string;
  };
}

const str = (n: number | null) => (n === null ? "" : String(n));

function toForm(s: StatutorySettings): FormState {
  return {
    minBasicStatBonusYearly: str(s.minBasicStatBonusYearly),
    minBasicHraYearly: str(s.minBasicHraYearly),
    pfEmployerRate: str(s.pfEmployerRate),
    pfEmployeeRate: str(s.pfEmployeeRate),
    pfOnActualBasic: s.pfOnActualBasic,
    pfCeilings: s.pfCeilings.map((c) => ({ from: c.from, amount: str(c.amount) })),
    esiEmployerRate: str(s.esiEmployerRate),
    esiEmployeeRate: str(s.esiEmployeeRate),
    esiGrossLimit: str(s.esiGrossLimit),
    gratuityRate: str(s.gratuityRate),
    ptSlabs: s.ptSlabs.map((p) => ({ from: str(p.from), to: str(p.to), monthly: str(p.monthly) })),
    tds: {
      standardDeduction: str(s.tds.standardDeduction),
      slabs: s.tds.slabs.map((x) => ({ upTo: str(x.upTo), rate: str(x.rate) })),
      rebateLimit: str(s.tds.rebateLimit),
      surcharge: s.tds.surcharge.map((x) => ({ above: str(x.above), rate: str(x.rate) })),
      cessRate: str(s.tds.cessRate),
    },
  };
}

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
        <input type="number" min="0" step="any" className={`input num ${error ? "input-error" : ""}`} value={value} onChange={(e) => onChange(e.target.value)} />
        {suffix && <span className="text-sm text-slate-500">{suffix}</span>}
      </span>
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="error-text block">{error}</span>}
    </label>
  );
}

/** A small editable table: one row per item, with add and remove. */
function Rows<T extends Record<string, string>>({
  name,
  columns,
  rows,
  onChange,
  blank,
  addLabel,
  errors,
  errorPath,
}: {
  name: string;
  columns: { key: keyof T & string; label: string; type?: string; placeholder?: string }[];
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: T;
  addLabel: string;
  errors: Record<string, string>;
  errorPath: string;
}) {
  return (
    <div>
      <table className="text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 uppercase">
            {columns.map((c) => (
              <th key={c.key} className="pr-2 pb-1 font-semibold">
                {c.label}
              </th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const error = columns.map((c) => errors[`${errorPath}.${i}.${c.key}`]).find(Boolean);
            return (
              <tr key={i} className="align-top">
                {columns.map((c) => (
                  <td key={c.key} className="py-1 pr-2">
                    <input
                      className={`input w-40 ${c.type === "date" ? "" : "num"}`}
                      type={c.type ?? "number"}
                      min="0"
                      step="any"
                      placeholder={c.placeholder}
                      value={row[c.key]}
                      onChange={(e) => onChange(rows.map((r, k) => (k === i ? { ...r, [c.key]: e.target.value } : r)))}
                      aria-label={`${name} ${c.label} ${i + 1}`}
                    />
                  </td>
                ))}
                <td className="py-1">
                  <button type="button" className="btn btn-sm mt-0.5" onClick={() => onChange(rows.filter((_, k) => k !== i))}>
                    Remove
                  </button>
                  {error && <span className="error-text ml-2">{error}</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {errors[errorPath] && <span className="error-text block">{errors[errorPath]}</span>}
      <button type="button" className="btn btn-sm mt-1" onClick={() => onChange([...rows, blank])}>
        {addLabel}
      </button>
    </div>
  );
}

export function StatutoryForm({ initial }: { initial: StatutorySettings }) {
  const router = useRouter();
  const [v, setV] = useState(() => toForm(initial));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const errors = result?.errors ?? {};

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setResult(null);
  };
  const setTds = <K extends keyof FormState["tds"]>(key: K, value: FormState["tds"][K]) => set("tds", { ...v.tds, [key]: value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const r = await saveStatutory(v);
      setResult(r);
      if (r.ok) router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="max-w-4xl space-y-4" noValidate>
      <div className="card space-y-3">
        <h2 className="font-semibold">Thresholds from the CTC sheet</h2>
        <div className="grid grid-cols-3 gap-4">
          <Num
            label="Min Basic for Stat Bonus (₹ per year)"
            value={v.minBasicStatBonusYearly}
            onChange={(x) => set("minBasicStatBonusYearly", x)}
            error={errors.minBasicStatBonusYearly}
            hint='Used by components with the condition "Basic ≤ stat-bonus limit".'
          />
          <Num
            label="Min Basic for HRA (₹ per year)"
            value={v.minBasicHraYearly}
            onChange={(x) => set("minBasicHraYearly", x)}
            error={errors.minBasicHraYearly}
            hint="Stored only. Nothing uses this value yet."
          />
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">Provident Fund</h2>
        <div className="grid grid-cols-3 gap-4">
          <Num label="Employer PF rate" suffix="% of Basic" value={v.pfEmployerRate} onChange={(x) => set("pfEmployerRate", x)} error={errors.pfEmployerRate} />
          <Num label="Employee PF rate" suffix="% of Basic" value={v.pfEmployeeRate} onChange={(x) => set("pfEmployeeRate", x)} error={errors.pfEmployeeRate} hint="Used in the in-hand estimate." />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.pfOnActualBasic} onChange={(e) => set("pfOnActualBasic", e.target.checked)} />
          Contribute on the actual Basic (ignore the wage ceiling)
        </label>
        <div className={v.pfOnActualBasic ? "opacity-50" : ""}>
          <span className="label">PF wage ceiling (monthly Basic on which PF is charged)</span>
          <Rows
            name="PF ceiling"
            columns={[
              { key: "from", label: "Applies from", type: "date" },
              { key: "amount", label: "Ceiling (₹ per month)" },
            ]}
            rows={v.pfCeilings}
            onChange={(rows) => set("pfCeilings", rows)}
            blank={{ from: "", amount: "" }}
            addLabel="+ Add a ceiling change"
            errors={errors}
            errorPath="pfCeilings"
          />
          <p className="mt-1 text-xs text-slate-500">
            Each ceiling applies from its date until the next one. Payroll months use the ceiling in force on the last
            day of the month.
          </p>
        </div>
      </div>

      <div className="card space-y-3">
        <h2 className="font-semibold">ESI and gratuity</h2>
        <div className="grid grid-cols-4 gap-4">
          <Num label="Employer ESIC rate" suffix="%" value={v.esiEmployerRate} onChange={(x) => set("esiEmployerRate", x)} error={errors.esiEmployerRate} />
          <Num label="Employee ESI rate" suffix="%" value={v.esiEmployeeRate} onChange={(x) => set("esiEmployeeRate", x)} error={errors.esiEmployeeRate} />
          <Num label="ESI applies up to gross (₹/month)" value={v.esiGrossLimit} onChange={(x) => set("esiGrossLimit", x)} error={errors.esiGrossLimit} />
          <Num label="Gratuity rate" suffix="% of Basic" value={v.gratuityRate} onChange={(x) => set("gratuityRate", x)} error={errors.gratuityRate} />
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Professional tax</h2>
          <p className="text-sm text-slate-600">Monthly tax by yearly gross salary. Used in the in-hand estimate.</p>
        </div>
        <Rows
          name="PT slab"
          columns={[
            { key: "from", label: "Yearly gross from (₹)" },
            { key: "to", label: "To (₹)", placeholder: "and above" },
            { key: "monthly", label: "Tax per month (₹)" },
          ]}
          rows={v.ptSlabs}
          onChange={(rows) => set("ptSlabs", rows)}
          blank={{ from: "", to: "", monthly: "" }}
          addLabel="+ Add slab"
          errors={errors}
          errorPath="ptSlabs"
        />
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Income tax (TDS), new regime</h2>
          <p className="text-sm text-slate-600">
            Yearly tax on gross salary x 12 less the standard deduction; one twelfth is the monthly TDS.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Num label="Standard deduction (₹)" value={v.tds.standardDeduction} onChange={(x) => setTds("standardDeduction", x)} error={errors["tds.standardDeduction"]} />
          <Num
            label="No tax up to taxable income (₹)"
            value={v.tds.rebateLimit}
            onChange={(x) => setTds("rebateLimit", x)}
            error={errors["tds.rebateLimit"]}
            hint="Rebate limit, with marginal relief just above it. 0 = no rebate."
          />
          <Num label="Cess" suffix="% of tax + surcharge" value={v.tds.cessRate} onChange={(x) => setTds("cessRate", x)} error={errors["tds.cessRate"]} />
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <span className="label">Tax slabs</span>
            <Rows
              name="Tax slab"
              columns={[
                { key: "upTo", label: "Taxable income up to (₹)", placeholder: "and above" },
                { key: "rate", label: "Rate (%)" },
              ]}
              rows={v.tds.slabs}
              onChange={(rows) => setTds("slabs", rows)}
              blank={{ upTo: "", rate: "" }}
              addLabel="+ Add slab"
              errors={errors}
              errorPath="tds.slabs"
            />
          </div>
          <div>
            <span className="label">Surcharge (with marginal relief)</span>
            <Rows
              name="Surcharge"
              columns={[
                { key: "above", label: "Taxable income above (₹)" },
                { key: "rate", label: "Surcharge (%)" },
              ]}
              rows={v.tds.surcharge}
              onChange={(rows) => setTds("surcharge", rows)}
              blank={{ above: "", rate: "" }}
              addLabel="+ Add surcharge level"
              errors={errors}
              errorPath="tds.surcharge"
            />
          </div>
        </div>
      </div>

      {result?.message && <p className={result.ok ? (result.message === "Saved." ? "alert-ok" : "alert-info") : "alert-error"}>{result.message}</p>}
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Saving..." : "Save settings"}
      </button>
    </form>
  );
}
