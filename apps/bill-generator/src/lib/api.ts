import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function fail(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Turns thrown errors into a tidy JSON body instead of a 500 HTML page. */
export function handleError(e: unknown) {
  if (e instanceof ZodError) {
    const first = e.issues[0];
    const where = first?.path?.join('.') ?? '';
    return fail(
      `${where ? where + ': ' : ''}${first?.message ?? 'Invalid input'}`,
      422,
      { issues: e.issues },
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === 'NO_COMPANY') return fail('Select or create a company first', 400);
  if (msg.includes('Unique constraint')) {
    // The only unique columns a user can collide on are the invoice number pair.
    if (msg.includes('number')) {
      return fail('That invoice number is already used on another bill for this company', 409);
    }
    return fail('That record already exists', 409);
  }
  console.error('[api]', e);
  return fail(msg || 'Something went wrong', 500);
}

/** Empty strings from HTML forms should land in the DB as NULL, not "". */
export function nullIfBlank(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}
