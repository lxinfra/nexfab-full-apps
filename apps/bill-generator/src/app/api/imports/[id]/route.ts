import { prisma } from '@/lib/db';
import { fail, handleError, ok } from '@/lib/api';
import { batchPreview, getBatch, parseIssues } from '@/lib/monthly-import-service';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const batch = await getBatch(id);
    if (!batch) return fail('Import not found', 404);
    return ok({
      batch,
      issues: parseIssues(batch.issues),
      preview: await batchPreview(id),
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * Discards an import.
 *
 * Only a batch that has generated nothing can be deleted outright. Once
 * invoices exist they are real accounting documents, so the batch is marked
 * cancelled instead and the invoices are left alone — deleting them here would
 * punch holes in the number series.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const batch = await getBatch(id);
    if (!batch) return fail('Import not found', 404);

    const generated = await prisma.invoice.count({ where: { importBatchId: id } });
    if (generated > 0) {
      await prisma.importBatch.update({ where: { id }, data: { status: 'CANCELLED' } });
      return ok({
        deleted: false,
        cancelled: true,
        generated,
        message:
          `${generated} invoice(s) were already generated from this import, so they have ` +
          'been kept. The import is marked cancelled.',
      });
    }

    await prisma.importBatch.delete({ where: { id } });
    return ok({ deleted: true, cancelled: false, generated: 0 });
  } catch (e) {
    return handleError(e);
  }
}
