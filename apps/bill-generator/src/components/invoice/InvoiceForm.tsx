'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Company } from '@prisma/client';
import { Field, SectionCard } from '@/components/ui/Field';
import StateSelect from '@/components/ui/StateSelect';
import { FormError } from '@/components/ui/FormShell';
import ItemsEditor from './ItemsEditor';
import TotalsPanel from './TotalsPanel';
import InvoicePreview from './InvoicePreview';
import ImportDialog from './ImportDialog';
import { newRow, rowToLine, rowToPayload, type CustomerLite, type ProductLite, type Row } from './types';
import { applyRebate, computeLine, computeTotals, supplyTypeFor } from '@/lib/gst';
import { toBasisPoints } from '@/lib/money';
import {
  DOC_LABELS,
  DOC_TYPES,
  SUPPLY_TYPE_LABELS,
  WITHIN_STATE_SUPPLY,
  type DocType,
  type Status,
  type WithinStateSupply,
} from '@/lib/constants';
import { stateByCode } from '@/lib/states';

export type InvoiceFormInitial = {
  id: string;
  docType: DocType;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  placeOfSupplyCode: string;
  reverseCharge: boolean;
  roundOff: boolean;
  withinStateSupply: WithinStateSupply;
  agreementNo: string;
  workOrderDate: string;
  rebateLabel: string;
  rebatePercent: string;
  number: string | null;
  status: Status;
  notes: string;
  terms: string;
  rows: Row[];
};

export default function InvoiceForm({
  company,
  customers,
  products,
  initial,
  issued = false,
}: {
  company: Company;
  customers: CustomerLite[];
  products: ProductLite[];
  initial?: InvoiceFormInitial;
  /** Editing a bill that already carries a number. */
  issued?: boolean;
}) {
  const router = useRouter();
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;

  const [docType, setDocType] = useState<DocType>(initial?.docType ?? 'TAX_INVOICE');
  const [customerId, setCustomerId] = useState(initial?.customerId ?? '');
  const [invoiceDate, setInvoiceDate] = useState(initial?.invoiceDate ?? todayStr);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [placeOfSupplyCode, setPlaceOfSupplyCode] = useState(
    initial?.placeOfSupplyCode ?? company.stateCode,
  );
  const [reverseCharge, setReverseCharge] = useState(initial?.reverseCharge ?? false);
  const [roundOff, setRoundOff] = useState(initial?.roundOff ?? true);
  const [withinStateSupply, setWithinStateSupply] = useState<WithinStateSupply>(
    initial?.withinStateSupply ?? 'INTRA_STATE',
  );
  const [agreementNo, setAgreementNo] = useState(initial?.agreementNo ?? '');
  const [workOrderDate, setWorkOrderDate] = useState(initial?.workOrderDate ?? '');
  const [rebateLabel, setRebateLabel] = useState(initial?.rebateLabel ?? 'Below');
  const [rebatePercent, setRebatePercent] = useState(initial?.rebatePercent ?? '0');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [terms, setTerms] = useState(initial?.terms ?? company.defaultTerms ?? '');
  const [rows, setRows] = useState<Row[]>(initial?.rows ?? [newRow()]);
  const [nextNumber, setNextNumber] = useState<string | null>(null);
  const [saving, setSaving] = useState<null | 'DRAFT' | 'ISSUE'>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [editReason, setEditReason] = useState('');

  const customer = customers.find((c) => c.id === customerId) ?? null;

  // Picking a customer defaults the place of supply to their billing state.
  useEffect(() => {
    if (customer) setPlaceOfSupplyCode(customer.billingStateCode);
  }, [customerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show the number this document will take when it is issued.
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/next-number?docType=${docType}&date=${invoiceDate}&customerId=${customerId}`, {
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j) => setNextNumber(j.number ?? null))
      .catch(() => {});
    return () => ctrl.abort();
  }, [docType, invoiceDate, customerId]);

  const supplyType = supplyTypeFor(company.stateCode, placeOfSupplyCode, withinStateSupply);
  const lines = useMemo(
    () => rows.map((r) => computeLine(rowToLine(r), supplyType)),
    [rows, supplyType],
  );
  const rebateBp = toBasisPoints(rebatePercent);
  const rebated = useMemo(() => applyRebate(lines, rebateBp, supplyType), [lines, rebateBp, supplyType]);
  const totals = useMemo(
    () =>
      computeTotals(rebated.lines, roundOff, {
        basicTotalPaise: rebated.basicTotalPaise,
        rebatePaise: rebated.rebatePaise,
      }),
    [rebated, roundOff],
  );

  async function save(mode: 'DRAFT' | 'ISSUE') {
    setError(null);
    if (!customerId) return setError('Choose a customer first.');
    const usable = rows.filter((r) => r.name.trim() !== '');
    if (usable.length === 0) return setError('Add at least one line item with a name.');

    setSaving(mode);
    try {
      const body = {
        docType,
        customerId,
        invoiceDate,
        dueDate,
        placeOfSupplyCode,
        reverseCharge,
        roundOff,
        withinStateSupply,
        agreementNo,
        workOrderDate,
        rebateLabel,
        rebateBp,
        editReason,
        notes,
        terms,
        status: issued ? initial!.status : mode === 'DRAFT' ? 'DRAFT' : 'SENT',
        items: usable.map(rowToPayload),
      };
      const res = await fetch(initial ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/${initial.id}` : `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices`, {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save');
      router.push(`/invoices/${json.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setSaving(null);
    }
  }

  const intra = supplyType !== 'INTER_STATE';
  const posName = stateByCode(placeOfSupplyCode)?.name ?? '';

  const preview = (
    <InvoicePreview
      company={company}
      customer={customer}
      docType={docType}
      number={initial?.number ?? (initial ? null : nextNumber)}
      invoiceDate={invoiceDate}
      dueDate={dueDate}
      placeOfSupply={posName}
      placeOfSupplyCode={placeOfSupplyCode}
      reverseCharge={reverseCharge}
      lines={rebated.lines}
      totals={totals}
      supplyType={supplyType}
      notes={notes}
      terms={terms}
      agreementNo={agreementNo}
      workOrderDate={workOrderDate}
      rebateLabel={rebateLabel}
      rebateBp={rebateBp}
    />
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="space-y-5">
        <FormError error={error} />
        {importNotice && (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span>{importNotice}</span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setImportNotice(null)}>
              ✕
            </button>
          </div>
        )}

        <SectionCard
          title="Document"
          description={
            nextNumber ? `Next number in this series: ${nextNumber}` : 'Numbering starts on issue.'
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" required>
              <select
                className="input"
                value={docType}
                onChange={(e) => setDocType(e.target.value as DocType)}
              >
                {DOC_TYPES.map((d) => (
                  <option key={d} value={d}>
                    {DOC_LABELS[d]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Customer" required>
              <select
                className="input"
                required
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
              >
                <option value="">Select customer…</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.billingState}
                  </option>
                ))}
              </select>
            </Field>
            {/* Read-only: the number is allocated by the database on save. */}
            <Field
              label="Invoice number"
              className="sm:col-span-2"
              hint={
                initial?.number
                  ? 'Assigned when this bill was issued. It never changes on edit.'
                  : 'Generated automatically when you save — it cannot be typed.'
              }
            >
              <input
                className="input font-mono"
                value={initial?.number ?? nextNumber ?? 'generated on save'}
                readOnly
                disabled
                aria-readonly="true"
              />
            </Field>
            <Field label="Invoice date" required>
              <input
                type="date"
                className="input"
                required
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
              />
            </Field>
            <Field label="Due date">
              <input
                type="date"
                className="input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
            <Field
              label="Place of supply"
              required
              hint={
                intra
                  ? `Same state as ${company.state} → CGST + SGST`
                  : `Different from ${company.state} → IGST`
              }
            >
              <StateSelect
                value={placeOfSupplyCode}
                onChange={(code) => setPlaceOfSupplyCode(code)}
                required
              />
            </Field>
            <Field
              label="Supply type"
              hint={
                intra
                  ? 'Both are taxed CGST + SGST; the choice is recorded on the bill.'
                  : `Place of supply is outside ${company.state}, so this is an inter-state supply (IGST).`
              }
            >
              {intra ? (
                <div className="flex flex-wrap gap-4 pt-1.5">
                  {WITHIN_STATE_SUPPLY.map((option) => (
                    <label
                      key={option}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="radio"
                        name="supplyType"
                        className="h-4 w-4"
                        value={option}
                        checked={withinStateSupply === option}
                        onChange={() => setWithinStateSupply(option)}
                      />
                      {SUPPLY_TYPE_LABELS[option]}
                    </label>
                  ))}
                </div>
              ) : (
                <input className="input" value={SUPPLY_TYPE_LABELS.INTER_STATE} readOnly disabled />
              )}
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={reverseCharge}
                  onChange={(e) => setReverseCharge(e.target.checked)}
                />
                Tax payable under reverse charge
              </label>
            </div>
          </div>

          <div
            className={`mt-4 rounded-lg px-3 py-2 text-sm ${
              intra ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'
            }`}
          >
            <strong>{SUPPLY_TYPE_LABELS[supplyType]}</strong> —{' '}
            {intra
              ? 'CGST and SGST are charged, split 50/50.'
              : 'IGST is charged at the full rate.'}{' '}
            Supplier {company.state} ({company.stateCode}) → place of supply {posName || '—'} (
            {placeOfSupplyCode || '—'}).
          </div>
        </SectionCard>

        <SectionCard
          title="Line items"
          description="Type them in, pick from your saved products, or import a PDF or spreadsheet."
          actions={
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setImporting(true)}
            >
              ⬆ Import bill (PDF / Excel)
            </button>
          }
        >
          <ItemsEditor
            rows={rows}
            setRows={setRows}
            lines={lines}
            products={products}
            intraState={intra}
          />
        </SectionCard>

        <ImportDialog
          open={importing}
          onClose={() => setImporting(false)}
          hasExistingRows={rows.some((r) => r.name.trim() !== '')}
          onApply={({ rows: imported, bill, matchedCustomerId, applyBill }, mode) => {
            // "Replace" still drops any blank starter row the form began with.
            setRows(
              mode === 'append'
                ? [...rows.filter((r) => r.name.trim() !== ''), ...imported]
                : imported,
            );

            if (applyBill) {
              if (matchedCustomerId) setCustomerId(matchedCustomerId);
              if (bill.invoiceDate) setInvoiceDate(bill.invoiceDate);
              if (bill.dueDate) setDueDate(bill.dueDate);
              if (bill.agreementNo) setAgreementNo(bill.agreementNo);
              if (bill.workOrderDate) setWorkOrderDate(bill.workOrderDate);
              if (bill.rebatePercent) {
                setRebatePercent(bill.rebatePercent);
                if (bill.rebateLabel) setRebateLabel(bill.rebateLabel);
              }
              // Only the buyer's own state should move the place of supply, and
              // only when no saved customer was matched (a match sets it itself).
              if (!matchedCustomerId && bill.buyer.stateCode) {
                setPlaceOfSupplyCode(bill.buyer.stateCode);
              }
              // Keep the source bill's own number traceable.
              if (bill.originalNumber) {
                const ref = `Original bill reference: ${bill.originalNumber}.`;
                setNotes((n) => (n.includes(ref) ? n : [n, ref].filter(Boolean).join('\n')));
              }
              setImportNotice(
                matchedCustomerId
                  ? null
                  : bill.buyer.name
                    ? `Imported “${bill.buyer.name}” — no saved customer matched, so pick or add one above.`
                    : null,
              );
            }
            setImporting(false);
          }}
        />

        <SectionCard
          title="Work order & rebate"
          description="These fill the “Order Details” block on the bill."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Agreement / work order no.">
              <input
                className="input"
                value={agreementNo}
                onChange={(e) => setAgreementNo(e.target.value)}
                placeholder="93/2024-25/IDA"
              />
            </Field>
            <Field label="Work order date">
              <input
                type="date"
                className="input"
                value={workOrderDate}
                onChange={(e) => setWorkOrderDate(e.target.value)}
              />
            </Field>
            <Field
              label="Rebate label"
              hint="Wording on the deduction row — “Below”, “Less”, “Rebate”…"
            >
              <input
                className="input"
                value={rebateLabel}
                onChange={(e) => setRebateLabel(e.target.value)}
                placeholder="Below"
              />
            </Field>
            <Field
              label="Rebate %"
              hint="Tender rate below schedule. Applies to the basic total, split pro-rata across GST slabs."
            >
              <input
                className="input"
                inputMode="decimal"
                value={rebatePercent}
                onChange={(e) => setRebatePercent(e.target.value)}
                placeholder="21.01"
              />
            </Field>
          </div>
        </SectionCard>

        <div className="grid gap-5 lg:grid-cols-2">
          <SectionCard title="Notes & terms">
            <Field label="Notes" hint="Printed under the bank details">
              <textarea
                className="input min-h-20"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <div className="mt-4">
              <Field label="Terms & conditions">
                <textarea
                  className="input min-h-28"
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard title="Totals">
            <TotalsPanel
              rebateLabel={rebateBp > 0 ? `${rebateLabel || 'Rebate'} ${rebatePercent}%` : undefined}
              lines={rebated.lines}
              totals={totals}
              supplyType={supplyType}
              roundOff={roundOff}
              onToggleRoundOff={setRoundOff}
            />
          </SectionCard>
        </div>

        {issued && (
          <SectionCard
            title="Reason for this change"
            description="Stored with the revision so the correction can be explained later."
          >
            <input
              className="input"
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              placeholder="e.g. corrected quantity agreed with the buyer on 12/06"
            />
          </SectionCard>
        )}

        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border">
          {issued ? (
            <button
              type="button"
              className="btn-primary"
              disabled={saving !== null}
              onClick={() => save('ISSUE')}
            >
              {saving ? 'Saving…' : 'Save correction'}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn-primary"
                disabled={saving !== null}
                onClick={() => save('ISSUE')}
              >
                {saving === 'ISSUE' ? 'Issuing…' : `Issue ${DOC_LABELS[docType].toLowerCase()}`}
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={saving !== null}
                onClick={() => save('DRAFT')}
              >
                {saving === 'DRAFT' ? 'Saving…' : 'Save as draft'}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-ghost xl:hidden"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? 'Hide preview' : 'Show preview'}
          </button>
          <button
            type="button"
            className="btn-ghost ml-auto"
            onClick={() => router.push('/invoices')}
            disabled={saving !== null}
          >
            Cancel
          </button>
        </div>

        {showPreview && <div className="xl:hidden">{preview}</div>}
      </div>

      <aside className="hidden xl:block">
        <div className="sticky top-20">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
            Live preview
          </p>
          {preview}
        </div>
      </aside>
    </div>
  );
}
