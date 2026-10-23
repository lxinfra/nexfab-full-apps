import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { applyRebate, computeLine, computeTotals, supplyTypeFor, type ComputedLine } from './gst';
import {
  allocateSequence,
  counterKey,
  deriveInitials,
  financialYear,
  renderInvoiceNumber,
} from './numbering';
import { companySnapshot, customerSnapshot } from './snapshot';
import { stateByCode } from './states';
import type { InvoiceInput } from './schemas';
import type { DocType, Status } from './constants';

/**
 * Prisma's interactive transactions default to a 5 second budget, which is fine
 * against a local file but not against a hosted database where every statement
 * is a network round trip and several writers may be queued on the same counter
 * row. The work inside each transaction is deliberately small; this only stops a
 * slow link from failing an otherwise correct write.
 */
const TX = { timeout: 30_000, maxWait: 20_000 } as const;

/**
 * Anything except a cancelled document can be corrected. An issued bill keeps
 * its number and its place in the series; the version it had before the edit is
 * written to InvoiceRevision first, so the change is always traceable.
 */
export function isEditable(status: string): boolean {
  return status !== 'CANCELLED';
}

/** Editing this will be recorded as a revision rather than a silent overwrite. */
export function editIsTracked(invoice: { number: string | null }): boolean {
  return Boolean(invoice.number);
}

/** Parses the yyyy-mm-dd coming from a date input as local midnight. */
export function parseDateInput(v: string): Date {
  const [y, m, d] = v.split('-').map(Number);
  if (!y || !m || !d) {
    const fallback = new Date(v);
    if (Number.isNaN(fallback.getTime())) throw new Error(`Invalid date: ${v}`);
    return fallback;
  }
  return new Date(y, m - 1, d, 12, 0, 0, 0); // midday avoids any TZ date-shift
}

export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type CompanyForCalc = {
  id: string;
  stateCode: string;
  invoicePrefix: string;
  includeFyInNo: boolean;
  numberPadding: number;
};

/** Runs the whole GST calculation for a payload without touching the database. */
export function calculate(input: InvoiceInput, companyStateCode: string) {
  const supplyType = supplyTypeFor(
    companyStateCode,
    input.placeOfSupplyCode,
    input.withinStateSupply,
  );
  const lines: ComputedLine[] = input.items.map((i) =>
    computeLine(
      {
        productId: i.productId,
        name: i.name,
        description: i.description,
        hsnSac: i.hsnSac,
        unit: i.unit,
        qtyMilli: i.qtyMilli,
        ratePaise: i.ratePaise,
        discountType: i.discountType,
        discountValue: i.discountValue,
        gstRate: i.gstRate,
      },
      supplyType,
    ),
  );
  const rebated = applyRebate(lines, input.rebateBp ?? 0, supplyType);
  const totals = computeTotals(rebated.lines, input.roundOff, {
    basicTotalPaise: rebated.basicTotalPaise,
    rebatePaise: rebated.rebatePaise,
  });
  return { supplyType, lines: rebated.lines, totals };
}


/** Resolves the buyer's initials, falling back to a value derived from the name. */
function buyerInitialsOf(c: { initials?: string | null; name: string }): string {
  return (c.initials ?? '').trim() || deriveInitials(c.name);
}

/** Allocates a sequence and renders the number from the company's template. */
async function issueNumber(
  tx: Prisma.TransactionClient,
  company: {
    id: string;
    invoicePrefix: string;
    numberFormat: string;
    includeFyInNo: boolean;
    numberPadding: number;
    numberStart: number;
    initials: string | null;
    legalName: string;
  },
  customer: { id: string; initials?: string | null; name: string },
  docType: DocType,
  fy: string,
  date: Date,
  override?: string | null,
): Promise<{ seq: number | null; number: string; bucket: string }> {
  // A hand-typed number does not consume the series, so the automatic sequence
  // stays unbroken for every other bill. Uniqueness is enforced by the database.
  const bucket = counterKey(company.numberFormat, fy, date, customer.id);
  const typed = (override ?? '').trim();
  if (typed) return { seq: null, number: typed, bucket };

  const seq = await allocateSequence(tx, company.id, docType, bucket, company.numberStart);
  const number = renderInvoiceNumber(company, {
    docType,
    fy,
    seq,
    date,
    sellerInitials: company.initials ?? '',
    buyerInitials: buyerInitialsOf(customer),
    sellerName: company.legalName,
    buyerName: customer.name,
  });
  return { seq, number, bucket };
}

function itemRows(lines: ComputedLine[]): Prisma.InvoiceItemCreateManyInvoiceInput[] {
  return lines.map((l, idx) => ({
    productId: l.productId ?? null,
    name: l.name,
    description: l.description ?? null,
    hsnSac: l.hsnSac ?? null,
    unit: l.unit,
    qtyMilli: l.qtyMilli,
    ratePaise: l.ratePaise,
    discountType: l.discountType,
    discountValue: l.discountValue,
    grossPaise: l.grossPaise,
    discountPaise: l.discountPaise,
    taxablePaise: l.taxablePaise,
    gstRate: l.gstRate,
    cgstPaise: l.cgstPaise,
    sgstPaise: l.sgstPaise,
    igstPaise: l.igstPaise,
    totalPaise: l.totalPaise,
    sortOrder: idx,
  }));
}

/**
 * Creates an invoice. A DRAFT is stored without a number; any other status
 * consumes the next number in the company's series for that doc type and FY.
 */
export type CreateExtras = {
  /** Set when the invoice is being generated from a monthly sheet import. */
  importBatchId?: string | null;
  /** The bill number the sheet already carried. Never used as the number. */
  externalBillNo?: string | null;
};

export async function createInvoice(
  companyId: string,
  input: InvoiceInput,
  extras: CreateExtras = {},
) {
  // Reads are done up front, outside the transaction. Over a remote database
  // every round trip inside a transaction holds a connection and counts against
  // the transaction timeout, and these two lookups do not need to be atomic with
  // the write — only reserving the number and inserting the invoice do.
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  const customer = await prisma.customer.findFirstOrThrow({
    where: { id: input.customerId, companyId },
  });

  return prisma.$transaction(async (tx) => {
    const invoiceDate = parseDateInput(input.invoiceDate);
    const fy = financialYear(invoiceDate);
    const { supplyType, lines, totals } = calculate(input, company.stateCode);

    let seq: number | null = null;
    let number: string | null = null;
    let seqBucket: string | null = null;
    if (input.status !== 'DRAFT') {
      const issued = await issueNumber(
        tx,
        company,
        customer,
        input.docType,
        fy,
        invoiceDate,
        input.numberOverride,
      );
      seq = issued.seq;
      number = issued.number;
      seqBucket = issued.bucket;
    }

    return tx.invoice.create({
      data: {
        companyId,
        customerId: customer.id,
        docType: input.docType,
        number,
        seq,
        seqBucket,
        fy,
        invoiceDate,
        dueDate: input.dueDate ? parseDateInput(input.dueDate) : null,
        placeOfSupply: stateByCode(input.placeOfSupplyCode)!.name,
        placeOfSupplyCode: input.placeOfSupplyCode,
        supplyType,
        reverseCharge: input.reverseCharge,
        status: input.status,
        agreementNo: input.agreementNo,
        workOrderDate: input.workOrderDate ? parseDateInput(input.workOrderDate) : null,
        rebateLabel: input.rebateLabel,
        rebateBp: input.rebateBp ?? 0,
        numberOverride: input.numberOverride,
        importBatchId: extras.importBatchId ?? null,
        externalBillNo: extras.externalBillNo ?? null,
        rebatePaise: totals.rebatePaise,
        notes: input.notes,
        terms: input.terms ?? company.defaultTerms,
        companySnapshot: JSON.stringify(companySnapshot(company)),
        customerSnapshot: JSON.stringify(customerSnapshot(customer)),
        subtotalPaise: totals.subtotalPaise,
        discountPaise: totals.discountPaise,
        taxablePaise: totals.taxablePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        roundOffPaise: totals.roundOffPaise,
        totalPaise: totals.totalPaise,
        items: { createMany: { data: itemRows(lines) } },
      },
      include: { items: true },
    });
  }, TX);
}

/**
 * Saves an edit. A draft is simply overwritten; an issued document keeps its
 * number and gains a revision recording what it looked like beforehand.
 */
export async function updateInvoice(invoiceId: string, input: InvoiceInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!isEditable(existing.status)) {
      throw new Error(
        'A cancelled document cannot be edited. Duplicate it to raise a fresh one.',
      );
    }
    const company = await tx.company.findUniqueOrThrow({ where: { id: existing.companyId } });
    const customer = await tx.customer.findFirstOrThrow({
      where: { id: input.customerId, companyId: existing.companyId },
    });

    const invoiceDate = parseDateInput(input.invoiceDate);
    const { supplyType, lines, totals } = calculate(input, company.stateCode);

    // An issued document keeps its number, its sequence and its financial year:
    // re-deriving any of them would shift its place in the series. Only a draft
    // being issued for the first time draws a number.
    let seq = existing.seq;
    let number = existing.number;
    let seqBucket = existing.seqBucket;
    let fy = existing.fy;
    let revision = existing.revision;

    if (!existing.number) {
      fy = financialYear(invoiceDate);
      if (input.status !== 'DRAFT') {
        const issued = await issueNumber(
          tx,
          company,
          customer,
          input.docType,
          fy,
          invoiceDate,
          input.numberOverride,
        );
        seq = issued.seq;
        number = issued.number;
      }
    } else {
      // Record what the bill looked like before this edit.
      revision = existing.revision + 1;
      await tx.invoiceRevision.create({
        data: {
          invoiceId,
          revision,
          reason: input.editReason,
          snapshot: JSON.stringify({
            number: existing.number,
            docType: existing.docType,
            status: existing.status,
            invoiceDate: existing.invoiceDate,
            dueDate: existing.dueDate,
            placeOfSupply: existing.placeOfSupply,
            placeOfSupplyCode: existing.placeOfSupplyCode,
            supplyType: existing.supplyType,
            reverseCharge: existing.reverseCharge,
            agreementNo: existing.agreementNo,
            workOrderDate: existing.workOrderDate,
            rebateLabel: existing.rebateLabel,
            rebateBp: existing.rebateBp,
            notes: existing.notes,
            terms: existing.terms,
            customerSnapshot: existing.customerSnapshot,
            subtotalPaise: existing.subtotalPaise,
            discountPaise: existing.discountPaise,
            rebatePaise: existing.rebatePaise,
            taxablePaise: existing.taxablePaise,
            cgstPaise: existing.cgstPaise,
            sgstPaise: existing.sgstPaise,
            igstPaise: existing.igstPaise,
            roundOffPaise: existing.roundOffPaise,
            totalPaise: existing.totalPaise,
            items: existing.items.map((i) => ({
              name: i.name,
              description: i.description,
              hsnSac: i.hsnSac,
              unit: i.unit,
              qtyMilli: i.qtyMilli,
              ratePaise: i.ratePaise,
              discountType: i.discountType,
              discountValue: i.discountValue,
              gstRate: i.gstRate,
              taxablePaise: i.taxablePaise,
              totalPaise: i.totalPaise,
            })),
          }),
        },
      });
    }

    await tx.invoiceItem.deleteMany({ where: { invoiceId } });

    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        customerId: customer.id,
        docType: input.docType,
        number,
        seq,
        seqBucket,
        fy,
        revision,
        lastEditedAt: existing.number ? new Date() : existing.lastEditedAt,
        invoiceDate,
        dueDate: input.dueDate ? parseDateInput(input.dueDate) : null,
        placeOfSupply: stateByCode(input.placeOfSupplyCode)!.name,
        placeOfSupplyCode: input.placeOfSupplyCode,
        supplyType,
        reverseCharge: input.reverseCharge,
        status: input.status,
        agreementNo: input.agreementNo,
        workOrderDate: input.workOrderDate ? parseDateInput(input.workOrderDate) : null,
        rebateLabel: input.rebateLabel,
        rebateBp: input.rebateBp ?? 0,
        numberOverride: input.numberOverride,
        rebatePaise: totals.rebatePaise,
        notes: input.notes,
        terms: input.terms,
        companySnapshot: JSON.stringify(companySnapshot(company)),
        customerSnapshot: JSON.stringify(customerSnapshot(customer)),
        subtotalPaise: totals.subtotalPaise,
        discountPaise: totals.discountPaise,
        taxablePaise: totals.taxablePaise,
        cgstPaise: totals.cgstPaise,
        sgstPaise: totals.sgstPaise,
        igstPaise: totals.igstPaise,
        roundOffPaise: totals.roundOffPaise,
        totalPaise: totals.totalPaise,
        items: { createMany: { data: itemRows(lines) } },
      },
      include: { items: true },
    });
  }, TX);
}

/** Copies an existing document into a fresh, un-numbered draft. */
export async function duplicateInvoice(invoiceId: string) {
  return prisma.$transaction(async (tx) => {
    const src = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    const company = await tx.company.findUniqueOrThrow({ where: { id: src.companyId } });
    const customer = await tx.customer.findUniqueOrThrow({ where: { id: src.customerId } });
    const today = new Date();

    return tx.invoice.create({
      data: {
        companyId: src.companyId,
        customerId: src.customerId,
        docType: src.docType,
        number: null,
        seq: null,
        fy: financialYear(today),
        invoiceDate: today,
        dueDate: null,
        placeOfSupply: src.placeOfSupply,
        placeOfSupplyCode: src.placeOfSupplyCode,
        supplyType: src.supplyType,
        reverseCharge: src.reverseCharge,
        status: 'DRAFT',
        notes: src.notes,
        terms: src.terms,
        companySnapshot: JSON.stringify(companySnapshot(company)),
        customerSnapshot: JSON.stringify(customerSnapshot(customer)),
        subtotalPaise: src.subtotalPaise,
        discountPaise: src.discountPaise,
        taxablePaise: src.taxablePaise,
        cgstPaise: src.cgstPaise,
        sgstPaise: src.sgstPaise,
        igstPaise: src.igstPaise,
        roundOffPaise: src.roundOffPaise,
        totalPaise: src.totalPaise,
        items: {
          createMany: {
            data: src.items.map((i, idx) => ({
              productId: i.productId,
              name: i.name,
              description: i.description,
              hsnSac: i.hsnSac,
              unit: i.unit,
              qtyMilli: i.qtyMilli,
              ratePaise: i.ratePaise,
              discountType: i.discountType,
              discountValue: i.discountValue,
              grossPaise: i.grossPaise,
              discountPaise: i.discountPaise,
              taxablePaise: i.taxablePaise,
              gstRate: i.gstRate,
              cgstPaise: i.cgstPaise,
              sgstPaise: i.sgstPaise,
              igstPaise: i.igstPaise,
              totalPaise: i.totalPaise,
              sortOrder: idx,
            })),
          },
        },
      },
    });
  }, TX);
}

/** Status transitions. Issuing a draft assigns its permanent number. */
export async function setStatus(invoiceId: string, status: Status, cancelReason?: string | null) {
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (inv.status === 'CANCELLED') throw new Error('This document is cancelled and cannot change.');

    const data: Prisma.InvoiceUpdateInput = { status };

    if (status !== 'DRAFT' && !inv.number) {
      const company = await tx.company.findUniqueOrThrow({ where: { id: inv.companyId } });
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: inv.customerId } });
      const issued = await issueNumber(
        tx,
        company,
        customer,
        inv.docType as DocType,
        inv.fy,
        inv.invoiceDate,
      );
      data.seq = issued.seq;
      data.number = issued.number;
      data.seqBucket = issued.bucket;
    }
    if (status === 'CANCELLED') {
      data.cancelledAt = new Date();
      data.cancelReason = cancelReason ?? null;
    }

    return tx.invoice.update({ where: { id: invoiceId }, data });
  }, TX);
}

/** Adds a payment and moves the invoice to PARTIALLY_PAID / PAID automatically. */
export async function addPayment(
  invoiceId: string,
  payment: { paidOn: Date; amountPaise: number; method: string; reference?: string | null; notes?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    if (inv.status === 'CANCELLED') throw new Error('Cannot record a payment against a cancelled document.');

    await tx.payment.create({ data: { invoiceId, ...payment } });

    const agg = await tx.payment.aggregate({ where: { invoiceId }, _sum: { amountPaise: true } });
    const paid = agg._sum.amountPaise ?? 0;

    let status = inv.status;
    if (paid <= 0) status = inv.status === 'DRAFT' ? 'DRAFT' : 'SENT';
    else if (paid >= inv.totalPaise) status = 'PAID';
    else status = 'PARTIALLY_PAID';

    const data: Prisma.InvoiceUpdateInput = { amountPaidPaise: paid, status };
    // Recording money against an un-issued draft issues it first.
    if (!inv.number && status !== 'DRAFT') {
      const company = await tx.company.findUniqueOrThrow({ where: { id: inv.companyId } });
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: inv.customerId } });
      const issued = await issueNumber(
        tx,
        company,
        customer,
        inv.docType as DocType,
        inv.fy,
        inv.invoiceDate,
      );
      data.seq = issued.seq;
      data.number = issued.number;
      data.seqBucket = issued.bucket;
    }

    return tx.invoice.update({ where: { id: invoiceId }, data });
  }, TX);
}

export async function deletePayment(paymentId: string) {
  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await tx.payment.delete({ where: { id: paymentId } });
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
    const agg = await tx.payment.aggregate({
      where: { invoiceId: p.invoiceId },
      _sum: { amountPaise: true },
    });
    const paid = agg._sum.amountPaise ?? 0;
    let status = inv.status;
    if (inv.status !== 'CANCELLED' && inv.status !== 'DRAFT') {
      status = paid <= 0 ? 'SENT' : paid >= inv.totalPaise ? 'PAID' : 'PARTIALLY_PAID';
    }
    return tx.invoice.update({
      where: { id: p.invoiceId },
      data: { amountPaidPaise: paid, status },
    });
  }, TX);
}

/** Drafts can be thrown away; anything with a number must be cancelled instead. */
export async function deleteDraft(invoiceId: string) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  if (inv.number) {
    throw new Error('Issued documents cannot be deleted — cancel it instead to keep numbering intact.');
  }
  await prisma.invoice.delete({ where: { id: invoiceId } });
  return { deleted: true };
}

export type InvoiceWithAll = Prisma.InvoiceGetPayload<{
  include: { items: true; payments: true; customer: true; company: true };
}>;

export async function getInvoice(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      payments: { orderBy: { paidOn: 'desc' } },
      revisions: { orderBy: { revision: 'desc' } },
      customer: true,
      company: true,
    },
  });
}

export type { CompanyForCalc };
