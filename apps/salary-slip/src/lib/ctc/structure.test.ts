import { describe, expect, it } from "vitest";
import { DEFAULT_STATUTORY, parseStatutory, pfCeilingOn, professionalTax, type StatutorySettings } from "./settings";
import {
  SAMPLE_TEMPLATES,
  estimateInHand,
  payrollComponents,
  solveCtc,
  solveParams,
  validateTemplate,
  type CtcBreakup,
  type TemplateComponent,
} from "./structure";

const M1 = SAMPLE_TEMPLATES[0].components; // "M1 to M4"
const M5 = SAMPLE_TEMPLATES[1].components; // "M5 & Above"
const AFTER = "2026-09-30"; // PF ceiling 25,000
const BEFORE = "2026-09-16"; // PF ceiling 15,000

function solve(ctcYearly: number, components: TemplateComponent[], asOf = AFTER, settings = DEFAULT_STATUTORY) {
  return solveCtc(ctcYearly, components, solveParams(settings, asOf));
}
function breakup(ctcYearly: number, components: TemplateComponent[], asOf = AFTER, settings = DEFAULT_STATUTORY): CtcBreakup {
  const r = solve(ctcYearly, components, asOf, settings);
  if (!r.ok) throw new Error(r.error);
  return r.breakup;
}
const monthly = (b: CtcBreakup) => Object.fromEntries([...b.earnings, ...b.employer, ...b.variable].map((l) => [l.name, l.monthly]));

describe("case A: M1 to M4, CTC 5,00,000 a year", () => {
  const b = breakup(500000, M1);

  it("matches the expected monthly figures", () => {
    expect(monthly(b)).toEqual({
      "Basic Salary": 20833,
      "House Rent Allowance": 10417,
      "Statutory Bonus": 1735,
      "Communication Allowance": 2500,
      "Defray Travel Expense": 3682,
      "Employer PF": 2500,
      "Employer ESIC": 0,
      "Variable Pay": 0,
    });
    expect(b.gross.monthly).toBe(39167);
    expect(b.fixedCtc.monthly).toBe(41667);
    expect(b.totalCtc.monthly).toBe(41667);
    expect(b.gratuity.monthly).toBe(1002);
  });

  it("has a yearly column that adds up to the CTC", () => {
    expect(b.totalCtc.yearly).toBe(500000);
    expect(b.gross.yearly).toBe(470000);
    expect(b.earnings.find((l) => l.name === "Basic Salary")?.yearly).toBe(250000);
    expect(b.earnings.find((l) => l.name === "Statutory Bonus")?.yearly).toBe(20825);
    expect(b.employer.find((l) => l.name === "Employer PF")?.yearly).toBe(30000);
    expect(b.gratuity.yearly).toBe(12025);
    expect(b.earnings.reduce((a, l) => a + l.yearly, 0)).toBe(b.gross.yearly);
  });

  it("gives an in-hand of 36,459 (PT 208, no TDS)", () => {
    const e = estimateInHand(b, DEFAULT_STATUTORY);
    expect(e).toMatchObject({ gross: 39167, employeePf: 2500, employeeEsi: 0, professionalTax: 208, tds: 0, inHand: 36459 });
  });
});

describe("case B: M5 & Above, CTC 5,00,000 a month", () => {
  const b = breakup(500000 * 12, M5);

  it("matches the expected monthly figures", () => {
    expect(monthly(b)).toMatchObject({
      "Basic Salary": 248500,
      "House Rent Allowance": 124250,
      "Communication Allowance": 5000,
      "Special Allowance": 99250,
      "Defray Travel Expense": 20000,
      "Employer PF": 3000,
      "Employer ESIC": 0,
    });
    expect(b.gross.monthly).toBe(497000);
    expect(b.totalCtc.monthly).toBe(500000);
    expect(b.gratuity.monthly).toBe(11953);
  });

  it("gives TDS of 15,40,625 a year, 1,28,385 a month, and an in-hand of 3,65,407", () => {
    const e = estimateInHand(b, DEFAULT_STATUTORY);
    expect(e.tax.annualTax).toBe(1540625);
    expect(e.tds).toBe(128385);
    expect(e.employeePf).toBe(3000);
    expect(e.inHand).toBe(365407);
  });
});

describe("case C: M5 & Above, CTC 10,00,000 a month", () => {
  const b = breakup(1000000 * 12, M5);

  it("matches the expected monthly figures", () => {
    expect(monthly(b)).toMatchObject({
      "Basic Salary": 498500,
      "House Rent Allowance": 249250,
      "Communication Allowance": 5000,
      "Special Allowance": 224250,
      "Defray Travel Expense": 20000,
      "Employer PF": 3000,
    });
    expect(b.gross.monthly).toBe(997000);
    expect(b.gratuity.monthly).toBe(23978);
  });

  it("gives TDS of 37,63,453 a year, 3,13,621 a month, and an in-hand of 6,80,171", () => {
    const e = estimateInHand(b, DEFAULT_STATUTORY);
    expect(e.tax.annualTax).toBe(3763453);
    expect(e.tds).toBe(313621);
    expect(e.inHand).toBe(680171);
  });
});

describe("case D: M5 & Above, CTC 10,00,000 a year", () => {
  it("is rejected because Special Allowance would be negative", () => {
    const r = solve(1000000, M5);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("Special Allowance");
      expect(r.error).toContain("negative");
    }
  });
});

describe("totals always add up", () => {
  it.each([312345, 500000, 777777, 1234567, 6000000])("CTC %i: both columns are consistent", (ctc) => {
    const b = breakup(ctc, M1);
    for (const col of ["monthly", "yearly"] as const) {
      const sum = (lines: { monthly: number; yearly: number }[]) => lines.reduce((a, l) => a + l[col], 0);
      expect(sum(b.earnings)).toBe(b.gross[col]);
      expect(b.gross[col] + sum(b.employer)).toBe(b.fixedCtc[col]);
      expect(b.fixedCtc[col] + sum(b.variable)).toBe(b.totalCtc[col]);
    }
    expect(b.totalCtc.yearly).toBe(ctc);
  });
});

describe("employer PF", () => {
  it("uses the ceiling in force on the date: 15,000 until 16 Sep 2026, 25,000 from 17 Sep 2026", () => {
    expect(pfCeilingOn(DEFAULT_STATUTORY, "2026-09-16")).toBe(15000);
    expect(pfCeilingOn(DEFAULT_STATUTORY, "2026-09-17")).toBe(25000);
    expect(pfCeilingOn(DEFAULT_STATUTORY, "2020-01-01")).toBe(15000);
    expect(pfCeilingOn(DEFAULT_STATUTORY, "1990-01-01")).toBe(15000);
  });

  it("is 1,800 under the old ceiling and 2,500 under the new one for a Basic of 20,833", () => {
    expect(monthly(breakup(500000, M1, BEFORE))["Employer PF"]).toBe(1800);
    expect(monthly(breakup(500000, M1, AFTER))["Employer PF"]).toBe(2500);
  });

  it("is capped at 12% of the ceiling when Basic is above it", () => {
    expect(monthly(breakup(6000000, M5, BEFORE))["Employer PF"]).toBe(1800);
    expect(monthly(breakup(6000000, M5, AFTER))["Employer PF"]).toBe(3000);
  });

  it("can be charged on actual Basic instead", () => {
    const settings: StatutorySettings = { ...DEFAULT_STATUTORY, pfOnActualBasic: true };
    expect(pfCeilingOn(settings, AFTER)).toBeNull();
    const b = breakup(6000000, M5, AFTER, settings);
    // Basic = 50% of Gross and Gross = CTC - 12% of Basic, so Gross = 5,00,000 / 1.06.
    expect(b.gross.monthly).toBe(471698);
    expect(monthly(b)["Basic Salary"]).toBe(235849);
    expect(monthly(b)["Employer PF"]).toBe(28302);
    expect(b.gross.monthly + 28302).toBe(500000);
    expect(estimateInHand(b, settings).employeePf).toBe(28302);
  });
});

describe("employer ESIC", () => {
  it("is 3.25% of gross when gross is 21,000 a month or less", () => {
    const components: TemplateComponent[] = [
      { name: "Basic", kind: "EARNING", method: "PCT_CTC", value: 50 },
      { name: "Special", kind: "EARNING", method: "BALANCING", value: 0 },
      { name: "Employer PF", kind: "EMPLOYER", method: "EMPLOYER_PF", value: 0 },
      { name: "Employer ESIC", kind: "EMPLOYER", method: "EMPLOYER_ESIC", value: 0 },
    ];
    const b = breakup(240000, components); // CTC 20,000 a month
    // Basic 10,000, PF 1,200; Gross = (20,000 - 1,200) / 1.0325
    expect(b.gross.monthly).toBe(18208);
    expect(monthly(b)["Employer ESIC"]).toBe(592);
    expect(monthly(b)["Employer PF"]).toBe(1200);
    expect(estimateInHand(b, DEFAULT_STATUTORY).employeeEsi).toBe(137); // 0.75% of 18,208
  });

  it("is zero when gross is above 21,000 (the sheet's 39,190 gross gets no ESIC)", () => {
    expect(monthly(breakup(500000, M1))["Employer ESIC"]).toBe(0);
  });
});

describe("conditions", () => {
  it("drops Statutory Bonus when Basic is above the limit, and the balancing component takes it up", () => {
    const b = breakup(600000, M1); // Basic 25,000 a month > 21,000
    expect(monthly(b)["Statutory Bonus"]).toBe(0);
    expect(b.earnings.reduce((a, l) => a + l.monthly, 0)).toBe(b.gross.monthly);
  });

  it("pays Statutory Bonus when Basic is exactly at the limit", () => {
    const b = breakup(504000, M1); // Basic exactly 21,000 a month
    expect(monthly(b)["Basic Salary"]).toBe(21000);
    expect(monthly(b)["Statutory Bonus"]).toBe(1749);
  });

  it("follows the company's stat-bonus threshold setting", () => {
    const settings = { ...DEFAULT_STATUTORY, minBasicStatBonusYearly: 240000 }; // 20,000 a month
    expect(monthly(breakup(500000, M1, AFTER, settings))["Statutory Bonus"]).toBe(0);
  });

  it("supports a fixed-amount condition", () => {
    const components: TemplateComponent[] = [
      { name: "Basic", kind: "EARNING", method: "PCT_CTC", value: 40 },
      { name: "City Allowance", kind: "EARNING", method: "FIXED", value: 1000, condition: { basis: "GROSS", op: "GTE", source: "AMOUNT", amount: 30000 } },
      { name: "Special", kind: "EARNING", method: "BALANCING", value: 0 },
    ];
    expect(monthly(breakup(480000, components))["City Allowance"]).toBe(1000); // gross 40,000
    expect(monthly(breakup(240000, components))["City Allowance"]).toBe(0); // gross 20,000
  });
});

describe("variable pay", () => {
  it("sits between Fixed CTC and Total CTC", () => {
    const components: TemplateComponent[] = [
      { name: "Basic", kind: "EARNING", method: "PCT_CTC", value: 40 },
      { name: "Special", kind: "EARNING", method: "BALANCING", value: 0 },
      { name: "Variable Pay", kind: "VARIABLE", method: "PCT_CTC", value: 10 },
    ];
    const b = breakup(1200000, components);
    expect(b.totalCtc.monthly).toBe(100000);
    expect(b.variable[0].monthly).toBe(10000);
    expect(b.fixedCtc.monthly).toBe(90000);
    expect(b.gross.monthly).toBe(90000);
    expect(monthly(b)).toMatchObject({ Basic: 40000, Special: 50000 });
  });
});

describe("template validation", () => {
  const basic: TemplateComponent = { name: "Basic", kind: "EARNING", method: "PCT_CTC", value: 50 };
  const balance: TemplateComponent = { name: "Special", kind: "EARNING", method: "BALANCING", value: 0 };

  it("accepts the sample templates", () => {
    expect(validateTemplate(M1)).toEqual([]);
    expect(validateTemplate(M5)).toEqual([]);
  });

  it("requires exactly one balancing component", () => {
    expect(validateTemplate([basic]).join(" ")).toContain("balancing");
    expect(validateTemplate([basic, balance, { ...balance, name: "Other" }]).join(" ")).toContain("Only one");
  });

  it("rejects duplicate names, bad percentages and a missing Basic", () => {
    expect(validateTemplate([basic, { ...basic }, balance]).join(" ")).toContain("twice");
    expect(validateTemplate([{ ...basic, value: 150 }, balance]).join(" ")).toContain("more than 100");
    expect(
      validateTemplate([{ name: "HRA", kind: "EARNING", method: "PCT_BASIC", value: 50 }, balance]).join(" "),
    ).toContain("Basic");
  });

  it("rejects statutory methods on earnings", () => {
    expect(validateTemplate([basic, balance, { name: "PF", kind: "EARNING", method: "EMPLOYER_PF", value: 0 }]).length).toBe(1);
  });

  it("makes solveCtc fail with the same message", () => {
    const r = solve(500000, [basic]);
    expect(r.ok).toBe(false);
  });

  it("rejects a zero or negative CTC", () => {
    expect(solve(0, M1).ok).toBe(false);
    expect(solve(-5, M1).ok).toBe(false);
  });
});

describe("payroll components", () => {
  it("are the non-zero monthly earnings, in template order", () => {
    expect(payrollComponents(breakup(500000, M1))).toEqual([
      { name: "Basic Salary", monthlyAmount: 20833 },
      { name: "House Rent Allowance", monthlyAmount: 10417 },
      { name: "Statutory Bonus", monthlyAmount: 1735 },
      { name: "Communication Allowance", monthlyAmount: 2500 },
      { name: "Defray Travel Expense", monthlyAmount: 3682 },
    ]);
  });
});

describe("settings", () => {
  it("fall back to the defaults for anything not stored", () => {
    expect(parseStatutory("{}")).toEqual(DEFAULT_STATUTORY);
    expect(parseStatutory("not json")).toEqual(DEFAULT_STATUTORY);
    const s = parseStatutory(JSON.stringify({ gratuityRate: 5, tds: { cessRate: 3 } }));
    expect(s.gratuityRate).toBe(5);
    expect(s.tds.cessRate).toBe(3);
    expect(s.tds.standardDeduction).toBe(75000);
    expect(s.minBasicHraYearly).toBe(240000);
  });

  it("looks up professional tax by annual gross", () => {
    expect(professionalTax(DEFAULT_STATUTORY, 200000)).toBe(0);
    expect(professionalTax(DEFAULT_STATUTORY, 225000)).toBe(0);
    expect(professionalTax(DEFAULT_STATUTORY, 225001)).toBe(125);
    expect(professionalTax(DEFAULT_STATUTORY, 350000)).toBe(166);
    expect(professionalTax(DEFAULT_STATUTORY, 470000)).toBe(208);
  });
});
