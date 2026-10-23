import { prisma } from '@/lib/db';
import { invoiceSchema } from '@/lib/schemas';
import { handleError, ok } from '@/lib/api';
import { requireActiveCompany } from '@/lib/company-context';
import { createInvoice } from '@/lib/invoice-service';

export async function GET(req: Request) {
  try {
    const company = await requireActiveCompany();
    const sp = new URL(req.url).searchParams;
    const invoices = await prisma.invoice.findMany({
      where: {
        companyId: company.id,
        ...(sp.get('status') ? { status: sp.get('status')! } : {}),
        ...(sp.get('customerId') ? { customerId: sp.get('customerId')! } : {}),
      },
      orderBy: { invoiceDate: 'desc' },
      include: { customer: { select: { name: true } } },
      take: 200,
    });
    return ok(invoices);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: Request) {
  try {
    const company = await requireActiveCompany();
    const input = invoiceSchema.parse(await req.json());
    return ok(await createInvoice(company.id, input), { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
