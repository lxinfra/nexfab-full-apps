/** Dev helper: dump every sheet of a workbook so its layout can be inspected. */
import ExcelJS from 'exceljs';

const file = process.argv[2];

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return cellText(o.result as ExcelJS.CellValue);
    if ('richText' in o) return (o.richText as { text: string }[]).map((t) => t.text).join('');
    if ('text' in o) return String(o.text);
    if ('error' in o) return `#ERR`;
  }
  return String(v);
}

async function main() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  for (const ws of wb.worksheets) {
    console.log(`\n===== SHEET "${ws.name}"  rows=${ws.rowCount} cols=${ws.columnCount} =====`);
    const merges = (ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? [];
    if (merges.length) console.log('merges:', merges.slice(0, 30).join(', '));
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = Array.isArray(row.values) ? row.values.slice(1) : [];
      const cells = vals.map((v) => cellText(v as ExcelJS.CellValue).replace(/\s+/g, ' ').trim());
      if (cells.every((c) => c === '')) {
        console.log(String(n).padStart(3), '|');
        return;
      }
      console.log(String(n).padStart(3), '|', cells.map((c, i) => `[${i}] ${c}`).join('  '));
    });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
