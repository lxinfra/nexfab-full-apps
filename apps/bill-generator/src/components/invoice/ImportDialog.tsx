'use client';

import { useRef, useState } from 'react';
import { newRow, type Row } from './types';
import { formatPaise } from '@/lib/money';
import { toPaise, toQtyMilli } from '@/lib/money';

type ParsedRow = {
  sheetRow: number;
  name: string;
  description: string;
  hsnSac: string;
  unit: string;
  qty: string;
  rate: string;
  discountType: 'PERCENT' | 'AMOUNT';
  discountValue: string;
  gstRate: number;
  warnings: string[];
};

export type ExtractedBill = {
  originalNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  agreementNo: string | null;
  workOrderDate: string | null;
  rebateLabel: string | null;
  rebatePercent: string | null;
  buyer: {
    name: string | null;
    attention: string | null;
    addressLines: string[];
    gstin: string | null;
    stateCode: string | null;
    stateName: string | null;
    pincode: string | null;
    city: string | null;
    phone: string | null;
  };
  warnings: string[];
};

type ParseResult = {
  sheetName: string;
  sheetNames: string[];
  headerRow: number;
  matched: Record<string, string>;
  ignored: string[];
  unrecognised: string[];
  rows: ParsedRow[];
  skippedBlankRows: number;
  truncated: boolean;
  productMatches: number;
  bill: ExtractedBill;
  matchedCustomerId: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Item',
  description: 'Description',
  hsnSac: 'HSN/SAC',
  qty: 'Qty',
  unit: 'Unit',
  rate: 'Rate',
  discountValue: 'Discount',
  discountType: 'Discount type',
  gstRate: 'GST %',
};


/** True when the sheet gave us anything worth filling the form with. */
function hasBillFields(b: ExtractedBill): boolean {
  return Boolean(
    b.buyer.name ||
      b.invoiceDate ||
      b.originalNumber ||
      b.agreementNo ||
      b.rebatePercent,
  );
}

function Detail({ k, v }: { k: string; v: string | null }) {
  return (
    <div className={v ? '' : 'opacity-50'}>
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-800">{v || 'not found'}</dd>
    </div>
  );
}

export default function ImportDialog({
  open,
  onClose,
  onApply,
  hasExistingRows,
}: {
  open: boolean;
  onClose: () => void;
  onApply: (
    payload: { rows: Row[]; bill: ExtractedBill; matchedCustomerId: string | null; applyBill: boolean },
    mode: 'replace' | 'append',
  ) => void;
  hasExistingRows: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [dragging, setDragging] = useState(false);
  // Kept so a different sheet of the same workbook can be re-read.
  const [file, setFile] = useState<File | null>(null);
  const [applyBill, setApplyBill] = useState(true);

  if (!open) return null;

  async function upload(f: File, sheet?: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    setFileName(f.name);
    setFile(f);
    try {
      const fd = new FormData();
      fd.append('file', f);
      if (sheet) fd.append('sheet', sheet);
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/import`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not read that file');
      setResult(json as ParseResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file');
    } finally {
      setBusy(false);
    }
  }

  function apply(mode: 'replace' | 'append') {
    if (!result) return;
    const rows: Row[] = result.rows.map((r) =>
      newRow({
        name: r.name,
        description: r.description,
        hsnSac: r.hsnSac,
        unit: r.unit,
        qty: r.qty,
        rate: r.rate,
        discountType: r.discountType,
        discountValue: r.discountValue,
        gstRate: r.gstRate,
      }),
    );
    onApply({ rows, bill: result.bill, matchedCustomerId: result.matchedCustomerId, applyBill }, mode);
    reset();
  }

  function reset() {
    setResult(null);
    setError(null);
    setFileName('');
    onClose();
  }

  const totalPreview =
    result?.rows.reduce(
      (sum, r) => sum + Math.round((toQtyMilli(r.qty) * toPaise(r.rate)) / 1000),
      0,
    ) ?? 0;
  const warningRows = result?.rows.filter((r) => r.warnings.length > 0) ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Import a bill"
    >
      <div className="my-8 w-full max-w-4xl rounded-xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Import a bill</h2>
            <p className="text-xs text-slate-500">
              PDF, Excel or CSV. Items and, where present, the whole bill. Nothing is saved until you apply it.
            </p>
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={reset}>
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!result && (
            <>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void upload(f);
                }}
                className={`grid place-items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
                  dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50'
                }`}
              >
                <p className="text-sm font-medium text-slate-700">
                  {busy ? `Reading ${fileName}…` : 'Drop a bill here — PDF, Excel or CSV'}
                </p>
                <p className="text-xs text-slate-500">or</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".pdf,.xlsx,.xlsm,.csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  className="btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                >
                  Choose file
                </button>
                <a
                  className="mt-1 text-xs text-brand-700 underline"
                  href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/import/template`}
                >
                  Download a template (pre-filled with your saved products)
                </a>
              </div>

              <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <p className="font-medium text-slate-700">Expected columns</p>
                <p className="mt-1">
                  <strong>Item</strong>, <strong>Qty</strong> and <strong>Rate</strong> are required.
                  Optional: Description, HSN/SAC, Unit, Discount, GST %. Header names are matched
                  loosely — “Particulars”, “Quantity”, “Unit Price” all work. Amount/Total/CGST
                  columns are ignored because the app recalculates them. Item names matching a saved
                  product inherit its HSN, unit, rate and GST.
                </p>
              </div>
            </>
          )}

          {result && (
            <>
              {result.sheetNames.length > 1 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2">
                  <span className="text-sm text-brand-900">
                    This workbook has {result.sheetNames.length} sheets — reading:
                  </span>
                  <select
                    className="input-sm w-auto"
                    value={result.sheetName}
                    disabled={busy}
                    onChange={(e) => {
                      if (file) void upload(file, e.target.value);
                    }}
                  >
                    {result.sheetNames.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="badge bg-emerald-50 text-emerald-700 ring-emerald-200">
                  {result.rows.length} items read
                </span>
                <span className="badge bg-slate-100 text-slate-700 ring-slate-200">
                  sheet “{result.sheetName}”, headers on row {result.headerRow}
                </span>
                {result.productMatches > 0 && (
                  <span className="badge bg-brand-50 text-brand-700 ring-brand-200">
                    {result.productMatches} matched a saved product
                  </span>
                )}
                {warningRows.length > 0 && (
                  <span className="badge bg-amber-50 text-amber-800 ring-amber-200">
                    {warningRows.length} need a look
                  </span>
                )}
              </div>

              {hasBillFields(result.bill) && (
                <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-3">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={applyBill}
                      onChange={(e) => setApplyBill(e.target.checked)}
                    />
                    <span className="text-sm font-medium text-slate-800">
                      This sheet is a complete bill — fill the whole form from it
                    </span>
                  </label>

                  <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                    <Detail k="Customer" v={result.bill.buyer.name} />
                    <Detail
                      k="Matched"
                      v={
                        result.matchedCustomerId
                          ? 'an existing customer'
                          : 'no match — pick or add one after importing'
                      }
                    />
                    <Detail k="Attention" v={result.bill.buyer.attention} />
                    <Detail
                      k="Buyer address"
                      v={
                        [
                          ...result.bill.buyer.addressLines,
                          result.bill.buyer.stateName,
                          result.bill.buyer.pincode,
                        ]
                          .filter(Boolean)
                          .join(', ') || null
                      }
                    />
                    <Detail k="Invoice date" v={result.bill.invoiceDate} />
                    <Detail k="Due date" v={result.bill.dueDate} />
                    <Detail k="Original bill no." v={result.bill.originalNumber} />
                    <Detail k="Agreement / order no." v={result.bill.agreementNo} />
                    <Detail k="Work order date" v={result.bill.workOrderDate} />
                    <Detail
                      k="Rebate"
                      v={
                        result.bill.rebatePercent
                          ? `${result.bill.rebateLabel ?? 'Below'} ${result.bill.rebatePercent}%`
                          : null
                      }
                    />
                  </dl>

                  {result.bill.warnings.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-xs text-amber-800">
                      {result.bill.warnings.map((w, i) => (
                        <li key={i}>⚠ {w}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-slate-500">
                    The bill number is not copied — this app issues its own from your numbering
                    format. The original is kept in the notes for reference.
                  </p>
                </div>
              )}

              <div className="grid gap-2 text-xs sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 p-2">
                  <p className="mb-1 font-medium text-slate-700">Columns used</p>
                  <ul className="space-y-0.5 text-slate-600">
                    {Object.entries(result.matched).map(([field, header]) => (
                      <li key={field}>
                        <span className="text-slate-400">{header}</span> →{' '}
                        <strong>{FIELD_LABELS[field] ?? field}</strong>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-slate-200 p-2">
                  <p className="mb-1 font-medium text-slate-700">Columns skipped</p>
                  <p className="text-slate-600">
                    {[...result.ignored, ...result.unrecognised].join(', ') || 'none'}
                  </p>
                  {result.skippedBlankRows > 0 && (
                    <p className="mt-1 text-slate-500">
                      {result.skippedBlankRows} blank row(s) ignored
                    </p>
                  )}
                  {result.truncated && (
                    <p className="mt-1 text-amber-700">
                      Only the first 500 item rows were read.
                    </p>
                  )}
                </div>
              </div>

              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[46rem] text-xs">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      <th className="th">Row</th>
                      <th className="th">Item</th>
                      <th className="th">HSN</th>
                      <th className="th text-right">Qty</th>
                      <th className="th">Unit</th>
                      <th className="th text-right">Rate</th>
                      <th className="th text-right">Disc.</th>
                      <th className="th text-right">GST</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.rows.map((r) => (
                      <tr key={r.sheetRow} className={r.warnings.length ? 'bg-amber-50/60' : ''}>
                        <td className="td text-slate-400">{r.sheetRow}</td>
                        <td className="td">
                          <div className="font-medium text-slate-800">{r.name}</div>
                          {r.description && (
                            <div className="text-slate-500">{r.description}</div>
                          )}
                          {r.warnings.map((w, i) => (
                            <div key={i} className="text-amber-700">
                              ⚠ {w}
                            </div>
                          ))}
                        </td>
                        <td className="td font-mono">{r.hsnSac || '—'}</td>
                        <td className="td text-right tabular-nums">{r.qty}</td>
                        <td className="td">{r.unit}</td>
                        <td className="td text-right tabular-nums">{r.rate}</td>
                        <td className="td text-right tabular-nums">
                          {Number(r.discountValue) > 0
                            ? r.discountType === 'PERCENT'
                              ? `${r.discountValue}%`
                              : `₹${r.discountValue}`
                            : '—'}
                        </td>
                        <td className="td text-right">{r.gstRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-slate-500">
                Gross value before discount and tax: ₹{formatPaise(totalPreview)}. Everything stays
                editable after importing.
              </p>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-5 py-3">
          {result ? (
            <>
              <button type="button" className="btn-primary" onClick={() => apply('replace')}>
                {hasExistingRows ? 'Replace line items' : `Add ${result.rows.length} items`}
              </button>
              {hasExistingRows && (
                <button type="button" className="btn-secondary" onClick={() => apply('append')}>
                  Append to existing
                </button>
              )}
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setResult(null);
                  setFileName('');
                }}
              >
                Choose a different file
              </button>
            </>
          ) : (
            <span className="text-xs text-slate-500">
              Supported: .pdf, .xlsx, .xlsm, .csv — up to 5 MB and 500 rows.
            </span>
          )}
          <button type="button" className="btn-ghost ml-auto" onClick={reset}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
