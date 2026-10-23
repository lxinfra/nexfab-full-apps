"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

/**
 * A button that asks for confirmation in a small dialog before running a
 * server action. Shows the action's error message if it returns one.
 */
export function ConfirmButton({
  action,
  title,
  body,
  confirmLabel = "Confirm",
  className = "btn btn-danger btn-sm",
  children,
  onDone,
}: {
  action: () => Promise<{ ok?: boolean; message?: string } | void>;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  className?: string;
  children: ReactNode;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const result = await action();
      if (result && !result.ok && result.message) {
        setError(result.message);
        return;
      }
      setOpen(false);
      onDone?.();
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {children}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-lg bg-white p-5 text-left shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <div className="mt-2 text-sm font-normal whitespace-normal text-slate-600 normal-case">{body}</div>
            {error && <p className="alert-error mt-3">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </button>
              {!error && (
                <button type="button" className="btn btn-primary" onClick={run} disabled={pending}>
                  {pending ? "Working..." : confirmLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
