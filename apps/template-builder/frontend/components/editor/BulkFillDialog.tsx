"use client";

import { Download, FileSpreadsheet, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { downloadBlob, exportBulk, safeFilename } from "@/lib/api";
import { variableNames, variableSamples } from "@/lib/editor/elements";
import type { Template } from "@/lib/types";

interface Props {
  template: Template;
  /** Make sure the server has the latest edits before generating. */
  save: () => Promise<void>;
  onClose: () => void;
}

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

export default function BulkFillDialog({ template, save, onClose }: Props) {
  const names = variableNames(template);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const downloadSample = () => {
    const samples = variableSamples(template);
    const header = [...names, "filename"];
    const row = [...names.map((name) => samples[name] ?? ""), `${safeFilename(template.name)}_001`];
    const csv = `${header.map(csvCell).join(",")}\n${row.map(csvCell).join(",")}\n`;
    downloadBlob(new Blob([csv], { type: "text/csv" }), `${safeFilename(template.name)}_variables.csv`);
  };

  const generate = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      await save();
      const zip = await exportBulk(template.id, file);
      downloadBlob(zip, `${safeFilename(template.name)}_bulk.zip`);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk fill failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-title"
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="bulk-title" className="text-base font-semibold text-slate-900">Bulk fill from a CSV</h2>
            <p className="mt-0.5 text-sm text-slate-600">One PDF per row, downloaded together as a zip.</p>
          </div>
          <button ref={closeButton} type="button" aria-label="Close" onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <h3 className="text-sm font-medium text-slate-900">Columns this template uses</h3>
            {names.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {names.map((name) => (
                  <li key={name} className="rounded bg-violet-50 px-2 py-0.5 font-mono text-xs text-violet-800">{name}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-600">
                No variable fields yet. Select a text element and tick <strong>Variable field</strong>, or type{" "}
                <code className="font-mono text-xs">{"{{name}}"}</code> into any text.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-500">
              An optional <code className="font-mono">filename</code> column names each PDF. Columns the template
              does not use are ignored.
            </p>
            {names.length > 0 && (
              <button type="button" onClick={downloadSample}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <Download className="h-4 w-4" aria-hidden />
                Download a starter CSV
              </button>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 hover:border-indigo-400 hover:bg-indigo-50/40">
            <FileSpreadsheet className="h-6 w-6 shrink-0 text-slate-400" aria-hidden />
            <span className="min-w-0 flex-1 text-sm">
              <span className="block truncate font-medium text-slate-900">{file ? file.name : "Choose a CSV file"}</span>
              <span className="text-slate-500">{file ? `${(file.size / 1024).toFixed(1)} KB` : "Up to 500 rows"}</span>
            </span>
            <input type="file" accept=".csv,text/csv" className="sr-only"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
                setDone(false);
              }} />
          </label>

          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
          {done && <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">The zip has been downloaded.</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button type="button" onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            Close
          </button>
          <button type="button" disabled={!file || busy} onClick={generate}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? "Generating…" : "Generate PDFs"}
          </button>
        </div>
      </div>
    </div>
  );
}
