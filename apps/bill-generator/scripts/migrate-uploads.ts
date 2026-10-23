/**
 * Moves locally-stored logos and signatures into Supabase Storage.
 *
 * Files written under `public/uploads` before Storage was connected are not
 * deployable: the folder is git-ignored, and a serverless host has no writable
 * filesystem anyway. This uploads each one that a company still references,
 * rewrites the company row to point at the bucket path, and records an Upload
 * row for it.
 *
 * Safe to re-run: paths that are already bucket paths are left alone.
 *
 *   npm run migrate:uploads
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { storeFile } from '../src/lib/storage';
import { storageBackend } from '../src/lib/storage';

const prisma = new PrismaClient();

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

async function migrateOne(
  localPath: string,
  kind: 'logo' | 'signature',
  companyId: string,
): Promise<string | null> {
  const abs = path.join(process.cwd(), 'public', localPath.replace(/^\//, ''));
  try {
    await stat(abs);
  } catch {
    console.log(`    missing on disk, leaving the row alone: ${localPath}`);
    return null;
  }

  const bytes = await readFile(abs);
  const name = path.basename(abs);
  const type = MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
  const stored = await storeFile(new File([bytes], name, { type }), kind, companyId);

  await prisma.upload.create({
    data: {
      companyId,
      kind,
      fileName: name,
      contentType: type,
      sizeBytes: bytes.length,
      storagePath: stored.storagePath,
      backend: stored.backend,
    },
  });

  console.log(`    ${localPath}  ->  ${stored.storagePath}  (${bytes.length} bytes)`);
  return stored.storagePath;
}

async function main() {
  if (storageBackend() !== 'supabase') {
    console.error(
      'Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY in .env first.',
    );
    process.exit(1);
  }

  const companies = await prisma.company.findMany();
  let moved = 0;

  for (const c of companies) {
    const updates: { logoPath?: string; signaturePath?: string } = {};
    const pending: [string, 'logo' | 'signature'][] = [];
    if (c.logoPath?.startsWith('/uploads/')) pending.push([c.logoPath, 'logo']);
    if (c.signaturePath?.startsWith('/uploads/')) pending.push([c.signaturePath, 'signature']);

    if (pending.length === 0) continue;
    console.log(`  ${c.legalName}`);

    for (const [p, kind] of pending) {
      const bucketPath = await migrateOne(p, kind, c.id);
      if (!bucketPath) continue;
      if (kind === 'logo') updates.logoPath = bucketPath;
      else updates.signaturePath = bucketPath;
      moved++;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.company.update({ where: { id: c.id }, data: updates });
    }
  }

  console.log(moved === 0 ? '\nNothing to migrate.' : `\nMoved ${moved} file(s) into Storage.`);
  console.log('The originals under public/uploads were left in place; delete them when happy.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
