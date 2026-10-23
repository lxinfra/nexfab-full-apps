import { fail, handleError, ok } from '@/lib/api';
import { generateBatch, getBatch } from '@/lib/monthly-import-service';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Generates the next chunk of invoices for a batch.
 *
 * The client calls this repeatedly until `done` is true. Chunking is what keeps
 * a thousand-bill import inside a request timeout and lets the UI show real
 * progress; it is also resumable, because each chunk only looks for rows that
 * have not been turned into an invoice yet.
 */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const batch = await getBatch(id);
    if (!batch) return fail('Import not found', 404);
    if (batch.status === 'CANCELLED') return fail('That import was cancelled', 409);

    let limit = 25;
    try {
      const body = (await req.json()) as { limit?: unknown };
      const n = Number(body?.limit);
      if (Number.isInteger(n) && n > 0) limit = Math.min(n, 100);
    } catch {
      // No body is fine; the default chunk applies.
    }

    return ok(await generateBatch(id, limit));
  } catch (e) {
    return handleError(e);
  }
}
