// The CTC statement as plain rows, shared by the screen, the PDF and the Excel file.
import type { CtcBreakup, InHandEstimate } from "./structure";

export interface StatementRow {
  label: string;
  yearly: number;
  monthly: number;
  highlight?: boolean; // Gross, Fixed CTC and Total CTC
}

/** The CTC box, in the order of the sheet. */
export function statementRows(b: CtcBreakup): StatementRow[] {
  const line = (l: { name: string; yearly: number; monthly: number }): StatementRow => ({
    label: l.name,
    yearly: l.yearly,
    monthly: l.monthly,
  });
  return [
    ...b.earnings.map(line),
    { label: "Gross Salary", ...b.gross, highlight: true },
    ...b.employer.map(line),
    { label: "Fixed CTC", ...b.fixedCtc, highlight: true },
    ...b.variable.map(line),
    { label: "Total CTC", ...b.totalCtc, highlight: true },
  ];
}

export interface InHandRow {
  label: string;
  monthly: number;
  total?: boolean;
  note?: string;
}

export function inHandRows(e: InHandEstimate, fmt: (n: number) => string): InHandRow[] {
  return [
    { label: "Gross Salary", monthly: e.gross },
    { label: "Less: Employee PF", monthly: -e.employeePf },
    { label: "Less: Employee ESI", monthly: -e.employeeEsi },
    { label: "Less: Professional Tax", monthly: -e.professionalTax },
    {
      label: "Less: TDS",
      monthly: -e.tds,
      note: e.tax.annualTax > 0 ? `Annual tax ${fmt(e.tax.annualTax)} / 12` : "No tax at this salary",
    },
    { label: "Estimated in-hand per month", monthly: e.inHand, total: true },
  ];
}

export const IN_HAND_NOTE =
  "Estimate only: a full month, new tax regime, using the company's statutory settings. " +
  "Actual payroll deductions follow the company's deduction rules.";
