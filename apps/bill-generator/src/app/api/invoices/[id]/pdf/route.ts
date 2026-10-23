import { prisma } from '@/lib/db';
import { fail, handleError } from '@/lib/api';
import { buildInvoicePdf, pdfFileName } from '@/pdf/build';
import { COPY_TYPES, type CopyType } from '@/lib/constants';

/** GET /api/invoices/:id/pdf?copy=original|duplicate|triplicate|none&download=1 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sp = new URL(req.url).searchParams;
    const requested = (sp.get('copy') ?? 'original').toUpperCase();
    const copy: CopyType = (COPY_TYPES as readonly string[]).includes(requested)
      ? (requested as CopyType)
      : 'ORIGINAL';

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!invoice) return fail('Invoice not found', 404);

    const pdf = await buildInvoicePdf(invoice, copy);
    const disposition = sp.get('download') === '1' ? 'attachment' : 'inline';

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.length),
        'Content-Disposition': `${disposition}; filename="${pdfFileName(invoice, copy)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
