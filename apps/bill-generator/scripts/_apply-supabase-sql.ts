/**
 * Applies the bits of the Supabase setup that Prisma does not own:
 * the storage bucket, Row Level Security, and the numbering RPC.
 *
 * Prisma owns the table definitions (it created them with `db push`), so this
 * deliberately does NOT re-create tables.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const STATEMENTS: { label: string; sql: string }[] = [
  {
    label: 'storage bucket "bill-files"',
    sql: `
      insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values (
        'bill-files', 'bill-files', false, 10485760,
        array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml',
              'application/pdf',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              'application/vnd.ms-excel','text/csv']
      )
      on conflict (id) do update
        set file_size_limit = excluded.file_size_limit,
            allowed_mime_types = excluded.allowed_mime_types;`,
  },
  {
    label: 'atomic numbering function',
    sql: `
      create or replace function public.next_invoice_sequence(
        p_company_id text, p_doc_type text, p_bucket text, p_start int default 1
      ) returns int language plpgsql security definer set search_path = public as $fn$
      declare v_seq int;
      begin
        insert into "InvoiceCounter" (id, "companyId", "docType", fy, "lastNumber")
        values (gen_random_uuid()::text, p_company_id, p_doc_type, p_bucket, greatest(1, p_start))
        on conflict ("companyId", "docType", fy)
          do update set "lastNumber" = "InvoiceCounter"."lastNumber" + 1
        returning "lastNumber" into v_seq;
        return v_seq;
      end $fn$;`,
  },
  {
    label: 'build_invoice_number helper',
    sql: `
      create or replace function public.build_invoice_number(
        p_customer_name text, p_date date, p_seq int, p_padding int default 4
      ) returns text language sql immutable as $fn$
        select upper(regexp_replace(split_part(btrim(p_customer_name), ' ', 1), '[^A-Za-z0-9]', '', 'g'))
            || '/' || upper(to_char(p_date, 'MON'))
            || '/' || to_char(p_date, 'YY')
            || '/' || lpad(p_seq::text, greatest(1, p_padding), '0');
      $fn$;`,
  },
];

// Option A: the app reaches Postgres with the database password and Storage with
// the service-role key, both of which bypass RLS. Turning RLS on with no policies
// makes the anon key — the only one that could reach a browser — useless.
const RLS_TABLES = [
  'Company', 'Customer', 'Product', 'Invoice', 'InvoiceItem',
  'Payment', 'InvoiceCounter', 'InvoiceRevision', 'Upload',
];

async function main() {
  for (const { label, sql } of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`  ok  ${label}`);
  }

  for (const table of RLS_TABLES) {
    await prisma.$executeRawUnsafe(`alter table public."${table}" enable row level security;`);
  }
  console.log(`  ok  row level security enabled on ${RLS_TABLES.length} tables (no policies: deny-by-default)`);

  await prisma.$executeRawUnsafe(`revoke all on public."Company" from anon;`);
  console.log('  ok  anon role revoked from company data');

  // Prove the function works. The counter table has a foreign key to Company,
  // so the probe uses a real company with a throwaway bucket, then cleans up.
  const company = await prisma.company.findFirstOrThrow({ select: { id: true } });
  const first = await prisma.$queryRawUnsafe<{ next_invoice_sequence: number }[]>(
    `select public.next_invoice_sequence($1, 'TAX_INVOICE', '__probe__', 1);`,
    company.id,
  );
  const second = await prisma.$queryRawUnsafe<{ next_invoice_sequence: number }[]>(
    `select public.next_invoice_sequence($1, 'TAX_INVOICE', '__probe__', 1);`,
    company.id,
  );
  console.log(
    '  ok  next_invoice_sequence() returned',
    first[0].next_invoice_sequence,
    'then',
    second[0].next_invoice_sequence,
  );
  await prisma.$executeRawUnsafe(`delete from "InvoiceCounter" where fy = '__probe__';`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
