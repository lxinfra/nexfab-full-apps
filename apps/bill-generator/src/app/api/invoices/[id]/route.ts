import { invoiceSchema } from '@/lib/schemas';
import { fail, handleError, ok } from '@/lib/api';
import { deleteDraft, getInvoice, updateInvoice } from '@/lib/invoice-service';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const invoice = await getInvoice(id);
    if (!invoice) return fail('Invoice not found', 404);
    return ok(invoice);
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const input = invoiceSchema.parse(await req.json());
    return ok(await updateInvoice(id, input));
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok(await deleteDraft(id));
  } catch (e) {
    return handleError(e);
  }
}
