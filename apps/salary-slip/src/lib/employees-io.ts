// Employee import (CSV / Excel) and export.
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { formatDate } from "./format";
import { DEFAULT_COMPONENTS } from "./validation";

const FIXED_COLUMNS: { header: string; field: string; aliases: string[] }[] = [
  { header: "Employee Code", field: "code", aliases: ["employeecode", "code", "empcode", "employeeid", "empid"] },
  { header: "Name", field: "name", aliases: ["name", "employeename"] },
  { header: "Designation", field: "designation", aliases: ["designation"] },
  { header: "Department", field: "department", aliases: ["department", "dept"] },
  { header: "Date of Joining", field: "dateOfJoining", aliases: ["dateofjoining", "doj", "joiningdate"] },
  { header: "PAN", field: "pan", aliases: ["pan", "panno", "pannumber"] },
  { header: "UAN", field: "uan", aliases: ["uan", "uanno", "uannumber"] },
  { header: "ESI Number", field: "esiNumber", aliases: ["esinumber", "esi", "esino"] },
  { header: "Bank Name", field: "bankName", aliases: ["bankname", "bank"] },
  {
    header: "Bank Account Number",
    field: "bankAccount",
    aliases: ["bankaccountnumber", "bankaccount", "accountnumber", "accountno", "bankaccountno"],
  },
  { header: "IFSC", field: "ifsc", aliases: ["ifsc", "ifsccode"] },
  { header: "Status", field: "status", aliases: ["status"] },
];

const normalise = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface ExportEmployee {
  code: string;
  name: string;
  designation: string | null;
  department: string | null;
  dateOfJoining: Date | null;
  pan: string | null;
  uan: string | null;
  esiNumber: string | null;
  bankName: string | null;
  bankAccount: string | null;
  ifsc: string | null;
  status: string;
  components: { name: string; monthlyAmount: number }[];
}

/** Header row + data rows. Salary components become one column each. */
export function buildEmployeeTable(employees: ExportEmployee[]): (string | number)[][] {
  const componentNames = [...DEFAULT_COMPONENTS];
  for (const e of employees) {
    for (const c of e.components) {
      if (!componentNames.some((n) => n.toLowerCase() === c.name.toLowerCase())) componentNames.push(c.name);
    }
  }
  const header = [...FIXED_COLUMNS.map((c) => c.header), ...componentNames];
  const rows = employees.map((e) => {
    const fixed = FIXED_COLUMNS.map((c) => {
      if (c.field === "dateOfJoining") return formatDate(e.dateOfJoining);
      if (c.field === "status") return e.status === "ACTIVE" ? "Active" : "Inactive";
      return (e[c.field as keyof ExportEmployee] as string | null) ?? "";
    });
    const amounts = componentNames.map((n) => {
      const c = e.components.find((x) => x.name.toLowerCase() === n.toLowerCase());
      return c ? c.monthlyAmount : "";
    });
    return [...fixed, ...amounts];
  });
  return [header, ...rows];
}

export async function tableToXlsx(table: (string | number)[][], sheetName: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  table.forEach((row) => ws.addRow(row));
  ws.getRow(1).font = { bold: true };
  ws.columns.forEach((col, i) => {
    const longest = Math.max(...table.map((r) => String(r[i] ?? "").length));
    col.width = Math.min(Math.max(longest + 2, 10), 40);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function tableToCsv(table: (string | number)[][]): string {
  // The BOM makes Excel read the file as UTF-8.
  return "﻿" + Papa.unparse(table);
}

function cellText(value: ExcelJS.CellValue, text: string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text.trim();
}

/** Read an uploaded .csv or .xlsx file into rows of text cells. */
export async function readTable(fileName: string, data: ArrayBuffer): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) {
    const text = new TextDecoder("utf-8").decode(data).replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    return parsed.data.map((row) => row.map((c) => String(c ?? "").trim()));
  }
  if (lower.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let i = 1; i <= ws.columnCount; i++) {
        const cell = row.getCell(i);
        cells.push(cellText(cell.value, cell.text ?? ""));
      }
      if (cells.some((c) => c !== "")) rows.push(cells);
    });
    return rows;
  }
  throw new Error("Please upload a .csv or .xlsx file.");
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY and DD-MM-YYYY; returns YYYY-MM-DD (or the input if unrecognised). */
function normaliseDate(value: string): string {
  const m = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return value;
}

export interface ImportRow {
  rowNumber: number; // as seen in the spreadsheet (header is row 1)
  data: Record<string, unknown>;
  error?: string;
}

/** Map spreadsheet rows to the shape expected by employeeSchema. */
export function mapImportRows(table: string[][]): { rows: ImportRow[]; hasComponents: boolean } {
  if (table.length === 0) throw new Error("The file is empty.");
  const header = table[0];
  const columns = header.map((h) => {
    const fixed = FIXED_COLUMNS.find((c) => c.aliases.includes(normalise(h)));
    return fixed ? { kind: "field" as const, field: fixed.field } : { kind: "component" as const, name: h.trim() };
  });
  for (const needed of ["code", "name"]) {
    if (!columns.some((c) => c.kind === "field" && c.field === needed)) {
      const label = FIXED_COLUMNS.find((c) => c.field === needed)!.header;
      throw new Error(`The file has no "${label}" column. Download the template to see the expected columns.`);
    }
  }
  const hasComponents = columns.some((c) => c.kind === "component" && c.name !== "");

  const rows: ImportRow[] = table.slice(1).map((cells, index) => {
    const data: Record<string, unknown> = { status: "ACTIVE" };
    const components: { name: string; monthlyAmount: number }[] = [];
    let error: string | undefined;

    columns.forEach((col, i) => {
      const value = (cells[i] ?? "").trim();
      if (col.kind === "field") {
        if (col.field === "dateOfJoining") data.dateOfJoining = normaliseDate(value);
        else if (col.field === "status") {
          const v = value.toLowerCase();
          data.status = v === "" || v === "active" ? "ACTIVE" : v === "inactive" ? "INACTIVE" : value;
        } else data[col.field] = value;
      } else if (col.name !== "" && value !== "") {
        const amount = Number(value.replace(/,/g, ""));
        if (Number.isNaN(amount)) error = `"${col.name}" must be a number (found "${value}").`;
        else components.push({ name: col.name, monthlyAmount: amount });
      }
    });

    data.components = components;
    return { rowNumber: index + 2, data, error };
  });

  return { rows, hasComponents };
}
