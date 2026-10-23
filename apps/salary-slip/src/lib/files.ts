import { monthName } from "./format";

/** Make a string safe to use as a download file name. */
export function safeFileName(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9 ._-]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "file"
  );
}

type SlipName = { employeeCode: string; employeeName: string; month: number; year: number };

/** "Employee Name - EMP001 - Salary Slip.pdf" */
export function slipFileName(slip: SlipName): string {
  return safeFileName(`${slip.employeeName} - ${slip.employeeCode} - Salary Slip`) + ".pdf";
}

/** The same with the month added, for a ZIP that holds several months of one employee. */
export function slipFileNameWithMonth(slip: SlipName): string {
  return (
    safeFileName(
      `${slip.employeeName} - ${slip.employeeCode} - Salary Slip - ${monthName(slip.month).slice(0, 3)} ${slip.year}`,
    ) + ".pdf"
  );
}
