"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveEmployee } from "@/app/actions/employees";
import { CtcBreakupView } from "@/components/CtcBreakup";
import { Field } from "@/components/Field";
import { isoDate, type StatutorySettings } from "@/lib/ctc/settings";
import { ctcYearly, estimateInHand, solveCtc, solveParams, type TemplateComponent } from "@/lib/ctc/structure";
import { formatINR } from "@/lib/format";
import { SALARY_PRESETS } from "@/lib/salary-presets";
import type { FieldErrors } from "@/lib/validation";

export interface TemplateOption {
  id: number;
  name: string;
  components: TemplateComponent[];
}

export interface EmployeeFormValues {
  code: string;
  name: string;
  designation: string;
  department: string;
  dateOfJoining: string;
  pan: string;
  uan: string;
  esiNumber: string;
  bankName: string;
  bankAccount: string;
  ifsc: string;
  status: string;
  components: { name: string; monthlyAmount: string }[];
  templateId: string; // "" = salary components entered by hand
  ctcAmount: string;
  ctcPeriod: string; // YEARLY | MONTHLY
}

export function EmployeeForm({
  id,
  initial,
  templates,
  settings,
}: {
  id: number | null;
  initial: EmployeeFormValues;
  templates: TemplateOption[];
  settings: StatutorySettings;
}) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (field: keyof EmployeeFormValues, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // The error belongs to the old value; it is checked again on save.
    setErrors(({ [field]: _cleared, ...rest }) => rest);
  };
  const text = (field: Exclude<keyof EmployeeFormValues, "components">) => ({
    value: values[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(field, e.target.value),
    error: errors[field],
  });
  const setComponent = (i: number, patch: Partial<{ name: string; monthlyAmount: string }>) =>
    setValues((v) => ({ ...v, components: v.components.map((c, k) => (k === i ? { ...c, ...patch } : c)) }));

  const total = values.components.reduce((a, c) => a + (Number(c.monthlyAmount) || 0), 0);

  // A ready-made salary fills in the hand-entered components; they stay editable.
  const [presetId, setPresetId] = useState("");
  const applyPreset = (id: string) => {
    setPresetId(id);
    const preset = SALARY_PRESETS.find((x) => x.id === id);
    if (!preset) return;
    setValues((v) => ({
      ...v,
      templateId: "",
      components: preset.components.map((c) => ({ name: c.name, monthlyAmount: String(c.monthlyAmount) })),
    }));
    setErrors({});
  };

  // Live CTC preview for the chosen template.
  const template = templates.find((t) => String(t.id) === values.templateId);
  const ctc = Number(values.ctcAmount);
  const preview =
    template && values.ctcAmount.trim() !== "" && Number.isFinite(ctc) && ctc > 0
      ? solveCtc(ctcYearly(ctc, values.ctcPeriod), template.components, solveParams(settings, isoDate(new Date())))
      : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      // On a template the components come from the CTC, so the hand-entered rows are not sent.
      const result = await saveEmployee(id, values.templateId ? { ...values, components: [] } : values);
      // On success the action redirects and never returns.
      if (result) {
        setErrors(result.errors ?? {});
        setMessage(result.message ?? null);
      }
    });
  };

  return (
    <form onSubmit={submit} className="max-w-4xl space-y-4" noValidate>
      {message && <p className="alert-error">{message}</p>}

      <div className="card space-y-4">
        <h2 className="font-semibold">Employee details</h2>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Employee code" required {...text("code")} />
          <Field label="Name" required className="col-span-2" {...text("name")} />
          <Field label="Designation" {...text("designation")} />
          <Field label="Department" {...text("department")} />
          <Field label="Date of joining" type="date" {...text("dateOfJoining")} />
          <Field label="PAN" placeholder="ABCDE1234F" {...text("pan")} />
          <Field label="UAN" placeholder="12 digits" {...text("uan")} />
          <Field label="ESI number" {...text("esiNumber")} />
          <Field label="Bank name" {...text("bankName")} />
          <Field label="Bank account number" {...text("bankAccount")} />
          <Field label="IFSC" placeholder="SBIN0001234" {...text("ifsc")} />
          <label className="block">
            <span className="label">Status</span>
            <select className="input" value={values.status} onChange={(e) => set("status", e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <span className="mt-1 block text-xs text-slate-500">Inactive employees are left out of payroll.</span>
          </label>
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <h2 className="font-semibold">Salary structure</h2>
          <p className="text-sm text-slate-600">
            Choose a CTC template to work the salary out from the CTC, or enter the monthly components by hand.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <label className="block">
            <span className="label">CTC template</span>
            <select
              className={`input ${errors.templateId ? "input-error" : ""}`}
              value={values.templateId}
              onChange={(e) => set("templateId", e.target.value)}
            >
              <option value="">None (enter components by hand)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {errors.templateId && <span className="error-text block">{errors.templateId}</span>}
            {templates.length === 0 && (
              <span className="mt-1 block text-xs text-slate-500">
                No templates yet.{" "}
                <Link href="/templates" className="text-indigo-700 underline">
                  Create one
                </Link>
                .
              </span>
            )}
          </label>
          {template && (
            <>
              <label className="block">
                <span className="label">
                  CTC (₹)<span className="text-red-600"> *</span>
                </span>
                <input
                  className={`input num ${errors.ctcAmount || (preview && !preview.ok) ? "input-error" : ""}`}
                  type="number"
                  min="0"
                  step="1"
                  value={values.ctcAmount}
                  onChange={(e) => set("ctcAmount", e.target.value)}
                  aria-label="CTC amount"
                />
              </label>
              <label className="block">
                <span className="label">CTC is per</span>
                <select className="input" value={values.ctcPeriod} onChange={(e) => set("ctcPeriod", e.target.value)} aria-label="CTC period">
                  <option value="YEARLY">Year</option>
                  <option value="MONTHLY">Month</option>
                </select>
              </label>
            </>
          )}
        </div>
        {template && (
          <div>
            {errors.ctcAmount && !preview && <p className="alert-error">{errors.ctcAmount}</p>}
            {preview && !preview.ok && <p className="alert-error">{preview.error}</p>}
            {preview?.ok && (
              <CtcBreakupView title={template.name} breakup={preview.breakup} inHand={estimateInHand(preview.breakup, settings)} />
            )}
            {!preview && !errors.ctcAmount && (
              <p className="text-sm text-slate-500">Enter the CTC to see the breakup.</p>
            )}
          </div>
        )}
        {!template && (
        <>
        <label className="block max-w-md">
          <span className="label">Ready-made salary</span>
          <select className="input" value={presetId} onChange={(e) => applyPreset(e.target.value)} aria-label="Ready-made salary">
            <option value="">Choose to fill in the components below...</option>
            {SALARY_PRESETS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-slate-500">
            Fills in the components below; you can still change them. The in-hand figure assumes the default deductions
            (PT ₹208 and TDS 10% of gross, PF and ESI at 0).
          </span>
        </label>
        <table className="w-full max-w-xl text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 uppercase">
              <th className="pb-1 font-semibold">Component</th>
              <th className="w-44 pb-1 font-semibold">Monthly amount (₹)</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {values.components.map((c, i) => {
              const nameError = errors[`components.${i}.name`];
              const amountError = errors[`components.${i}.monthlyAmount`];
              return (
                <tr key={i} className="align-top">
                  <td className="py-1 pr-2">
                    <input
                      className={`input ${nameError ? "input-error" : ""}`}
                      value={c.name}
                      onChange={(e) => setComponent(i, { name: e.target.value })}
                      placeholder="Component name"
                      aria-label="Component name"
                    />
                    {nameError && <span className="error-text block">{nameError}</span>}
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className={`input num ${amountError ? "input-error" : ""}`}
                      type="number"
                      min="0"
                      step="1"
                      value={c.monthlyAmount}
                      onChange={(e) => setComponent(i, { monthlyAmount: e.target.value })}
                      aria-label={`${c.name || "Component"} monthly amount`}
                    />
                    {amountError && <span className="error-text block">{amountError}</span>}
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      className="btn btn-sm mt-0.5"
                      onClick={() => setValues((v) => ({ ...v, components: v.components.filter((_, k) => k !== i) }))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            <tr className="border-t border-slate-200 font-semibold">
              <td className="py-2">Monthly gross</td>
              <td className="num py-2 pr-5">{formatINR(total)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => setValues((v) => ({ ...v, components: [...v.components, { name: "", monthlyAmount: "" }] }))}
        >
          + Add component
        </button>
        </>
        )}
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || (!!preview && !preview.ok)}>
          {pending ? "Saving..." : "Save employee"}
        </button>
        <Link href="/employees" className="btn">
          Cancel
        </Link>
      </div>
    </form>
  );
}
