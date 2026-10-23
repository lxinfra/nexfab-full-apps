import { handleError, ok } from '@/lib/api';
import { paymentSchema } from '@/lib/schemas';
import { addPayment, parseDateInput } from '@/lib/invoice-service';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const p = paymentSchema.parse(await req.json());
    return ok(
      await addPayment(id, {
        paidOn: parseDateInput(p.paidOn),
        amountPaise: p.amountPaise,
        method: p.method,
        reference: p.reference,
        notes: p.notes,
      }),
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}
