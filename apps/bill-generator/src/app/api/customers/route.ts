import { prisma } from '@/lib/db';
import { customerSchema } from '@/lib/schemas';
import { handleError, ok } from '@/lib/api';
import { requireActiveCompany } from '@/lib/company-context';

export async function GET(req: Request) {
  try {
    const company = await requireActiveCompany();
    const q = new URL(req.url).searchParams.get('q')?.trim();
    const customers = await prisma.customer.findMany({
      where: {
        companyId: company.id,
        isActive: true,
        ...(q ? { OR: [{ name: { contains: q } }, { gstin: { contains: q } }, { phone: { contains: q } }] } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return ok(customers);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const company = await requireActiveCompany();
    const data = customerSchema.parse(await req.json());
    const customer = await prisma.customer.create({ data: { ...data, companyId: company.id } });
    return ok(customer, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
