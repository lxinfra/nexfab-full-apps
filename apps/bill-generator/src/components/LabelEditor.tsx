'use client';

import { useState } from 'react';
import { DEFAULT_LABELS, LABEL_GROUPS, type LabelKey } from '@/lib/labels';

/**
 * Lets every fixed word on the printed bill be reworded. Blank means "use the
 * default", so the form shows the default as the placeholder rather than
 * pre-filling it — that keeps the stored override map small.
 */
export default function LabelEditor({
  values,
  onChange,
}: {
  values: Partial<Record<LabelKey, string>>;
  onChange: (next: Partial<Record<LabelKey, string>>) => void;
}) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  const changed = (Object.keys(values) as LabelKey[]).filter(
    (k) => (values[k] ?? '').trim() && values[k] !== DEFAULT_LABELS[k],
  ).length;

  function set(key: LabelKey, v: string) {
    onChange({ ...values, [key]: v });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="hint m-0">
          {changed === 0
            ? 'All wording is at its default.'
            : `${changed} label${changed === 1 ? '' : 's'} reworded.`}
        </p>
        {changed > 0 && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => onChange({})}
          >
            Reset all to default
          </button>
        )}
      </div>

      {LABEL_GROUPS.map((group) => {
        const open = openGroup === group.title;
        const groupChanged = group.keys.filter(
          (k) => (values[k] ?? '').trim() && values[k] !== DEFAULT_LABELS[k],
        ).length;
        return (
          <div key={group.title} className="rounded-lg border border-slate-200">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50"
              onClick={() => setOpenGroup(open ? null : group.title)}
            >
              <span>
                {group.title}
                {groupChanged > 0 && (
                  <span className="ml-2 badge bg-brand-50 text-brand-700 ring-brand-200">
                    {groupChanged}
                  </span>
                )}
              </span>
              <span className="text-slate-400">{open ? '−' : '+'}</span>
            </button>
            {open && (
              <div className="grid gap-3 border-t border-slate-200 p-3 sm:grid-cols-2">
                {group.keys.map((key) => (
                  <label key={key} className="block">
                    <span className="label">{DEFAULT_LABELS[key]}</span>
                    <input
                      className="input-sm"
                      value={values[key] ?? ''}
                      placeholder={DEFAULT_LABELS[key]}
                      onChange={(e) => set(key, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
