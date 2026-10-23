import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { downloadFile } from '@/lib/storage';

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Reads a stored image into a data URL for @react-pdf/renderer.
 *
 * react-pdf cannot fetch a private URL itself, so the bytes have to be inlined.
 * Three kinds of reference can arrive here:
 *   - `/uploads/...`   a local file under public/
 *   - `https://...`    an absolute URL (an older row, or an external logo)
 *   - `companyId/...`  an object in the private Supabase bucket
 *
 * SVG is skipped throughout: react-pdf cannot embed it as an <Image>.
 */
export async function imageDataUrl(stored?: string | null): Promise<string | null> {
  if (!stored) return null;
  const ext = path.extname(stored.split('?')[0]).toLowerCase();
  const mime = MIME[ext];
  if (!mime) return null;

  try {
    const bytes = await loadBytes(stored);
    if (!bytes) return null;
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    // A missing logo must never stop a bill from being generated.
    return null;
  }
}

async function loadBytes(stored: string): Promise<Buffer | null> {
  if (stored.startsWith('/uploads/')) {
    const file = path.join(process.cwd(), 'public', stored.replace(/^\//, ''));
    return readFile(file);
  }

  if (/^https?:\/\//i.test(stored)) {
    const res = await fetch(stored);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  }

  return downloadFile(stored);
}

export const FONT_DIR = path.join(process.cwd(), 'public', 'fonts');
