import { prisma } from '@/lib/db';
import { companySchema } from '@/lib/schemas';
import { handleError, ok } from '@/lib/api';

export async function GET() {
  try {
    const companies = await prisma.company.findMany({
      where: { isActive: true },
      orderBy: { legalName: 'asc' },
    });
    return ok(companies);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const data = companySchema.parse(await req.json());
    const company = await prisma.company.create({ data });
    return ok(company, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
