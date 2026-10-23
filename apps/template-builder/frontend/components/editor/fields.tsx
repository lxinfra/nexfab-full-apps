"use client";

import { useEffect, useState, type ReactNode } from "react";

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 shadow-sm " +
  "focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-500";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-200 px-4 py-3">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs text-slate-600">{label}</span>
      {children}
    </label>
  );
}

interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
}

/** Number input that lets you type freely and commits every valid value. */
export function NumberField({ label, value, onChange, min, max, step = 1, suffix, disabled }: NumberFieldProps) {
  const shown = String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(shown);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(shown);
  }, [shown, focused]);

  return (
    <Field label={label}>
      <div className="relative">
        <input
          type="number"
          className={inputClass + (suffix ? " pr-7" : "")}
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDraft(shown);
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            const parsed = Number.parseFloat(event.target.value);
            if (Number.isNaN(parsed)) return;
            if ((min !== undefined && parsed < min) || (max !== undefined && parsed > max)) return;
            if (parsed !== value) onChange(parsed);
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

interface ColorFieldProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  /** Allow "no colour" (for fills and strokes). */
  nullable?: boolean;
}

export function ColorField({ label, value, onChange, nullable }: ColorFieldProps) {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  // Three controls share this label, so it is a group rather than a <label>.
  return (
    <div role="group" aria-label={label}>
      <span className="mb-0.5 block text-xs text-slate-600">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          className="h-8 w-9 shrink-0 cursor-pointer rounded border border-slate-300 bg-white p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
          value={value ?? "#000000"}
          disabled={value === null}
          onChange={(event) => onChange(event.target.value)}
        />
        <input
          type="text"
          aria-label={`${label} hex value`}
          className={inputClass + " font-mono"}
          value={value === null ? "none" : draft}
          disabled={value === null}
          spellCheck={false}
          onChange={(event) => {
            const text = event.target.value.trim();
            setDraft(text);
            if (/^#[0-9a-fA-F]{6}$/.test(text)) onChange(text.toLowerCase());
          }}
          onBlur={() => setDraft(value ?? "")}
        />
        {nullable && (
          <label className="flex shrink-0 items-center gap-1 text-xs text-slate-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              checked={value === null}
              onChange={(event) => onChange(event.target.checked ? null : draft || "#000000")}
            />
            None
          </label>
        )}
      </div>
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

/** 0..1 value shown as a percentage. */
export function OpacityField({ label, value, onChange }: SliderProps) {
  return (
    <Field label={`${label} · ${Math.round(value * 100)}%`}>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        className="w-full accent-indigo-600"
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
    </Field>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function SelectField<T extends string>({ label, value, options, onChange }: SelectFieldProps<T>) {
  return (
    <Field label={label}>
      <select className={inputClass} value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function IconButton({ label, onClick, active, disabled, children }: IconButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={
        "inline-flex h-8 w-8 items-center justify-center rounded-md border text-slate-700 transition-colors " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 " +
        (active
          ? "border-indigo-500 bg-indigo-50 text-indigo-700"
          : "border-slate-300 bg-white hover:bg-slate-100 disabled:hover:bg-white")
      }
    >
      {children}
    </button>
  );
}

export { inputClass };
