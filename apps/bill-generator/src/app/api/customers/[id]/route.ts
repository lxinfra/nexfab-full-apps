import { prisma } from '@/lib/db';
import { customerSchema } from '@/lib/schemas';
import { fail, handleError, ok } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return fail('Customer not found', 404);
    return ok(customer);
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const data = customerSchema.parse(await req.json());
    return ok(await prisma.customer.update({ where: { id }, data }));
  } catch (e) {
    return handleError(e);
  }
}

/** Archive rather than delete so historical invoices keep their link. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await prisma.customer.update({ where: { id }, data: { isActive: false } });
    return ok({ archived: true });
  } catch (e) {
    return handleError(e);
  }
}
