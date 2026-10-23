import { NextResponse } from 'next/server';
import { signedUrl } from '@/lib/storage';
import { isSafeStoragePath } from '@/lib/file-url';

/**
 * Resolves a stored bucket path to a fresh signed URL and redirects to it.
 *
 * Logos and signatures are kept in a private bucket, so they cannot be linked
 * directly. Storing a signed URL on the company row would break as soon as the
 * signature expired; this route hands one out on demand instead.
 */
export async function GET(req: Request) {
  const path = new URL(req.url).searchParams.get('path') ?? '';

  if (!isSafeStoragePath(path)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const url = await signedUrl(path, 60 * 60);
  if (url === path) {
    // No Supabase credentials configured, so nothing could be signed.
    return NextResponse.json({ error: 'File not available' }, { status: 404 });
  }

  // Short cache: the signature outlives it comfortably, and the browser stops
  // re-requesting the logo on every page render.
  return NextResponse.redirect(url, {
    status: 307,
    headers: { 'Cache-Control': 'private, max-age=600' },
  });
}
