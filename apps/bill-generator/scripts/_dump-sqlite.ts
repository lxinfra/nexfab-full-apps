/** Exports every table to JSON so the data can be re-imported into Postgres. */
import { writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const data = {
    companies: await prisma.company.findMany(),
    customers: await prisma.customer.findMany(),
    products: await prisma.product.findMany(),
    invoiceCounters: await prisma.invoiceCounter.findMany(),
    invoices: await prisma.invoice.findMany(),
    invoiceItems: await prisma.invoiceItem.findMany(),
    payments: await prisma.payment.findMany(),
    invoiceRevisions: await prisma.invoiceRevision.findMany(),
    uploads: await prisma.upload.findMany(),
  };

  await writeFile('sqlite-export.json', JSON.stringify(data, null, 2));
  for (const [table, rows] of Object.entries(data)) {
    console.log(`  ${table.padEnd(18)} ${rows.length}`);
  }
  console.log('\nwritten to sqlite-export.json');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
