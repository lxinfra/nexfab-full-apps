import type { TdsSettings } from "../ctc/tds";
import type { DeductionRuleInput, NamedAmount, PayrollOverrides, PayrollResult, Slab } from "./calc";

/** Everything printed on a slip, frozen when the month is finalised. */
export interface SlipSnapshot {
  month: number;
  year: number;
  company: {
    name: string;
    address: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    gstin: string | null;
    pan: string | null;
    tan: string | null;
    signatoryName: string | null;
    signatoryDesignation: string | null;
  };
  employee: {
    code: string;
    name: string;
    designation: string | null;
    department: string | null;
    dateOfJoining: string | null; // ISO date
    pan: string | null;
    uan: string | null;
    esiNumber: string | null;
    bankName: string | null;
    bankAccountMasked: string;
    ifsc: string | null;
  };
  result: PayrollResult;
}

/** JSON stored in PayrollEntry.manualDeductions. */
export interface StoredManualDeductions {
  rules?: Record<string, number>;
  adhoc?: NamedAmount[];
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

interface RuleRow {
  id: number;
  name: string;
  type: string;
  baseType: string | null;
  baseComponents: string | null;
  percentage: number | null;
  fixedAmount: number | null;
  slabs: string | null;
  baseCap: number | null;
  amountCap: number | null;
  eligibilityMaxGross: number | null;
  employerType: string | null;
  employerValue: number | null;
}

/** Convert a DeductionRule database row into the calculator's input shape. */
export function toRuleInput(rule: RuleRow, tds?: TdsSettings): DeductionRuleInput {
  return {
    id: rule.id,
    name: rule.name,
    type: rule.type as DeductionRuleInput["type"],
    baseType: rule.baseType as DeductionRuleInput["baseType"],
    baseComponents: parseJson<string[]>(rule.baseComponents, []),
    percentage: rule.percentage,
    fixedAmount: rule.fixedAmount,
    slabs: parseJson<Slab[]>(rule.slabs, []),
    baseCap: rule.baseCap,
    amountCap: rule.amountCap,
    eligibilityMaxGross: rule.eligibilityMaxGross,
    employerType: (rule.employerType ?? "NONE") as DeductionRuleInput["employerType"],
    employerValue: rule.employerValue,
    ...(rule.type === "TDS" && tds ? { tds } : {}),
  };
}

export type { PayrollOverrides };
