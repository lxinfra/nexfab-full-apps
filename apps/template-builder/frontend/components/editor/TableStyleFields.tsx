"use client";

import type { TableStyle } from "@/lib/editor/tableDesign";

const field =
  "h-7 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-900 focus:border-indigo-500 focus:outline-none";

/** A colour, or none. */
function ColourField({ label, value, onChange, allowNone }: {
  label: string; value: string | null; onChange: (value: string | null) => void; allowNone: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
      {label}
      <span className="flex items-center gap-1">
        {allowNone && (
          <label className="flex items-center gap-1 text-[11px] text-slate-500">
            <input type="checkbox" checked={value === null} onChange={(e) => onChange(e.target.checked ? null : "#e5e7eb")}
              className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
            none
          </label>
        )}
        <input type="color" aria-label={label} value={value ?? "#e5e7eb"} disabled={value === null}
          onChange={(e) => onChange(e.target.value)} className="h-7 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5 disabled:opacity-40" />
      </span>
    </label>
  );
}

/** The fields of a table's look. Every change is reported at once. */
export default function TableStyleFields({ style, onChange }: { style: TableStyle; onChange: (style: TableStyle) => void }) {
  const set = (changes: Partial<TableStyle>) => onChange({ ...style, ...changes });
  return (
    <div className="space-y-2" data-table-style>
      <ColourField label="Lines" value={style.borderColor} allowNone onChange={(borderColor) => set({ borderColor })} />
      <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
        Line width
        <input type="number" min={0.25} max={6} step={0.25} value={style.borderWidth} aria-label="Line width"
          onChange={(e) => set({ borderWidth: Math.max(0.25, Number(e.target.value) || 0.25) })} className={field + " w-16 text-right tabular-nums"} />
      </label>
      <ColourField label="Heading background" value={style.headerFill} allowNone onChange={(headerFill) => set({ headerFill })} />
      <ColourField label="Row stripes" value={style.stripeFill} allowNone onChange={(stripeFill) => set({ stripeFill })} />
      <label className="flex items-center justify-between gap-2 text-xs text-slate-700">
        Text size
        <input type="number" min={4} max={72} step={0.5} value={style.fontSize} aria-label="Text size"
          onChange={(e) => set({ fontSize: Math.max(4, Number(e.target.value) || 4) })} className={field + " w-16 text-right tabular-nums"} />
      </label>
      <ColourField label="Text colour" value={style.textColor} allowNone={false} onChange={(textColor) => set({ textColor: textColor ?? "#111827" })} />
    </div>
  );
}
