import type { InputHTMLAttributes, ReactNode } from "react";

/** Label + input + error message. */
export function Field({
  label,
  error,
  hint,
  required,
  className = "",
  ...input
}: {
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`block ${className}`}>
      <span className="label">
        {label}
        {required && <span className="text-red-600"> *</span>}
      </span>
      <input {...input} className={`input ${error ? "input-error" : ""}`} aria-invalid={!!error} />
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="error-text block">{error}</span>}
    </label>
  );
}
