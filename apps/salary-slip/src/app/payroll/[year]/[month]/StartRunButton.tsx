"use client";

import { useState, useTransition } from "react";
import { startRun } from "@/app/actions/payroll";

export function StartRunButton({ year, month, label }: { year: number; month: number; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startRun(year, month);
            if (result?.message) setError(result.message);
          })
        }
      >
        {pending ? "Starting..." : `Start payroll for ${label}`}
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
