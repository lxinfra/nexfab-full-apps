/**
 * Creates one document of every type for the active company and saves the
 * PDFs into ./samples so the layout can be eyeballed.
 *
 *   npm run dev        (in one terminal)
 *   npm run samples    (in another)
 *
 * The PDFs are fetched from the app's own /api/invoices/:id/pdf route, so what
 * you get here is byte-for-byte what the Download button produces.
 *
 * If the company has no GSTIN / bank / UPI details yet, obvious placeholder
 * values are printed on the sample PDFs so the whole layout is visible; the
 * stored company record is left untouched.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createInvoice } from '../src/lib/invoice-service';
import { DOC_LABELS, type CopyType, type DocType } from '../src/lib/constants';
import { formatINR } from '../src/lib/money';
import type { CompanySnapshot } from '../src/lib/snapshot';

const prisma = new PrismaClient();
const OUT = path.join(process.cwd(), 'samples');
const BASE = process.env.BASE_URL ?? 'http://localhost:3000';

const PLACEHOLDER: Partial<CompanySnapshot> = {
  gstin: '23AABCN1234C1ZT',
  pan: 'AABCN1234C',
  bankName: 'HDFC Bank',
  bankAccountNo: '50200012345678',
  bankIfsc: 'HDFC0001234',
  bankBranch: 'Sukhliya, Indore',
  upiId: 'nexofab@okhdfcbank',
};

function day(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  // The route renders the PDF, so the dev server has to be up.
  try {
    await fetch(BASE, { signal: AbortSignal.timeout(4000) });
  } catch {
    throw new Error(`Cannot reach ${BASE}. Start the app with \`npm run dev\` first.`);
  }

  const company = await prisma.company.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!company) throw new Error('No company found. Run `npm run db:seed` first.');

  const customers = await prisma.customer.findMany({
    where: { companyId: company.id, isActive: true },
    orderBy: { name: 'asc' },
  });
  const products = await prisma.product.findMany({
    where: { companyId: company.id, isActive: true },
    orderBy: { name: 'asc' },
  });
  if (customers.length === 0 || products.length === 0) {
    throw new Error('Need at least one customer and one product. Run `npm run db:seed`.');
  }

  const inState = customers.find((c) => c.billingStateCode === company.stateCode) ?? customers[0];
  const outState = customers.find((c) => c.billingStateCode !== company.stateCode) ?? customers[0];

  // Pick by role rather than by position so the sample quantities stay sensible
  // (hours of labour, kilos of sheet) whatever order the products come back in.
  const service = products.find((p) => p.isService) ?? products[products.length - 1];
  const byWeight = products.find((p) => p.unit === 'KG') ?? products[0];
  const byPiece =
    products.find((p) => p !== service && p !== byWeight) ?? products[0];

  const line = (p: (typeof products)[number], qty: number, discountBp = 0) => ({
    productId: p.id,
    name: p.name,
    description: p.description,
    hsnSac: p.hsnSac,
    unit: p.unit,
    qtyMilli: Math.round(qty * 1000),
    ratePaise: p.ratePaise,
    discountType: 'PERCENT' as const,
    discountValue: discountBp,
    gstRate: p.gstRate,
  });

  const jobs = [
    {
      label: '1-tax-invoice-intra-state-cgst-sgst',
      docType: 'TAX_INVOICE' as DocType,
      customer: inState,
      copy: 'ORIGINAL' as CopyType,
      items: [line(byPiece, 2, 1000), line(byWeight, 150.5), line(service, 8)],
      notes: 'Material dispatched via Gati Ltd, LR No. 884512.',
      dueDate: day(15),
    },
    {
      label: '2-tax-invoice-inter-state-igst',
      docType: 'TAX_INVOICE' as DocType,
      customer: outState,
      copy: 'DUPLICATE' as CopyType,
      items: [line(byWeight, 400), line(service, 16)],
      notes: 'Delivery at Bhiwandi warehouse. E-way bill to follow.',
      dueDate: day(30),
    },
    {
      label: '3-proforma-invoice',
      docType: 'PROFORMA' as DocType,
      customer: outState,
      copy: 'NONE' as CopyType,
      items: [line(byPiece, 5)],
      notes: 'Advance 50% against this proforma; balance before dispatch.',
      dueDate: null,
    },
    {
      label: '4-quotation',
      docType: 'QUOTATION' as DocType,
      customer: inState,
      copy: 'NONE' as CopyType,
      items: [line(byPiece, 10, 500), line(service, 24)],
      notes: 'Rates valid for 15 days. Delivery 3-4 weeks from a confirmed order.',
      dueDate: null,
    },
    {
      label: '5-delivery-challan',
      docType: 'DELIVERY_CHALLAN' as DocType,
      customer: inState,
      copy: 'TRIPLICATE' as CopyType,
      items: [line(byWeight, 75.25)],
      notes: 'Goods sent for job work; to be returned within 180 days.',
      dueDate: null,
    },
  ];

  await mkdir(OUT, { recursive: true });
  const needsPlaceholders = !company.gstin || !company.bankAccountNo || !company.upiId;

  console.log(`\nGenerating samples for ${company.legalName}\n`);

  for (const job of jobs) {
    const created = await createInvoice(company.id, {
      docType: job.docType,
      customerId: job.customer.id,
      invoiceDate: day(),
      dueDate: job.dueDate,
      placeOfSupplyCode: job.customer.billingStateCode,
      reverseCharge: false,
      roundOff: true,
      agreementNo: null,
      workOrderDate: null,
      rebateLabel: null,
      rebateBp: 0,
      withinStateSupply: 'INTRA_STATE' as const,
      editReason: null,
      numberOverride: null,
      notes: job.notes,
      terms: company.defaultTerms,
      items: job.items,
      status: 'SENT',
    });

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: created.id } });
    const realSnapshot = invoice.companySnapshot;

    // Swap in placeholders just long enough to render, then put it straight back.
    if (needsPlaceholders) {
      const snap = JSON.parse(realSnapshot) as Record<string, unknown>;
      for (const [k, v] of Object.entries(PLACEHOLDER)) if (!snap[k]) snap[k] = v;
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { companySnapshot: JSON.stringify(snap) },
      });
    }

    try {
      const res = await fetch(
        `${BASE}/api/invoices/${invoice.id}/pdf?copy=${job.copy.toLowerCase()}`,
      );
      if (!res.ok) throw new Error(`PDF route returned ${res.status}: ${await res.text()}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      const file = path.join(OUT, `${job.label}.pdf`);
      await writeFile(file, bytes);

      console.log(
        `  ${DOC_LABELS[job.docType].padEnd(18)} ${String(invoice.number).padEnd(22)}` +
          `${formatINR(invoice.totalPaise).padStart(14)}  ` +
          `${invoice.supplyType === 'INTRA_STATE' ? 'CGST+SGST' : 'IGST     '}  ` +
          `${(bytes.length / 1024).toFixed(0).padStart(3)} KB  -> samples/${path.basename(file)}`,
      );
    } finally {
      if (needsPlaceholders) {
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { companySnapshot: realSnapshot },
        });
      }
    }
  }

  if (needsPlaceholders) {
    console.log(
      '\n  Note: GSTIN / bank / UPI were blank, so placeholder values were printed on these\n' +
        '        samples to show the complete layout (including the UPI QR). Your company\n' +
        '        record is unchanged - set the real values under Companies.',
    );
  }
  console.log(`\nDone. ${jobs.length} PDFs in ./samples\n`);
}

main()
  .catch((e) => {
    console.error('\n' + (e instanceof Error ? e.message : String(e)) + '\n');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
