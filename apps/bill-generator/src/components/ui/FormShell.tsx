'use client';

import type { ReactNode } from 'react';

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {error}
    </div>
  );
}

export function FormActions({
  saving,
  saveLabel = 'Save',
  onCancel,
  extra,
}: {
  saving: boolean;
  saveLabel?: string;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-4">
      <button type="submit" className="btn-primary" disabled={saving}>
        {saving ? 'Saving…' : saveLabel}
      </button>
      <button type="button" className="btn-secondary" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      {extra}
    </div>
  );
}
