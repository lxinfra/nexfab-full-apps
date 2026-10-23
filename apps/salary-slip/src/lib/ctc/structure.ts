// CTC structure: turns a template + a CTC into a salary breakup. Pure: no
// database, no dates (the PF ceiling for the relevant date is passed in).
//
// How it works:
//  - Total CTC = Fixed CTC + variable pay.
//  - Fixed CTC = Gross + employer contributions (PF, ESIC, ...).
//  - Gross = sum of the earning components. One earning is the "balancing"
//    component and takes whatever is left of Gross.
//  - Gross depends on the employer contributions, which depend on Basic, which
//    can itself be a % of Gross. This circle is solved by repeating the
//    calculation until the figures stop changing.
//  - Each column (monthly, yearly) is rounded to the rupee per component, and
//    the balancing component absorbs the rounding so the totals always add up.
import { isBasicName, roundRupee } from "../payroll/calc";
import { computeTax, type TaxComputation } from "./tds";
import { pfCeilingOn, professionalTax, type StatutorySettings } from "./settings";

export type ComponentKind = "EARNING" | "EMPLOYER" | "VARIABLE";
export type CalcMethod =
  | "PCT_CTC"
  | "PCT_GROSS"
  | "PCT_BASIC"
  | "FIXED"
  | "BALANCING"
  | "EMPLOYER_PF" // statutory: PF rate on Basic, up to the PF wage ceiling
  | "EMPLOYER_ESIC"; // statutory: ESI rate on Gross, only up to the ESI gross limit

export interface ComponentCondition {
  basis: "BASIC" | "GROSS" | "CTC"; // monthly figure that is compared
  op: "LTE" | "GTE";
  /** AMOUNT = the monthly amount below; STAT_BONUS_LIMIT = the company's "Min Basic for Stat Bonus". */
  source: "AMOUNT" | "STAT_BONUS_LIMIT";
  amount?: number | null;
}

export interface TemplateComponent {
  name: string;
  kind: ComponentKind;
  method: CalcMethod;
  /** Percent for the PCT_* methods, monthly rupees for FIXED; unused otherwise. */
  value: number;
  condition?: ComponentCondition | null;
}

/** The statutory figures the solver needs, already resolved for a date. */
export interface SolveParams {
  pfEmployerRate: number;
  pfCeiling: number | null; // null = PF on actual Basic
  esiEmployerRate: number;
  esiGrossLimit: number;
  gratuityRate: number;
  statBonusBasicLimitMonthly: number;
}

export function solveParams(settings: StatutorySettings, asOf: string): SolveParams {
  return {
    pfEmployerRate: settings.pfEmployerRate,
    pfCeiling: pfCeilingOn(settings, asOf),
    esiEmployerRate: settings.esiEmployerRate,
    esiGrossLimit: settings.esiGrossLimit,
    gratuityRate: settings.gratuityRate,
    statBonusBasicLimitMonthly: settings.minBasicStatBonusYearly / 12,
  };
}

export interface Amounts {
  monthly: number;
  yearly: number;
}

export interface CtcLine extends Amounts {
  name: string;
  balancing?: boolean;
}

export interface CtcBreakup {
  earnings: CtcLine[];
  gross: Amounts;
  employer: CtcLine[];
  fixedCtc: Amounts;
  variable: CtcLine[];
  totalCtc: Amounts;
  /** Shown below the CTC box; not part of the CTC. */
  gratuity: Amounts;
  /** Monthly Basic before rounding (used for PF). */
  basicMonthly: number;
  pfCeiling: number | null;
}

export type SolveResult = { ok: true; breakup: CtcBreakup } | { ok: false; error: string };

const EARNING_METHODS: CalcMethod[] = ["PCT_CTC", "PCT_GROSS", "PCT_BASIC", "FIXED", "BALANCING"];
const EMPLOYER_METHODS: CalcMethod[] = ["PCT_CTC", "PCT_GROSS", "PCT_BASIC", "FIXED", "EMPLOYER_PF", "EMPLOYER_ESIC"];
const VARIABLE_METHODS: CalcMethod[] = ["PCT_CTC", "FIXED"];
const USES_VALUE: CalcMethod[] = ["PCT_CTC", "PCT_GROSS", "PCT_BASIC", "FIXED"];

/** Problems with a template, in plain words. Empty = the template is usable. */
export function validateTemplate(components: TemplateComponent[]): string[] {
  const errors: string[] = [];
  if (components.length === 0) return ["Add at least one component."];

  const seen = new Set<string>();
  for (const c of components) {
    const name = c.name.trim();
    if (!name) {
      errors.push("Every component needs a name.");
      continue;
    }
    if (seen.has(name.toLowerCase())) errors.push(`"${name}" is listed twice.`);
    seen.add(name.toLowerCase());

    const allowed = c.kind === "EARNING" ? EARNING_METHODS : c.kind === "EMPLOYER" ? EMPLOYER_METHODS : VARIABLE_METHODS;
    if (!allowed.includes(c.method)) {
      errors.push(`"${name}": this calculation method cannot be used for this type of component.`);
    }
    if (USES_VALUE.includes(c.method)) {
      if (!Number.isFinite(c.value) || c.value < 0) errors.push(`"${name}": enter a value of zero or more.`);
      else if (c.method !== "FIXED" && c.value > 100) errors.push(`"${name}": a percentage cannot be more than 100.`);
    }
    if (c.condition?.source === "AMOUNT" && !(Number(c.condition.amount) >= 0 && c.condition.amount != null)) {
      errors.push(`"${name}": enter the amount for its condition.`);
    }
  }

  const balancing = components.filter((c) => c.method === "BALANCING");
  if (balancing.length === 0) {
    errors.push("Mark one earning as the balancing component, so the total always matches the CTC.");
  } else if (balancing.length > 1) {
    errors.push("Only one component can be the balancing component.");
  } else if (balancing[0].condition) {
    errors.push("The balancing component cannot have a condition.");
  }

  const basics = components.filter((c) => c.kind === "EARNING" && isBasicName(c.name));
  const needsBasic = components.some(
    (c) => c.method === "PCT_BASIC" || c.method === "EMPLOYER_PF" || c.condition?.basis === "BASIC",
  );
  if (basics.length > 1) errors.push("Only one earning can be the Basic salary.");
  if (needsBasic && basics.length === 0) {
    errors.push('Some components depend on Basic, so add an earning named "Basic" or "Basic Salary".');
  }
  if (basics.length === 1 && (basics[0].method === "PCT_BASIC" || basics[0].method === "BALANCING")) {
    errors.push("Basic must be a % of CTC, a % of Gross or a fixed amount.");
  }
  return errors;
}

const rupees = (n: number) => roundRupee(n).toLocaleString("en-IN");

/** Work out the breakup for a yearly CTC. */
export function solveCtc(ctcYearly: number, components: TemplateComponent[], params: SolveParams): SolveResult {
  const invalid = validateTemplate(components);
  if (invalid.length > 0) return { ok: false, error: invalid[0] };
  if (!Number.isFinite(ctcYearly) || ctcYearly <= 0) return { ok: false, error: "Enter a CTC greater than zero." };

  const ctc = ctcYearly / 12; // everything below is monthly and unrounded
  const basicComponent = components.find((c) => c.kind === "EARNING" && isBasicName(c.name));

  const eligible = (c: TemplateComponent, gross: number, basic: number) => {
    if (!c.condition) return true;
    const actual = c.condition.basis === "BASIC" ? basic : c.condition.basis === "GROSS" ? gross : ctc;
    const limit =
      c.condition.source === "STAT_BONUS_LIMIT" ? params.statBonusBasicLimitMonthly : (c.condition.amount ?? 0);
    // A tiny tolerance so a figure that equals the limit is not lost to floating point.
    return c.condition.op === "LTE" ? actual <= limit + 1e-6 : actual >= limit - 1e-6;
  };

  const valueOf = (c: TemplateComponent, gross: number, basic: number): number => {
    if (!eligible(c, gross, basic)) return 0;
    switch (c.method) {
      case "PCT_CTC":
        return (ctc * c.value) / 100;
      case "PCT_GROSS":
        return (gross * c.value) / 100;
      case "PCT_BASIC":
        return (basic * c.value) / 100;
      case "FIXED":
        return c.value;
      case "EMPLOYER_PF":
        return (Math.min(basic, params.pfCeiling ?? Infinity) * params.pfEmployerRate) / 100;
      case "EMPLOYER_ESIC":
        return gross <= params.esiGrossLimit + 1e-6 ? (gross * params.esiEmployerRate) / 100 : 0;
      case "BALANCING":
        return 0; // filled in at the end
    }
  };

  // Repeat until Gross and Basic stop changing.
  let gross = ctc;
  let basic = 0;
  let stable = false;
  for (let i = 0; i < 200 && !stable; i++) {
    const nextBasic = basicComponent ? valueOf(basicComponent, gross, basic) : 0;
    const outside = components
      .filter((c) => c.kind !== "EARNING")
      .reduce((sum, c) => sum + valueOf(c, gross, nextBasic), 0);
    const nextGross = ctc - outside;
    stable = Math.abs(nextGross - gross) < 0.0005 && Math.abs(nextBasic - basic) < 0.0005;
    gross = nextGross;
    basic = nextBasic;
  }
  if (!stable) {
    return {
      ok: false,
      error: "This structure does not settle on stable figures for this CTC. Check the percentages and conditions.",
    };
  }
  if (gross <= 0) {
    return { ok: false, error: "Employer contributions and variable pay use up the whole CTC. Increase the CTC." };
  }

  // Round each column per component; derived rows are sums of rounded figures.
  const column = (factor: number) => {
    const amount = (c: TemplateComponent) => roundRupee(valueOf(c, gross, basic) * factor);
    const of = (kind: ComponentKind) => components.filter((c) => c.kind === kind);
    const variable = of("VARIABLE").map((c) => ({ name: c.name, amount: amount(c) }));
    const employer = of("EMPLOYER").map((c) => ({ name: c.name, amount: amount(c) }));
    const totalCtc = roundRupee(ctc * factor);
    const fixedCtc = totalCtc - variable.reduce((a, l) => a + l.amount, 0);
    const grossAmount = fixedCtc - employer.reduce((a, l) => a + l.amount, 0);
    const others = of("EARNING").map((c) => ({
      name: c.name,
      balancing: c.method === "BALANCING",
      amount: c.method === "BALANCING" ? 0 : amount(c),
    }));
    const left = grossAmount - others.reduce((a, l) => a + l.amount, 0);
    const earnings = others.map((l) => (l.balancing ? { ...l, amount: left } : l));
    return { variable, employer, totalCtc, fixedCtc, gross: grossAmount, earnings, gratuity: roundRupee(((basic * params.gratuityRate) / 100) * factor) };
  };
  const m = column(1);
  const y = column(12);

  const balancing = m.earnings.find((l) => l.balancing)!;
  if (balancing.amount < 0 || y.earnings.find((l) => l.balancing)!.amount < 0) {
    return {
      ok: false,
      error:
        `"${balancing.name}" would be negative (₹${rupees(balancing.amount)} a month): the other components add up to ` +
        `more than the gross salary of ₹${rupees(m.gross)} a month. Increase the CTC or reduce the other components.`,
    };
  }

  const pair = (monthly: number, yearly: number): Amounts => ({ monthly, yearly });
  const lines = (key: "earnings" | "employer" | "variable"): CtcLine[] =>
    m[key].map((l, i) => ({
      name: l.name,
      monthly: l.amount,
      yearly: y[key][i].amount,
      ...("balancing" in l && l.balancing ? { balancing: true } : {}),
    }));

  return {
    ok: true,
    breakup: {
      earnings: lines("earnings"),
      gross: pair(m.gross, y.gross),
      employer: lines("employer"),
      fixedCtc: pair(m.fixedCtc, y.fixedCtc),
      variable: lines("variable"),
      totalCtc: pair(m.totalCtc, y.totalCtc),
      gratuity: pair(m.gratuity, y.gratuity),
      basicMonthly: basic,
      pfCeiling: params.pfCeiling,
    },
  };
}

export interface InHandEstimate {
  gross: number;
  employeePf: number;
  employeeEsi: number;
  professionalTax: number;
  tds: number;
  tax: TaxComputation;
  inHand: number;
}

/** Monthly take-home estimate: Gross - employee PF - ESI - PT - TDS. */
export function estimateInHand(breakup: CtcBreakup, settings: StatutorySettings): InHandEstimate {
  const gross = breakup.gross.monthly;
  const employeePf = roundRupee(
    (Math.min(breakup.basicMonthly, breakup.pfCeiling ?? Infinity) * settings.pfEmployeeRate) / 100,
  );
  const employeeEsi = gross <= settings.esiGrossLimit ? roundRupee((gross * settings.esiEmployeeRate) / 100) : 0;
  const pt = professionalTax(settings, breakup.gross.yearly);
  const tax = computeTax(breakup.gross.yearly, settings.tds);
  return {
    gross,
    employeePf,
    employeeEsi,
    professionalTax: pt,
    tds: tax.monthlyTds,
    tax,
    inHand: gross - employeePf - employeeEsi - pt - tax.monthlyTds,
  };
}

/** The earning lines as monthly salary components for payroll (zero lines left out). */
export function payrollComponents(breakup: CtcBreakup): { name: string; monthlyAmount: number }[] {
  return breakup.earnings.filter((l) => l.monthly !== 0).map((l) => ({ name: l.name, monthlyAmount: l.monthly }));
}

export const ctcYearly = (amount: number, period: string | null | undefined) =>
  period === "MONTHLY" ? amount * 12 : amount;

/** The two templates from the CTC sheet, offered as a starting point. */
export const SAMPLE_TEMPLATES: { name: string; components: TemplateComponent[] }[] = [
  {
    name: "M1 to M4",
    components: [
      { name: "Basic Salary", kind: "EARNING", method: "PCT_CTC", value: 50 },
      { name: "House Rent Allowance", kind: "EARNING", method: "PCT_BASIC", value: 50 },
      {
        name: "Statutory Bonus",
        kind: "EARNING",
        method: "PCT_BASIC",
        value: 8.33,
        condition: { basis: "BASIC", op: "LTE", source: "STAT_BONUS_LIMIT" },
      },
      { name: "Communication Allowance", kind: "EARNING", method: "FIXED", value: 2500 },
      { name: "Defray Travel Expense", kind: "EARNING", method: "BALANCING", value: 0 },
      { name: "Employer PF", kind: "EMPLOYER", method: "EMPLOYER_PF", value: 0 },
      { name: "Employer ESIC", kind: "EMPLOYER", method: "EMPLOYER_ESIC", value: 0 },
      { name: "Variable Pay", kind: "VARIABLE", method: "FIXED", value: 0 },
    ],
  },
  {
    name: "M5 & Above",
    components: [
      { name: "Basic Salary", kind: "EARNING", method: "PCT_GROSS", value: 50 },
      { name: "House Rent Allowance", kind: "EARNING", method: "PCT_BASIC", value: 50 },
      { name: "Communication Allowance", kind: "EARNING", method: "FIXED", value: 5000 },
      { name: "Special Allowance", kind: "EARNING", method: "BALANCING", value: 0 },
      { name: "Defray Travel Expense", kind: "EARNING", method: "FIXED", value: 20000 },
      { name: "Employer PF", kind: "EMPLOYER", method: "EMPLOYER_PF", value: 0 },
      { name: "Employer ESIC", kind: "EMPLOYER", method: "EMPLOYER_ESIC", value: 0 },
      { name: "Variable Pay", kind: "VARIABLE", method: "FIXED", value: 0 },
    ],
  },
];
