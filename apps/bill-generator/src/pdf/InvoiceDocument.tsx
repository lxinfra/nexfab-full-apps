import path from 'node:path';
import React from 'react';
import { Document, Font, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { hsnSummary, type ComputedLine, type SupplyType } from '@/lib/gst';
import { formatPaise, formatQty, formatBasisPoints } from '@/lib/money';
import { paiseToWords } from '@/lib/words';
import {
  COPY_LABELS,
  DOC_DATE_LABELS,
  DOC_NUMBER_LABELS,
  DOC_TITLES,
  SUPPLY_TYPE_LABELS,
  type CopyType,
  type DocType,
} from '@/lib/constants';
import { addressLines, type CompanySnapshot, type CustomerSnapshot } from '@/lib/snapshot';
import { formatHsn } from '@/lib/hsn';
import { DEFAULT_LABELS } from '@/lib/labels';
import { FONT_DIR } from './assets';

// Noto Sans carries the ₹ glyph, which the built-in PDF fonts do not.
Font.register({
  family: 'NotoSans',
  fonts: [
    { src: path.join(FONT_DIR, 'NotoSans-Regular.ttf'), fontWeight: 400 },
    { src: path.join(FONT_DIR, 'NotoSans-Bold.ttf'), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((word) => [word]);

const BORDER = '#555f6d';
const LIGHT = '#c9d1da';
const HEAD_BG = '#eef2f6';

const s = StyleSheet.create({
  page: {
    fontFamily: 'NotoSans',
    fontSize: 8,
    color: '#111827',
    paddingTop: 16,
    paddingBottom: 26,
    paddingHorizontal: 18,
  },
  frame: { borderWidth: 1, borderColor: BORDER },
  row: { flexDirection: 'row' },
  copyLabel: { textAlign: 'right', fontSize: 7, color: '#475569', marginBottom: 3 },

  // --- letterhead -----------------------------------------------------------
  regBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    paddingVertical: 2.5,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    fontSize: 7.5,
  },
  letterhead: { paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: BORDER },
  companyName: { fontSize: 24, fontWeight: 700, textAlign: 'center', letterSpacing: 0.3 },
  tagline: { fontSize: 9.5, textAlign: 'center', color: '#334155', marginTop: 2 },
  officeLine: { fontSize: 8, textAlign: 'center', color: '#334155', marginTop: 3 },
  logo: { width: 44, height: 44, objectFit: 'contain' },

  // --- title ----------------------------------------------------------------
  titleBand: {
    backgroundColor: HEAD_BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingVertical: 3,
  },
  title: { textAlign: 'center', fontSize: 11, fontWeight: 700, letterSpacing: 1.8 },
  subtitle: { textAlign: 'center', fontSize: 7.5, letterSpacing: 1, color: '#475569', marginTop: 1 },

  // --- two-column blocks ----------------------------------------------------
  colLeft: { width: '52%', borderRightWidth: 1, borderRightColor: BORDER },
  colRight: { width: '48%' },
  pad: { paddingHorizontal: 6, paddingVertical: 4 },
  blockLabel: {
    fontSize: 7,
    fontWeight: 700,
    color: '#475569',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  sectionBorder: { borderBottomWidth: 1, borderBottomColor: BORDER },
  metaRow: { flexDirection: 'row', marginBottom: 1.5 },
  metaKey: { width: 72, color: '#475569' },
  metaVal: { flex: 1, fontWeight: 700 },

  // --- items ----------------------------------------------------------------
  th: {
    backgroundColor: HEAD_BG,
    fontWeight: 700,
    fontSize: 7.5,
    paddingVertical: 4,
    paddingHorizontal: 3,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  td: { paddingVertical: 4, paddingHorizontal: 3, borderRightWidth: 1, borderRightColor: LIGHT },
  trBorder: { borderBottomWidth: 1, borderBottomColor: LIGHT },
  right: { textAlign: 'right' },
  center: { textAlign: 'center' },
  bold: { fontWeight: 700 },
  muted: { color: '#475569' },

  // --- totals ---------------------------------------------------------------
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 },
  totalKey: { color: '#334155' },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: BORDER,
    marginTop: 2,
    paddingTop: 3,
  },

  qr: { width: 56, height: 56 },
  signature: { height: 32, objectFit: 'contain', marginLeft: 'auto' },
  thanks: { textAlign: 'center', fontSize: 9, fontWeight: 700, marginBottom: 6 },
  footerNote: {
    position: 'absolute',
    bottom: 10,
    left: 18,
    right: 18,
    textAlign: 'center',
    fontSize: 6.5,
    color: '#94a3b8',
  },
});

// Item table columns (sum = 100%)
const COLS = {
  sn: '5%',
  desc: '38%',
  hsn: '12%',
  qty: '9%',
  unit: '9%',
  rate: '12%',
  amount: '15%',
};

export type InvoicePdfData = {
  docType: DocType;
  number: string | null;
  invoiceDate: string;
  dueDate: string | null;
  placeOfSupply: string;
  placeOfSupplyCode: string;
  reverseCharge: boolean;
  status: string;
  revision: number;
  supplyType: SupplyType;
  company: CompanySnapshot;
  customer: CustomerSnapshot;
  lines: ComputedLine[];
  agreementNo: string | null;
  workOrderDate: string | null;
  rebateLabel: string | null;
  rebateBp: number;
  totals: {
    subtotalPaise: number;
    discountPaise: number;
    basicTotalPaise: number;
    rebatePaise: number;
    taxablePaise: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    roundOffPaise: number;
    totalPaise: number;
  };
  amountPaidPaise: number;
  notes: string | null;
  terms: string | null;
  copy: CopyType;
  logo: string | null;
  signature: string | null;
  upiQr: string | null;
};

export function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  const intra = data.supplyType !== 'INTER_STATE';
  const c = data.company;
  const b = data.customer;
  const t = data.totals;
  const hsn = hsnSummary(data.lines);
  const gstRate = data.lines.find((l) => l.gstRate > 0)?.gstRate ?? 0;
  const balance = t.totalPaise - data.amountPaidPaise;
  // Wording frozen with the bill; falls back to the defaults for older records.
  const L = c.labels ?? DEFAULT_LABELS;

  const officeLine = [
    'Office Address :- ' + addressLines(c).join(', '),
    c.phone ? `Mobile No. ${c.phone}` : '',
    c.email ?? '',
    c.website ?? '',
  ]
    .filter(Boolean)
    .join('   ');

  const shipping = b.shipSameAsBilling
    ? null
    : {
        name: b.shippingName || b.name,
        lines: addressLines({
          addressLine1: b.shippingLine1,
          addressLine2: b.shippingLine2,
          city: b.shippingCity,
          state: b.shippingState,
          pincode: b.shippingPincode,
        }),
      };

  return (
    <Document
      title={`${DOC_TITLES[data.docType]} ${data.number ?? 'DRAFT'}`}
      author={c.legalName}
      subject={`${DOC_TITLES[data.docType]} for ${b.name}`}
    >
      <Page size="A4" style={s.page}>
        {data.copy !== 'NONE' && <Text style={s.copyLabel}>{COPY_LABELS[data.copy]}</Text>}

        <View style={s.frame}>
          {/* ---- registration bar: CIN left, GST right ---- */}
          {/* Nothing to register means no empty strip above the letterhead. */}
          {c.cin || c.gstin ? (
            <View style={s.regBar}>
              <Text>{c.cin ? `CIN No. - ${c.cin}` : ' '}</Text>
              <Text>{c.gstin ? `GST No.- ${c.gstin}` : ' '}</Text>
            </View>
          ) : null}

          {/* ---- letterhead ---- */}
          <View style={s.letterhead}>
            <View style={s.row}>
              {data.logo ? (
                <Image style={s.logo} src={data.logo} />
              ) : (
                <View style={{ width: 0 }} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.companyName}>{c.legalName}</Text>
                {c.tagline ? <Text style={s.tagline}>{c.tagline}</Text> : null}
                <Text style={s.officeLine}>{officeLine}</Text>
              </View>
              {data.logo ? <View style={{ width: 44 }} /> : null}
            </View>
          </View>

          {/* ---- title ---- */}
          <View style={s.titleBand}>
            <Text style={s.title}>{DOC_TITLES[data.docType]}</Text>
            {c.invoiceSubtitle ? <Text style={s.subtitle}>{c.invoiceSubtitle}</Text> : null}
          </View>

          {/* ---- buyer (left) | document meta (right) ---- */}
          <View style={[s.row, s.sectionBorder]}>
            <View style={[s.colLeft, s.pad]}>
              <Text style={s.blockLabel}>{L.buyerBlock}</Text>
              <Text style={s.bold}>{b.name}</Text>
              {addressLines({
                addressLine1: b.billingLine1,
                addressLine2: b.billingLine2,
                city: b.billingCity,
                state: b.billingState,
                pincode: b.billingPincode,
              }).map((l, i) => (
                <Text key={i}>{l}</Text>
              ))}
              <Text style={{ marginTop: 1 }}>
                {L.buyerGstin} : {b.gstin || L.unregistered}
              </Text>
              <Text>
                {L.buyerState} : {b.billingState} ({b.billingStateCode})
              </Text>
              {b.phone ? (
                <Text>
                  {L.buyerPhone} {b.phone}
                </Text>
              ) : null}
              {shipping ? (
                <View style={{ marginTop: 3 }}>
                  <Text style={s.blockLabel}>{L.shipBlock}</Text>
                  <Text style={s.bold}>{shipping.name}</Text>
                  {shipping.lines.map((l, i) => (
                    <Text key={i}>{l}</Text>
                  ))}
                </View>
              ) : null}
            </View>

            <View style={[s.colRight, s.pad]}>
              <Meta k={DOC_NUMBER_LABELS[data.docType]} v={data.number ?? 'DRAFT (unissued)'} />
              <Meta k={DOC_DATE_LABELS[data.docType]} v={data.invoiceDate} />
              {data.revision > 0 ? <Meta k="Revised" v={`Revision ${data.revision}`} /> : null}
              {data.dueDate ? <Meta k={L.dueDate} v={data.dueDate} /> : null}
              {c.pan ? <Meta k={L.panNo} v={c.pan} /> : null}
              {c.gstin ? <Meta k={L.gstinNo} v={c.gstin} /> : null}
              {data.status === 'CANCELLED' ? <Meta k={L.status} v="CANCELLED" /> : null}
            </View>
          </View>

          {/* ---- bank + seller (left) | services & order refs (right) ---- */}
          <View style={[s.row, s.sectionBorder]}>
            <View style={s.colLeft}>
              <View style={[s.pad, s.sectionBorder]}>
                <Text style={s.blockLabel}>{L.bankBlock}</Text>
                <View style={s.row}>
                  <View style={{ flex: 1 }}>
                    {c.bankAccountName ? <Text>
                        {L.bankAcName} {c.bankAccountName}
                      </Text> : null}
                    {c.bankName ? <Text>
                        {L.bankNameRow} {c.bankName}
                      </Text> : null}
                    {c.bankAccountNo ? <Text>
                        {L.bankAcNo} {c.bankAccountNo}
                      </Text> : null}
                    {c.bankIfsc ? <Text>
                        {L.bankIfscRow} {c.bankIfsc}
                      </Text> : null}
                    {c.bankAccountType ? <Text>
                        {L.bankTypeRow} {c.bankAccountType}
                      </Text> : null}
                    {c.bankBranch ? <Text>
                        {L.bankBranchRow} {c.bankBranch}
                      </Text> : null}
                    {c.upiId ? <Text>
                        {L.bankUpiRow} {c.upiId}
                      </Text> : null}
                    {!c.bankName && !c.bankAccountNo ? (
                      <Text style={s.muted}>Bank details not configured.</Text>
                    ) : null}
                  </View>
                  {data.upiQr ? (
                    <View style={{ alignItems: 'center' }}>
                      <Image style={s.qr} src={data.upiQr} />
                      <Text style={{ fontSize: 6 }}>{L.scanToPay}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </View>

            <View style={s.colRight}>
              <View style={s.pad}>
                <Text style={s.blockLabel}>{L.orderBlock}</Text>
                {data.agreementNo ? <Meta k={L.agreementNo} v={data.agreementNo} /> : null}
                {data.workOrderDate ? <Meta k={L.workOrderDate} v={data.workOrderDate} /> : null}
                <Meta
                  k={L.placeOfSupply}
                  v={`${data.placeOfSupply} (${data.placeOfSupplyCode})`}
                />
                <Meta
                  k={L.supplyType}
                  v={SUPPLY_TYPE_LABELS[data.supplyType] ?? (intra ? L.intraState : L.interState)}
                />
                <Meta k={L.reverseCharge} v={data.reverseCharge ? L.yes : L.no} />
              </View>
            </View>
          </View>

          {/* ---- items ---- */}
          <View style={[s.row, s.sectionBorder]}>
            <Text style={[s.th, { width: COLS.sn }, s.center]}>{L.colSn}</Text>
            <Text style={[s.th, { width: COLS.desc }]}>{L.colDesc}</Text>
            <Text style={[s.th, { width: COLS.hsn }, s.center]}>{L.colHsn}</Text>
            <Text style={[s.th, { width: COLS.qty }, s.right]}>{L.colQty}</Text>
            <Text style={[s.th, { width: COLS.unit }, s.center]}>{L.colUnit}</Text>
            <Text style={[s.th, { width: COLS.rate }, s.right]}>{L.colRate}</Text>
            <Text style={[s.th, { width: COLS.amount, borderRightWidth: 0 }, s.right]}>
              {L.colAmount}
            </Text>
          </View>

          {data.lines.map((l, i) => (
            <View key={i} style={[s.row, s.trBorder]} wrap={false}>
              <Text style={[s.td, { width: COLS.sn }, s.center]}>{i + 1}</Text>
              <View style={[s.td, { width: COLS.desc }]}>
                <Text style={s.bold}>{l.name}</Text>
                {l.description ? <Text style={s.muted}>{l.description}</Text> : null}
                {l.discountPaise > 0 ? (
                  <Text style={s.muted}>{L.lineDiscount} {formatPaise(l.discountPaise)}</Text>
                ) : null}
              </View>
              <Text style={[s.td, { width: COLS.hsn }, s.center]}>
                {l.hsnSac ? formatHsn(l.hsnSac) : '—'}
              </Text>
              <Text style={[s.td, { width: COLS.qty }, s.right]}>{formatQty(l.qtyMilli)}</Text>
              <Text style={[s.td, { width: COLS.unit }, s.center]}>{l.unit}</Text>
              <Text style={[s.td, { width: COLS.rate }, s.right]}>{formatPaise(l.ratePaise)}</Text>
              <Text style={[s.td, { width: COLS.amount, borderRightWidth: 0 }, s.right, s.bold]}>
                {formatPaise(l.grossPaise - l.discountPaise)}
              </Text>
            </View>
          ))}

          {/* ---- totals, laid out the way the source bill does ---- */}
          <View style={[s.row, s.sectionBorder]}>
            <View style={[{ width: '55%' }, s.pad, { borderRightWidth: 1, borderRightColor: BORDER }]}>
              {hsn.length > 0 ? (
                <>
                  <Text style={s.blockLabel}>{L.hsnBlock}</Text>
                  <View style={[s.row, { backgroundColor: HEAD_BG }]}>
                    <Text style={[s.td, { width: '30%' }, s.bold]}>{L.hsnColCode}</Text>
                    <Text style={[s.td, { width: '14%' }, s.right, s.bold]}>{L.hsnColRate}</Text>
                    <Text style={[s.td, { width: '28%' }, s.right, s.bold]}>{L.hsnColTaxable}</Text>
                    <Text style={[s.td, { width: '28%', borderRightWidth: 0 }, s.right, s.bold]}>
                      {intra ? 'CGST + SGST' : 'IGST'}
                    </Text>
                  </View>
                  {hsn.map((h) => (
                    <View key={`${h.hsnSac}-${h.gstRate}`} style={[s.row, s.trBorder]}>
                      <Text style={[s.td, { width: '30%' }]}>{formatHsn(h.hsnSac) || '—'}</Text>
                      <Text style={[s.td, { width: '14%' }, s.right]}>{h.gstRate}%</Text>
                      <Text style={[s.td, { width: '28%' }, s.right]}>
                        {formatPaise(h.taxablePaise)}
                      </Text>
                      <Text style={[s.td, { width: '28%', borderRightWidth: 0 }, s.right]}>
                        {formatPaise(h.cgstPaise + h.sgstPaise + h.igstPaise)}
                      </Text>
                    </View>
                  ))}
                </>
              ) : null}
            </View>

            <View style={[{ width: '45%' }, s.pad]}>
              <TotalRow k={L.totalBasic} v={formatPaise(t.basicTotalPaise)} />
              {t.rebatePaise > 0 ? (
                <TotalRow
                  k={`${data.rebateLabel || 'Below'} ${formatBasisPoints(data.rebateBp)}%`}
                  v={`- ${formatPaise(t.rebatePaise)}`}
                />
              ) : null}
              <TotalRow k={L.totalTaxable} v={formatPaise(t.taxablePaise)} bold />
              {intra ? (
                <>
                  <TotalRow k={`CGST ${gstRate / 2}%`} v={formatPaise(t.cgstPaise)} />
                  <TotalRow k={`SGST ${gstRate / 2}%`} v={formatPaise(t.sgstPaise)} />
                </>
              ) : (
                <TotalRow k={`IGST ${gstRate}%`} v={formatPaise(t.igstPaise)} />
              )}
              {t.roundOffPaise !== 0 ? (
                <TotalRow k={L.totalRoundOff} v={formatPaise(t.roundOffPaise)} />
              ) : null}
              <View style={s.grandRow}>
                <Text style={[s.bold, { fontSize: 10 }]}>{L.totalGrand}</Text>
                <Text style={[s.bold, { fontSize: 10 }]}>₹ {formatPaise(t.totalPaise)}</Text>
              </View>
              {data.amountPaidPaise > 0 ? (
                <>
                  <TotalRow k={L.totalReceived} v={formatPaise(data.amountPaidPaise)} />
                  <TotalRow k={L.totalBalance} v={formatPaise(balance)} bold />
                </>
              ) : null}
            </View>
          </View>

          {/* ---- amount in words ---- */}
          <View style={[s.pad, s.sectionBorder]}>
            <Text>
              <Text style={s.bold}>{L.amountInWords} </Text>
              {paiseToWords(t.totalPaise)}
            </Text>
          </View>

          {/* ---- notes / terms | sign-off ---- */}
          <View style={s.row}>
            <View style={[s.colLeft, s.pad]}>
              {data.notes ? (
                <>
                  <Text style={s.blockLabel}>{L.notesBlock}</Text>
                  <Text>{data.notes}</Text>
                </>
              ) : null}
              {data.terms ? (
                <View style={{ marginTop: data.notes ? 4 : 0 }}>
                  <Text style={s.blockLabel}>{L.termsBlock}</Text>
                  {data.terms.split('\n').map((line, i) => (
                    <Text key={i}>{line}</Text>
                  ))}
                </View>
              ) : null}
              {!data.notes && !data.terms ? <Text style={s.muted}> </Text> : null}
            </View>

            <View style={[s.colRight, s.pad, { justifyContent: 'space-between', minHeight: 86 }]}>
              <Text style={s.thanks}>{L.thanks}</Text>
              <View>
                {data.signature ? <Image style={s.signature} src={data.signature} /> : null}
                <Text style={[s.right, s.bold]}>
                  {L.forCompany} {c.legalName}
                </Text>
                <Text style={[s.right, { marginTop: 10 }]}>{L.signatory}</Text>
              </View>
            </View>
          </View>
        </View>

        <Text
          style={s.footerNote}
          fixed
          render={({ pageNumber, totalPages }) =>
            `${L.computerGenerated}${data.number ? ` ${data.number}` : ''} · ${L.page} ${pageNumber} / ${totalPages}`
          }
        />
      </Page>
    </Document>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.metaRow}>
      <Text style={s.metaKey}>{k}</Text>
      <Text style={s.metaVal}>: {v}</Text>
    </View>
  );
}

function TotalRow({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <View style={s.totalRow}>
      <Text style={bold ? s.bold : s.totalKey}>{k}</Text>
      <Text style={bold ? s.bold : undefined}>{v}</Text>
    </View>
  );
}
