import { prisma } from '@/lib/db';
import { productSchema } from '@/lib/schemas';
import { handleError, ok } from '@/lib/api';
import { requireActiveCompany } from '@/lib/company-context';

export async function GET(req: Request) {
  try {
    const company = await requireActiveCompany();
    const q = new URL(req.url).searchParams.get('q')?.trim();
    const products = await prisma.product.findMany({
      where: {
        companyId: company.id,
        isActive: true,
        ...(q ? { OR: [{ name: { contains: q } }, { hsnSac: { contains: q } }] } : {}),
      },
      orderBy: { name: 'asc' },
    });
    return ok(products);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const company = await requireActiveCompany();
    const data = productSchema.parse(await req.json());
    return ok(await prisma.product.create({ data: { ...data, companyId: company.id } }), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
