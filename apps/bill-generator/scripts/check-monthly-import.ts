/**
 * Assertions for the monthly sheet import.
 *
 * The scenarios are the ones that decide whether the feature is correct: when
 * rows become one bill and when they stay separate.
 *
 *   npm run check:import
 */
import {
  coerceDate,
  coerceSupplyType,
  detectMonthlyColumns,
  groupIntoBills,
  hasBillNumbers,
  markDuplicateRows,
  missingRequiredFields,
  parseMonthlyRows,
  previewGroups,
  suggestGrouping,
  summarise,
  type GroupingMode,
  type MonthlyColumnMap,
} from '../src/lib/monthly-import';

let failures = 0;

function ok(label: string, pass: boolean, detail?: string) {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!pass) failures++;
}

function eq(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  ok(label, pass, pass ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Builds the rows a sheet would hand over, given a header and body. */
function parse(headers: string[], body: unknown[][], mode?: GroupingMode) {
  const detect = detectMonthlyColumns(headers);
  const parsed = parseMonthlyRows(
    body.map((cells, i) => ({ rowNumber: i + 2, cells })),
    { map: detect.map, defaultSupplyType: 'INTRA_STATE' },
  );
  const grouping = mode ?? suggestGrouping(parsed.rows);
  const bills = groupIntoBills(parsed.rows.filter((r) => r.valid), grouping);
  return { detect, parsed, bills, grouping };
}

// ---------------------------------------------------------------------------
console.log('\n--- column detection ---');
{
  const d = detectMonthlyColumns(['Date', 'Company', 'Product', 'HSN Code', 'Qty', 'Rate', 'GST']);
  eq('Date -> date', d.map.date, 0);
  eq('Company -> customer', d.map.customer, 1);
  eq('Product -> name', d.map.name, 2);
  eq('HSN Code -> hsnSac', d.map.hsnSac, 3);
  eq('Qty -> qty', d.map.qty, 4);
  eq('Rate -> rate', d.map.rate, 5);
  eq('GST -> gstRate', d.map.gstRate, 6);
  eq('nothing missing', missingRequiredFields(d.map), []);
}
{
  // The same sheet written by someone else.
  const d = detectMonthlyColumns([
    'Invoice Date', 'Party Name', 'Bill No.', 'Item Name', 'HSN/SAC',
    'Quantity', 'Unit Price', 'Tax %', 'Type of Supply', 'Amount',
  ]);
  eq('Invoice Date -> date', d.map.date, 0);
  eq('Party Name -> customer', d.map.customer, 1);
  eq('Bill No. -> billNo', d.map.billNo, 2);
  eq('Item Name -> name', d.map.name, 3);
  eq('HSN/SAC -> hsnSac', d.map.hsnSac, 4);
  eq('Quantity -> qty', d.map.qty, 5);
  eq('Unit Price -> rate', d.map.rate, 6);
  eq('Tax % -> gstRate', d.map.gstRate, 7);
  eq('Type of Supply -> supplyType', d.map.supplyType, 8);
  eq('Amount -> amount', d.map.amount, 9);
}
{
  const d = detectMonthlyColumns(['Client', 'Dt', 'Particulars', 'Nos', 'Price']);
  eq('Client -> customer', d.map.customer, 0);
  eq('Dt -> date', d.map.date, 1);
  eq('Particulars -> name', d.map.name, 2);
  eq('Nos -> qty', d.map.qty, 3);
  eq('Price -> rate', d.map.rate, 4);
}
{
  const d = detectMonthlyColumns(['Date', 'Qty', 'Rate']);
  eq('missing customer and product reported', missingRequiredFields(d.map), ['customer', 'name']);
}
{
  // "Company Name" must not lose the customer column to a bare "Name".
  const d = detectMonthlyColumns(['Date', 'Company Name', 'Product Name', 'Qty', 'Rate']);
  eq('Company Name -> customer', d.map.customer, 1);
  eq('Product Name -> name', d.map.name, 2);
}

// ---------------------------------------------------------------------------
console.log('\n--- dates ---');
{
  const d = coerceDate('05/09/2026').date!;
  eq('05/09/2026 is 5 September (day first)', [d.getDate(), d.getMonth() + 1, d.getFullYear()], [5, 9, 2026]);
}
{
  const d = coerceDate('2026-09-05').date!;
  eq('ISO 2026-09-05', [d.getDate(), d.getMonth() + 1], [5, 9]);
}
{
  const d = coerceDate('5-Sep-2026').date!;
  eq('5-Sep-2026', [d.getDate(), d.getMonth() + 1, d.getFullYear()], [5, 9, 2026]);
}
{
  const d = coerceDate('10 September 26').date!;
  eq('10 September 26 -> 2026', [d.getDate(), d.getMonth() + 1, d.getFullYear()], [10, 9, 2026]);
}
{
  const r = coerceDate('09/25/2026');
  eq('09/25/2026 falls back to month-first', [r.date!.getDate(), r.date!.getMonth() + 1], [25, 9]);
  ok('and warns about it', !!r.warning, r.warning);
}
{
  // Excel's 1900 date system. 45292 is the documented serial for 2024-01-01,
  // which anchors the conversion; 46270 is then 2026-09-05.
  const anchor = coerceDate(45292).date!;
  eq('Excel serial 45292 is 2024-01-01',
    [anchor.getDate(), anchor.getMonth() + 1, anchor.getFullYear()], [1, 1, 2024]);
  const d = coerceDate(46270).date!;
  eq('Excel serial 46270 is 2026-09-05',
    [d.getDate(), d.getMonth() + 1, d.getFullYear()], [5, 9, 2026]);
}
eq('31 February is rejected', coerceDate('31/02/2026').date, null);
eq('nonsense is rejected', coerceDate('not a date').date, null);
eq('blank is null', coerceDate('').date, null);
{
  const d = coerceDate(new Date(2026, 8, 5, 23, 30)).date!;
  eq('a late-evening Date keeps its day', [d.getDate(), d.getMonth() + 1], [5, 9]);
}

// ---------------------------------------------------------------------------
console.log('\n--- supply type ---');
eq('Intra-State', coerceSupplyType('Intra-State'), 'INTRA_STATE');
eq('Intra State Supply', coerceSupplyType('Intra State Supply'), 'INTRA_STATE');
eq('Intrastate', coerceSupplyType('Intrastate'), 'INTRA_STATE');
eq('Intra-City', coerceSupplyType('Intra-City'), 'INTRA_CITY');
eq('intracity', coerceSupplyType('intracity'), 'INTRA_CITY');
eq('Local', coerceSupplyType('Local'), 'INTRA_CITY');
eq('blank -> null', coerceSupplyType(''), null);
eq('gibberish -> null', coerceSupplyType('qqq'), null);

// ---------------------------------------------------------------------------
console.log('\n--- scenario 1: one company, one date, multiple products (bill no given) ---');
{
  const { bills } = parse(
    ['Date', 'Company', 'Bill No', 'Product', 'HSN', 'Qty', 'Rate'],
    [
      ['10/09/2026', 'Trivedi Enterprises', 'B001', 'Product A', '73089090', 10, 100],
      ['10/09/2026', 'Trivedi Enterprises', 'B001', 'Product B', '73089090', 5, 200],
      ['10/09/2026', 'Trivedi Enterprises', 'B001', 'Product C', '73089090', 2, 300],
    ],
  );
  eq('one invoice', bills.length, 1);
  eq('with three line items', bills[0].rows.length, 3);
  eq('external bill number kept', bills[0].externalBillNo, 'B001');
}

console.log('\n--- scenario 2: one company, different dates ---');
{
  const { bills } = parse(
    ['Date', 'Company', 'Bill No', 'Product', 'Qty', 'Rate'],
    [
      ['05/09/2026', 'Trivedi Enterprises', 'B001', 'Product A', 10, 100],
      ['05/09/2026', 'Trivedi Enterprises', 'B001', 'Product B', 5, 200],
      ['06/09/2026', 'Trivedi Enterprises', 'B002', 'Product D', 1, 400],
      ['06/09/2026', 'Trivedi Enterprises', 'B002', 'Product E', 3, 150],
    ],
  );
  eq('two invoices', bills.length, 2);
  eq('two lines each', bills.map((b) => b.rows.length), [2, 2]);
  eq('in date order', bills.map((b) => b.date.getDate()), [5, 6]);
}

console.log('\n--- scenario 3: same date, same company, SAME product, different bill numbers ---');
{
  const { bills, grouping } = parse(
    ['Date', 'Company', 'Bill No', 'Product', 'HSN', 'Qty', 'Rate'],
    [
      ['10/09/2026', 'Trivedi Enterprises', 'B001', 'Product A', '1234', 10, 100],
      ['10/09/2026', 'Trivedi Enterprises', 'B002', 'Product A', '1234', 10, 100],
      ['10/09/2026', 'Trivedi Enterprises', 'B003', 'Product A', '1234', 10, 100],
    ],
  );
  eq('grouping defaulted to bill number', grouping, 'BILL_NO');
  eq('THREE separate invoices', bills.length, 3);
  eq('one line each', bills.map((b) => b.rows.length), [1, 1, 1]);
  eq('each keeps its own bill number', bills.map((b) => b.externalBillNo).sort(), ['B001', 'B002', 'B003']);
}

console.log('\n--- scenario 4: same bill number, multiple products ---');
{
  const { bills } = parse(
    ['Date', 'Company', 'Bill No', 'Product', 'Qty', 'Rate'],
    [
      ['10/09/2026', 'Trivedi', 'B001', 'Product A', 10, 100],
      ['10/09/2026', 'Trivedi', 'B001', 'Product B', 5, 200],
      ['10/09/2026', 'Trivedi', 'B001', 'Product C', 2, 300],
    ],
  );
  eq('one invoice', bills.length, 1);
  eq('three line items', bills[0].rows.length, 3);
}

console.log('\n--- scenario 5: different companies, same date ---');
{
  const { bills } = parse(
    ['Date', 'Company', 'Bill No', 'Product', 'Qty', 'Rate'],
    [
      ['05/09/2026', 'Trivedi Enterprises', 'B001', 'Product A', 10, 100],
      ['05/09/2026', 'Reliance Industries', 'B001', 'Product C', 20, 150],
    ],
  );
  eq('two invoices, not merged by a shared bill number', bills.length, 2);
  eq('one per company', bills.map((b) => b.customerName).sort(), ['Reliance Industries', 'Trivedi Enterprises']);
}

console.log('\n--- scenario 6: the no-bill-number case must not merge ---');
{
  const rowsIn: unknown[][] = [
    ['10/09/2026', 'Trivedi Enterprises', 'Product A', '1234', 10, 100],
    ['10/09/2026', 'Trivedi Enterprises', 'Product A', '1234', 5, 100],
    ['10/09/2026', 'Trivedi Enterprises', 'Product B', '5678', 2, 200],
  ];
  const headers = ['Date', 'Company', 'Product', 'HSN', 'Qty', 'Rate'];

  const auto = parse(headers, rowsIn);
  eq('no bill number detected', hasBillNumbers(auto.parsed.rows), false);
  eq('so grouping defaults to per-row', auto.grouping, 'PER_ROW');
  eq('three separate invoices', auto.bills.length, 3);

  const forced = parse(headers, rowsIn, 'DATE_CUSTOMER');
  eq('only an explicit date+company choice merges them', forced.bills.length, 1);
  eq('into one invoice with three lines', forced.bills[0].rows.length, 3);
}

console.log('\n--- bill numbers are scoped, not global ---');
{
  const { bills } = parse(
    ['Date', 'Company', 'Bill No', 'Product', 'Qty', 'Rate'],
    [
      ['05/09/2026', 'Trivedi', '1', 'Product A', 1, 100],
      ['05/10/2026', 'Trivedi', '1', 'Product B', 1, 100],
    ],
  );
  eq('the same bill number in two months stays two invoices', bills.length, 2);
}

// ---------------------------------------------------------------------------
console.log('\n--- validation ---');
{
  const { parsed } = parse(
    ['Date', 'Company', 'Product', 'HSN', 'Qty', 'Rate', 'GST'],
    [
      ['05/09/2026', 'Trivedi', 'Product A', '73089090', 10, 100, '18%'],  // clean
      ['', 'Trivedi', 'Product B', '73089090', 1, 100, 18],                 // no date
      ['05/09/2026', '', 'Product C', '73089090', 1, 100, 18],              // no company
      ['05/09/2026', 'Trivedi', '', '73089090', 1, 100, 18],                // no product
      ['05/09/2026', 'Trivedi', 'Product E', '', 1, 100, 18],               // no HSN
      ['05/09/2026', 'Trivedi', 'Product F', '73089090', 'abc', 100, 18],   // bad qty
      ['05/09/2026', 'Trivedi', 'Product G', '73089090', 0, 100, 18],       // zero qty
      ['05/09/2026', 'Trivedi', 'Product H', '73089090', 1, 'xyz', 18],     // bad rate
      ['32/13/2026', 'Trivedi', 'Product I', '73089090', 1, 100, 18],       // bad date
      ['05/09/2026', 'Trivedi', 'Product J', '12', 1, 100, 18],             // bad HSN
      ['', '', '', '', '', '', ''],                                          // blank
      ['TOTAL', '', '', '', '', '', ''],                                     // summary line
    ],
  );
  eq('two rows skipped (blank + total)', parsed.skipped, 2);
  eq('ten rows kept', parsed.rows.length, 10);

  const errs = parsed.rows.filter((r) => !r.valid).map((r) => r.rowNumber);
  eq('seven rows rejected', errs, [3, 4, 5, 7, 8, 9, 10]);

  const find = (n: number) => parsed.rows.find((r) => r.rowNumber === n)!;
  ok('missing date reported', find(3).issues.some((i) => i.message === 'Date is missing'));
  ok('missing company reported', find(4).issues.some((i) => i.message === 'Company name is missing'));
  ok('missing product reported', find(5).issues.some((i) => i.message === 'Product name is missing'));
  ok('missing HSN is a warning, not an error', find(6).valid
    && find(6).issues.some((i) => i.severity === 'warning' && i.field === 'hsnSac'));
  ok('non-numeric qty reported', find(7).issues.some((i) => /not a number/.test(i.message)));
  ok('zero qty reported', find(8).issues.some((i) => /greater than zero/.test(i.message)));
  ok('non-numeric rate reported', find(9).issues.some((i) => /not a number/.test(i.message)));
  ok('unreadable date reported', find(10).issues.some((i) => i.field === 'date'));
  ok('2-digit HSN warned but row kept', find(11).valid
    && find(11).issues.some((i) => /only a chapter/.test(i.message)));
  eq('nothing was silently dropped', parsed.rows.length + parsed.skipped, 12);
}
{
  // Amount that disagrees with qty x rate is flagged, and qty x rate wins.
  const { parsed } = parse(
    ['Date', 'Company', 'Product', 'Qty', 'Rate', 'Amount'],
    [['05/09/2026', 'Trivedi', 'Product A', 10, 100, 9999]],
  );
  ok('amount mismatch warned', parsed.rows[0].issues.some((i) => i.field === 'amount'));
  ok('row still valid', parsed.rows[0].valid);
  eq('rate unchanged', parsed.rows[0].ratePaise, 10000);
}

console.log('\n--- duplicate rows are flagged, never merged ---');
{
  const { parsed, bills } = parse(
    ['Date', 'Company', 'Product', 'HSN', 'Qty', 'Rate'],
    [
      ['10/09/2026', 'Trivedi', 'Product A', '1234', 10, 100],
      ['10/09/2026', 'Trivedi', 'Product A', '1234', 10, 100],
    ],
  );
  const dupes = markDuplicateRows(parsed.rows);
  eq('one duplicate flagged', dupes.length, 1);
  eq('both rows still valid', parsed.rows.filter((r) => r.valid).length, 2);
  eq('and both still become invoices', bills.length, 2);
  ok('warning explains the choice', /separate bill/.test(dupes[0].message), dupes[0].message);
}

// ---------------------------------------------------------------------------
console.log('\n--- summary and preview ---');
{
  const { parsed, bills } = parse(
    ['Date', 'Company', 'Bill No', 'Product', 'Qty', 'Rate'],
    [
      ['05/09/2026', 'Trivedi Enterprises', 'B001', 'Product A', 10, 100],
      ['05/09/2026', 'Trivedi Enterprises', 'B001', 'Product B', 5, 200],
      ['05/09/2026', 'Reliance Industries', 'R001', 'Product C', 20, 150],
      ['06/09/2026', 'Trivedi Enterprises', 'B002', 'Product D', 1, 400],
      ['', 'Trivedi Enterprises', 'B003', 'Product E', 1, 100],
    ],
  );
  const s = summarise(parsed, bills);
  eq('5 rows', s.totalRows, 5);
  eq('4 valid', s.validRows, 4);
  eq('1 error', s.errorRows, 1);
  eq('2 companies', s.customers, 2);
  eq('2 dates', s.dates, 2);
  eq('3 bills', s.bills, 3);
  eq('period is September 2026', [s.periodMonth, s.periodYear], [9, 2026]);

  const groups = previewGroups(bills);
  eq('three preview rows', groups.length, 3);
  eq('first is 5 Sep Reliance', [groups[0].date, groups[0].customerName], ['2026-09-05', 'Reliance Industries']);
  eq('Trivedi 5 Sep has 1 bill / 2 lines', [groups[1].bills, groups[1].lines], [1, 2]);
  eq('and totals 2000.00', groups[1].totalPaise, 200000);
}

console.log(
  failures === 0
    ? '\nAll monthly-import checks passed.'
    : `\n${failures} check(s) FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
