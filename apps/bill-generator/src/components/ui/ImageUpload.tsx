'use client';

import { useRef, useState } from 'react';
import { fileUrl } from '@/lib/file-url';

export default function ImageUpload({
  value,
  onChange,
  kind,
  label,
  hint,
}: {
  value: string | null;
  onChange: (path: string | null) => void;
  kind: 'logo' | 'signature';
  label: string;
  hint?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', kind);
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/upload`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');
      onChange(json.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-3">
        <div className="grid h-16 w-24 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-50">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileUrl(value) ?? ''}
              alt={label}
              className="max-h-16 max-w-24 object-contain"
            />
          ) : (
            <span className="text-xs text-slate-400">None</span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn-secondary btn-sm"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}
          </button>
          {value && (
            <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(null)}>
              Remove
            </button>
          )}
        </div>
      </div>
      {error ? <p className="err">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}
