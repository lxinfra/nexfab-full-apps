'use client';

import type { Company } from '@prisma/client';
import { hsnSummary, type ComputedLine, type SupplyType, type Totals } from '@/lib/gst';
import { formatBasisPoints, formatPaise, formatQty } from '@/lib/money';
import { paiseToWords } from '@/lib/words';
import {
  DOC_DATE_LABELS,
  DOC_NUMBER_LABELS,
  DOC_TITLES,
  SUPPLY_TYPE_LABELS,
  type DocType,
} from '@/lib/constants';
import { addressLines } from '@/lib/snapshot';
import { formatHsn } from '@/lib/hsn';
import { formatBillDateInput } from '@/lib/numbering';
import { resolveLabels } from '@/lib/labels';
import type { CustomerLite } from './types';

/** On-screen replica of the printed page so the PDF is never a surprise. */
export default function InvoicePreview({
  company,
  customer,
  docType,
  number,
  invoiceDate,
  dueDate,
  placeOfSupply,
  placeOfSupplyCode,
  reverseCharge,
  revision = 0,
  lines,
  totals,
  supplyType,
  notes,
  terms,
  agreementNo,
  workOrderDate,
  rebateLabel,
  rebateBp,
}: {
  company: Company;
  customer: CustomerLite | null;
  docType: DocType;
  number: string | null;
  invoiceDate: string;
  dueDate: string;
  placeOfSupply: string;
  placeOfSupplyCode: string;
  reverseCharge: boolean;
  revision?: number;
  lines: ComputedLine[];
  totals: Totals;
  supplyType: SupplyType;
  notes: string;
  terms: string;
  agreementNo?: string;
  workOrderDate?: string;
  rebateLabel?: string;
  rebateBp?: number;
}) {
  const intra = supplyType !== 'INTER_STATE';
  const L = resolveLabels(company.labels);
  const hsn = hsnSummary(lines);
  const gstRate = lines.find((l) => l.gstRate > 0)?.gstRate ?? 0;
  const shipping =
    customer && !customer.shipSameAsBilling
      ? {
          name: customer.shippingName || customer.name,
          lines: addressLines({
            addressLine1: customer.shippingLine1,
            addressLine2: customer.shippingLine2,
            city: customer.shippingCity,
            state: customer.shippingState,
            pincode: customer.shippingPincode,
          }),
        }
      : null;

  const officeLine = [
    'Office Address :- ' + addressLines({ ...company }).join(', '),
    company.phone ? `Mobile No. ${company.phone}` : '',
    company.email ?? '',
  ]
    .filter(Boolean)
    .join('   ');

  return (
    <div className="overflow-hidden rounded-lg border border-slate-400 bg-white text-[10px] leading-snug text-slate-800">
      {/* registration bar — hidden entirely when there is nothing to show */}
      {(company.cin || company.gstin) && (
        <div className="flex justify-between border-b border-slate-400 px-2 py-0.5 text-[9px]">
          <span>{company.cin ? `CIN No. - ${company.cin}` : ''}</span>
          <span>{company.gstin ? `GST No.- ${company.gstin}` : ''}</span>
        </div>
      )}

      {/* letterhead */}
      <div className="border-b border-slate-400 px-2 py-2 text-center">
        <p className="text-2xl leading-tight font-bold tracking-tight text-slate-900">
          {company.legalName}
        </p>
        {company.tagline && <p className="mt-0.5 text-[11px] text-slate-600">{company.tagline}</p>}
        <p className="mt-0.5 text-[10px] text-slate-600">{officeLine}</p>
      </div>

      {/* title */}
      <div className="border-b border-slate-400 bg-slate-100 py-1 text-center">
        <p className="text-xs font-bold tracking-widest">{DOC_TITLES[docType]}</p>
        {company.invoiceSubtitle && (
          <p className="text-[9px] tracking-wider text-slate-500">{company.invoiceSubtitle}</p>
        )}
      </div>

      {/* buyer | document meta */}
      <div className="grid grid-cols-[52%_48%] border-b border-slate-400">
        <div className="border-r border-slate-400 p-2">
          <p className="mb-1 text-[9px] font-bold tracking-wide text-slate-500">{L.buyerBlock}</p>
          {customer ? (
            <>
              <p className="font-semibold text-slate-900">{customer.name}</p>
              {addressLines({
                addressLine1: customer.billingLine1,
                addressLine2: customer.billingLine2,
                city: customer.billingCity,
                state: customer.billingState,
                pincode: customer.billingPincode,
              }).map((l, i) => (
                <p key={i}>{l}</p>
              ))}
              <p>
                {L.buyerGstin} : {customer.gstin || L.unregistered}
              </p>
              <p>
                {L.buyerState} : {customer.billingState} ({customer.billingStateCode})
              </p>
              {shipping && (
                <div className="mt-1.5">
                  <p className="text-[9px] font-bold tracking-wide text-slate-500">{L.shipBlock}</p>
                  <p className="font-semibold">{shipping.name}</p>
                  {shipping.lines.map((l, i) => (
                    <p key={i}>{l}</p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-slate-400">Choose a customer</p>
          )}
        </div>
        <div className="p-2">
          <Meta k={DOC_NUMBER_LABELS[docType]} v={number ?? 'DRAFT (unissued)'} />
          <Meta k={DOC_DATE_LABELS[docType]} v={formatBillDateInput(invoiceDate) || '—'} />
          {revision > 0 && <Meta k="Revised" v={`Revision ${revision}`} />}
          {dueDate && <Meta k={L.dueDate} v={formatBillDateInput(dueDate)} />}
          {company.pan && <Meta k={L.panNo} v={company.pan} />}
          {company.gstin && <Meta k={L.gstinNo} v={company.gstin} />}
        </div>
      </div>

      {/* bank + seller | services + order */}
      <div className="grid grid-cols-[52%_48%] border-b border-slate-400">
        <div className="border-r border-slate-400">
          <div className="border-b border-slate-400 p-2">
            <p className="mb-1 text-[9px] font-bold tracking-wide text-slate-500">{L.bankBlock}</p>
            {company.bankAccountName && <p>A/c Name {company.bankAccountName}</p>}
            {company.bankName && <p>Bank Name - {company.bankName}</p>}
            {company.bankAccountNo && <p>A/c No. {company.bankAccountNo}</p>}
            {company.bankIfsc && <p>IFSC Code - {company.bankIfsc}</p>}
            {company.bankAccountType && <p>Account Type - {company.bankAccountType}</p>}
            {company.bankBranch && <p>Branch - {company.bankBranch}</p>}
            {company.upiId && <p>UPI - {company.upiId} (QR on the PDF)</p>}
            {!company.bankName && !company.bankAccountNo && (
              <p className="text-slate-400">Bank details not configured.</p>
            )}
          </div>
        </div>
        <div>
          <div className="p-2">
            <p className="mb-1 text-[9px] font-bold tracking-wide text-slate-500">{L.orderBlock}</p>
            {agreementNo && <Meta k={L.agreementNo} v={agreementNo} />}
            {workOrderDate && <Meta k={L.workOrderDate} v={formatBillDateInput(workOrderDate)} />}
            <Meta
              k={L.placeOfSupply}
              v={placeOfSupply ? `${placeOfSupply} (${placeOfSupplyCode})` : '—'}
            />
            <Meta
              k={L.supplyType}
              v={SUPPLY_TYPE_LABELS[supplyType] ?? (intra ? L.intraState : L.interState)}
            />
            <Meta k={L.reverseCharge} v={reverseCharge ? L.yes : L.no} />
          </div>
        </div>
      </div>

      {/* items */}
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-100">
            <Th className="w-8">{L.colSn}</Th>
            <Th className="text-left">{L.colDesc}</Th>
            <Th className="w-16">{L.colHsn}</Th>
            <Th className="w-10 text-right">{L.colQty}</Th>
            <Th className="w-12">{L.colUnit}</Th>
            <Th className="w-16 text-right">{L.colRate}</Th>
            <Th className="w-20 text-right">{L.colAmount}</Th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 && (
            <tr>
              <Td colSpan={7} className="py-3 text-center text-slate-400">
                Add a line item to see it here
              </Td>
            </tr>
          )}
          {lines.map((l, i) => (
            <tr key={i}>
              <Td className="text-center">{i + 1}</Td>
              <Td className="text-left">
                <span className="font-medium">{l.name || 'Untitled item'}</span>
                {l.description && <div className="text-slate-500">{l.description}</div>}
                {l.discountPaise > 0 && (
                  <div className="text-slate-500">
                    {L.lineDiscount} {formatPaise(l.discountPaise)}
                  </div>
                )}
              </Td>
              <Td className="text-center">{l.hsnSac ? formatHsn(l.hsnSac) : '—'}</Td>
              <Td className="text-right">{formatQty(l.qtyMilli)}</Td>
              <Td className="text-center">{l.unit}</Td>
              <Td className="text-right">{formatPaise(l.ratePaise)}</Td>
              <Td className="text-right font-medium">
                {formatPaise(l.grossPaise - l.discountPaise)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* HSN summary | totals */}
      <div className="grid grid-cols-[55%_45%] border-t border-slate-400">
        <div className="border-r border-slate-400 p-2">
          {hsn.length > 0 && (
            <>
              <p className="mb-1 text-[9px] font-bold tracking-wide text-slate-500">
                {L.hsnBlock}
              </p>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    <Th className="text-left">{L.hsnColCode}</Th>
                    <Th className="text-right">{L.hsnColRate}</Th>
                    <Th className="text-right">{L.hsnColTaxable}</Th>
                    <Th className="text-right">{intra ? 'CGST+SGST' : 'IGST'}</Th>
                  </tr>
                </thead>
                <tbody>
                  {hsn.map((h) => (
                    <tr key={`${h.hsnSac}-${h.gstRate}`}>
                      <Td className="text-left">{formatHsn(h.hsnSac) || '—'}</Td>
                      <Td className="text-right">{h.gstRate}%</Td>
                      <Td className="text-right">{formatPaise(h.taxablePaise)}</Td>
                      <Td className="text-right">
                        {formatPaise(h.cgstPaise + h.sgstPaise + h.igstPaise)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="p-2">
          <Row k={L.totalBasic} v={formatPaise(totals.basicTotalPaise)} />
          {totals.rebatePaise > 0 && (
            <Row
              k={`${rebateLabel || 'Below'} ${formatBasisPoints(rebateBp ?? 0)}%`}
              v={`- ${formatPaise(totals.rebatePaise)}`}
            />
          )}
          <Row k={L.totalTaxable} v={formatPaise(totals.taxablePaise)} bold />
          {intra ? (
            <>
              <Row k={`CGST ${gstRate / 2}%`} v={formatPaise(totals.cgstPaise)} />
              <Row k={`SGST ${gstRate / 2}%`} v={formatPaise(totals.sgstPaise)} />
            </>
          ) : (
            <Row k={`IGST ${gstRate}%`} v={formatPaise(totals.igstPaise)} />
          )}
          {totals.roundOffPaise !== 0 && (
            <Row k={L.totalRoundOff} v={formatPaise(totals.roundOffPaise)} />
          )}
          <div className="mt-1 flex justify-between border-t border-slate-400 pt-1 text-xs font-bold">
            <span>{L.totalGrand}</span>
            <span>₹ {formatPaise(totals.totalPaise)}</span>
          </div>
        </div>
      </div>

      <div className="border-t border-slate-400 p-2">
        <span className="font-semibold">{L.amountInWords} </span>
        {paiseToWords(totals.totalPaise)}
      </div>

      {/* notes | sign-off */}
      <div className="grid grid-cols-[52%_48%] border-t border-slate-400">
        <div className="border-r border-slate-400 p-2">
          {notes && (
            <>
              <p className="text-[9px] font-bold tracking-wide text-slate-500">{L.notesBlock}</p>
              <p className="whitespace-pre-line">{notes}</p>
            </>
          )}
          {terms && (
            <div className={notes ? 'mt-1.5' : ''}>
              <p className="text-[9px] font-bold tracking-wide text-slate-500">
                {L.termsBlock}
              </p>
              {terms.split('\n').map((t, i) => (
                <p key={i}>{t}</p>
              ))}
            </div>
          )}
        </div>
        <div className="flex min-h-20 flex-col justify-between p-2">
          <p className="text-center text-xs font-bold">{L.thanks}</p>
          <div className="text-right">
            <p className="font-semibold">
              {L.forCompany} {company.legalName}
            </p>
            <p className="mt-4">{L.signatory}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div className="mb-0.5 flex">
      <span className="w-24 shrink-0 text-slate-500">{k}</span>
      <span className="font-semibold text-slate-900">: {v}</span>
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className={bold ? 'font-semibold' : 'text-slate-600'}>{k}</span>
      <span className={`tabular-nums ${bold ? 'font-semibold' : ''}`}>{v}</span>
    </div>
  );
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`border border-slate-300 px-1 py-1 text-[9px] font-semibold ${className}`}>
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
  colSpan,
}: {
  children?: React.ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={`border border-slate-300 px-1 py-1 align-top ${className}`}>
      {children}
    </td>
  );
}
