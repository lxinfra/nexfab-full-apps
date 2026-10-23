/**
 * Writes a monthly details sheet that exercises every grouping scenario.
 *
 *   npx tsx scripts/make-monthly-sample.ts
 *
 * Produces samples/monthly-sample-sep-2026.xlsx. Deliberately messy: unusual
 * header spellings, mixed date formats, a blank row, a TOTAL line and a handful
 * of invalid rows, so the validation report has something to report.
 */
import ExcelJS from 'exceljs';
import { mkdir } from 'node:fs/promises';

const rows: (string | number)[][] = [
  // Scenario 1 + 4: one bill, three products -> ONE invoice with 3 lines.
  ['05/09/2026', 'Trivedi Enterprises', 'B001', 'Pet Preform 28mm', 'Preform, 28mm neck', '39233090', 'KG', 1920, 108, '18%', 'Intra-State'],
  ['05/09/2026', 'Trivedi Enterprises', 'B001', 'Pet Preform 30mm', '', '39233090', 'KG', 500, 112, '18%', 'Intra-State'],
  ['05/09/2026', 'Trivedi Enterprises', 'B001', 'Bottle Caps', '', '39235010', 'NOS', 10000, 1.5, '18%', 'Intra-State'],

  // Scenario 5: different company, same date -> its own invoice.
  ['05/09/2026', 'Masar Beverages', 'M001', 'Pet Preform 28mm', '', '39233090', 'KG', 800, 108, '18%', 'Intra-City'],

  // Scenario 2: same company, next day, new bill -> separate invoice.
  ['06/09/2026', 'Trivedi Enterprises', 'B002', 'Shrink Film', '', '39206920', 'KG', 250, 145, 18, 'Intra-State'],
  ['06/09/2026', 'Trivedi Enterprises', 'B002', 'Carton Box', '', '48191010', 'NOS', 400, 22, 18, 'Intra-State'],

  // Scenario 3: same date, same company, SAME product, SAME rate, three bill
  // numbers -> must stay THREE invoices.
  ['10-Sep-2026', 'Trivedi Enterprises', 'B003', 'Pet Preform 28mm', '', '39233090', 'KG', 100, 108, 18, 'Intra-State'],
  ['10-Sep-2026', 'Trivedi Enterprises', 'B004', 'Pet Preform 28mm', '', '39233090', 'KG', 100, 108, 18, 'Intra-State'],
  ['10-Sep-2026', 'Trivedi Enterprises', 'B005', 'Pet Preform 28mm', '', '39233090', 'KG', 100, 108, 18, 'Intra-State'],

  // A third company, 5% slab, and an Excel-native date cell further down.
  ['12/09/2026', 'Veracity Engineering Pvt Ltd', 'V001', 'Structural Fabrication', 'Site work', '73089090', 'KG', 2500, 95, '18%', 'Intra-State'],
  ['12/09/2026', 'Veracity Engineering Pvt Ltd', 'V002', 'Welding Consumables', '', '83112000', 'KG', 60, 310, '18%', 'Intra-State'],

  // Blank row in the middle of the data.
  ['', '', '', '', '', '', '', '', '', '', ''],

  // Intra-city, another day.
  ['15/09/2026', 'Masar Beverages', 'M002', 'Bottle Caps', '', '39235010', 'NOS', 25000, 1.5, '18%', 'Intra-City'],

  // --- rows that must be reported, not silently dropped ---
  ['', 'Trivedi Enterprises', 'B006', 'Pet Preform 28mm', '', '39233090', 'KG', 10, 108, 18, 'Intra-State'],          // no date
  ['18/09/2026', '', 'B007', 'Pet Preform 28mm', '', '39233090', 'KG', 10, 108, 18, 'Intra-State'],                   // no company
  ['18/09/2026', 'Trivedi Enterprises', 'B008', '', '', '39233090', 'KG', 10, 108, 18, 'Intra-State'],                // no product
  ['18/09/2026', 'Trivedi Enterprises', 'B009', 'Mystery Item', '', '', 'KG', 10, 108, 18, 'Intra-State'],            // no HSN (warning only)
  ['18/09/2026', 'Trivedi Enterprises', 'B010', 'Bad Qty Item', '', '39233090', 'KG', 'abc', 108, 18, 'Intra-State'], // qty not a number
  ['18/09/2026', 'Trivedi Enterprises', 'B011', 'Zero Qty Item', '', '39233090', 'KG', 0, 108, 18, 'Intra-State'],    // zero qty
  ['18/09/2026', 'Trivedi Enterprises', 'B012', 'Bad Rate Item', '', '39233090', 'KG', 5, 'xyz', 18, 'Intra-State'],  // rate not a number
  ['32/13/2026', 'Trivedi Enterprises', 'B013', 'Bad Date Item', '', '39233090', 'KG', 5, 108, 18, 'Intra-State'],    // impossible date
  ['18/09/2026', 'Trivedi Enterprises', 'B014', 'Short HSN Item', '', '39', 'KG', 5, 108, 18, 'Intra-State'],         // 2-digit HSN (warning)

  // A trailing summary line, as sheets usually have.
  ['TOTAL', '', '', '', '', '', '', '', '', '', ''],
];

async function main() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sep 2026');

  // A merged banner above the header, which the header detector has to skip.
  ws.addRow(['MONTHLY SALES DETAILS - SEPTEMBER 2026']);
  ws.mergeCells('A1:K1');

  // Headers written the way a real sheet would, not the way the code expects.
  ws.addRow([
    'Invoice Date', 'Party Name', 'Bill No.', 'Item Name', 'Product Description',
    'HSN/SAC', 'UOM', 'Quantity', 'Unit Price', 'Tax %', 'Type of Supply',
  ]);

  for (const r of rows) ws.addRow(r);

  // Make one date a real Excel date cell rather than text, so both paths run.
  const target = ws.getRow(12).getCell(1);
  target.value = new Date(2026, 8, 12, 12, 0, 0);
  target.numFmt = 'dd/mm/yyyy';

  await mkdir('samples', { recursive: true });
  const out = 'samples/monthly-sample-sep-2026.xlsx';
  await wb.xlsx.writeFile(out);
  console.log(`wrote ${out} — ${rows.length} data rows under a 2-row preamble`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
