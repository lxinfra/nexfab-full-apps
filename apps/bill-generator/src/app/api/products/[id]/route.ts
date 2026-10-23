import { prisma } from '@/lib/db';
import { productSchema } from '@/lib/schemas';
import { fail, handleError, ok } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) return fail('Product not found', 404);
    return ok(product);
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const data = productSchema.parse(await req.json());
    return ok(await prisma.product.update({ where: { id }, data }));
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await prisma.product.update({ where: { id }, data: { isActive: false } });
    return ok({ archived: true });
  } catch (e) {
    return handleError(e);
  }
}
