import { prisma } from '@/lib/db';
import { companySchema } from '@/lib/schemas';
import { fail, handleError, ok } from '@/lib/api';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) return fail('Company not found', 404);
    return ok(company);
  } catch (e) {
    return handleError(e);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const data = companySchema.parse(await req.json());
    const company = await prisma.company.update({ where: { id }, data });
    return ok(company);
  } catch (e) {
    return handleError(e);
  }
}

/** Soft delete: invoices must keep pointing at a company for ever. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await prisma.company.update({ where: { id }, data: { isActive: false } });
    return ok({ archived: true });
  } catch (e) {
    return handleError(e);
  }
}
