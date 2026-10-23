/**
 * Loads the SQLite export into Postgres, in dependency order.
 *
 * Every row keeps its original id, so invoice numbers, counters and all the
 * foreign keys line up exactly as they did before the move. Re-running is safe:
 * rows that already exist are skipped rather than duplicated.
 */
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type Row = Record<string, unknown>;

/** Dates come back from JSON as strings; Prisma wants real Dates. */
const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'invoiceDate',
  'dueDate',
  'workOrderDate',
  'paidOn',
  'cancelledAt',
  'lastEditedAt',
]);

function revive(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = DATE_FIELDS.has(k) && typeof v === 'string' ? new Date(v) : v;
  }
  return out;
}

async function load(
  label: string,
  rows: Row[],
  create: (data: Row) => Promise<unknown>,
): Promise<void> {
  let inserted = 0;
  let skipped = 0;
  for (const row of rows) {
    try {
      await create(revive(row));
      inserted++;
    } catch (e) {
      // A unique-constraint hit means the row is already there.
      if (e instanceof Error && /Unique constraint/i.test(e.message)) skipped++;
      else throw e;
    }
  }
  console.log(`  ${label.padEnd(18)} ${inserted} inserted${skipped ? `, ${skipped} already present` : ''}`);
}

async function main() {
  const data = JSON.parse(await readFile('sqlite-export.json', 'utf8'));

  await load('companies', data.companies, (d) => prisma.company.create({ data: d as never }));
  await load('customers', data.customers, (d) => prisma.customer.create({ data: d as never }));
  await load('products', data.products, (d) => prisma.product.create({ data: d as never }));
  await load('invoiceCounters', data.invoiceCounters, (d) =>
    prisma.invoiceCounter.create({ data: d as never }),
  );
  await load('invoices', data.invoices, (d) => prisma.invoice.create({ data: d as never }));
  await load('invoiceItems', data.invoiceItems, (d) =>
    prisma.invoiceItem.create({ data: d as never }),
  );
  await load('payments', data.payments, (d) => prisma.payment.create({ data: d as never }));
  await load('invoiceRevisions', data.invoiceRevisions, (d) =>
    prisma.invoiceRevision.create({ data: d as never }),
  );
  await load('uploads', data.uploads, (d) => prisma.upload.create({ data: d as never }));

  console.log('\nnow in Supabase:');
  console.log('  companies ', await prisma.company.count());
  console.log('  customers ', await prisma.customer.count());
  console.log('  products  ', await prisma.product.count());
  console.log('  invoices  ', await prisma.invoice.count());
  console.log('  items     ', await prisma.invoiceItem.count());
  console.log('  counters  ', await prisma.invoiceCounter.count());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
