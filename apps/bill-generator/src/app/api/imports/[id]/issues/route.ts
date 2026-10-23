import { prisma } from '@/lib/db';
import { fail, handleError } from '@/lib/api';
import { getBatch, parseIssues } from '@/lib/monthly-import-service';
import { csvResponse, toCsv } from '@/lib/csv';

type Ctx = { params: Promise<{ id: string }> };

/** The validation report as CSV, so a long list of problems can be worked through. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const batch = await getBatch(id);
    if (!batch) return fail('Import not found', 404);

    const rows = await prisma.importRow.findMany({
      where: { batchId: id },
      orderBy: { rowNumber: 'asc' },
      select: {
        rowNumber: true,
        issues: true,
        customerName: true,
        itemName: true,
        externalBillNo: true,
      },
    });

    const out: (string | number | null)[][] = [
      ['Row', 'Severity', 'Field', 'Problem', 'Company', 'Product', 'Sheet bill no.'],
    ];
    for (const row of rows) {
      for (const issue of parseIssues(row.issues)) {
        out.push([
          row.rowNumber,
          issue.severity,
          issue.field,
          issue.message,
          row.customerName,
          row.itemName,
          row.externalBillNo,
        ]);
      }
    }

    const safe = batch.fileName.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
    return csvResponse(`import-issues-${safe}.csv`, toCsv(out));
  } catch (e) {
    return handleError(e);
  }
}
