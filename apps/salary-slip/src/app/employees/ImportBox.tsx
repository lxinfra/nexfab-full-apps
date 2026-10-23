"use client";

import { useActionState } from "react";
import { importEmployees, type ImportResult } from "@/app/actions/employees";

export function ImportBox() {
  const [result, action, pending] = useActionState<ImportResult | null, FormData>(importEmployees, null);

  return (
    <details className="card py-3" open={!!result}>
      <summary className="cursor-pointer text-sm font-medium text-slate-700">Import employees from CSV / Excel</summary>
      <div className="mt-3 space-y-3 text-sm">
        <p className="text-slate-600">
          Use the same columns as the export.{" "}
          <a
            href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/employees/export?format=xlsx&template=1`}
            className="text-indigo-700 underline"
          >
            Download the template
          </a>
          . Employees are matched by Employee Code: existing codes are updated, new codes are added. Any extra
          column (for example &quot;Basic&quot; or &quot;HRA&quot;) is read as a monthly salary component.
        </p>
        <form action={action} className="flex items-center gap-2">
          <input type="file" name="file" accept=".csv,.xlsx" className="text-sm" required />
          <button className="btn btn-primary" disabled={pending}>
            {pending ? "Importing..." : "Import"}
          </button>
        </form>
        {result?.message && <p className="alert-error">{result.message}</p>}
        {result && !result.message && (
          <p className={result.errors.length ? "alert-info" : "alert-ok"}>
            {result.created} added, {result.updated} updated
            {result.errors.length > 0 ? `, ${result.errors.length} row(s) skipped because of errors:` : "."}
          </p>
        )}
        {result && result.errors.length > 0 && (
          <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-red-700">
            {result.errors.map((e) => (
              <li key={e.row}>
                Row {e.row}: {e.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
