import { z } from 'zod';
import { handleError, ok } from '@/lib/api';
import { setStatus } from '@/lib/invoice-service';
import { STATUSES } from '@/lib/constants';

const schema = z.object({
  status: z.enum(STATUSES),
  cancelReason: z.string().trim().nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { status, cancelReason } = schema.parse(await req.json());
    return ok(await setStatus(id, status, cancelReason ?? null));
  } catch (e) {
    return handleError(e);
  }
}
