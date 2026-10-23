import { handleError, ok } from '@/lib/api';
import { duplicateInvoice } from '@/lib/invoice-service';

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await duplicateInvoice(id), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
