/**
 * Sanity checks for the money / GST / words engine.
 * Run with: npm run check:math
 */
import {
  applyRebate,
  chargesCgstSgst,
  computeLine,
  computeTotals,
  hsnSummary,
  supplyTypeFor,
  taxBreakup,
} from '../src/lib/gst';
import { divRound, formatINR, formatPaise, formatQty, groupIndian, toPaise, toQtyMilli } from '../src/lib/money';
import { paiseToWords } from '../src/lib/words';
import {
  counterKey,
  deriveInitials,
  financialYear,
  firstLetters,
  firstWord,
  formatBillDate,
  formatBillDateInput,
  renderInvoiceNumber,
} from '../src/lib/numbering';
import { gstinCheckDigit, validateGstin } from '../src/lib/validate';
import { describeHsn, formatHsn, parseHsn, validateHsn } from '../src/lib/hsn';

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures++;
    console.log(`  FAIL ${label}\n       got      ${a}\n       expected ${e}`);
  } else {
    console.log(`  ok   ${label} = ${a}`);
  }
}

console.log('\nmoney');
eq('toPaise("1,250.50")', toPaise('1,250.50'), 125050);
eq('toPaise("0.005") rounds up', toPaise('0.005'), 1);
eq('toPaise(0.1+0.2 style)', toPaise(0.1) + toPaise(0.2), toPaise(0.3));
eq('divRound(5,2)', divRound(5, 2), 3);
eq('divRound(-5,2)', divRound(-5, 2), -3);
eq('groupIndian(12345678)', groupIndian(12345678), '1,23,45,678');
eq('formatPaise(125050)', formatPaise(125050), '1,250.50');
eq('formatINR(100000000)', formatINR(100000000), '₹10,00,000.00');
eq('toQtyMilli("2.5")', toQtyMilli('2.5'), 2500);
eq('formatQty(2500)', formatQty(2500), '2.5');

console.log('\nwords');
eq('0 paise', paiseToWords(0), 'Rupees Zero Only');
eq('1 rupee', paiseToWords(100), 'Rupees One Only');
eq('1,00,000.50', paiseToWords(10000050), 'Rupees One Lakh and Fifty Paise Only');
eq('1,23,45,678', paiseToWords(1234567800), 'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
eq('14,750', paiseToWords(1475000), 'Rupees Fourteen Thousand Seven Hundred Fifty Only');

console.log('\nsupply type');
eq('MP -> MP', supplyTypeFor('23', '23'), 'INTRA_STATE');
eq('MP -> MH', supplyTypeFor('23', '27'), 'INTER_STATE');

console.log('\nline maths (intra-state, 18%)');
const intra = computeLine(
  {
    name: 'Frame',
    unit: 'NOS',
    hsnSac: '73089090',
    qtyMilli: 2000,
    ratePaise: 1250000,
    discountType: 'PERCENT',
    discountValue: 1000, // 10%
    gstRate: 18,
  },
  'INTRA_STATE',
);
eq('gross', intra.grossPaise, 2500000);
eq('discount 10%', intra.discountPaise, 250000);
eq('taxable', intra.taxablePaise, 2250000);
eq('cgst + sgst == tax', intra.cgstPaise + intra.sgstPaise, intra.taxPaise);
eq('tax 18% of 22500', intra.taxPaise, 405000);
eq('line total', intra.totalPaise, 2655000);

console.log('\nodd-paise split goes to CGST');
const odd = computeLine(
  { name: 'x', unit: 'PCS', qtyMilli: 1000, ratePaise: 101, discountType: 'PERCENT', discountValue: 0, gstRate: 5 },
  'INTRA_STATE',
);
eq('tax on 1.01 @5%', odd.taxPaise, 5);
eq('cgst', odd.cgstPaise, 3);
eq('sgst', odd.sgstPaise, 2);
eq('cgst+sgst == tax', odd.cgstPaise + odd.sgstPaise, odd.taxPaise);

console.log('\ninter-state goes to IGST');
const inter = computeLine(
  { name: 'Sheet', unit: 'KG', hsnSac: '72193590', qtyMilli: 150500, ratePaise: 28500, discountType: 'AMOUNT', discountValue: 50000, gstRate: 18 },
  'INTER_STATE',
);
eq('gross 150.5kg x 285', inter.grossPaise, 4289250);
eq('flat discount 500', inter.discountPaise, 50000);
eq('cgst is zero', inter.cgstPaise, 0);
eq('igst == tax', inter.igstPaise, inter.taxPaise);

console.log('\ndiscount never exceeds the line');
const over = computeLine(
  { name: 'y', unit: 'PCS', qtyMilli: 1000, ratePaise: 10000, discountType: 'AMOUNT', discountValue: 999999, gstRate: 18 },
  'INTRA_STATE',
);
eq('discount capped at gross', over.discountPaise, 10000);
eq('taxable floors at zero', over.taxablePaise, 0);

console.log('\ntotals and round-off');
const totals = computeTotals([intra, odd], true);
eq('round-off is within ±0.50', Math.abs(totals.roundOffPaise) <= 50, true);
eq('total is a whole rupee', totals.totalPaise % 100, 0);
eq('total == taxable + tax + roundoff', totals.totalPaise, totals.taxablePaise + totals.taxPaise + totals.roundOffPaise);

console.log('\nHSN summary + breakup');
const rows = hsnSummary([intra, inter]);
eq('two HSN rows', rows.length, 2);
eq('breakup splits CGST/SGST', taxBreakup([intra], 'INTRA_STATE').map((r) => r.label), ['CGST @ 9%', 'SGST @ 9%']);
eq('breakup uses IGST', taxBreakup([inter], 'INTER_STATE').map((r) => r.label), ['IGST @ 18%']);

console.log('\nfinancial year + numbering');
eq('31 Mar 2026', financialYear(new Date(2026, 2, 31)), '2025-26');
eq('1 Apr 2026', financialYear(new Date(2026, 3, 1)), '2026-27');
eq('1 Jan 2027', financialYear(new Date(2027, 0, 1)), '2026-27');
const jun = new Date(2026, 5, 10); // 10 June 2026

const legacy = {
  invoicePrefix: 'NXF/',
  numberFormat: '{PREFIX}/{FY}/{SEQ}',
  includeFyInNo: true,
  numberPadding: 4,
  legalName: 'Nexofab Industries Limited',
};
eq(
  'prefix/FY/seq format',
  renderInvoiceNumber(legacy, {
    docType: 'TAX_INVOICE', fy: '2026-27', seq: 1, date: jun, sellerInitials: '', buyerInitials: 'IDA',
  }),
  'NXF/2026-27/0001',
);
eq(
  'quotation keeps its own series',
  renderInvoiceNumber(legacy, {
    docType: 'QUOTATION', fy: '2026-27', seq: 12, date: jun, sellerInitials: '', buyerInitials: 'IDA',
  }),
  'QT/NXF/2026-27/0012',
);

const tender = {
  invoicePrefix: 'LXI/',
  numberFormat: '{SELLER}/{MM}/{BUYER}/{SEQ}',
  includeFyInNo: false,
  numberPadding: 4,
  initials: 'LIL',
  legalName: 'Lx Infrastructure Limited',
};
eq(
  'seller/month/buyer/seq',
  renderInvoiceNumber(tender, {
    docType: 'TAX_INVOICE', fy: '2026-27', seq: 1, date: jun, sellerInitials: 'LIL', buyerInitials: 'IDA',
  }),
  'LIL/06/IDA/0001',
);
eq(
  'empty buyer initials collapse',
  renderInvoiceNumber(tender, {
    docType: 'TAX_INVOICE', fy: '2026-27', seq: 7, date: jun, sellerInitials: 'LIL', buyerInitials: '',
  }),
  'LIL/06/0007',
);
const buyerMonthSeq = {
  invoicePrefix: '',
  numberFormat: '{BUYER4}/{MMMM}/{SEQ}',
  includeFyInNo: false,
  numberPadding: 4,
  numberStart: 1001,
  initials: 'LXI',
  legalName: 'Lx Infrastructure Limited',
};
const ctx = (seq: number, date: Date, buyerName: string) => ({
  docType: 'TAX_INVOICE' as const,
  fy: '2026-27',
  seq,
  date,
  sellerInitials: 'LXI',
  buyerInitials: 'IDA',
  buyerName,
  sellerName: 'Lx Infrastructure Limited',
});
eq(
  'buyer4/month4/seq',
  renderInvoiceNumber(buyerMonthSeq, ctx(1001, jun, 'Indore Development Authority')),
  'INDO/JUNE/1001',
);
eq(
  'October gives OCTO',
  renderInvoiceNumber(buyerMonthSeq, ctx(1001, new Date(2026, 9, 2), 'Indore Development Authority')),
  'INDO/OCTO/1001',
);
eq(
  'May is only three letters',
  renderInvoiceNumber(buyerMonthSeq, ctx(1002, new Date(2026, 4, 2), 'Shree Balaji Traders')),
  'SHRE/MAY/1002',
);
eq(
  'punctuation and spaces are dropped',
  renderInvoiceNumber(buyerMonthSeq, ctx(1003, jun, 'A.B. Enterprises')),
  'ABEN/JUNE/1003',
);
eq('four letters of a name', firstLetters('Indore Development Authority'), 'INDO');
eq('short names are not padded', firstLetters('Ab Co'), 'ABCO');
eq('quotation keeps its series marker',
  renderInvoiceNumber(buyerMonthSeq, { ...ctx(1001, jun, 'Indore Development Authority'), docType: 'QUOTATION' }),
  'QT/INDO/JUNE/1001',
);
console.log('\nTRIVEDI/SEP/26/0001 format');
const trivedi = {
  invoicePrefix: '',
  numberFormat: '{BUYERWORD}/{MMM}/{YY}/{SEQ}',
  includeFyInNo: false,
  numberPadding: 4,
  numberStart: 1,
  legalName: 'Trivedi Enterprises Pvt Ltd',
};
const sep26 = new Date(2026, 8, 15); // 15 September 2026
// The prefix is the CUSTOMER being billed.
const num = (opts: typeof trivedi, seq: number, date: Date, buyer: string) =>
  renderInvoiceNumber(opts, {
    docType: 'TAX_INVOICE',
    fy: financialYear(date),
    seq,
    date,
    sellerInitials: '',
    buyerInitials: '',
    buyerName: buyer,
  });
eq('first invoice', num(trivedi, 1, sep26, 'Trivedi Enterprises Pvt Ltd'), 'TRIVEDI/SEP/26/0001');
eq('second invoice', num(trivedi, 2, sep26, 'Trivedi Enterprises Pvt Ltd'), 'TRIVEDI/SEP/26/0002');
eq('third invoice', num(trivedi, 3, sep26, 'Trivedi Enterprises Pvt Ltd'), 'TRIVEDI/SEP/26/0003');
eq('different customer', num(trivedi, 1, sep26, 'Reliance Industries Limited'), 'RELIANCE/SEP/26/0001');
eq('three-word customer', num(trivedi, 1, sep26, 'Tata Consultancy Services'), 'TATA/SEP/26/0001');
eq('adani', num(trivedi, 1, sep26, 'Adani Enterprises Ltd'), 'ADANI/SEP/26/0001');
eq(
  'new month restarts',
  num(trivedi, 1, new Date(2026, 9, 3), 'Trivedi Enterprises Pvt Ltd'),
  'TRIVEDI/OCT/26/0001',
);
eq('four digits at 10', num(trivedi, 10, sep26, 'Trivedi Enterprises Pvt Ltd'), 'TRIVEDI/SEP/26/0010');
eq('four digits at 100', num(trivedi, 100, sep26, 'Trivedi Enterprises Pvt Ltd'), 'TRIVEDI/SEP/26/0100');
eq('four digits at 1000', num(trivedi, 1000, sep26, 'Trivedi Enterprises Pvt Ltd'), 'TRIVEDI/SEP/26/1000');
eq('year 2027', num(trivedi, 1, new Date(2027, 8, 1), 'Trivedi Enterprises Pvt Ltd'), 'TRIVEDI/SEP/27/0001');
eq('first word only', firstWord('Trivedi Enterprises Pvt Ltd'), 'TRIVEDI');
eq('first word uppercases', firstWord('reliance industries limited'), 'RELIANCE');
eq('first word strips punctuation', firstWord('A.B.C. Traders'), 'ABC');

console.log('\nsequence bucket: company + month + year');
eq('month format buckets monthly', counterKey('{SELLERWORD}/{MMM}/{YY}/{SEQ}', '2026-27', sep26), '2026-09');
eq('buyer format buckets per customer', counterKey('{BUYERWORD}/{MMM}/{YY}/{SEQ}', '2026-27', sep26, 'cust-1'), '2026-09|cust-1');
eq('a different customer is a different run', counterKey('{BUYERWORD}/{MMM}/{YY}/{SEQ}', '2026-27', sep26, 'cust-2'), '2026-09|cust-2');
eq('October is its own bucket', counterKey('{SELLERWORD}/{MMM}/{YY}/{SEQ}', '2026-27', new Date(2026, 9, 3)), '2026-10');
eq('next year is its own bucket', counterKey('{SELLERWORD}/{MMM}/{YY}/{SEQ}', '2027-28', new Date(2027, 8, 1)), '2027-09');

console.log('\nbill date format: dd/MON/yy');
eq('15 Sep 2026', formatBillDate(new Date(2026, 8, 15)), '15/SEP/26');
eq('1 Jan pads the day', formatBillDate(new Date(2026, 0, 1)), '01/JAN/26');
eq('31 Dec 2027', formatBillDate(new Date(2027, 11, 31)), '31/DEC/27');
eq('year 2005 pads to 05', formatBillDate(new Date(2005, 5, 9)), '09/JUN/05');
eq('from a date input', formatBillDateInput('2026-09-15'), '15/SEP/26');
eq('input, single-digit day', formatBillDateInput('2026-01-02'), '02/JAN/26');
eq('empty input stays empty', formatBillDateInput(''), '');
eq('unparseable input passes through', formatBillDateInput('not a date'), 'not a date');
eq('month 13 is rejected', formatBillDateInput('2026-13-01'), '2026-13-01');
eq(
  'the date agrees with the {MMM} in the number',
  formatBillDate(sep26).split('/')[1],
  num(trivedi, 1, sep26, 'Indore Development Authority').split('/')[1],
);

console.log('\nsupply types');
eq('intra-state charges CGST+SGST', chargesCgstSgst('INTRA_STATE'), true);
eq('intra-city charges CGST+SGST too', chargesCgstSgst('INTRA_CITY'), true);
eq('inter-state charges IGST', chargesCgstSgst('INTER_STATE'), false);
eq('same state, city chosen', supplyTypeFor('23', '23', 'INTRA_CITY'), 'INTRA_CITY');
eq('same state, state chosen', supplyTypeFor('23', '23', 'INTRA_STATE'), 'INTRA_STATE');
eq('different state ignores the choice', supplyTypeFor('23', '27', 'INTRA_CITY'), 'INTER_STATE');
const cityLine = computeLine(
  { name: 'x', unit: 'PCS', qtyMilli: 1000, ratePaise: 100000, discountType: 'PERCENT', discountValue: 0, gstRate: 18 },
  'INTRA_CITY',
);
eq('intra-city splits CGST/SGST', [cityLine.cgstPaise, cityLine.sgstPaise, cityLine.igstPaise], [9000, 9000, 0]);
eq('intra-city matches intra-state', cityLine.totalPaise, computeLine(
  { name: 'x', unit: 'PCS', qtyMilli: 1000, ratePaise: 100000, discountType: 'PERCENT', discountValue: 0, gstRate: 18 },
  'INTRA_STATE',
).totalPaise);

eq('initials skip Ltd/Pvt', deriveInitials('Lx Infrastructure Limited'), 'LI');
eq('initials of three words', deriveInitials('Indore Development Authority'), 'IDA');
eq('no-year format runs one series', counterKey('{SELLER}/{MM}/{BUYER}/{SEQ}', '2026-27'), 'ALL');
eq('year format resets yearly', counterKey('{PREFIX}/{FY}/{SEQ}', '2026-27'), '2026-27');

console.log('\ninvoice-wide rebate (tender "below" percentage)');
const rebLines = [
  computeLine({ name: 'a', unit: 'MONTH', hsnSac: '995461', qtyMilli: 4000, ratePaise: 5164200, discountType: 'PERCENT', discountValue: 0, gstRate: 18 }, 'INTRA_STATE'),
];
const reb = applyRebate(rebLines, 2101, 'INTRA_STATE'); // 21.01% below
eq('basic total', reb.basicTotalPaise, 20656800);
eq('rebate 21.01%', reb.rebatePaise, 4339994);
eq('taxable after rebate', reb.lines[0].taxablePaise, 16316806);
eq('cgst', reb.lines[0].cgstPaise, 1468513);
eq('sgst', reb.lines[0].sgstPaise, 1468512);
const rebTotals = computeTotals(reb.lines, true, { basicTotalPaise: reb.basicTotalPaise, rebatePaise: reb.rebatePaise });
eq('grand total is a whole rupee', rebTotals.totalPaise, 19253800);

console.log('\nrebate split across two GST slabs');
const twoSlab = [
  computeLine({ name: 'x', unit: 'PCS', qtyMilli: 1000, ratePaise: 100000, discountType: 'PERCENT', discountValue: 0, gstRate: 18 }, 'INTRA_STATE'),
  computeLine({ name: 'y', unit: 'PCS', qtyMilli: 1000, ratePaise: 50000, discountType: 'PERCENT', discountValue: 0, gstRate: 5 }, 'INTRA_STATE'),
];
const split = applyRebate(twoSlab, 1000, 'INTRA_STATE'); // 10%
eq('shares sum to the rebate', split.lines[0].rebatePaise! + split.lines[1].rebatePaise!, split.rebatePaise);
eq('taxables sum correctly', split.lines[0].taxablePaise + split.lines[1].taxablePaise, split.basicTotalPaise - split.rebatePaise);
eq('18% line taxed on its own share', split.lines[0].taxablePaise, 90000);
eq('5% line taxed on its own share', split.lines[1].taxablePaise, 45000);

console.log('\nHSN structure');
eq('8-digit levels', describeHsn('73089090').length, 4);
eq('chapter name', parseHsn('73089090')!.chapterName, 'Articles of iron or steel');
eq('heading', parseHsn('73089090')!.heading, '7308');
eq('sub-heading', parseHsn('73089090')!.subHeading, '730890');
eq('tariff item', parseHsn('73089090')!.tariffItem, '73089090');
eq('SAC is a service', parseHsn('995461')!.isService, true);
eq('formatted', formatHsn('73089090'), '7308 90 90');
eq('2 digits rejected', validateHsn('73') !== null, true);
eq('5 digits rejected', validateHsn('73089') !== null, true);
eq('4 digits allowed', validateHsn('7308'), null);
eq('6 digits allowed', validateHsn('730890'), null);
eq('8 digits allowed', validateHsn('73089090'), null);
eq('SAC must be 6', validateHsn('99546') !== null, true);
eq('blank allowed', validateHsn(''), null);

console.log('\nGSTIN');
eq('check digit of real GSTIN 27AAPFU0939F1Z', gstinCheckDigit('27AAPFU0939F1Z'), 'V');
eq('check digit of real GSTIN 29AABCU9603R1Z', gstinCheckDigit('29AABCU9603R1Z'), 'J');
eq('seeded MP gstin valid', validateGstin('23AABCS1429B1Z2').ok, true);
eq('seeded MH gstin valid', validateGstin('27AAFCV2008A1ZW').ok, true);
eq('bad check digit rejected', validateGstin('23AABCS1429B1ZZ').checksumFailed, true);
eq('bad state code rejected', validateGstin('99AABCS1429B1ZX').ok, false);
eq('blank is allowed', validateGstin('').ok, true);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
