/**
 * File storage.
 *
 * When Supabase is configured the bytes go to a Storage bucket and only a path
 * is kept in the database — large files never sit in a table row. Without
 * Supabase credentials it falls back to writing under public/uploads, which is
 * how the app has always worked, so nothing breaks before you connect a project.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getSupabaseAdmin, isSupabaseConfigured, STORAGE_BUCKET } from './supabase';

export type StoredFile = {
  /** What the application stores and renders. */
  url: string;
  /** Path inside the bucket, or the public path when stored locally. */
  storagePath: string;
  backend: 'supabase' | 'local';
};

/** A collision-proof object name that keeps the original extension. */
function objectName(kind: string, originalName: string, companyId?: string | null): string {
  const ext = path.extname(originalName).toLowerCase() || '';
  const safeKind = kind.replace(/[^a-z]/gi, '') || 'file';
  const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  // The first segment is the company id so Storage policies can scope by it.
  const prefix = companyId ? `${companyId}/` : 'shared/';
  return `${prefix}${safeKind}-${stamp}${ext}`;
}

export async function storeFile(
  file: File,
  kind: string,
  companyId?: string | null,
): Promise<StoredFile> {
  const bytes = Buffer.from(await file.arrayBuffer());
  const supabase = getSupabaseAdmin();

  if (supabase) {
    const storagePath = objectName(kind, file.name, companyId);
    const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

    return { url: await signedUrl(storagePath), storagePath, backend: 'supabase' };
  }

  // --- local fallback -------------------------------------------------------
  // Serverless hosts have a read-only filesystem, so this path cannot work
  // there. Say why rather than letting an EROFS escape.
  if (process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error(
      'File uploads need Supabase Storage when deployed. Set NEXT_PUBLIC_SUPABASE_URL ' +
        'and SUPABASE_SERVICE_ROLE_KEY in the site environment variables.',
    );
  }
  const dir = path.join(process.cwd(), 'public', 'uploads');
  await mkdir(dir, { recursive: true });
  const ext = path.extname(file.name).toLowerCase() || '';
  const safeKind = kind.replace(/[^a-z]/gi, '') || 'file';
  const name = `${safeKind}-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`;
  await writeFile(path.join(dir, name), bytes);
  const publicPath = `/uploads/${name}`;
  return { url: publicPath, storagePath: publicPath, backend: 'local' };
}

/**
 * A time-limited URL for a private object. Local files are already reachable
 * under /uploads, so their path is returned unchanged.
 */
export async function signedUrl(storagePath: string, expiresInSeconds = 60 * 60): Promise<string> {
  if (!storagePath.startsWith('/uploads/')) {
    const supabase = getSupabaseAdmin();
    if (supabase) {
      const { data, error } = await supabase.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(storagePath, expiresInSeconds);
      if (!error && data?.signedUrl) return data.signedUrl;
    }
  }
  return storagePath;
}

export async function deleteFile(storagePath: string): Promise<void> {
  if (storagePath.startsWith('/uploads/')) return; // leave local files in place
  const supabase = getSupabaseAdmin();
  if (supabase) await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
}

/**
 * Pulls an object's bytes out of the bucket. The invoice PDF has to inline
 * images, and @react-pdf/renderer cannot authenticate against a private URL.
 */
export async function downloadFile(storagePath: string): Promise<Buffer | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export function storageBackend(): 'supabase' | 'local' {
  return isSupabaseConfigured() ? 'supabase' : 'local';
}
