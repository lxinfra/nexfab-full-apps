/**
 * Supabase client factory.
 *
 * Credentials come from the environment only — nothing is hard-coded, and the
 * service-role key is read on the server exclusively (it is never prefixed with
 * NEXT_PUBLIC_, so Next.js will not ship it to the browser).
 *
 * One client is created per process and reused.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** The storage bucket created by supabase/migrations/0002_storage_and_rls.sql. */
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? 'bill-files';

/** True once a URL and at least one key are configured. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && (SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY));
}

const globalForSupabase = globalThis as unknown as { supabase?: SupabaseClient };

/**
 * Server-side client. Prefers the service-role key so it can write through the
 * RLS policies in Option A; falls back to the anon key if only that is set.
 * Returns null when Supabase is not configured, so callers can degrade to the
 * local filesystem rather than crash.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (globalForSupabase.supabase) return globalForSupabase.supabase;

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (process.env.NODE_ENV !== 'production') globalForSupabase.supabase = client;
  return client;
}
