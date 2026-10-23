import { prisma } from '@/lib/db';
import { handleError, ok } from '@/lib/api';
import { requireActiveCompany } from '@/lib/company-context';
import { deriveInitials, financialYear, peekNextNumber } from '@/lib/numbering';
import { isDocType } from '@/lib/constants';
import { parseDateInput } from '@/lib/invoice-service';

export async function GET(req: Request) {
  try {
    const company = await requireActiveCompany();
    const sp = new URL(req.url).searchParams;
    const docType = sp.get('docType');
    if (!isDocType(docType)) return ok({ number: null });

    const date = sp.get('date') ? parseDateInput(sp.get('date')!) : new Date();
    const fy = financialYear(date);

    // The number embeds the buyer's initials, so the preview needs the customer.
    const customerId = sp.get('customerId');
    let buyerInitials = '';
    let buyerName = '';
    let buyerKey = '';
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, companyId: company.id },
        select: { initials: true, name: true },
      });
      if (customer) {
        buyerInitials = (customer.initials ?? '').trim() || deriveInitials(customer.name);
        buyerName = customer.name;
        buyerKey = customerId;
      }
    }

    return ok({
      fy,
      number: await peekNextNumber(
        prisma,
        company.id,
        docType,
        fy,
        company,
        date,
        buyerInitials,
        buyerName,
        buyerKey,
      ),
    });
  } catch (e) {
    return handleError(e);
  }
}
