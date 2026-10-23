// Monthly payroll register: all employees, all components.
import ExcelJS from "exceljs";
import { prisma } from "./db";
import { monthLabel } from "./format";
import { calculatePayroll, type PayrollResult } from "./payroll/calc";
import { entryToInput, loadCalculation, loadRun } from "./payroll/service";
import { parseJson, type SlipSnapshot } from "./payroll/types";

export interface RegisterRow {
  code: string;
  name: string;
  designation: string;
  department: string;
  result: PayrollResult;
}

export interface Register {
  status: string;
  month: number;
  year: number;
  earningNames: string[];
  deductionNames: string[];
  employerNames: string[];
  rows: RegisterRow[];
}

const addName = (list: string[], name: string) => {
  if (!list.includes(name)) list.push(name);
};

export async function buildRegister(companyId: number, year: number, month: number): Promise<Register | null> {
  const run = await loadRun(companyId, year, month);
  if (!run) return null;

  let rows: RegisterRow[];
  if (run.status === "FINALISED") {
    // Finalised months are reported exactly as issued.
    const slips = await prisma.slip.findMany({
      where: { runId: run.id },
      select: { snapshot: true },
      orderBy: { employeeCode: "asc" },
    });
    rows = slips.map((s) => {
      const snap = parseJson<SlipSnapshot | null>(s.snapshot, null)!;
      return {
        code: snap.employee.code,
        name: snap.employee.name,
        designation: snap.employee.designation ?? "",
        department: snap.employee.department ?? "",
        result: snap.result,
      };
    });
  } else {
    const calc = await loadCalculation(run);
    rows = run.entries.map((entry) => ({
      code: entry.employee.code,
      name: entry.employee.name,
      designation: entry.employee.designation ?? "",
      department: entry.employee.department ?? "",
      result: calculatePayroll(entryToInput(entry, calc)),
    }));
  }

  const earningNames: string[] = [];
  const deductionNames: string[] = [];
  const employerNames: string[] = [];
  for (const r of rows) {
    r.result.earnings.forEach((e) => addName(earningNames, e.name));
    r.result.deductions.forEach((d) => addName(deductionNames, d.name));
    r.result.employerContributions.forEach((e) => addName(employerNames, e.name));
  }
  return { status: run.status, month, year, earningNames, deductionNames, employerNames, rows };
}

const amountOf = (lines: { name: string; amount: number }[], name: string) =>
  lines.filter((l) => l.name === name).reduce((a, l) => a + l.amount, 0);

/** Header + one row per employee + a totals row, as plain values. */
export function registerTable(reg: Register): { header: string[]; rows: (string | number)[][]; totals: (string | number)[] } {
  const header = [
    "Code",
    "Name",
    "Designation",
    "Department",
    "Total Days",
    "Paid Days",
    "LOP Days",
    ...reg.earningNames,
    "Gross Earnings",
    ...reg.deductionNames,
    "Total Deductions",
    "Net Pay",
    ...reg.employerNames.map((n) => `Employer ${n}`),
  ];
  const rows = reg.rows.map((r) => [
    r.code,
    r.name,
    r.designation,
    r.department,
    r.result.totalDays,
    r.result.paidDays,
    r.result.lopDays,
    ...reg.earningNames.map((n) => amountOf(r.result.earnings, n)),
    r.result.gross,
    ...reg.deductionNames.map((n) => amountOf(r.result.deductions, n)),
    r.result.totalDeductions,
    r.result.netPay,
    ...reg.employerNames.map((n) => amountOf(r.result.employerContributions, n)),
  ]);
  const FIRST_AMOUNT = 7;
  const totals: (string | number)[] = header.map((_, i) => {
    if (i === 0) return "Total";
    if (i < FIRST_AMOUNT) return "";
    return rows.reduce((a, row) => a + (Number(row[i]) || 0), 0);
  });
  return { header, rows, totals };
}

const INR_FORMAT = "[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0";

export async function registerToXlsx(reg: Register, companyName: string): Promise<Buffer> {
  const { header, rows, totals } = registerTable(reg);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Payroll Register");

  ws.addRow([companyName]).font = { bold: true, size: 14 };
  ws.addRow([
    `Payroll Register - ${monthLabel(reg.month, reg.year)}${reg.status === "FINALISED" ? "" : " (DRAFT - not finalised)"}`,
  ]).font = { bold: true };
  ws.addRow([]);

  const headerRow = ws.addRow(header);
  headerRow.font = { bold: true };
  headerRow.alignment = { wrapText: true, vertical: "middle" };
  headerRow.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    c.border = { bottom: { style: "thin" } };
  });

  rows.forEach((r) => ws.addRow(r));
  const totalRow = ws.addRow(totals);
  totalRow.font = { bold: true };
  totalRow.eachCell((c) => {
    c.border = { top: { style: "thin" } };
  });

  ws.columns.forEach((col, i) => {
    col.width = i === 1 ? 26 : i < 4 ? 16 : 14;
    if (i >= 7) col.numFmt = INR_FORMAT;
  });
  ws.views = [{ state: "frozen", xSplit: 2, ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
