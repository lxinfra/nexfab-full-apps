// Company-level statutory settings. Stored as JSON on the company; anything
// missing falls back to these defaults, so every value stays editable.
import { z } from "zod";
import type { TdsSettings } from "./tds";

export interface PfCeiling {
  from: string; // YYYY-MM-DD, the first day this ceiling applies
  amount: number; // monthly PF wage ceiling
}

export interface PtSlab {
  from: number; // annual gross, inclusive
  to: number | null; // inclusive; null = no upper limit
  monthly: number; // professional tax per month
}

export interface StatutorySettings {
  /** Thresholds from the CTC sheet, per year. */
  minBasicStatBonusYearly: number;
  minBasicHraYearly: number; // stored only; no logic uses it yet
  pfEmployerRate: number;
  pfEmployeeRate: number;
  /** true = PF on the actual Basic, ignoring the wage ceiling. */
  pfOnActualBasic: boolean;
  pfCeilings: PfCeiling[];
  esiEmployerRate: number;
  esiEmployeeRate: number;
  esiGrossLimit: number; // monthly gross at or below which ESI applies
  gratuityRate: number; // percent of Basic
  ptSlabs: PtSlab[];
  tds: TdsSettings;
}

export const DEFAULT_STATUTORY: StatutorySettings = {
  minBasicStatBonusYearly: 252000,
  minBasicHraYearly: 240000,
  pfEmployerRate: 12,
  pfEmployeeRate: 12,
  pfOnActualBasic: false,
  pfCeilings: [
    { from: "2000-01-01", amount: 15000 },
    { from: "2026-09-17", amount: 25000 },
  ],
  esiEmployerRate: 3.25,
  esiEmployeeRate: 0.75,
  esiGrossLimit: 21000,
  gratuityRate: 4.81,
  // Madhya Pradesh professional tax, by annual salary.
  ptSlabs: [
    { from: 0, to: 225000, monthly: 0 },
    { from: 225001, to: 300000, monthly: 125 },
    { from: 300001, to: 400000, monthly: 166 },
    { from: 400001, to: null, monthly: 208 },
  ],
  // New tax regime, FY 2026-27.
  tds: {
    standardDeduction: 75000,
    slabs: [
      { upTo: 400000, rate: 0 },
      { upTo: 800000, rate: 5 },
      { upTo: 1200000, rate: 10 },
      { upTo: 1600000, rate: 15 },
      { upTo: 2000000, rate: 20 },
      { upTo: 2400000, rate: 25 },
      { upTo: null, rate: 30 },
    ],
    rebateLimit: 1200000,
    surcharge: [
      { above: 5000000, rate: 10 },
      { above: 10000000, rate: 15 },
      { above: 20000000, rate: 25 },
    ],
    cessRate: 4,
  },
};

const blankToNull = (v: unknown) => (v === "" || v === null || v === undefined ? null : v);
const money = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number.` })
    .finite(`${label} must be a number.`)
    .min(0, `${label} cannot be negative.`);
const percent = (label: string) => money(label).max(100, `${label} cannot be more than 100.`);

export const statutorySchema = z
  .object({
    minBasicStatBonusYearly: money("Min Basic for Stat Bonus"),
    minBasicHraYearly: money("Min Basic for HRA"),
    pfEmployerRate: percent("Employer PF rate"),
    pfEmployeeRate: percent("Employee PF rate"),
    pfOnActualBasic: z.boolean(),
    pfCeilings: z
      .array(
        z.object({
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date."),
          amount: money("Ceiling").positive("Ceiling must be greater than zero."),
        }),
      )
      .min(1, "Add at least one PF wage ceiling."),
    esiEmployerRate: percent("Employer ESI rate"),
    esiEmployeeRate: percent("Employee ESI rate"),
    esiGrossLimit: money("ESI gross limit"),
    gratuityRate: percent("Gratuity rate"),
    ptSlabs: z.array(
      z.object({
        from: money("From"),
        to: z.preprocess(blankToNull, money("To").nullable()),
        monthly: money("Monthly tax"),
      }),
    ),
    tds: z.object({
      standardDeduction: money("Standard deduction"),
      slabs: z
        .array(z.object({ upTo: z.preprocess(blankToNull, money("Up to").nullable()), rate: percent("Rate") }))
        .min(1, "Add at least one tax slab."),
      rebateLimit: money("Rebate limit"),
      surcharge: z.array(z.object({ above: money("Above"), rate: percent("Rate") })),
      cessRate: percent("Cess rate"),
    }),
  })
  .superRefine((d, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const dates = d.pfCeilings.map((c) => c.from);
    dates.forEach((date, i) => {
      if (dates.indexOf(date) !== i) issue(["pfCeilings", i, "from"], "Two ceilings start on the same date.");
    });
    d.ptSlabs.forEach((s, i) => {
      if (s.to !== null && s.to < s.from) issue(["ptSlabs", i, "to"], "To must not be less than From.");
    });
    const open = d.tds.slabs.filter((s) => s.upTo === null).length;
    if (open !== 1) issue(["tds", "slabs"], 'Exactly one slab must have "Up to" left empty (the top slab).');
    const limits = d.tds.slabs.map((s) => s.upTo).filter((v): v is number => v !== null);
    limits.forEach((v, i) => {
      if (limits.indexOf(v) !== i) issue(["tds", "slabs", i, "upTo"], "Two slabs end at the same amount.");
    });
  });

/** Read the JSON stored on the company, filling gaps with the defaults. */
export function parseStatutory(json: string | null | undefined): StatutorySettings {
  let stored: Partial<StatutorySettings> = {};
  try {
    stored = json ? (JSON.parse(json) as Partial<StatutorySettings>) : {};
  } catch {
    stored = {};
  }
  return {
    ...DEFAULT_STATUTORY,
    ...stored,
    tds: { ...DEFAULT_STATUTORY.tds, ...(stored.tds ?? {}) },
  };
}

/** The PF wage ceiling in force on a date (YYYY-MM-DD). null = no ceiling. */
export function pfCeilingOn(settings: StatutorySettings, date: string): number | null {
  if (settings.pfOnActualBasic) return null;
  const inForce = settings.pfCeilings.filter((c) => c.from <= date).sort((a, b) => a.from.localeCompare(b.from));
  if (inForce.length > 0) return inForce[inForce.length - 1].amount;
  // Before the first listed date: use the earliest ceiling.
  const earliest = [...settings.pfCeilings].sort((a, b) => a.from.localeCompare(b.from))[0];
  return earliest ? earliest.amount : null;
}

/** Professional tax per month for an annual gross salary. */
export function professionalTax(settings: StatutorySettings, annualGross: number): number {
  const slab = settings.ptSlabs.find((s) => annualGross >= s.from && (s.to === null || annualGross <= s.to));
  return slab ? slab.monthly : 0;
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
