import { describe, expect, it } from "vitest";
import {
  calculatePayroll,
  findSlabAmount,
  proRate,
  roundRupee,
  type DeductionRuleInput,
  type PayrollInput,
} from "./calc";

const components = [
  { name: "Basic", monthlyAmount: 20000 },
  { name: "HRA", monthlyAmount: 8000 },
  { name: "Conveyance Allowance", monthlyAmount: 1600 },
  { name: "Special Allowance", monthlyAmount: 9150 },
  { name: "Medical Allowance", monthlyAmount: 1250 },
]; // monthly gross 40,000

const base = (extra: Partial<PayrollInput> = {}): PayrollInput => ({
  totalDays: 30,
  paidDays: 30,
  components,
  ...extra,
});

const rule = (r: Partial<DeductionRuleInput>): DeductionRuleInput => ({
  id: 1,
  name: "Rule",
  type: "FIXED",
  ...r,
});

const deduction = (input: PayrollInput, name = "Rule") =>
  calculatePayroll(input).deductions.find((d) => d.name === name);

describe("rounding", () => {
  it("rounds to the nearest rupee, halves up", () => {
    expect(roundRupee(100.49)).toBe(100);
    expect(roundRupee(100.5)).toBe(101);
    expect(roundRupee(100.51)).toBe(101);
    expect(roundRupee(0)).toBe(0);
  });

  it("is not thrown off by floating-point noise", () => {
    expect(roundRupee(1.005 * 1000 - 1004.5 + 0.0000000001)).toBe(1); // 0.5 -> 1
    expect(roundRupee(499.4999999999999)).toBe(500);
  });

  it("rounds each component on its own, and totals are sums of rounded components", () => {
    // 3 components of 1000 for 20/30 days: 666.67 each -> 667 each -> 2001 (not round(2000))
    const r = calculatePayroll({
      totalDays: 30,
      paidDays: 20,
      components: [
        { name: "Basic", monthlyAmount: 1000 },
        { name: "HRA", monthlyAmount: 1000 },
        { name: "Other", monthlyAmount: 1000 },
      ],
    });
    expect(r.earnings.map((e) => e.amount)).toEqual([667, 667, 667]);
    expect(r.gross).toBe(2001);
  });
});

describe("pro-rating", () => {
  it("pays the full amount for a full month", () => {
    const r = calculatePayroll(base());
    expect(r.gross).toBe(40000);
    expect(r.netPay).toBe(40000);
    expect(r.lopDays).toBe(0);
  });

  it("pro-rates every component by paid days", () => {
    const r = calculatePayroll(base({ totalDays: 31, paidDays: 28 }));
    expect(r.earnings.map((e) => e.amount)).toEqual([
      18065, // 20000 * 28/31 = 18064.52
      7226, // 8000 * 28/31 = 7225.81
      1445, // 1600 * 28/31 = 1445.16
      8265, // 9150 * 28/31 = 8264.52
      1129, // 1250 * 28/31 = 1129.03
    ]);
    expect(r.gross).toBe(36130);
    expect(r.lopDays).toBe(3);
    expect(r.monthlyGross).toBe(40000);
  });

  it("supports half days", () => {
    expect(proRate(30000, 29.5, 30)).toBe(29500);
    expect(calculatePayroll(base({ paidDays: 29.5 })).lopDays).toBe(0.5);
  });

  it("pays nothing for zero paid days", () => {
    const r = calculatePayroll(base({ paidDays: 0 }));
    expect(r.gross).toBe(0);
    expect(r.lopDays).toBe(30);
  });

  it("does not pro-rate arrears or one-time earnings", () => {
    const r = calculatePayroll(
      base({ paidDays: 15, arrears: 1000, oneTimeEarnings: [{ name: "Bonus", amount: 5000 }] }),
    );
    expect(r.gross).toBe(20000 + 1000 + 5000);
    expect(r.earnings.find((e) => e.name === "Arrears")?.amount).toBe(1000);
    expect(r.earnings.find((e) => e.name === "Bonus")?.amount).toBe(5000);
  });

  it("rejects invalid day counts", () => {
    expect(() => calculatePayroll(base({ paidDays: 31 }))).toThrow();
    expect(() => calculatePayroll(base({ paidDays: -1 }))).toThrow();
    expect(() => calculatePayroll(base({ totalDays: 0, paidDays: 0 }))).toThrow();
  });
});

describe("percentage rules", () => {
  it("takes a percentage of Basic", () => {
    const d = deduction(base({ rules: [rule({ type: "PERCENTAGE", baseType: "BASIC", percentage: 12 })] }));
    expect(d?.amount).toBe(2400);
  });

  it("uses the earned (pro-rated) Basic", () => {
    const d = deduction(
      base({ paidDays: 15, rules: [rule({ type: "PERCENTAGE", baseType: "BASIC", percentage: 12 })] }),
    );
    expect(d?.amount).toBe(1200);
  });

  it("takes a percentage of Gross, including arrears and one-time earnings", () => {
    const d = deduction(
      base({ arrears: 1000, rules: [rule({ type: "PERCENTAGE", baseType: "GROSS", percentage: 0.75 })] }),
    );
    expect(d?.amount).toBe(308); // 41000 * 0.75% = 307.5 -> 308
  });

  it("takes a percentage of a selected set of components", () => {
    const d = deduction(
      base({
        rules: [
          rule({
            type: "PERCENTAGE",
            baseType: "COMPONENTS",
            baseComponents: ["Basic", "Special Allowance"],
            percentage: 10,
          }),
        ],
      }),
    );
    expect(d?.amount).toBe(2915); // (20000 + 9150) * 10%
  });

  it("matches component names regardless of case", () => {
    const d = deduction({
      totalDays: 30,
      paidDays: 30,
      components: [{ name: "BASIC", monthlyAmount: 10000 }],
      rules: [rule({ type: "PERCENTAGE", baseType: "BASIC", percentage: 12 })],
    });
    expect(d?.amount).toBe(1200);
  });
});

describe("fixed rules", () => {
  it("deducts the fixed amount and does not pro-rate it", () => {
    const d = deduction(base({ paidDays: 10, rules: [rule({ type: "FIXED", fixedAmount: 200 })] }));
    expect(d?.amount).toBe(200);
  });
});

describe("slab rules", () => {
  const slabs = [
    { from: 0, to: 18750, amount: 0 },
    { from: 18751, to: 25000, amount: 125 },
    { from: 25001, to: 33333, amount: 167 },
    { from: 33334, to: null, amount: 208 },
  ];

  it("finds the slab, with inclusive boundaries", () => {
    expect(findSlabAmount(slabs, 18750)).toBe(0);
    expect(findSlabAmount(slabs, 18751)).toBe(125);
    expect(findSlabAmount(slabs, 25000)).toBe(125);
    expect(findSlabAmount(slabs, 25001)).toBe(167);
    expect(findSlabAmount(slabs, 999999)).toBe(208);
  });

  it("returns 0 when no slab matches", () => {
    expect(findSlabAmount([{ from: 100, to: 200, amount: 50 }], 50)).toBe(0);
    expect(findSlabAmount([], 50)).toBe(0);
  });

  it("uses earned gross for the slab lookup", () => {
    const rules = [rule({ type: "SLAB", baseType: "GROSS", slabs })];
    expect(deduction(base({ rules }))?.amount).toBe(208); // gross 40000
    expect(deduction(base({ paidDays: 15, rules }))?.amount).toBe(125); // gross 20000
  });

  it("can look up the slab on Basic", () => {
    const rules = [rule({ type: "SLAB", baseType: "BASIC", slabs })];
    expect(deduction(base({ rules }))?.amount).toBe(125); // basic 20000
  });
});

describe("manual rules", () => {
  it("uses the amount entered for the month", () => {
    const rules = [rule({ id: 7, name: "Advance", type: "MANUAL" })];
    expect(deduction(base({ rules, manualAmounts: { "7": 2500 } }), "Advance")?.amount).toBe(2500);
  });

  it("is zero when nothing was entered", () => {
    const rules = [rule({ id: 7, name: "Advance", type: "MANUAL" })];
    expect(deduction(base({ rules }), "Advance")?.amount).toBe(0);
  });
});

describe("caps", () => {
  it("caps the base before applying the percentage", () => {
    const d = deduction(
      base({ rules: [rule({ type: "PERCENTAGE", baseType: "BASIC", percentage: 12, baseCap: 15000 })] }),
    );
    expect(d?.amount).toBe(1800); // 12% of 15000, not of 20000
  });

  it("leaves the base alone when it is under the cap", () => {
    const d = deduction(
      base({
        paidDays: 15, // earned basic 10000
        rules: [rule({ type: "PERCENTAGE", baseType: "BASIC", percentage: 12, baseCap: 15000 })],
      }),
    );
    expect(d?.amount).toBe(1200);
  });

  it("caps the resulting amount", () => {
    const d = deduction(
      base({ rules: [rule({ type: "PERCENTAGE", baseType: "GROSS", percentage: 10, amountCap: 2500 })] }),
    );
    expect(d?.amount).toBe(2500);
  });

  it("applies the amount cap to manual entries too", () => {
    const rules = [rule({ id: 3, type: "MANUAL", amountCap: 1000 })];
    expect(deduction(base({ rules, manualAmounts: { "3": 5000 } }))?.amount).toBe(1000);
  });
});

describe("eligibility", () => {
  const esi = rule({
    name: "ESI",
    type: "PERCENTAGE",
    baseType: "GROSS",
    percentage: 0.75,
    eligibilityMaxGross: 21000,
    employerType: "PERCENTAGE",
    employerValue: 3.25,
  });

  it("skips the rule (and its employer share) when monthly gross is above the limit", () => {
    const r = calculatePayroll(base({ rules: [esi] }));
    expect(r.deductions).toEqual([]);
    expect(r.employerContributions).toEqual([]);
  });

  it("applies the rule when monthly gross is exactly at the limit", () => {
    const r = calculatePayroll({
      totalDays: 30,
      paidDays: 30,
      components: [{ name: "Basic", monthlyAmount: 21000 }],
      rules: [esi],
    });
    expect(r.deductions[0].amount).toBe(158); // 157.5 -> 158
  });

  it("judges eligibility on the full monthly gross, not the pro-rated amount", () => {
    // Earned gross is 20000 for half a month, but the monthly rate is 40000.
    const r = calculatePayroll(base({ paidDays: 15, rules: [esi] }));
    expect(r.deductions).toEqual([]);
  });
});

describe("employer contribution", () => {
  it("is shown separately and not deducted from net pay", () => {
    const r = calculatePayroll(
      base({
        rules: [
          rule({
            name: "PF",
            type: "PERCENTAGE",
            baseType: "BASIC",
            percentage: 12,
            baseCap: 15000,
            employerType: "PERCENTAGE",
            employerValue: 13,
          }),
        ],
      }),
    );
    expect(r.deductions[0].amount).toBe(1800);
    expect(r.employerContributions).toEqual([{ name: "PF", amount: 1950 }]); // 13% of capped 15000
    expect(r.totalDeductions).toBe(1800);
    expect(r.netPay).toBe(40000 - 1800);
  });

  it("supports a fixed employer amount", () => {
    const r = calculatePayroll(
      base({ rules: [rule({ type: "FIXED", fixedAmount: 100, employerType: "FIXED", employerValue: 75 })] }),
    );
    expect(r.employerContributions).toEqual([{ name: "Rule", amount: 75 }]);
  });

  it("has none when the employer type is NONE or missing", () => {
    const r = calculatePayroll(
      base({ rules: [rule({ type: "FIXED", fixedAmount: 100, employerType: "NONE", employerValue: 5 })] }),
    );
    expect(r.employerContributions).toEqual([]);
  });
});

describe("overrides and ad-hoc deductions", () => {
  it("lets a deduction amount be overridden by name", () => {
    const r = calculatePayroll(
      base({
        rules: [rule({ name: "TDS", type: "FIXED", fixedAmount: 500 })],
        overrides: { deductions: { TDS: 750 } },
      }),
    );
    expect(r.deductions[0]).toMatchObject({ name: "TDS", amount: 750, overridden: true });
  });

  it("lets an earned amount be overridden, and deductions follow it", () => {
    const r = calculatePayroll(
      base({
        rules: [rule({ type: "PERCENTAGE", baseType: "BASIC", percentage: 10 })],
        overrides: { earnings: { Basic: 15000 } },
      }),
    );
    expect(r.earnings[0]).toMatchObject({ name: "Basic", amount: 15000, overridden: true });
    expect(r.deductions[0].amount).toBe(1500);
  });

  it("adds ad-hoc deductions", () => {
    const r = calculatePayroll(base({ adhocDeductions: [{ name: "Canteen", amount: 350.4 }] }));
    expect(r.deductions).toEqual([{ name: "Canteen", amount: 350 }]);
    expect(r.netPay).toBe(39650);
  });
});

describe("totals", () => {
  it("net pay = gross - total deductions", () => {
    const r = calculatePayroll(
      base({
        totalDays: 31,
        paidDays: 28,
        arrears: 500,
        rules: [
          rule({ id: 1, name: "PF", type: "PERCENTAGE", baseType: "BASIC", percentage: 12, baseCap: 15000 }),
          rule({ id: 2, name: "PT", type: "FIXED", fixedAmount: 208 }),
          rule({ id: 3, name: "Advance", type: "MANUAL" }),
        ],
        manualAmounts: { "3": 1000 },
      }),
    );
    expect(r.gross).toBe(36630);
    expect(r.deductions.map((d) => d.amount)).toEqual([1800, 208, 1000]);
    expect(r.totalDeductions).toBe(3008);
    expect(r.netPay).toBe(33622);
    expect(r.warnings).toEqual([]);
  });

  it("warns when net pay is negative", () => {
    const r = calculatePayroll(base({ paidDays: 0, rules: [rule({ type: "FIXED", fixedAmount: 200 })] }));
    expect(r.netPay).toBe(-200);
    expect(r.warnings.length).toBe(1);
  });
});
