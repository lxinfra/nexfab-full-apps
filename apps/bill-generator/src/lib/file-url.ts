/**
 * Turns a stored file reference into something an <img> can load.
 *
 * What gets stored on a company or an upload row is a *durable* reference:
 *   - `/uploads/logo-....jpg`      a local file, already served by Next
 *   - `companyId/logo-....jpg`     an object inside the private Supabase bucket
 *
 * The bucket is private, so its objects need a signed URL, and signed URLs
 * expire. Storing one would mean the logo silently disappeared an hour later,
 * so the path is stored instead and `/api/files` mints a fresh signature on
 * every request.
 */
export function fileUrl(stored?: string | null): string | null {
  if (!stored) return null;
  // Already loadable as-is.
  if (/^https?:\/\//i.test(stored)) return stored;
  const base = process.env.NEXT_PUBLIC_BASE_PATH || "";
  if (stored.startsWith('/uploads/')) return `${base}${stored}`;
  return `${base}/api/files?path=${encodeURIComponent(stored)}`;
}

/** Rejects anything that tries to climb out of the bucket prefix. */
export function isSafeStoragePath(p: string): boolean {
  if (!p || p.length > 400) return false;
  if (p.startsWith('/') || p.includes('\\')) return false;
  return !p.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
}
