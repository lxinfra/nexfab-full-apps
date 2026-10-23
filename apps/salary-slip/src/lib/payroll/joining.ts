// Which employees belong in a payroll month, judged by their date of joining. Pure.
import { daysInMonth } from "../format";

/**
 * Paid days an employee starts a month with:
 *  - null when they join after the month (they are not part of it),
 *  - the days from the joining date to the month end in the joining month,
 *  - the whole month otherwise (including employees with no joining date).
 * Dates of joining are stored as UTC midnight.
 */
export function defaultPaidDays(dateOfJoining: Date | null, year: number, month: number): number | null {
  const total = daysInMonth(month, year);
  if (!dateOfJoining) return total;
  const joinYear = dateOfJoining.getUTCFullYear();
  const joinMonth = dateOfJoining.getUTCMonth() + 1;
  if (joinYear > year || (joinYear === year && joinMonth > month)) return null;
  if (joinYear === year && joinMonth === month) return total - (dateOfJoining.getUTCDate() - 1);
  return total;
}

export interface Period {
  year: number;
  month: number; // 1-12
}

/** Every month from `from` to `to`, both included, oldest first. */
export function monthsBetween(from: Period, to: Period): Period[] {
  const out: Period[] = [];
  for (let y = from.year, m = from.month; y < to.year || (y === to.year && m <= to.month); ) {
    out.push({ year: y, month: m });
    if (++m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
