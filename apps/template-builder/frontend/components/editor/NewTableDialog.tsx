"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_STYLE, type NewTableOptions, type TableStyle } from "@/lib/editor/tableDesign";
import TableStyleFields from "./TableStyleFields";

interface Props {
  /** The area dragged out on the page, in page points. */
  area: { x: number; y: number; width: number; height: number };
  fontFamilies: string[];
  onCreate: (options: NewTableOptions) => void;
  onClose: () => void;
}

const field =
  "h-8 w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500";

export default function NewTableDialog({ area, fontFamilies, onCreate, onClose }: Props) {
  const [rows, setRows] = useState(5);
  const [columns, setColumns] = useState(4);
  const [headerRows, setHeaderRows] = useState(1);
  const [fontFamily, setFontFamily] = useState(fontFamilies[0] ?? "Helvetica");
  const [style, setStyle] = useState<TableStyle>(DEFAULT_STYLE);
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rowHeight = area.height / Math.max(1, rows);
  const tooSmall = rowHeight < style.fontSize * 1.25 + 2 || area.width / Math.max(1, columns) < 12;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <form role="dialog" aria-modal="true" aria-labelledby="new-table-title"
        className="w-full max-w-md rounded-xl bg-white shadow-xl" onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onCreate({ rows, columns, headerRows: Math.min(headerRows, rows - 1), style, fontFamily });
          onClose();
        }}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="new-table-title" className="text-base font-semibold text-slate-900">New table</h2>
            <p className="mt-0.5 text-sm text-slate-600">{Math.round(area.width)} × {Math.round(area.height)} pt on the page.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm text-slate-700">
              Columns
              <input ref={first} type="number" min={1} max={30} value={columns} onChange={(e) => setColumns(Math.max(1, Number(e.target.value) || 1))} className={field + " mt-1"} />
            </label>
            <label className="text-sm text-slate-700">
              Rows
              <input type="number" min={1} max={200} value={rows} onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))} className={field + " mt-1"} />
            </label>
            <label className="text-sm text-slate-700">
              Heading rows
              <input type="number" min={0} max={Math.max(0, rows - 1)} value={headerRows} onChange={(e) => setHeaderRows(Math.max(0, Number(e.target.value) || 0))} className={field + " mt-1"} />
            </label>
          </div>
          <label className="block text-sm text-slate-700">
            Font
            <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} className={field + " mt-1"}>
              {[...new Set([fontFamily, ...fontFamilies, "Helvetica", "Times New Roman", "Courier New"])].map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <TableStyleFields style={style} onChange={setStyle} />
          {tooSmall && <p className="text-xs text-amber-800">The area is small for this many rows or columns: the cells will be cramped.</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            Cancel
          </button>
          <button type="submit"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            Create table
          </button>
        </div>
      </form>
    </div>
  );
}
