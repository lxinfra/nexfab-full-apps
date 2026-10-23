/** RFC-4180 CSV. Excel opens this directly; the BOM keeps ₹ and names intact. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          const v = cell === null || cell === undefined ? '' : String(cell);
          return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(','),
    )
    .join('\r\n');
  return '\uFEFF' + body;
}

export function csvResponse(filename: string, csv: string): Response {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
