import ExcelJS from 'exceljs';
import { handleError } from '@/lib/api';
import { prisma } from '@/lib/db';
import { getActiveCompany } from '@/lib/company-context';

/** GET a ready-made .xlsx with the expected headers and the saved products. */
export async function GET() {
  try {
    const company = await getActiveCompany();
    const products = company
      ? await prisma.product.findMany({
          where: { companyId: company.id, isActive: true },
          orderBy: { name: 'asc' },
          take: 50,
        })
      : [];

    const wb = new ExcelJS.Workbook();
    wb.creator = company?.legalName ?? 'GST Bill Generator';
    const ws = wb.addWorksheet('Items');

    ws.columns = [
      { header: 'Item', key: 'name', width: 38 },
      { header: 'Description', key: 'description', width: 34 },
      { header: 'HSN/SAC', key: 'hsn', width: 12 },
      { header: 'Qty', key: 'qty', width: 10 },
      { header: 'Unit', key: 'unit', width: 10 },
      { header: 'Rate', key: 'rate', width: 14 },
      { header: 'Discount %', key: 'discount', width: 12 },
      { header: 'GST %', key: 'gst', width: 9 },
    ];

    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF1F5F9' },
    };
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // Pre-fill the saved catalogue so only quantities need typing.
    for (const p of products) {
      ws.addRow({
        name: p.name,
        description: p.description ?? '',
        hsn: p.hsnSac ?? '',
        qty: 1,
        unit: p.unit,
        rate: p.ratePaise / 100,
        discount: 0,
        gst: p.gstRate,
      });
    }
    if (products.length === 0) {
      ws.addRow({
        name: 'Example item - replace this row',
        description: 'Optional second line printed under the item name',
        hsn: '73089090',
        qty: 2,
        unit: 'NOS',
        rate: 12500,
        discount: 0,
        gst: 18,
      });
    }

    ws.getColumn('rate').numFmt = '#,##0.00';
    ws.getColumn('qty').numFmt = '#,##0.###';

    const notes = wb.addWorksheet('How to use');
    notes.columns = [{ width: 100 }];
    [
      'Fill the Items sheet and upload it under Invoices → New → Line items → Import.',
      '',
      'Required columns: Item, Qty, Rate. Everything else is optional.',
      'Header names are matched loosely, so "Particulars", "Quantity", "Unit Price" etc. all work.',
      '',
      'Unit     - PCS, NOS, KG, MTR, LTR, BOX, SET, HRS … unknown codes become OTH.',
      'GST %    - 0, 5, 12, 18 or 28. Blank falls back to the saved product, else 18%.',
      'Discount - this column is read as a percentage. Put a ₹ amount in a column',
      '           named "Discount Amount" instead, or add a "Discount Type" column.',
      '',
      'Item names that exactly match a saved product inherit its HSN, unit, rate and',
      'GST automatically, so you can leave those cells blank.',
      '',
      'Amount / Total / CGST / SGST columns are ignored - the app recalculates them.',
    ].forEach((line) => notes.addRow([line]));

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="invoice-items-template.xlsx"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
