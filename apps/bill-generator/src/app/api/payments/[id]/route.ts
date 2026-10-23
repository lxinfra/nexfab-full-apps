import { handleError, ok } from '@/lib/api';
import { deletePayment } from '@/lib/invoice-service';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return ok(await deletePayment(id));
  } catch (e) {
    return handleError(e);
  }
}
