// All salary calculation logic lives in this file. It is pure: no database,
// no dates, no I/O. The same function runs in the browser (live review table)
// and on the server (save / finalise).
//
// Rules of the calculation:
//  - Each earning component is pro-rated by paidDays / totalDays.
//  - Every component (earning, deduction, employer contribution) is rounded to
//    the nearest rupee on its own; totals are sums of the rounded components.
//  - Percentage and slab rules work on EARNED (pro-rated) amounts.
//  - The eligibility condition compares the employee's full MONTHLY gross
//    (the salary structure, before pro-rating) with the rule's limit.
//  - TDS rules tax the full monthly gross x 12 under the company's tax settings
//    and deduct one twelfth each month; they are not pro-rated.
import { computeTax, type TdsSettings } from "../ctc/tds";

export type RuleType = "PERCENTAGE" | "FIXED" | "SLAB" | "MANUAL" | "TDS";
export type BaseType = "BASIC" | "GROSS" | "COMPONENTS";
export type EmployerType = "NONE" | "PERCENTAGE" | "FIXED";

export interface EarningComponent {
  name: string;
  monthlyAmount: number;
}

export interface NamedAmount {
  name: string;
  amount: number;
}

export interface Slab {
  from: number; // inclusive
  to: number | null; // inclusive; null = no upper limit
  amount: number;
}

export interface DeductionRuleInput {
  id: number;
  name: string;
  type: RuleType;
  baseType?: BaseType | null;
  baseComponents?: string[];
  percentage?: number | null;
  fixedAmount?: number | null;
  slabs?: Slab[];
  baseCap?: number | null;
  amountCap?: number | null;
  eligibilityMaxGross?: number | null;
  employerType?: EmployerType | null;
  employerValue?: number | null;
  /** Tax settings for TDS rules. */
  tds?: TdsSettings | null;
}

export interface PayrollOverrides {
  earnings?: Record<string, number>; // component name -> earned amount
  deductions?: Record<string, number>; // rule name -> amount
}

export interface PayrollInput {
  totalDays: number;
  paidDays: number;
  components: EarningComponent[];
  arrears?: number;
  oneTimeEarnings?: NamedAmount[];
  /** Rules that apply to this employee (already filtered for "selected employees"). */
  rules?: DeductionRuleInput[];
  /** Amounts typed in for MANUAL rules this month, keyed by rule id. */
  manualAmounts?: Record<string, number>;
  /** One-off deductions for this month that are not backed by a rule. */
  adhocDeductions?: NamedAmount[];
  overrides?: PayrollOverrides;
}

export interface EarningLine {
  name: string;
  /** Full monthly amount from the salary structure (null for arrears / one-time). */
  fullAmount: number | null;
  amount: number;
  overridden?: boolean;
}

export interface DeductionLine {
  name: string;
  amount: number;
  ruleId?: number;
  manual?: boolean;
  overridden?: boolean;
}

export interface PayrollResult {
  totalDays: number;
  paidDays: number;
  lopDays: number;
  earnings: EarningLine[];
  deductions: DeductionLine[];
  employerContributions: NamedAmount[];
  monthlyGross: number;
  gross: number;
  totalDeductions: number;
  netPay: number;
  warnings: string[];
}

/** Round to the nearest rupee (halves round up). */
export function roundRupee(n: number): number {
  if (!Number.isFinite(n)) return 0;
  // toFixed(6) removes floating-point noise such as 499.99999999997.
  return Math.round(Number(n.toFixed(6)));
}

export function proRate(monthlyAmount: number, paidDays: number, totalDays: number): number {
  if (totalDays <= 0) return 0;
  return roundRupee((monthlyAmount * paidDays) / totalDays);
}

export function findSlabAmount(slabs: Slab[], value: number): number {
  const slab = slabs.find((s) => value >= s.from && (s.to === null || value <= s.to));
  return slab ? slab.amount : 0;
}

const sum = (nums: number[]) => nums.reduce((a, b) => a + b, 0);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** "Basic", "Basic Salary", "Basic_Salary" and "Basic Pay" all count as the Basic component. */
export function isBasicName(name: string): boolean {
  return ["basic", "basicsalary", "basicpay"].includes(name.toLowerCase().replace(/[^a-z]/g, ""));
}

export function calculatePayroll(input: PayrollInput): PayrollResult {
  const { totalDays, paidDays } = input;
  if (!(totalDays > 0)) throw new Error("Total days must be greater than zero.");
  if (!(paidDays >= 0) || paidDays > totalDays) {
    throw new Error("Paid days must be between 0 and the total days in the month.");
  }

  const warnings: string[] = [];
  const earningOverrides = input.overrides?.earnings ?? {};
  const deductionOverrides = input.overrides?.deductions ?? {};

  // ---- Earnings ----
  const componentLines: EarningLine[] = input.components.map((c) => {
    const override = earningOverrides[c.name];
    const hasOverride = override !== undefined && override !== null;
    return {
      name: c.name,
      fullAmount: roundRupee(c.monthlyAmount),
      amount: hasOverride ? roundRupee(override) : proRate(c.monthlyAmount, paidDays, totalDays),
      ...(hasOverride ? { overridden: true } : {}),
    };
  });

  const extraLines: EarningLine[] = [];
  const arrears = roundRupee(input.arrears ?? 0);
  if (arrears !== 0) extraLines.push({ name: "Arrears", fullAmount: null, amount: arrears });
  for (const e of input.oneTimeEarnings ?? []) {
    const amount = roundRupee(e.amount);
    if (amount !== 0) extraLines.push({ name: e.name, fullAmount: null, amount });
  }

  const earnings = [...componentLines, ...extraLines];
  const gross = sum(earnings.map((e) => e.amount));
  const monthlyGross = sum(componentLines.map((e) => e.fullAmount ?? 0));

  const baseFor = (rule: DeductionRuleInput): number => {
    let base: number;
    switch (rule.baseType) {
      case "BASIC":
        base = sum(componentLines.filter((c) => isBasicName(c.name)).map((c) => c.amount));
        break;
      case "COMPONENTS": {
        const names = rule.baseComponents ?? [];
        base = sum(
          componentLines.filter((c) => names.some((n) => sameName(n, c.name))).map((c) => c.amount),
        );
        break;
      }
      default:
        base = gross;
    }
    if (rule.baseCap != null) base = Math.min(base, rule.baseCap);
    return base;
  };

  // ---- Deductions ----
  const deductions: DeductionLine[] = [];
  const employerContributions: NamedAmount[] = [];

  for (const rule of input.rules ?? []) {
    if (rule.eligibilityMaxGross != null && monthlyGross > rule.eligibilityMaxGross) continue;

    const base = baseFor(rule);
    let amount: number;
    switch (rule.type) {
      case "PERCENTAGE":
        amount = roundRupee((base * (rule.percentage ?? 0)) / 100);
        break;
      case "FIXED":
        amount = roundRupee(rule.fixedAmount ?? 0);
        break;
      case "SLAB":
        amount = roundRupee(findSlabAmount(rule.slabs ?? [], base));
        break;
      case "MANUAL":
        amount = roundRupee(input.manualAmounts?.[String(rule.id)] ?? 0);
        break;
      case "TDS":
        amount = rule.tds ? computeTax(monthlyGross * 12, rule.tds).monthlyTds : 0;
        break;
    }
    if (rule.amountCap != null) amount = Math.min(amount, roundRupee(rule.amountCap));

    const override = deductionOverrides[rule.name];
    const hasOverride = override !== undefined && override !== null;
    if (hasOverride) amount = roundRupee(override);

    deductions.push({
      name: rule.name,
      amount,
      ruleId: rule.id,
      ...(rule.type === "MANUAL" ? { manual: true } : {}),
      ...(hasOverride ? { overridden: true } : {}),
    });

    // Employer contribution: shown separately, never deducted from net pay.
    if (rule.employerType === "PERCENTAGE") {
      employerContributions.push({
        name: rule.name,
        amount: roundRupee((base * (rule.employerValue ?? 0)) / 100),
      });
    } else if (rule.employerType === "FIXED") {
      employerContributions.push({ name: rule.name, amount: roundRupee(rule.employerValue ?? 0) });
    }
  }

  for (const d of input.adhocDeductions ?? []) {
    const amount = roundRupee(d.amount);
    if (amount !== 0) deductions.push({ name: d.name, amount });
  }

  const totalDeductions = sum(deductions.map((d) => d.amount));
  const netPay = gross - totalDeductions;
  if (netPay < 0) warnings.push("Net pay is negative: deductions are more than earnings.");

  return {
    totalDays,
    paidDays,
    lopDays: Number((totalDays - paidDays).toFixed(2)),
    earnings,
    deductions,
    employerContributions,
    monthlyGross,
    gross,
    totalDeductions,
    netPay,
    warnings,
  };
}
