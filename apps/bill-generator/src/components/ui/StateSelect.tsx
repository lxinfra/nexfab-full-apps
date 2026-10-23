'use client';

import { STATES } from '@/lib/states';

/** One control that sets both the state name and its GST code. */
export default function StateSelect({
  value,
  onChange,
  name,
  required,
}: {
  /** the 2-digit state code */
  value: string;
  onChange: (code: string, stateName: string) => void;
  name?: string;
  required?: boolean;
}) {
  return (
    <select
      name={name}
      required={required}
      className="input"
      value={value}
      onChange={(e) => {
        const code = e.target.value;
        const st = STATES.find((s) => s.code === code);
        onChange(code, st?.name ?? '');
      }}
    >
      <option value="">Select state…</option>
      {STATES.map((s) => (
        <option key={s.code} value={s.code}>
          {s.code} — {s.name}
        </option>
      ))}
    </select>
  );
}
