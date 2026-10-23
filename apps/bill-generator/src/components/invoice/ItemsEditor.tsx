'use client';

import type { ComputedLine } from '@/lib/gst';
import { GST_RATES, UNITS } from '@/lib/constants';
import { formatPaise, paiseToInput } from '@/lib/money';
import { newRow, type ProductLite, type Row } from './types';

export default function ItemsEditor({
  rows,
  setRows,
  lines,
  products,
  intraState,
}: {
  rows: Row[];
  setRows: (rows: Row[]) => void;
  lines: ComputedLine[];
  products: ProductLite[];
  intraState: boolean;
}) {
  const update = (idx: number, patch: Partial<Row>) =>
    setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const pickProduct = (idx: number, productId: string) => {
    const p = products.find((x) => x.id === productId);
    if (!p) {
      update(idx, { productId: '' });
      return;
    }
    update(idx, {
      productId: p.id,
      name: p.name,
      description: p.description ?? '',
      hsnSac: p.hsnSac ?? '',
      unit: p.unit,
      rate: paiseToInput(p.ratePaise),
      gstRate: p.gstRate,
    });
  };

  return (
    <div>
      {/* Wide screens: a real table. */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[60rem] border-separate border-spacing-0">
          <thead>
            <tr className="bg-slate-50">
              <th className="th w-8">#</th>
              <th className="th min-w-56">Item</th>
              <th className="th w-28">HSN/SAC</th>
              <th className="th w-24">Qty</th>
              <th className="th w-24">Unit</th>
              <th className="th w-32">Rate</th>
              <th className="th w-36">Discount</th>
              <th className="th w-20">GST</th>
              <th className="th w-32 text-right">Taxable</th>
              <th className="th w-32 text-right">Total</th>
              <th className="th w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const l = lines[i];
              return (
                <tr key={r.key} className="border-t border-slate-100 align-top">
                  <td className="td pt-3 text-xs text-slate-400">{i + 1}</td>
                  <td className="td">
                    <select
                      className="input-sm mb-1"
                      value={r.productId}
                      onChange={(e) => pickProduct(i, e.target.value)}
                    >
                      <option value="">— custom item —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="input-sm"
                      placeholder="Item name"
                      value={r.name}
                      onChange={(e) => update(i, { name: e.target.value, productId: '' })}
                    />
                    <input
                      className="input-sm mt-1 text-xs"
                      placeholder="Description (optional)"
                      value={r.description}
                      onChange={(e) => update(i, { description: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className="input-sm"
                      inputMode="numeric"
                      maxLength={8}
                      value={r.hsnSac}
                      onChange={(e) => update(i, { hsnSac: e.target.value.replace(/\D/g, '') })}
                    />
                  </td>
                  <td className="td">
                    <input
                      className="input-sm text-right"
                      inputMode="decimal"
                      value={r.qty}
                      onChange={(e) => update(i, { qty: e.target.value })}
                    />
                  </td>
                  <td className="td">
                    <select
                      className="input-sm"
                      value={r.unit}
                      onChange={(e) => update(i, { unit: e.target.value })}
                    >
                      {UNITS.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </td>
                  <td className="td">
                    <input
                      className="input-sm text-right"
                      inputMode="decimal"
                      value={r.rate}
                      onChange={(e) => update(i, { rate: e.target.value, productId: '' })}
                    />
                  </td>
                  <td className="td">
                    <div className="flex gap-1">
                      <input
                        className="input-sm text-right"
                        inputMode="decimal"
                        value={r.discountValue}
                        onChange={(e) => update(i, { discountValue: e.target.value })}
                      />
                      <select
                        className="input-sm w-16"
                        value={r.discountType}
                        onChange={(e) =>
                          update(i, { discountType: e.target.value as Row['discountType'] })
                        }
                      >
                        <option value="PERCENT">%</option>
                        <option value="AMOUNT">₹</option>
                      </select>
                    </div>
                  </td>
                  <td className="td">
                    <select
                      className="input-sm"
                      value={r.gstRate}
                      onChange={(e) => update(i, { gstRate: Number(e.target.value) })}
                    >
                      {GST_RATES.map((g) => (
                        <option key={g} value={g}>
                          {g}%
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="td pt-3 text-right tabular-nums">
                    {l ? formatPaise(l.taxablePaise) : '0.00'}
                    {l && l.discountPaise > 0 && (
                      <div className="text-xs text-emerald-600">−{formatPaise(l.discountPaise)}</div>
                    )}
                  </td>
                  <td className="td pt-3 text-right font-medium tabular-nums">
                    {l ? formatPaise(l.totalPaise) : '0.00'}
                    {l && l.gstRate > 0 && (
                      <div className="text-xs font-normal text-slate-400">
                        {intraState
                          ? `C ${formatPaise(l.cgstPaise)} · S ${formatPaise(l.sgstPaise)}`
                          : `IGST ${formatPaise(l.igstPaise)}`}
                      </div>
                    )}
                  </td>
                  <td className="td pt-3 text-right">
                    <button
                      type="button"
                      aria-label="Remove line"
                      className="btn-ghost btn-sm text-rose-600"
                      onClick={() => setRows(rows.filter((_, x) => x !== i))}
                      disabled={rows.length === 1}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: one card per line. */}
      <div className="space-y-3 lg:hidden">
        {rows.map((r, i) => {
          const l = lines[i];
          return (
            <div key={r.key} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">Item {i + 1}</span>
                <button
                  type="button"
                  className="btn-ghost btn-sm text-rose-600"
                  onClick={() => setRows(rows.filter((_, x) => x !== i))}
                  disabled={rows.length === 1}
                >
                  Remove
                </button>
              </div>
              <select
                className="input-sm mb-2"
                value={r.productId}
                onChange={(e) => pickProduct(i, e.target.value)}
              >
                <option value="">— custom item —</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input
                className="input-sm mb-2"
                placeholder="Item name"
                value={r.name}
                onChange={(e) => update(i, { name: e.target.value, productId: '' })}
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  className="input-sm"
                  placeholder="HSN/SAC"
                  inputMode="numeric"
                  value={r.hsnSac}
                  onChange={(e) => update(i, { hsnSac: e.target.value.replace(/\D/g, '') })}
                />
                <select
                  className="input-sm"
                  value={r.unit}
                  onChange={(e) => update(i, { unit: e.target.value })}
                >
                  {UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
                <input
                  className="input-sm text-right"
                  placeholder="Qty"
                  inputMode="decimal"
                  value={r.qty}
                  onChange={(e) => update(i, { qty: e.target.value })}
                />
                <input
                  className="input-sm text-right"
                  placeholder="Rate"
                  inputMode="decimal"
                  value={r.rate}
                  onChange={(e) => update(i, { rate: e.target.value, productId: '' })}
                />
                <div className="flex gap-1">
                  <input
                    className="input-sm text-right"
                    placeholder="Disc."
                    inputMode="decimal"
                    value={r.discountValue}
                    onChange={(e) => update(i, { discountValue: e.target.value })}
                  />
                  <select
                    className="input-sm w-14"
                    value={r.discountType}
                    onChange={(e) =>
                      update(i, { discountType: e.target.value as Row['discountType'] })
                    }
                  >
                    <option value="PERCENT">%</option>
                    <option value="AMOUNT">₹</option>
                  </select>
                </div>
                <select
                  className="input-sm"
                  value={r.gstRate}
                  onChange={(e) => update(i, { gstRate: Number(e.target.value) })}
                >
                  {GST_RATES.map((g) => (
                    <option key={g} value={g}>
                      GST {g}%
                    </option>
                  ))}
                </select>
              </div>
              {l && (
                <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm">
                  <span className="text-slate-500">
                    Taxable {formatPaise(l.taxablePaise)}
                    {l.gstRate > 0 &&
                      ` · ${intraState ? 'CGST+SGST' : 'IGST'} ${formatPaise(
                        l.cgstPaise + l.sgstPaise + l.igstPaise,
                      )}`}
                  </span>
                  <span className="font-semibold tabular-nums">{formatPaise(l.totalPaise)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setRows([...rows, newRow()])}
        >
          + Add line
        </button>
      </div>
    </div>
  );
}
