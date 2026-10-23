'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { Customer } from '@prisma/client';
import { Field, SectionCard } from '@/components/ui/Field';
import StateSelect from '@/components/ui/StateSelect';
import { FormActions, FormError } from '@/components/ui/FormShell';
import { gstinMatchesState, validateGstin } from '@/lib/validate';
import { deriveInitials } from '@/lib/numbering';

type State = {
  name: string;
  initials: string;
  gstin: string;
  phone: string;
  email: string;
  billingLine1: string;
  billingLine2: string;
  billingCity: string;
  billingStateCode: string;
  billingPincode: string;
  shipSameAsBilling: boolean;
  shippingName: string;
  shippingLine1: string;
  shippingLine2: string;
  shippingCity: string;
  shippingStateCode: string;
  shippingPincode: string;
  notes: string;
};

function initial(c?: Customer | null): State {
  return {
    name: c?.name ?? '',
    initials: c?.initials ?? '',
    gstin: c?.gstin ?? '',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    billingLine1: c?.billingLine1 ?? '',
    billingLine2: c?.billingLine2 ?? '',
    billingCity: c?.billingCity ?? '',
    billingStateCode: c?.billingStateCode ?? '',
    billingPincode: c?.billingPincode ?? '',
    shipSameAsBilling: c?.shipSameAsBilling ?? true,
    shippingName: c?.shippingName ?? '',
    shippingLine1: c?.shippingLine1 ?? '',
    shippingLine2: c?.shippingLine2 ?? '',
    shippingCity: c?.shippingCity ?? '',
    shippingStateCode: c?.shippingStateCode ?? '',
    shippingPincode: c?.shippingPincode ?? '',
    notes: c?.notes ?? '',
  };
}

export default function CustomerForm({ customer }: { customer?: Customer | null }) {
  const router = useRouter();
  const [f, setF] = useState<State>(() => initial(customer));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof State>(k: K, v: State[K]) => setF((p) => ({ ...p, [k]: v }));

  const check = useMemo(() => validateGstin(f.gstin), [f.gstin]);
  const mismatch = f.gstin.length === 15 && !gstinMatchesState(f.gstin, f.billingStateCode);
  const gstinError = f.gstin
    ? !check.ok
      ? check.error ?? null
      : mismatch
        ? `GSTIN state code ${f.gstin.slice(0, 2)} does not match the billing state (${f.billingStateCode})`
        : null
    : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (gstinError) {
      setError(gstinError);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(customer ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/customers/${customer.id}` : `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/customers`, {
        method: customer ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(f),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save');
      router.push('/customers');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 pb-4">
      <FormError error={error} />

      <SectionCard title="Customer">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" required className="sm:col-span-2">
            <input
              className="input"
              required
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Shree Balaji Traders"
            />
          </Field>
          <Field
            label="Initials"
            hint={`Used as {BUYER} in the bill number. Blank derives "${
              deriveInitials(f.name) || '—'
            }".`}
          >
            <input
              className="input uppercase"
              maxLength={6}
              value={f.initials}
              onChange={(e) => set('initials', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder={deriveInitials(f.name)}
            />
          </Field>
          <Field
            label="GSTIN"
            error={gstinError}
            hint={
              f.gstin && check.ok
                ? `Valid — ${check.stateName}`
                : 'Optional. Leave blank for unregistered buyers.'
            }
          >
            <input
              className="input uppercase"
              maxLength={15}
              value={f.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
            />
          </Field>
          <Field label="Phone">
            <input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email" className="sm:col-span-2">
            <input
              className="input"
              type="email"
              value={f.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Billing address" description="The state here sets the default place of supply.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" required className="sm:col-span-2">
            <input
              className="input"
              required
              value={f.billingLine1}
              onChange={(e) => set('billingLine1', e.target.value)}
            />
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            <input
              className="input"
              value={f.billingLine2}
              onChange={(e) => set('billingLine2', e.target.value)}
            />
          </Field>
          <Field label="City" required>
            <input
              className="input"
              required
              value={f.billingCity}
              onChange={(e) => set('billingCity', e.target.value)}
            />
          </Field>
          <Field label="PIN code" required>
            <input
              className="input"
              required
              inputMode="numeric"
              maxLength={6}
              value={f.billingPincode}
              onChange={(e) => set('billingPincode', e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="State" required className="sm:col-span-2">
            <StateSelect
              value={f.billingStateCode}
              onChange={(code) => set('billingStateCode', code)}
              required
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Shipping address">
        <label className="mb-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={f.shipSameAsBilling}
            onChange={(e) => set('shipSameAsBilling', e.target.checked)}
          />
          Same as billing address
        </label>

        {!f.shipSameAsBilling && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Consignee name" className="sm:col-span-2">
              <input
                className="input"
                value={f.shippingName}
                onChange={(e) => set('shippingName', e.target.value)}
              />
            </Field>
            <Field label="Address line 1" required className="sm:col-span-2">
              <input
                className="input"
                required
                value={f.shippingLine1}
                onChange={(e) => set('shippingLine1', e.target.value)}
              />
            </Field>
            <Field label="Address line 2" className="sm:col-span-2">
              <input
                className="input"
                value={f.shippingLine2}
                onChange={(e) => set('shippingLine2', e.target.value)}
              />
            </Field>
            <Field label="City">
              <input
                className="input"
                value={f.shippingCity}
                onChange={(e) => set('shippingCity', e.target.value)}
              />
            </Field>
            <Field label="PIN code">
              <input
                className="input"
                inputMode="numeric"
                maxLength={6}
                value={f.shippingPincode}
                onChange={(e) => set('shippingPincode', e.target.value.replace(/\D/g, ''))}
              />
            </Field>
            <Field label="State" className="sm:col-span-2">
              <StateSelect
                value={f.shippingStateCode}
                onChange={(code) => set('shippingStateCode', code)}
              />
            </Field>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Notes">
        <textarea
          className="input min-h-24"
          value={f.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Payment terms, contact person, anything worth remembering"
        />
      </SectionCard>

      <FormActions
        saving={saving}
        saveLabel={customer ? 'Save changes' : 'Add customer'}
        onCancel={() => router.push('/customers')}
      />
    </form>
  );
}
