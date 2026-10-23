'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Field, SectionCard } from '@/components/ui/Field';
import { WITHIN_STATE_SUPPLY, SUPPLY_TYPE_LABELS, type WithinStateSupply } from '@/lib/constants';
import {
  GROUPING_HINTS,
  GROUPING_LABELS,
  GROUPING_MODES,
  MONTHLY_FIELD_LABELS,
  REQUIRED_FIELDS,
  type GroupingMode,
  type MonthlyField,
} from '@/lib/monthly-import';
import { formatINR, formatQty } from '@/lib/money';

type Issue = {
  rowNumber: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
};

type Summary = {
  totalRows: number;
  validRows: number;
  errorRows: number;
  skippedRows: number;
  warningRows: number;
  customers: number;
  dates: number;
  bills: number;
  periodMonth: number | null;
  periodYear: number | null;
};

type PreviewRow = {
  date: string;
  customerName: string;
  bills: number;
  lines: number;
  totalPaise: number;
};

type SampleRow = {
  rowNumber: number;
  date: string | null;
  customerName: string;
  externalBillNo: string | null;
  name: string;
  hsnSac: string | null;
  qtyMilli: number;
  ratePaise: number;
  gstRate: number;
  valid: boolean;
};

type DuplicateInfo = {
  id: string;
  fileName: string;
  createdAt: string;
  invoiceCount: number;
  billCount: number;
  status: string;
};

type Analysis = {
  committed: boolean;
  batchId?: string;
  fileName?: string;
  fileSize?: number;
  headers: string[];
  headerRow: number;
  sheetName: string;
  sheetNames: string[];
  map: Partial<Record<MonthlyField, number>>;
  detectedMap: Partial<Record<MonthlyField, number>>;
  unmatchedHeaders: string[];
  missing: MonthlyField[];
  grouping: GroupingMode;
  groupingSuggested: GroupingMode;
  hasBillNumbers: boolean;
  defaultSupplyType: WithinStateSupply;
  summary: Summary;
  preview: PreviewRow[];
  issues: Issue[];
  issueCount: number;
  sample: SampleRow[];
  duplicate?: DuplicateInfo | null;
};

type Step = 'upload' | 'map' | 'preview' | 'generating' | 'done';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Every field the mapping screen offers, required ones first. */
const MAPPABLE: MonthlyField[] = [
  'date', 'customer', 'billNo', 'name', 'description',
  'hsnSac', 'qty', 'unit', 'rate', 'gstRate', 'supplyType', 'amount',
];

function periodLabel(s: Summary): string {
  if (!s.periodMonth || !s.periodYear) return 'Unknown period';
  return `${MONTH_NAMES[s.periodMonth - 1]} ${s.periodYear}`;
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d} ${MONTH_NAMES[Number(m) - 1]?.slice(0, 3) ?? m} ${y}`;
}

export default function MonthlyImportWizard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [step, setStep] = useState<Step>('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);

  // Draft choices, editable on the mapping screen.
  const [map, setMap] = useState<Partial<Record<MonthlyField, number>>>({});
  const [grouping, setGrouping] = useState<GroupingMode>('BILL_NO');
  const [supplyType, setSupplyType] = useState<WithinStateSupply>('INTRA_STATE');
  const [sheetName, setSheetName] = useState<string>('');

  const [showIssues, setShowIssues] = useState(false);
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  // Generation progress.
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<{
    generatedTotal: number;
    billsTotal: number;
    failed: { billKey: string; customerName: string; message: string }[];
    warnings: string[];
    createdCustomers: string[];
    batchId: string;
  } | null>(null);

  /** Posts the file for analysis (or for commit) with the current choices. */
  const send = useCallback(
    async (opts: { commit?: boolean; mapOverride?: Partial<Record<MonthlyField, number>> } = {}) => {
      if (!file) return null;
      const fd = new FormData();
      fd.append('file', file);
      const effectiveMap = opts.mapOverride ?? map;
      if (Object.keys(effectiveMap).length > 0) fd.append('map', JSON.stringify(effectiveMap));
      fd.append('grouping', grouping);
      fd.append('defaultSupplyType', supplyType);
      if (sheetName) fd.append('sheetName', sheetName);
      if (opts.commit) fd.append('commit', '1');
      if (confirmDuplicate) fd.append('confirmDuplicate', '1');

      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/imports`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) {
        if (json.requiresConfirmation && json.duplicate) {
          setDuplicate(json.duplicate as DuplicateInfo);
          throw new Error('DUPLICATE');
        }
        throw new Error(json.error ?? 'Import failed');
      }
      return json as Analysis;
    },
    [file, map, grouping, supplyType, sheetName, confirmDuplicate],
  );

  async function onAnalyse(selected: File) {
    setBusy(true);
    setError(null);
    setFile(selected);
    try {
      const fd = new FormData();
      fd.append('file', selected);
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/imports`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not read that file');
      const a = json as Analysis;
      setAnalysis(a);
      setMap(a.detectedMap);
      setGrouping(a.groupingSuggested);
      setSupplyType(a.defaultSupplyType);
      setSheetName(a.sheetName);
      setDuplicate(a.duplicate ?? null);
      setStep('map');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file');
      setFile(null);
    } finally {
      setBusy(false);
    }
  }

  /** Re-analyse after the user changes a mapping, grouping or supply type. */
  async function reanalyse(next?: { map?: Partial<Record<MonthlyField, number>> }) {
    setBusy(true);
    setError(null);
    try {
      const a = await send({ mapOverride: next?.map });
      if (a) setAnalysis(a);
    } catch (e) {
      if (e instanceof Error && e.message !== 'DUPLICATE') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function onContinue() {
    setBusy(true);
    setError(null);
    try {
      const a = await send();
      if (!a) return;
      setAnalysis(a);
      setStep('preview');
    } catch (e) {
      if (e instanceof Error && e.message !== 'DUPLICATE') setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /** Commits the batch, then generates in chunks so progress can be shown. */
  async function onGenerate() {
    setBusy(true);
    setError(null);
    try {
      const committed = await send({ commit: true });
      if (!committed?.batchId) throw new Error('Import could not be saved');
      const batchId = committed.batchId;
      const total = committed.summary.bills;

      setStep('generating');
      setProgress({ done: 0, total });

      let safety = 0;
      let last: {
        generatedTotal: number;
        billsTotal: number;
        failed: { billKey: string; customerName: string; message: string }[];
        warnings: string[];
        createdCustomers: string[];
      } | null = null;
      const failed: { billKey: string; customerName: string; message: string }[] = [];
      const warnings = new Set<string>();
      const createdCustomers = new Set<string>();

      // Each call generates a chunk. The loop ends when the server says the
      // batch is done; the counter is only a backstop against a bug here.
      while (safety++ < 1000) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/imports/${batchId}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 20 }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Generation failed');

        last = json;
        for (const f of json.failed ?? []) failed.push(f);
        for (const w of json.warnings ?? []) warnings.add(w);
        for (const c of json.createdCustomers ?? []) createdCustomers.add(c);
        setProgress({ done: json.generatedTotal, total: total || json.billsTotal });

        if (json.done) break;
        // Nothing moved and not done: stop rather than spin.
        if (json.generatedNow === 0 && (json.failed ?? []).length === 0) break;
      }

      setResult({
        batchId,
        generatedTotal: last?.generatedTotal ?? 0,
        billsTotal: total,
        failed,
        warnings: [...warnings],
        createdCustomers: [...createdCustomers],
      });
      setStep('done');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
      setStep('preview');
    } finally {
      setBusy(false);
    }
  }

  function setField(field: MonthlyField, value: string) {
    const next = { ...map };
    if (value === '') delete next[field];
    else next[field] = Number(value);
    setMap(next);
    void reanalyse({ map: next });
  }

  function restart() {
    setFile(null);
    setAnalysis(null);
    setMap({});
    setResult(null);
    setDuplicate(null);
    setConfirmDuplicate(false);
    setShowIssues(false);
    setError(null);
    setStep('upload');
    if (fileRef.current) fileRef.current.value = '';
  }

  const errorIssues = useMemo(
    () => (analysis?.issues ?? []).filter((i) => i.severity === 'error'),
    [analysis],
  );
  const warningIssues = useMemo(
    () => (analysis?.issues ?? []).filter((i) => i.severity === 'warning'),
    [analysis],
  );

  // -------------------------------------------------------------------------

  return (
    <div className="grid gap-5">
      <Steps step={step} />

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}

      {duplicate && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">This file appears to have already been imported.</p>
          <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-amber-700">File</dt>
              <dd>{duplicate.fileName}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-amber-700">Imported on</dt>
              <dd>{new Date(duplicate.createdAt).toLocaleString('en-IN')}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-amber-700">Invoices generated</dt>
              <dd>{duplicate.invoiceCount}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-amber-700">Status</dt>
              <dd>{duplicate.status}</dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={confirmDuplicate}
                onChange={(e) => setConfirmDuplicate(e.target.checked)}
              />
              Import it again anyway
            </label>
            <Link href={`/imports/${duplicate.id}`} className="btn-secondary btn-sm">
              Open the earlier import
            </Link>
          </div>
          <p className="mt-2 text-xs">
            Nothing is generated until you press <strong>Generate invoices</strong>, so you can
            safely look through the report first.
          </p>
        </div>
      )}

      {/* ------------------------------------------------- step 1: upload */}
      {step === 'upload' && (
        <SectionCard
          title="Upload Monthly Details"
          description="An Excel or CSV sheet of a month's sales. Nothing is created until you confirm."
        >
          <div
            className="grid place-items-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onAnalyse(f);
            }}
          >
            <p className="text-sm font-medium text-slate-700">
              Drop <span className="font-mono">September 2026.xlsx</span> here
            </p>
            <p className="text-xs text-slate-500">.xlsx, .xls or .csv — up to 10 MB</p>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onAnalyse(f);
              }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              {busy ? 'Reading…' : 'Choose Excel file'}
            </button>
          </div>
          <p className="hint mt-3">
            The sheet should have one row per product line, with a date and a company name on every
            row. A bill / invoice number column is recommended: it is what tells the importer which
            rows belong on the same invoice.
          </p>
        </SectionCard>
      )}

      {/* --------------------------------------- step 2: mapping + report */}
      {step === 'map' && analysis && (
        <>
          <SectionCard
            title={`${analysis.fileName ?? file?.name ?? 'Sheet'} — ${periodLabel(analysis.summary)}`}
            description={`Sheet "${analysis.sheetName}", headers found on row ${analysis.headerRow + 1}.`}
            actions={
              analysis.sheetNames.length > 1 ? (
                <select
                  className="input-sm"
                  value={sheetName}
                  onChange={(e) => {
                    setSheetName(e.target.value);
                    void reanalyse();
                  }}
                >
                  {analysis.sheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : undefined
            }
          >
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat label="Total rows" value={analysis.summary.totalRows} />
              <Stat label="Valid rows" value={analysis.summary.validRows} tone="good" />
              <Stat
                label="Issues"
                value={analysis.summary.errorRows}
                tone={analysis.summary.errorRows > 0 ? 'bad' : 'plain'}
              />
              <Stat label="Companies" value={analysis.summary.customers} />
              <Stat label="Dates" value={analysis.summary.dates} />
              <Stat label="Bills to generate" value={analysis.summary.bills} tone="brand" />
            </div>
          </SectionCard>

          <SectionCard
            title="Column mapping"
            description="Suggested from the sheet's headers. Correct anything that looks wrong."
          >
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {MAPPABLE.map((field) => {
                const required = REQUIRED_FIELDS.includes(field);
                const value = map[field];
                return (
                  <Field
                    key={field}
                    label={MONTHLY_FIELD_LABELS[field]}
                    required={required}
                    error={required && value === undefined ? 'Required — pick a column' : null}
                    hint={
                      value === undefined
                        ? 'Not in this sheet'
                        : `Using "${analysis.headers[value] || `column ${value + 1}`}"`
                    }
                  >
                    <select
                      className="input"
                      value={value === undefined ? '' : String(value)}
                      onChange={(e) => setField(field, e.target.value)}
                    >
                      <option value="">— none —</option>
                      {analysis.headers.map((h, i) => (
                        <option key={`${h}-${i}`} value={i}>
                          {h || `(column ${i + 1})`}
                        </option>
                      ))}
                    </select>
                  </Field>
                );
              })}
            </div>
            {analysis.unmatchedHeaders.length > 0 && (
              <p className="hint mt-4">
                Columns not used: {analysis.unmatchedHeaders.join(', ')}
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Transaction grouping"
            description="How rows become bills. This is the choice that decides whether two similar rows are one invoice or two."
          >
            <div className="grid gap-3">
              {GROUPING_MODES.map((mode) => {
                const disabled = mode === 'BILL_NO' && !analysis.hasBillNumbers;
                return (
                  <label
                    key={mode}
                    className={`flex gap-3 rounded-xl border px-4 py-3 ${
                      grouping === mode
                        ? 'border-brand-400 bg-brand-50'
                        : 'border-slate-200 bg-white'
                    } ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
                  >
                    <input
                      type="radio"
                      name="grouping"
                      className="mt-1"
                      checked={grouping === mode}
                      disabled={disabled}
                      onChange={() => {
                        setGrouping(mode);
                        void reanalyse();
                      }}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">
                        {GROUPING_LABELS[mode]}
                        {mode === analysis.groupingSuggested && (
                          <span className="badge ml-2">suggested</span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-600">
                        {GROUPING_HINTS[mode]}
                      </span>
                      {disabled && (
                        <span className="mt-0.5 block text-xs text-slate-500">
                          No bill number column was found in this sheet.
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            title="Default supply type"
            description="Applied to rows where the sheet does not say. A sheet column, when present, wins."
          >
            <div className="flex flex-wrap gap-3">
              {WITHIN_STATE_SUPPLY.map((t) => (
                <label
                  key={t}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium ${
                    supplyType === t
                      ? 'border-brand-400 bg-brand-50 text-brand-800'
                      : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="supplyType"
                    checked={supplyType === t}
                    onChange={() => {
                      setSupplyType(t);
                      void reanalyse();
                    }}
                  />
                  {SUPPLY_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
            <p className="hint mt-3">
              A customer registered outside this company&apos;s state is always an inter-state
              supply with IGST, whatever the sheet says — that is decided by the state codes, not
              by this setting.
            </p>
          </SectionCard>

          <ValidationReport
            summary={analysis.summary}
            errorIssues={errorIssues}
            warningIssues={warningIssues}
            issueCount={analysis.issueCount}
            show={showIssues}
            onToggle={() => setShowIssues((v) => !v)}
          />

          {analysis.sample.length > 0 && (
            <SectionCard title="First rows as read" description="Check the dates and amounts landed in the right columns.">
              <SampleTable rows={analysis.sample} />
            </SectionCard>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" className="btn-ghost" onClick={restart} disabled={busy}>
              Choose a different file
            </button>
            <div className="flex items-center gap-2">
              {analysis.missing.length > 0 && (
                <span className="text-sm text-rose-700">
                  Map {analysis.missing.map((f) => MONTHLY_FIELD_LABELS[f]).join(', ')} first
                </span>
              )}
              <button
                type="button"
                className="btn-primary"
                disabled={busy || analysis.missing.length > 0 || analysis.summary.bills === 0}
                onClick={onContinue}
              >
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ----------------------------------------------- step 3: preview */}
      {step === 'preview' && analysis && (
        <>
          <SectionCard
            title="Invoice generation preview"
            description="Nothing has been created yet. Review this, then confirm."
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={periodLabel(analysis.summary)} value={analysis.summary.validRows} sub="valid rows" />
              <Stat label="Companies" value={analysis.summary.customers} />
              <Stat label="Dates" value={analysis.summary.dates} />
              <Stat label="Invoices to generate" value={analysis.summary.bills} tone="brand" />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Company</th>
                    <th className="py-2 pr-3 text-right">Bills</th>
                    <th className="py-2 pr-3 text-right">Lines</th>
                    <th className="py-2 text-right">Taxable value</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.preview.map((g) => (
                    <tr key={`${g.date}-${g.customerName}`} className="border-b border-slate-100">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatDate(g.date)}</td>
                      <td className="py-2 pr-3">{g.customerName}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.bills}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{g.lines}</td>
                      <td className="py-2 text-right tabular-nums">{formatINR(g.totalPaise)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td className="py-2 pr-3" colSpan={2}>
                      Total invoices to generate
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {analysis.preview.reduce((n, g) => n + g.bills, 0)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {analysis.preview.reduce((n, g) => n + g.lines, 0)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatINR(analysis.preview.reduce((n, g) => n + g.totalPaise, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="hint mt-4">
              Grouping: <strong>{GROUPING_LABELS[grouping]}</strong>. Invoice numbers come from this
              company&apos;s own series, so each one is allocated at the moment it is created and no
              existing number is reused. The sheet&apos;s bill numbers are kept on each invoice for
              reference.
            </p>
          </SectionCard>

          {analysis.summary.errorRows > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong>{analysis.summary.errorRows} row(s) will be skipped</strong> because of the
              problems listed on the previous screen. The other {analysis.summary.validRows} rows
              will be imported. Go back to fix the mapping, or re-upload a corrected sheet, if that
              is not what you want.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setStep('map')}
              disabled={busy}
            >
              Back to mapping
            </button>
            <button type="button" className="btn-primary" disabled={busy} onClick={onGenerate}>
              {busy ? 'Saving…' : `Generate ${analysis.summary.bills} invoices`}
            </button>
          </div>
        </>
      )}

      {/* -------------------------------------------- step 4: generating */}
      {step === 'generating' && (
        <SectionCard title="Generating invoices…" description="Leave this page open until it finishes.">
          <ProgressBar done={progress.done} total={progress.total} />
          <p className="mt-3 text-sm text-slate-600">
            Generating invoice {Math.min(progress.done + 1, progress.total)} of {progress.total}
          </p>
        </SectionCard>
      )}

      {/* -------------------------------------------------- step 5: done */}
      {step === 'done' && result && analysis && (
        <>
          <SectionCard title="Import complete">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Stat label="Sheet rows" value={analysis.summary.totalRows} />
              <Stat label="Invoices generated" value={result.generatedTotal} tone="good" />
              <Stat label="Line items" value={analysis.summary.validRows} />
              <Stat label="Companies" value={analysis.summary.customers} />
              <Stat
                label="Failed"
                value={result.failed.length}
                tone={result.failed.length > 0 ? 'bad' : 'plain'}
              />
            </div>

            {result.createdCustomers.length > 0 && (
              <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                <p className="font-semibold">
                  {result.createdCustomers.length} new customer(s) were created from the sheet
                </p>
                <p className="mt-1">{result.createdCustomers.join(', ')}</p>
                <p className="mt-1 text-xs">
                  A monthly sheet only carries a name, so their addresses are placeholders. Open{' '}
                  <Link href="/customers" className="underline">
                    Customers
                  </Link>{' '}
                  to complete them — the bills already total correctly.
                </p>
              </div>
            )}

            {result.warnings.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Warnings</p>
                <ul className="mt-1 list-disc pl-5">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.failed.length > 0 && (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                <p className="font-semibold">{result.failed.length} bill(s) could not be created</p>
                <ul className="mt-1 list-disc pl-5">
                  {result.failed.slice(0, 20).map((f, i) => (
                    <li key={`${f.billKey}-${i}`}>
                      {f.customerName}: {f.message}
                    </li>
                  ))}
                </ul>
                {result.failed.length > 20 && (
                  <p className="mt-1 text-xs">and {result.failed.length - 20} more.</p>
                )}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2">
              <Link href={`/invoices?importBatchId=${result.batchId}`} className="btn-primary">
                View generated invoices
              </Link>
              <Link href={`/imports/${result.batchId}`} className="btn-secondary">
                View import report
              </Link>
              <button type="button" className="btn-ghost" onClick={restart}>
                Import another month
              </button>
            </div>
          </SectionCard>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Steps({ step }: { step: Step }) {
  const order: Step[] = ['upload', 'map', 'preview', 'generating', 'done'];
  const labels: Record<Step, string> = {
    upload: 'Upload',
    map: 'Map & validate',
    preview: 'Preview',
    generating: 'Generate',
    done: 'Done',
  };
  const current = order.indexOf(step);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium">
      {order.map((s, i) => (
        <li key={s} className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 ${
              i < current
                ? 'bg-emerald-100 text-emerald-800'
                : i === current
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-500'
            }`}
          >
            {i + 1}. {labels[s]}
          </span>
          {i < order.length - 1 && <span className="text-slate-300">→</span>}
        </li>
      ))}
    </ol>
  );
}

function Stat({
  label,
  value,
  sub,
  tone = 'plain',
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: 'plain' | 'good' | 'bad' | 'brand';
}) {
  const toneClass =
    tone === 'good'
      ? 'text-emerald-700'
      : tone === 'bad'
        ? 'text-rose-700'
        : tone === 'brand'
          ? 'text-brand-700'
          : 'text-slate-900';
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${toneClass}`}>
        {typeof value === 'number' ? value.toLocaleString('en-IN') : value}
      </p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div>
      <div
        className="h-3 w-full overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-right text-sm font-semibold tabular-nums text-slate-700">{pct}%</p>
    </div>
  );
}

function ValidationReport({
  summary,
  errorIssues,
  warningIssues,
  issueCount,
  show,
  onToggle,
}: {
  summary: Summary;
  errorIssues: Issue[];
  warningIssues: Issue[];
  issueCount: number;
  show: boolean;
  onToggle: () => void;
}) {
  const grouped = useMemo(() => {
    const byMessage = new Map<string, { message: string; severity: string; rows: number[] }>();
    for (const i of [...errorIssues, ...warningIssues]) {
      // Group by the kind of problem, not the exact text, so "row 12" and
      // "row 480" with the same cause read as one line.
      const key = `${i.severity}|${i.field}|${i.message.replace(/\d+/g, '#')}`;
      const entry = byMessage.get(key) ?? { message: i.message, severity: i.severity, rows: [] };
      entry.rows.push(i.rowNumber);
      byMessage.set(key, entry);
    }
    return [...byMessage.values()].sort(
      (a, b) => (a.severity === b.severity ? b.rows.length - a.rows.length : a.severity === 'error' ? -1 : 1),
    );
  }, [errorIssues, warningIssues]);

  return (
    <SectionCard
      title="Import validation"
      description="Nothing is ignored silently. Every problem is listed here."
      actions={
        issueCount > 0 ? (
          <button type="button" className="btn-secondary btn-sm" onClick={onToggle}>
            {show ? 'Hide issues' : 'View issues'}
          </button>
        ) : undefined
      }
    >
      <ul className="grid gap-1.5 text-sm">
        <li className="text-emerald-700">
          ✓ {summary.validRows.toLocaleString('en-IN')} valid rows
        </li>
        {summary.errorRows > 0 && (
          <li className="text-rose-700">
            ✗ {summary.errorRows.toLocaleString('en-IN')} rows cannot be imported
          </li>
        )}
        {summary.warningRows > 0 && (
          <li className="text-amber-700">
            ⚠ {summary.warningRows.toLocaleString('en-IN')} rows have warnings but will import
          </li>
        )}
        {summary.skippedRows > 0 && (
          <li className="text-slate-600">
            – {summary.skippedRows.toLocaleString('en-IN')} blank or total rows skipped
          </li>
        )}
        {issueCount === 0 && <li className="text-slate-600">No problems found.</li>}
      </ul>

      {show && grouped.length > 0 && (
        <div className="mt-4 max-h-80 overflow-y-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2">Problem</th>
                <th className="px-3 py-2 text-right">Rows</th>
                <th className="px-3 py-2">Which</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span
                      className={
                        g.severity === 'error'
                          ? 'font-medium text-rose-700'
                          : 'font-medium text-amber-700'
                      }
                    >
                      {g.severity === 'error' ? 'Error' : 'Warning'}
                    </span>{' '}
                    — {g.message}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.rows.length}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {g.rows.slice(0, 12).join(', ')}
                    {g.rows.length > 12 ? ` … +${g.rows.length - 12}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

function SampleTable({ rows }: { rows: SampleRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="py-2 pr-3">Row</th>
            <th className="py-2 pr-3">Date</th>
            <th className="py-2 pr-3">Company</th>
            <th className="py-2 pr-3">Bill no.</th>
            <th className="py-2 pr-3">Product</th>
            <th className="py-2 pr-3">HSN</th>
            <th className="py-2 pr-3 text-right">Qty</th>
            <th className="py-2 pr-3 text-right">Rate</th>
            <th className="py-2 pr-3 text-right">GST</th>
            <th className="py-2">OK</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowNumber} className="border-b border-slate-100">
              <td className="py-2 pr-3 tabular-nums text-slate-500">{r.rowNumber}</td>
              <td className="py-2 pr-3 whitespace-nowrap">
                {r.date ? formatDate(r.date.slice(0, 10)) : <span className="text-rose-600">—</span>}
              </td>
              <td className="py-2 pr-3">{r.customerName || <span className="text-rose-600">—</span>}</td>
              <td className="py-2 pr-3 font-mono text-xs">{r.externalBillNo ?? '—'}</td>
              <td className="py-2 pr-3">{r.name || <span className="text-rose-600">—</span>}</td>
              <td className="py-2 pr-3 font-mono text-xs">{r.hsnSac ?? '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatQty(r.qtyMilli)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{formatINR(r.ratePaise)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.gstRate}%</td>
              <td className="py-2">
                {r.valid ? (
                  <span className="text-emerald-600">✓</span>
                ) : (
                  <span className="text-rose-600">✗</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
