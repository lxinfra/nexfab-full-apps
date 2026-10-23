'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { Company } from '@prisma/client';
import { Field, SectionCard } from '@/components/ui/Field';
import StateSelect from '@/components/ui/StateSelect';
import ImageUpload from '@/components/ui/ImageUpload';
import { FormActions, FormError } from '@/components/ui/FormShell';
import LabelEditor from '@/components/LabelEditor';
import { resolveLabels, serialiseLabels, DEFAULT_LABELS, type LabelKey } from '@/lib/labels';
import { validateGstin, gstinMatchesState } from '@/lib/validate';
import { DOC_SERIES } from '@/lib/constants';
import {
  renderInvoiceNumber,
  currentFinancialYear,
  deriveInitials,
  formatHasYear,
  NUMBER_TOKENS,
} from '@/lib/numbering';

type State = {
  legalName: string;
  tradeName: string;
  initials: string;
  tagline: string;
  logoPath: string | null;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateCode: string;
  pincode: string;
  country: string;
  gstin: string;
  pan: string;
  cin: string;
  phone: string;
  email: string;
  website: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNo: string;
  bankIfsc: string;
  bankBranch: string;
  bankAccountType: string;
  upiId: string;
  invoicePrefix: string;
  numberFormat: string;
  invoiceSubtitle: string;
  includeFyInNo: boolean;
  numberPadding: number;
  numberStart: number;
  defaultTerms: string;
  signaturePath: string | null;
  labelOverrides: Partial<Record<LabelKey, string>>;
};

/** Only the entries that differ, so the editor shows blanks for defaults. */
function diffFromDefaults(stored?: string | null): Partial<Record<LabelKey, string>> {
  const resolved = resolveLabels(stored);
  const out: Partial<Record<LabelKey, string>> = {};
  for (const key of Object.keys(DEFAULT_LABELS) as LabelKey[]) {
    if (resolved[key] !== DEFAULT_LABELS[key]) out[key] = resolved[key];
  }
  return out;
}

function initial(c?: Company | null): State {
  return {
    legalName: c?.legalName ?? '',
    tradeName: c?.tradeName ?? '',
    initials: c?.initials ?? '',
    tagline: c?.tagline ?? '',
    logoPath: c?.logoPath ?? null,
    addressLine1: c?.addressLine1 ?? '',
    addressLine2: c?.addressLine2 ?? '',
    city: c?.city ?? '',
    stateCode: c?.stateCode ?? '',
    pincode: c?.pincode ?? '',
    country: c?.country ?? 'India',
    gstin: c?.gstin ?? '',
    pan: c?.pan ?? '',
    cin: c?.cin ?? '',
    phone: c?.phone ?? '',
    email: c?.email ?? '',
    website: c?.website ?? '',
    bankName: c?.bankName ?? '',
    bankAccountName: c?.bankAccountName ?? '',
    bankAccountNo: c?.bankAccountNo ?? '',
    bankIfsc: c?.bankIfsc ?? '',
    bankBranch: c?.bankBranch ?? '',
    bankAccountType: c?.bankAccountType ?? '',
    upiId: c?.upiId ?? '',
    invoicePrefix: c?.invoicePrefix ?? 'INV/',
    numberFormat: c?.numberFormat ?? '{SELLER}/{MM}/{BUYER}/{SEQ}',
    invoiceSubtitle: c?.invoiceSubtitle ?? '',
    includeFyInNo: c?.includeFyInNo ?? true,
    numberPadding: c?.numberPadding ?? 4,
    numberStart: c?.numberStart ?? 1,
    defaultTerms: c?.defaultTerms ?? '',
    signaturePath: c?.signaturePath ?? null,
    labelOverrides: diffFromDefaults(c?.labels),
  };
}

export default function CompanyForm({ company }: { company?: Company | null }) {
  const router = useRouter();
  const [f, setF] = useState<State>(() => initial(company));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof State>(k: K, v: State[K]) => setF((p) => ({ ...p, [k]: v }));

  const gstinCheck = useMemo(() => validateGstin(f.gstin), [f.gstin]);
  const gstinStateMismatch = f.gstin.length === 15 && !gstinMatchesState(f.gstin, f.stateCode);
  const gstinError = f.gstin
    ? !gstinCheck.ok
      ? gstinCheck.error ?? null
      : gstinStateMismatch
        ? `GSTIN state code ${f.gstin.slice(0, 2)} does not match the selected state (${f.stateCode})`
        : null
    : null;

  const fy = currentFinancialYear();
  const sellerInitials = f.initials.trim() || deriveInitials(f.legalName);
  const preview = renderInvoiceNumber(
    {
      invoicePrefix: f.invoicePrefix,
      numberFormat: f.numberFormat,
      includeFyInNo: f.includeFyInNo,
      numberPadding: f.numberPadding,
      numberStart: f.numberStart,
      initials: sellerInitials,
      legalName: f.legalName,
    },
    {
      docType: 'TAX_INVOICE',
      fy,
      seq: f.numberStart,
      date: new Date(),
      sellerInitials,
      buyerInitials: 'ABC',
      buyerName: 'A Buyer Company',
      sellerName: f.legalName,
    },
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (gstinError) {
      setError(gstinError);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(company ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/companies/${company.id}` : `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/companies`, {
        method: company ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...f,
          numberPadding: Number(f.numberPadding),
          labels: serialiseLabels(f.labelOverrides),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save');
      if (!company) {
        document.cookie = `bg_company=${json.id}; path=/; max-age=31536000; samesite=lax`;
      }
      router.push('/companies');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 pb-4">
      <FormError error={error} />

      <SectionCard title="Identity" description="Shown in the header of every document.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal name" required className="sm:col-span-2">
            <input
              className="input"
              required
              value={f.legalName}
              onChange={(e) => set('legalName', e.target.value)}
              placeholder="Nexofab Industries Limited"
            />
          </Field>
          <Field label="Trade name" hint="Used in the company switcher and headings">
            <input
              className="input"
              value={f.tradeName}
              onChange={(e) => set('tradeName', e.target.value)}
            />
          </Field>
          <Field
            label="Initials"
            hint={`Used as {SELLER} in the bill number. Leave blank to derive "${
              deriveInitials(f.legalName) || '—'
            }".`}
          >
            <input
              className="input uppercase"
              maxLength={6}
              value={f.initials}
              onChange={(e) => set('initials', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder={deriveInitials(f.legalName)}
            />
          </Field>
          <Field label="Tagline" className="sm:col-span-2" hint="Printed under the company name">
            <input
              className="input"
              value={f.tagline}
              onChange={(e) => set('tagline', e.target.value)}
              placeholder="** A Name of Quality Work **"
            />
          </Field>
          <ImageUpload
            label="Logo"
            kind="logo"
            value={f.logoPath}
            onChange={(p) => set('logoPath', p)}
            hint="PNG with a transparent background looks best"
          />
        </div>
      </SectionCard>

      <SectionCard title="Registered address">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" required className="sm:col-span-2">
            <input
              className="input"
              required
              value={f.addressLine1}
              onChange={(e) => set('addressLine1', e.target.value)}
              placeholder="CH-73, MR 10 Road"
            />
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            <input
              className="input"
              value={f.addressLine2}
              onChange={(e) => set('addressLine2', e.target.value)}
              placeholder="Sukhliya"
            />
          </Field>
          <Field label="City" required>
            <input
              className="input"
              required
              value={f.city}
              onChange={(e) => set('city', e.target.value)}
            />
          </Field>
          <Field label="PIN code" required>
            <input
              className="input"
              required
              inputMode="numeric"
              maxLength={6}
              value={f.pincode}
              onChange={(e) => set('pincode', e.target.value.replace(/\D/g, ''))}
            />
          </Field>
          <Field label="State" required hint="Decides CGST+SGST vs IGST on every invoice">
            <StateSelect value={f.stateCode} onChange={(code) => set('stateCode', code)} required />
          </Field>
          <Field label="Country">
            <input
              className="input"
              value={f.country}
              onChange={(e) => set('country', e.target.value)}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Tax &amp; contact">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="GSTIN"
            error={gstinError}
            hint={
              gstinCheck.ok && f.gstin
                ? `Valid — ${gstinCheck.stateName}, PAN ${gstinCheck.pan}`
                : '15 characters, e.g. 23AABCN1234C1Z5'
            }
          >
            <input
              className="input uppercase"
              maxLength={15}
              value={f.gstin}
              onChange={(e) => set('gstin', e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
              placeholder="23AABCN1234C1Z5"
            />
          </Field>
          <Field label="PAN">
            <input
              className="input uppercase"
              maxLength={10}
              value={f.pan}
              onChange={(e) => set('pan', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="CIN" hint="Companies Act registration number, printed on the letterhead">
            <input
              className="input uppercase"
              maxLength={21}
              value={f.cin}
              onChange={(e) => set('cin', e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
              placeholder="U74999MP2018PLC046065"
            />
          </Field>
          <Field label="Phone">
            <input className="input" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email">
            <input
              className="input"
              type="email"
              value={f.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label="Website" className="sm:col-span-2">
            <input
              className="input"
              value={f.website}
              onChange={(e) => set('website', e.target.value)}
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Bank &amp; UPI"
        description="Printed at the foot of the invoice; the UPI ID becomes a QR code."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank name">
            <input
              className="input"
              value={f.bankName}
              onChange={(e) => set('bankName', e.target.value)}
            />
          </Field>
          <Field label="Account holder name">
            <input
              className="input"
              value={f.bankAccountName}
              onChange={(e) => set('bankAccountName', e.target.value)}
            />
          </Field>
          <Field label="Account number">
            <input
              className="input"
              value={f.bankAccountNo}
              onChange={(e) => set('bankAccountNo', e.target.value)}
            />
          </Field>
          <Field label="IFSC">
            <input
              className="input uppercase"
              maxLength={11}
              value={f.bankIfsc}
              onChange={(e) => set('bankIfsc', e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="Branch">
            <input
              className="input"
              value={f.bankBranch}
              onChange={(e) => set('bankBranch', e.target.value)}
            />
          </Field>
          <Field label="Account type" hint="Current / Savings">
            <input
              className="input"
              value={f.bankAccountType}
              onChange={(e) => set('bankAccountType', e.target.value)}
              placeholder="Current"
            />
          </Field>
          <Field label="UPI ID" hint="e.g. nexofab@okhdfcbank">
            <input className="input" value={f.upiId} onChange={(e) => set('upiId', e.target.value)} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard
        title="Invoice settings"
        description={`Current financial year: ${fy}.`}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bill number format" className="sm:col-span-2">
            <input
              className="input font-mono"
              value={f.numberFormat}
              onChange={(e) => set('numberFormat', e.target.value)}
              placeholder="{SELLER}/{MM}/{BUYER}/{SEQ}"
            />
          </Field>
          <div className="sm:col-span-2 -mt-2">
            <div className="flex flex-wrap gap-1.5">
              {NUMBER_TOKENS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="rounded border border-slate-300 bg-white px-1.5 py-0.5 font-mono text-xs text-slate-600 hover:bg-slate-50"
                  onClick={() => set('numberFormat', f.numberFormat + t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <p className="hint">
              Next tax invoice:{' '}
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs">{preview}</code>{' '}
              (buyer shown as ABC). Quotations, proformas and challans keep their own series (
              {Object.values(DOC_SERIES).filter(Boolean).join(', ')}).
            </p>
            {!formatHasYear(f.numberFormat) && (
              <p className="mt-1 text-xs text-amber-700">
                No year token, so the sequence runs continuously and never restarts — otherwise
                last year’s numbers would come round again.
              </p>
            )}
          </div>
          <Field label="Document subtitle" hint="Small line under the title, e.g. TAX / RETAIL">
            <input
              className="input"
              value={f.invoiceSubtitle}
              onChange={(e) => set('invoiceSubtitle', e.target.value)}
            />
          </Field>
          <Field label="Sequence digits" hint="0001 vs 001">
            <input
              className="input"
              type="number"
              min={1}
              max={8}
              value={f.numberPadding}
              onChange={(e) => set('numberPadding', Number(e.target.value))}
            />
          </Field>
          <Field
            label="Sequence starts at"
            hint="The first number a new series hands out — e.g. 1001"
          >
            <input
              className="input"
              type="number"
              min={1}
              value={f.numberStart}
              onChange={(e) => set('numberStart', Number(e.target.value))}
            />
          </Field>
          <Field label="Number prefix" hint="Only used by the {PREFIX} token">
            <input
              className="input"
              value={f.invoicePrefix}
              onChange={(e) => set('invoicePrefix', e.target.value)}
            />
          </Field>
          <Field label="Default terms &amp; conditions" className="sm:col-span-2">
            <textarea
              className="input min-h-28"
              value={f.defaultTerms}
              onChange={(e) => set('defaultTerms', e.target.value)}
              placeholder="One condition per line"
            />
          </Field>
          <ImageUpload
            label="Signature / stamp"
            kind="signature"
            value={f.signaturePath}
            onChange={(p) => set('signaturePath', p)}
            hint="Printed above “Authorised Signatory”"
          />
        </div>
      </SectionCard>

      <SectionCard
        title="Printed wording"
        description="Every fixed word on the bill. Leave a box blank to keep the default."
      >
        <LabelEditor
          values={f.labelOverrides}
          onChange={(next) => set('labelOverrides', next)}
        />
      </SectionCard>

      <FormActions
        saving={saving}
        saveLabel={company ? 'Save changes' : 'Create company'}
        onCancel={() => router.push('/companies')}
      />
    </form>
  );
}
