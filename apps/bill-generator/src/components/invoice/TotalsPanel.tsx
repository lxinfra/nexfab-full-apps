'use client';

import type { ComputedLine, SupplyType, Totals } from '@/lib/gst';
import { taxBreakup } from '@/lib/gst';
import { formatPaise } from '@/lib/money';
import { paiseToWords } from '@/lib/words';

export default function TotalsPanel({
  lines,
  totals,
  supplyType,
  roundOff,
  onToggleRoundOff,
  rebateLabel = 'Rebate',
}: {
  lines: ComputedLine[];
  totals: Totals;
  supplyType: SupplyType;
  roundOff: boolean;
  onToggleRoundOff?: (v: boolean) => void;
  rebateLabel?: string;
}) {
  const breakup = taxBreakup(lines, supplyType);

  return (
    <div className="space-y-3">
      <dl className="space-y-1.5 text-sm">
        <Line label="Subtotal" value={totals.subtotalPaise} />
        {totals.discountPaise > 0 && (
          <Line label="Discount" value={-totals.discountPaise} tone="text-emerald-600" />
        )}
        {totals.rebatePaise > 0 && (
          <>
            <Line label="Basic total" value={totals.basicTotalPaise} />
            <Line label={rebateLabel} value={-totals.rebatePaise} tone="text-emerald-600" />
          </>
        )}
        <Line label="Taxable value" value={totals.taxablePaise} strong />
        {breakup.map((b) => (
          <Line key={b.label} label={b.label} value={b.amountPaise} />
        ))}
        {breakup.length === 0 && <Line label="GST" value={0} />}
        {roundOff && totals.roundOffPaise !== 0 && (
          <Line label="Round off" value={totals.roundOffPaise} />
        )}
        <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
          <dt className="font-semibold text-slate-900">Grand total</dt>
          <dd className="text-lg font-bold tabular-nums text-slate-900">
            ₹{formatPaise(totals.totalPaise)}
          </dd>
        </div>
      </dl>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span className="font-medium text-slate-700">In words: </span>
        {paiseToWords(totals.totalPaise)}
      </p>

      {onToggleRoundOff && (
        <label className="flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="h-3.5 w-3.5"
            checked={roundOff}
            onChange={(e) => onToggleRoundOff(e.target.checked)}
          />
          Round the grand total to the nearest rupee
        </label>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: number;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={strong ? 'font-medium text-slate-700' : 'text-slate-600'}>{label}</dt>
      <dd className={`tabular-nums ${tone ?? (strong ? 'font-medium text-slate-900' : 'text-slate-800')}`}>
        {formatPaise(value)}
      </dd>
    </div>
  );
}
