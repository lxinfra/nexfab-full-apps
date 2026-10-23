'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Finishes an import that stopped part-way.
 *
 * Generation is chunked and resumable: each call only looks at rows that have
 * no invoice yet, so pressing this cannot produce a second copy of a bill that
 * was already generated.
 */
export default function GenerateRemaining({
  batchId,
  pending,
}: {
  batchId: string;
  pending: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      let safety = 0;
      while (safety++ < 1000) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/imports/${batchId}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 20 }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Generation failed');
        setDone(json.generatedTotal);
        if (json.done) break;
        if (json.generatedNow === 0 && (json.failed ?? []).length === 0) break;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={run}>
        {busy ? `Generating… ${done}` : `Generate the remaining ${pending}`}
      </button>
      {error && <p className="err mt-2">{error}</p>}
    </div>
  );
}
