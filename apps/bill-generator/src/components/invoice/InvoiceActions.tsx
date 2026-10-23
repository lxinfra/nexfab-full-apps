'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { COPY_LABELS, COPY_TYPES, STATUSES, STATUS_LABELS, type CopyType, type Status } from '@/lib/constants';

export default function InvoiceActions({
  invoiceId,
  status,
  isDraft,
  hasNumber,
}: {
  invoiceId: string;
  status: Status;
  isDraft: boolean;
  hasNumber: boolean;
}) {
  const router = useRouter();
  const [copy, setCopy] = useState<CopyType>('ORIGINAL');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const pdfUrl = (download: boolean) =>
    `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/${invoiceId}/pdf?copy=${copy.toLowerCase()}${download ? '&download=1' : ''}`;

  async function call(label: string, url: string, body?: unknown) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Action failed');
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Copy type"
          className="input-sm w-auto"
          value={copy}
          onChange={(e) => setCopy(e.target.value as CopyType)}
        >
          {COPY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t === 'NONE' ? 'No copy label' : COPY_LABELS[t]}
            </option>
          ))}
        </select>
        <a className="btn-primary btn-sm" href={pdfUrl(true)}>
          ⬇ Download PDF
        </a>
        <a className="btn-secondary btn-sm" href={pdfUrl(false)} target="_blank" rel="noreferrer">
          🖨 Open / print
        </a>
        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={busy !== null}
          onClick={async () => {
            const j = await call('dup', `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/${invoiceId}/duplicate`);
            if (j?.id) router.push(`/invoices/${j.id}/edit`);
          }}
        >
          {busy === 'dup' ? 'Duplicating…' : '⧉ Duplicate'}
        </button>
        {status !== 'CANCELLED' && (
          <a className="btn-secondary btn-sm" href={`/invoices/${invoiceId}/edit`}>
            {isDraft ? '✎ Edit draft' : '✎ Edit bill'}
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs font-medium text-slate-500">Status</span>
        {STATUSES.filter((st) => st !== 'CANCELLED' && !(st === 'DRAFT' && hasNumber)).map((st) => (
          <button
            key={st}
            type="button"
            disabled={busy !== null || status === st || status === 'CANCELLED'}
            className={`btn-sm ${status === st ? 'btn-primary' : 'btn-secondary'}`}
            onClick={async () => {
              await call(st, `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/${invoiceId}/status`, { status: st });
              router.refresh();
            }}
          >
            {STATUS_LABELS[st]}
          </button>
        ))}
        {status !== 'CANCELLED' && (
          <button
            type="button"
            className="btn-danger btn-sm ml-auto"
            onClick={() => setCancelling((v) => !v)}
          >
            Cancel document
          </button>
        )}
        {isDraft && !hasNumber && (
          <button
            type="button"
            className="btn-ghost btn-sm text-rose-600"
            disabled={busy !== null}
            onClick={async () => {
              setBusy('del');
              const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/${invoiceId}`, { method: 'DELETE' });
              setBusy(null);
              if (res.ok) {
                router.push('/invoices');
                router.refresh();
              } else {
                const j = await res.json().catch(() => ({}));
                setError(j.error ?? 'Could not discard draft');
              }
            }}
          >
            Discard draft
          </button>
        )}
      </div>

      {cancelling && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="mb-2 text-sm text-rose-800">
            Cancelling keeps the number reserved so your series stays unbroken. This cannot be
            undone.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input-sm flex-1"
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              type="button"
              className="btn-danger btn-sm"
              disabled={busy !== null}
              onClick={async () => {
                await call('cancel', `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/invoices/${invoiceId}/status`, {
                  status: 'CANCELLED',
                  cancelReason: reason || null,
                });
                setCancelling(false);
                router.refresh();
              }}
            >
              {busy === 'cancel' ? 'Cancelling…' : 'Confirm cancellation'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setCancelling(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
