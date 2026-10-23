'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Product } from '@prisma/client';
import { Field, SectionCard } from '@/components/ui/Field';
import { FormActions, FormError } from '@/components/ui/FormShell';
import { GST_RATES, UNITS } from '@/lib/constants';
import { formatINR, paiseToInput, toPaise } from '@/lib/money';
import { formatHsn, parseHsn, validateHsn } from '@/lib/hsn';

function Level({
  label,
  digits,
  note,
  on,
}: {
  label: string;
  digits: string;
  note: string;
  on: boolean;
}) {
  return (
    <li className={on ? 'text-slate-700' : 'text-slate-400'}>
      <span className="inline-block w-24">{label}</span>
      <span className="font-mono">{digits || '—'}</span>
      <span className="ml-2 text-slate-400">{note}</span>
    </li>
  );
}

export default function ProductForm({ product }: { product?: Product | null }) {
  const router = useRouter();
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [hsnSac, setHsnSac] = useState(product?.hsnSac ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'PCS');
  const [rate, setRate] = useState(product ? paiseToInput(product.ratePaise) : '');
  const [gstRate, setGstRate] = useState(product?.gstRate ?? 18);
  const [isService, setIsService] = useState(product?.isService ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ratePaise = toPaise(rate);
  const hsnParts = parseHsn(hsnSac);
  const hsnError = validateHsn(hsnSac);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (hsnError) {
      setError(hsnError);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(product ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/products/${product.id}` : `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/products`, {
        method: product ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          hsnSac,
          unit,
          ratePaise,
          gstRate: Number(gstRate),
          isService,
          isActive: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save');
      router.push('/products');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 pb-4">
      <FormError error={error} />

      <SectionCard title={isService ? 'Service' : 'Product'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <input
              className="input"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MS Fabricated Steel Frame"
            />
          </Field>
          <Field label="Description" className="sm:col-span-2" hint="Printed under the item name">
            <textarea
              className="input min-h-20"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <Field
            label={isService ? 'SAC code' : 'HSN code'}
            className="sm:col-span-2"
            error={hsnError}
            hint={
              hsnError
                ? undefined
                : isService
                  ? 'Services use a 6-digit SAC starting 99, e.g. 995461.'
                  : '2 digits = chapter · 4 = heading · 6 = sub-heading · 8 = tariff item. Invoices take 4, 6 or 8.'
            }
          >
            <input
              className="input font-mono"
              inputMode="numeric"
              maxLength={8}
              value={hsnSac}
              onChange={(e) => setHsnSac(e.target.value.replace(/\D/g, ''))}
              placeholder={isService ? '995461' : '73089090'}
            />
            {hsnParts && (
              <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs">
                <p className="font-medium text-slate-700">
                  Chapter {hsnParts.chapter} — {hsnParts.chapterName}
                </p>
                <ul className="mt-1 space-y-0.5 text-slate-600">
                  <Level
                    label="Chapter"
                    digits={hsnParts.chapter}
                    note="broad category"
                    on={true}
                  />
                  <Level
                    label="Heading"
                    digits={hsnParts.heading}
                    note="specific heading"
                    on={!!hsnParts.heading}
                  />
                  <Level
                    label="Sub-heading"
                    digits={hsnParts.subHeading}
                    note="international (WCO) level"
                    on={!!hsnParts.subHeading}
                  />
                  <Level
                    label="Tariff item"
                    digits={hsnParts.tariffItem}
                    note="national (India) level"
                    on={!!hsnParts.tariffItem}
                  />
                </ul>
                <p className="mt-1.5 text-slate-500">
                  Prints as <span className="font-mono">{formatHsn(hsnSac)}</span>
                </p>
              </div>
            )}
          </Field>
          <Field label="Unit" required>
            <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rate (₹ per unit)" required hint={ratePaise ? formatINR(ratePaise) : undefined}>
            <input
              className="input"
              required
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="12500.00"
            />
          </Field>
          <Field label="GST rate" required>
            <select
              className="input"
              value={gstRate}
              onChange={(e) => setGstRate(Number(e.target.value))}
            >
              {GST_RATES.map((r) => (
                <option key={r} value={r}>
                  {r}%
                </option>
              ))}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={isService}
                onChange={(e) => setIsService(e.target.checked)}
              />
              This is a service (uses an SAC code rather than HSN)
            </label>
          </div>
        </div>
      </SectionCard>

      <FormActions
        saving={saving}
        saveLabel={product ? 'Save changes' : 'Add item'}
        onCancel={() => router.push('/products')}
      />
    </form>
  );
}
