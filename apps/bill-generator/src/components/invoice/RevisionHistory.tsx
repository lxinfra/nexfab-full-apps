import { formatINR, formatQty } from '@/lib/money';
import { DOC_LABELS, STATUS_LABELS, type DocType, type Status } from '@/lib/constants';

type Snapshot = {
  number?: string | null;
  docType?: string;
  status?: string;
  invoiceDate?: string;
  totalPaise?: number;
  taxablePaise?: number;
  rebateBp?: number;
  items?: {
    name: string;
    qtyMilli: number;
    ratePaise: number;
    gstRate: number;
    totalPaise: number;
  }[];
};

export type RevisionRow = {
  id: string;
  revision: number;
  reason: string | null;
  createdAt: Date;
  snapshot: string;
};

/**
 * Every earlier version of an issued bill. The newest entry is what the bill
 * looked like immediately before the most recent edit.
 */
export default function RevisionHistory({
  revisions,
  currentTotalPaise,
}: {
  revisions: RevisionRow[];
  currentTotalPaise: number;
}) {
  if (revisions.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No edits yet. If you change this bill, the version it has now will be saved here first.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {revisions.map((r) => {
        let snap: Snapshot = {};
        try {
          snap = JSON.parse(r.snapshot) as Snapshot;
        } catch {
          /* a damaged snapshot should not break the page */
        }
        const before = snap.totalPaise ?? 0;
        const delta = currentTotalPaise - before;

        return (
          <li key={r.id} className="rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-slate-800">
                Before revision {r.revision}
              </span>
              <span className="text-xs text-slate-500">
                saved {r.createdAt.toLocaleString('en-IN')}
              </span>
            </div>

            {r.reason && <p className="mt-1 text-slate-600">“{r.reason}”</p>}

            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs sm:grid-cols-4">
              <Cell k="Number" v={snap.number ?? '—'} />
              <Cell
                k="Type"
                v={snap.docType ? (DOC_LABELS[snap.docType as DocType] ?? snap.docType) : '—'}
              />
              <Cell
                k="Status"
                v={snap.status ? (STATUS_LABELS[snap.status as Status] ?? snap.status) : '—'}
              />
              <Cell
                k="Date"
                v={snap.invoiceDate ? String(snap.invoiceDate).slice(0, 10) : '—'}
              />
            </dl>

            <div className="mt-2 flex flex-wrap items-baseline gap-3 border-t border-slate-100 pt-2">
              <span className="text-slate-600">
                Total was <strong className="tabular-nums">{formatINR(before)}</strong>
              </span>
              {delta !== 0 && (
                <span className={delta > 0 ? 'text-amber-700' : 'text-emerald-700'}>
                  {delta > 0 ? '+' : '−'}
                  {formatINR(Math.abs(delta))} since
                </span>
              )}
            </div>

            {snap.items && snap.items.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
                {snap.items.map((it, i) => (
                  <li key={i}>
                    {it.name} — {formatQty(it.qtyMilli)} × {formatINR(it.ratePaise)} @ {it.gstRate}%
                    {' = '}
                    <span className="tabular-nums">{formatINR(it.totalPaise)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-slate-400">{k}</dt>
      <dd className="text-slate-700">{v}</dd>
    </div>
  );
}
