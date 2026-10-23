'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '@/lib/constants';
import { formatINR, paiseToInput, toPaise } from '@/lib/money';

export type PaymentRow = {
  id: string;
  paidOn: string;
  amountPaise: number;
  method: string;
  reference: string | null;
};

export default function PaymentsPanel({
  invoiceId,
  payments,
  totalPaise,
  paidPaise,
  disabled,
}: {
  invoiceId: string;
  payments: PaymentRow[];
  totalPaise: number;
  paidPaise: number;
  disabled: boolean;
}) {
  const router = useRouter();
  const balance = totalPaise - paidPaise;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(balance > 0 ? paiseToInput(balance) : '');
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    const amountPaise = toPaise(amount);
    if (amountPaise <= 0) return setError('Enter an amount greater than zero.');
    setBusy(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paidOn, amountPaise, method, reference }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not record payment');
      setOpen(false);
      setReference('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Invoice total" value={formatINR(totalPaise)} />
        <Stat label="Received" value={formatINR(paidPaise)} tone="text-emerald-700" />
        <Stat
          label="Balance"
          value={formatINR(balance)}
          tone={balance > 0 ? 'text-amber-700' : 'text-slate-500'}
        />
      </div>

      {payments.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100 text-sm">
          {payments.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="font-medium text-slate-800">{formatINR(p.amountPaise)}</p>
                <p className="text-xs text-slate-500">
                  {p.paidOn} ·{' '}
                  {PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}
                  {p.reference ? ` · ${p.reference}` : ''}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost btn-sm text-rose-600"
                onClick={async () => {
                  await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/payments/${p.id}`, { method: 'DELETE' });
                  router.refresh();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {disabled ? (
        <p className="text-sm text-slate-500">
          This document is cancelled — payments can no longer be recorded.
        </p>
      ) : !open ? (
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>
          + Record payment
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          {error && <p className="err">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="input-sm"
              inputMode="decimal"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <input
              className="input-sm"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
            <select
              className="input-sm"
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
            <input
              className="input-sm"
              placeholder="Reference / UTR"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={submit}>
              {busy ? 'Saving…' : 'Save payment'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <p className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${tone ?? 'text-slate-900'}`}>{value}</p>
    </div>
  );
}
