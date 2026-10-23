import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getActiveCompany } from '@/lib/company-context';
import { storeFile, storageBackend } from '@/lib/storage';

const ALLOWED = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
]);

const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Stores a file and records its metadata.
 *
 * The bytes go to Supabase Storage when it is configured, otherwise to
 * public/uploads. Either way only a path is written to the database — a file's
 * contents never sit inside a row.
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file');
  const kind = String(form.get('kind') ?? 'attachment').replace(/[^a-z]/gi, '') || 'attachment';
  const invoiceId = form.get('invoiceId');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: 'Allowed types: PNG, JPG, WEBP, GIF, SVG, PDF, XLSX, CSV' },
      { status: 415 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File must be 10 MB or smaller' }, { status: 413 });
  }

  try {
    const company = await getActiveCompany();
    const stored = await storeFile(file, kind, company?.id ?? null);

    const upload = await prisma.upload.create({
      data: {
        companyId: company?.id ?? null,
        invoiceId: typeof invoiceId === 'string' && invoiceId ? invoiceId : null,
        kind,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        storagePath: stored.storagePath,
        backend: stored.backend,
      },
    });

    return NextResponse.json({
      id: upload.id,
      // `path` is what callers persist, so it must stay valid forever: the
      // bucket path, not the signed URL, which expires within the hour.
      path: stored.storagePath,
      // `url` is good for displaying the file right now.
      url: stored.url,
      storagePath: stored.storagePath,
      backend: stored.backend,
      fileName: upload.fileName,
      sizeBytes: upload.sizeBytes,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    console.error('[upload]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Lists previously uploaded files for the active company. */
export async function GET(req: Request) {
  const company = await getActiveCompany();
  if (!company) return NextResponse.json({ files: [], backend: storageBackend() });

  const invoiceId = new URL(req.url).searchParams.get('invoiceId');
  const files = await prisma.upload.findMany({
    where: { companyId: company.id, ...(invoiceId ? { invoiceId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return NextResponse.json({ backend: storageBackend(), files });
}
