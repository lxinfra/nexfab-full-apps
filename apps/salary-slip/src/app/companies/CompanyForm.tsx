"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { saveCompany } from "@/app/actions/companies";
import { Field } from "@/components/Field";
import type { ActionResult } from "@/lib/validation";

export interface CompanyFormValues {
  id?: number;
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  gstin: string;
  pan: string;
  tan: string;
  signatoryName: string;
  signatoryDesignation: string;
  logoUrl?: string | null;
}

export function CompanyForm({ initial }: { initial: CompanyFormValues }) {
  const [state, setState] = useState<ActionResult>({});
  const [pending, startTransition] = useTransition();
  const e = state.errors ?? {};

  // Submitted by hand (not as a form action) so the typed values stay in place
  // when the server sends back validation errors.
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveCompany({}, data);
      // On success the action redirects and never returns.
      if (result) setState(result);
    });
  };

  return (
    <form onSubmit={submit} className="card max-w-3xl space-y-4" noValidate>
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      {state.message && <p className="alert-error">{state.message}</p>}

      <Field label="Company name" name="name" defaultValue={initial.name} error={e.name} required />
      <label className="block">
        <span className="label">
          Address<span className="text-red-600"> *</span>
        </span>
        <textarea
          name="address"
          rows={2}
          defaultValue={initial.address}
          className={`input ${e.address ? "input-error" : ""}`}
        />
        {e.address && <span className="error-text block">{e.address}</span>}
      </label>

      <div className="grid grid-cols-3 gap-4">
        <Field label="Phone" name="phone" defaultValue={initial.phone} error={e.phone} />
        <Field label="Email" name="email" type="email" defaultValue={initial.email} error={e.email} />
        <Field label="Website" name="website" defaultValue={initial.website} error={e.website} placeholder="https://" />
        <Field label="GSTIN" name="gstin" defaultValue={initial.gstin} error={e.gstin} />
        <Field label="PAN" name="pan" defaultValue={initial.pan} error={e.pan} />
        <Field label="TAN" name="tan" defaultValue={initial.tan} error={e.tan} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Authorised signatory name"
          name="signatoryName"
          defaultValue={initial.signatoryName}
          error={e.signatoryName}
          hint="Optional. Adds a signatory line to the salary slip."
        />
        <Field
          label="Signatory designation"
          name="signatoryDesignation"
          defaultValue={initial.signatoryDesignation}
          error={e.signatoryDesignation}
        />
      </div>

      <div>
        <span className="label">Logo</span>
        <div className="flex items-center gap-4">
          {initial.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={initial.logoUrl} alt="Current logo" className="h-14 w-14 rounded border border-slate-200 object-contain" />
          )}
          <div>
            <input type="file" name="logo" accept="image/png,image/jpeg" className="text-sm" />
            <p className="mt-1 text-xs text-slate-500">PNG or JPEG, up to 500 KB. Shown on the salary slip.</p>
            {initial.logoUrl && (
              <label className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                <input type="checkbox" name="removeLogo" /> Remove the current logo
              </label>
            )}
            {e.logo && <p className="error-text">{e.logo}</p>}
          </div>
        </div>
      </div>

      <div className="flex gap-2 border-t border-slate-100 pt-4">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving..." : "Save company"}
        </button>
        <Link href="/companies" className="btn">
          Cancel
        </Link>
      </div>
    </form>
  );
}
