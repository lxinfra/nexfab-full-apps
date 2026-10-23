"use client";

import { FileSpreadsheet, Loader2, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { parseSpreadsheet, type Sheet } from "@/lib/api";
import { flowImport } from "@/lib/editor/importFlow";
import { chainPages, columnCount, guessHasHeader, rowCount, tableChain, tableText, type Measure } from "@/lib/editor/tables";
import type { TemplatePage, TemplateTable } from "@/lib/types";

interface Props {
  /** Every page of the template (a long table may continue on other pages). */
  pages: TemplatePage[];
  page: TemplatePage;
  table: TemplateTable;
  /** Open with "all tables" chosen: fill the table and every continuation of it. */
  startWithAll: boolean;
  measure: Measure;
  /**
   * Apply the import: the template's new page list (one undo step). Pages keep
   * their old `index`; pages may have been added, and tables may have grown.
   */
  onImport: (pages: TemplatePage[]) => void;
  onClose: () => void;
}

type Scope = "table" | "all";

const PREVIEW_ROWS = 8;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const bodyRowsOf = (table: TemplateTable) => rowCount(table) - table.headerRows;

export default function ImportTableDialog({ pages, page, table, startWithAll, measure, onImport, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [hasHeader, setHasHeader] = useState(true);
  const [replaceHeader, setReplaceHeader] = useState(false);
  // null = decide automatically (see `scope` below)
  const [scopeChoice, setScopeChoice] = useState<Scope | null>(startWithAll ? "all" : null);
  // when the sheet has more rows than the tables hold: make the table longer (and add pages) to fit them
  const [addRows, setAddRows] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const choose = async (chosen: File | undefined) => {
    if (!chosen) return;
    setFile(chosen);
    setSheets(null);
    setError(null);
    setBusy(true);
    try {
      const parsed = await parseSpreadsheet(chosen);
      setSheets(parsed.sheets);
      setSheetIndex(0);
      setHasHeader(guessHasHeader(table, parsed.sheets[0].rows));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file could not be read.");
    } finally {
      setBusy(false);
    }
  };

  const sheet = sheets?.[sheetIndex];
  const bodyRows = bodyRowsOf(table);
  const currentHeader = useMemo(() => (table.headerRows ? tableText(table, page.elements)[0] : null), [table, page.elements]);

  // Every table with this many columns: one long table split by page breaks is one table per page.
  const joined = useMemo(() => tableChain(pages, page.index, table), [pages, page.index, table]);
  // tables the user left out (a table that merely has as many columns)
  const [leftOut, setLeftOut] = useState<Set<string>>(() => new Set());
  const chain = useMemo(
    () => joined.filter((ref) => (ref.pageIndex === page.index && ref.table.id === table.id) || !leftOut.has(`${ref.pageIndex}:${ref.table.id}`)),
    [joined, leftOut, page.index, table.id],
  );
  const chained = joined.length > 1;
  const chainRows = chain.reduce((sum, ref) => sum + bodyRowsOf(ref.table), 0);
  const isFirst = chain[0].pageIndex === page.index && chain[0].table.id === table.id;
  const dataRows = sheet ? Math.max(0, sheet.rows.length - (hasHeader ? 1 : 0)) : 0;
  // Unless chosen: fill everything when this is where the table starts and the sheet does not fit in it.
  const scope: Scope = !chained ? "table" : (scopeChoice ?? (isFirst && dataRows > bodyRows ? "all" : "table"));

  // Rows the tables hold as they are, before any are added.
  const baseCapacity = scope === "all" ? chainRows : bodyRows;

  const outcome = useMemo(() => {
    if (!sheet) return null;
    return flowImport({
      pages, page, table, chain, all: scope === "all", rows: sheet.rows, styles: sheet.styles,
      options: { hasHeader, replaceHeader: replaceHeader && hasHeader }, addRows, measure,
    });
  }, [sheet, table, chain, scope, pages, page, hasHeader, replaceHeader, measure, addRows]);

  const notes: { tone: "info" | "warn"; text: string }[] = [];
  if (outcome) {
    const { plan } = outcome;
    if (table.headerRows && hasHeader) {
      notes.push({
        tone: "info",
        text: plan.matchedByName
          ? "Columns are matched by their headings."
          : "Headings differ, so columns are matched by position: first to first, second to second.",
      });
    }
    if (outcome.addedRows > 0 || outcome.addedPages > 0) {
      const parts: string[] = [];
      if (outcome.addedRows > 0) {
        parts.push(`${plural(outcome.addedRows, "row")} ${outcome.addedRows === 1 ? "is" : "are"} added to the ${scope === "all" ? "last table" : "table"}, moving what is below it down`);
      }
      if (outcome.addedPages > 0) {
        parts.push(`${plural(outcome.addedPages, "page")} ${outcome.addedPages === 1 ? "is" : "are"} added after page ${outcome.copiedPage} as ${outcome.addedPages === 1 ? "a copy" : "copies"} of it`);
      }
      notes.push({ tone: "info", text: `To fit ${plural(plan.sheetRows, "row")}: ${parts.join("; ")}.` });
    }
    if (outcome.tallerRows > 0) {
      notes.push({
        tone: "info",
        text: `${plural(outcome.tallerRows, "row")} ${outcome.tallerRows === 1 ? "is" : "are"} made taller so the text fits in its column.`,
      });
    }
    const where = scope === "all" ? `these ${chain.length} tables have` : "the table has";
    if (outcome.skippedRows > 0) {
      notes.push({
        tone: "warn",
        text:
          `The sheet has ${plural(plan.sheetRows, "row")} of data but ${addRows ? "there is" : where} room for ${outcome.capacity}: ` +
          `the last ${plural(outcome.skippedRows, "row")} will not be imported.` +
          (addRows ? "" : scope === "table" && chained ? " Add rows, or choose all tables to use the room on the other pages." : " Tick \"Add rows\" to make room."),
      });
    } else if (plan.sheetRows < outcome.capacity) {
      notes.push({
        tone: "info",
        text: `The sheet has ${plural(plan.sheetRows, "row")} of data: the remaining ${plural(outcome.capacity - plan.sheetRows, "table row")} will be emptied.`,
      });
    }
    if (plan.skippedColumns > 0) {
      notes.push({ tone: "info", text: `${plural(plan.skippedColumns, "sheet column")} ${plan.skippedColumns === 1 ? "is" : "are"} not used.` });
    }
    if (outcome.overflowing > 0) {
      notes.push({
        tone: "warn",
        text: `${plural(outcome.overflowing, "value")} ${outcome.overflowing === 1 ? "is" : "are"} too wide for the column even at one letter per line, and will overlap the next one.`,
      });
    }
    if (outcome.unplaced > 0) notes.push({ tone: "warn", text: `${plural(outcome.unplaced, "value")} could not be placed.` });
    if (sheet?.truncated) notes.push({ tone: "warn", text: "Only the first 2,000 rows of this sheet were read." });
  }

  const previewHeader = outcome?.plan.header ?? currentHeader;
  const checkbox = "h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";
  const radio = "mt-0.5 h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="import-table-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="import-table-title" className="text-base font-semibold text-slate-900">
              {scope === "all" ? `Import Excel into all ${chain.length} tables` : "Import Excel into this table"}
            </h2>
            <p className="mt-0.5 text-sm text-slate-600">
              {plural(columnCount(table), "column")}. Each value keeps the font, colour and alignment of the cell it replaces.
            </p>
          </div>
          <button ref={closeButton} type="button" aria-label="Close" onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {chained && (
            <fieldset>
              <legend className="text-sm font-medium text-slate-900">What to fill</legend>
              <p className="text-xs text-slate-500">This table continues with the same columns on {chainPages(chain)}.</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {([
                  ["table", "This table only", `${plural(bodyRows, "row")} on page ${page.index + 1}`],
                  ["all", `All ${chain.length} tables`, `${plural(chainRows, "row")} on ${chainPages(chain)}, filled in order`],
                ] as const).map(([value, title, detail]) => (
                  <label key={value}
                    className={"flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm " +
                      (scope === value ? "border-indigo-500 bg-indigo-50/50" : "border-slate-300 hover:bg-slate-50")}>
                    <input type="radio" name="import-scope" className={radio} checked={scope === value}
                      onChange={() => setScopeChoice(value)} />
                    <span>
                      <span className="block font-medium text-slate-900">{title}</span>
                      <span className="block text-xs text-slate-500">{detail}</span>
                    </span>
                  </label>
                ))}
              </div>
              {scope === "all" && (
                <ul className="mt-2 grid gap-1 sm:grid-cols-2" aria-label="Tables to fill">
                  {joined.map((ref) => {
                    const key = `${ref.pageIndex}:${ref.table.id}`;
                    const itself = ref.pageIndex === page.index && ref.table.id === table.id;
                    return (
                      <li key={key}>
                        <label className="flex items-center gap-2 text-xs text-slate-700">
                          <input type="checkbox" className={checkbox} checked={itself || !leftOut.has(key)} disabled={itself}
                            onChange={(event) => setLeftOut((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.delete(key);
                              else next.add(key);
                              return next;
                            })} />
                          Page {ref.pageIndex + 1} · {plural(columnCount(ref.table), "column")} × {plural(bodyRowsOf(ref.table), "row")}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </fieldset>
          )}

          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 hover:border-indigo-400 hover:bg-indigo-50/40">
            {busy ? <Loader2 className="h-6 w-6 shrink-0 animate-spin text-slate-400" aria-hidden />
              : <FileSpreadsheet className="h-6 w-6 shrink-0 text-slate-400" aria-hidden />}
            <span className="min-w-0 flex-1 text-sm">
              <span className="block truncate font-medium text-slate-900">{file ? file.name : "Choose an Excel or CSV file"}</span>
              <span className="text-slate-500">
                {busy ? "Reading…" : sheet ? `${plural(sheet.rowCount, "row")}, ${plural(sheet.columnCount, "column")}` : ".xlsx, .xlsm, .csv or .tsv"}
              </span>
            </span>
            <input type="file" accept=".xlsx,.xlsm,.csv,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only" aria-label="Spreadsheet file"
              onChange={(event) => {
                void choose(event.target.files?.[0]);
                event.target.value = "";
              }} />
          </label>

          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

          {sheets && sheet && outcome && (
            <>
              <div className="space-y-2">
                {sheets.length > 1 && (
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    Sheet
                    <select value={sheetIndex} aria-label="Sheet"
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      onChange={(event) => {
                        const index = Number(event.target.value);
                        setSheetIndex(index);
                        setHasHeader(guessHasHeader(table, sheets[index].rows));
                      }}>
                      {sheets.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
                    </select>
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-slate-800">
                  <input type="checkbox" className={checkbox} checked={hasHeader} onChange={(event) => setHasHeader(event.target.checked)} />
                  First row is column headings
                </label>
                {table.headerRows > 0 && hasHeader && (
                  <label className="flex items-center gap-2 text-sm text-slate-800">
                    <input type="checkbox" className={checkbox} checked={replaceHeader} onChange={(event) => setReplaceHeader(event.target.checked)} />
                    Replace the table&apos;s headings too
                  </label>
                )}
                {(dataRows > baseCapacity || (addRows ? outcome.addedRows + outcome.addedPages > 0 : outcome.skippedRows > 0)) && (
                  <label className="flex items-start gap-2 text-sm text-slate-800">
                    <input type="checkbox" className={checkbox + " mt-0.5"} checked={addRows} onChange={(event) => setAddRows(event.target.checked)} />
                    <span>
                      {dataRows > baseCapacity
                        ? `Add rows for the ${plural(dataRows - baseCapacity, "row")} that do not fit`
                        : "Add rows for the rows that no longer fit"}
                      <span className="block text-xs text-slate-500">
                        The table is made longer; when its page is full, pages are added.
                      </span>
                    </span>
                  </label>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium text-slate-900">{scope === "all" ? "The tables after import" : "The table after import"}</h3>
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full border-collapse text-left text-xs">
                    {previewHeader && (
                      <thead>
                        <tr className="bg-slate-100">
                          {previewHeader.map((text, c) => (
                            <th key={c} scope="col" className="whitespace-nowrap px-3 py-1.5 font-semibold text-slate-700">{text || " "}</th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {outcome.body.slice(0, PREVIEW_ROWS).map((row, r) => (
                        <tr key={r} className="border-t border-slate-200">
                          {row.map((text, c) => (
                            <td key={c} className={"max-w-[14rem] truncate px-3 py-1.5 " + (text ? "text-slate-900" : "text-slate-400")}>
                              {text || "(empty)"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {outcome.body.length > PREVIEW_ROWS && (
                  <p className="mt-1 text-xs text-slate-500">Showing the first {PREVIEW_ROWS} of {outcome.body.length} rows.</p>
                )}
              </div>

              {notes.length > 0 && (
                <ul className="space-y-1.5">
                  {notes.map((note, i) => (
                    <li key={i} className={"flex items-start gap-2 rounded-md px-3 py-2 text-sm " +
                      (note.tone === "warn" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700")}>
                      {note.tone === "warn" && <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                      {note.text}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <span className="mr-auto text-xs text-slate-500">You can undo the import with Ctrl+Z.</span>
          <button type="button" onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            Cancel
          </button>
          <button type="button" disabled={!outcome || !outcome.changed}
            onClick={() => {
              if (!outcome) return;
              onImport(outcome.pages);
              onClose();
            }}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
            {outcome && !outcome.changed ? "Nothing to change" : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
