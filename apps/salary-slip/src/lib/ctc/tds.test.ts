import { describe, expect, it } from "vitest";
import { calculatePayroll } from "../payroll/calc";
import { DEFAULT_STATUTORY } from "./settings";
import { computeTax, slabTax, type TdsSettings } from "./tds";

const S = DEFAULT_STATUTORY.tds;
const tax = (annualIncome: number, settings: TdsSettings = S) => computeTax(annualIncome, settings);
/** Annual income that gives this taxable income after the standard deduction. */
const income = (taxable: number) => taxable + 75000;

describe("slabs", () => {
  it("taxes each slice at its own rate", () => {
    expect(slabTax(400000, S.slabs)).toBe(0);
    expect(slabTax(800000, S.slabs)).toBe(20000);
    expect(slabTax(1200000, S.slabs)).toBe(60000);
    expect(slabTax(1600000, S.slabs)).toBe(120000);
    expect(slabTax(2000000, S.slabs)).toBe(200000);
    expect(slabTax(2400000, S.slabs)).toBe(300000);
    expect(slabTax(3000000, S.slabs)).toBe(480000);
  });
});

describe("standard deduction and rebate", () => {
  it("deducts 75,000 before taxing", () => {
    expect(tax(1000000).taxableIncome).toBe(925000);
    expect(tax(50000).taxableIncome).toBe(0);
  });

  it("charges nothing up to 12,00,000 taxable", () => {
    expect(tax(income(395000)).annualTax).toBe(0);
    expect(tax(income(1200000)).annualTax).toBe(0);
    expect(tax(income(1200000)).monthlyTds).toBe(0);
  });

  it("gives marginal relief just above 12,00,000", () => {
    // Slab tax would be 61,500, but only 10,000 was earned over the limit.
    const t = tax(income(1210000));
    expect(t.slabTax).toBe(61500);
    expect(t.taxAfterRebate).toBe(10000);
    expect(t.annualTax).toBe(10400); // + 4% cess
  });

  it("stops giving relief once the slab tax is lower than the excess", () => {
    // At 12,75,000 taxable: slab tax 71,250 < excess 75,000.
    const t = tax(income(1275000));
    expect(t.taxAfterRebate).toBe(71250);
    expect(t.annualTax).toBe(74100);
  });
});

describe("surcharge", () => {
  it("is nil up to 50,00,000 taxable", () => {
    const t = tax(income(5000000));
    expect(t.surcharge).toBe(0);
    expect(t.annualTax).toBe(1123200); // 10,80,000 + 4%
  });

  it("is 10% above 50,00,000, with marginal relief just above the threshold", () => {
    // Taxable 51,00,000: tax 11,10,000; with 10% surcharge 12,21,000.
    // Relief caps it at tax on 50L (10,80,000) + the extra 1,00,000 = 11,80,000.
    const t = tax(income(5100000));
    expect(t.taxAfterRebate + t.surcharge).toBe(1180000);
    expect(t.annualTax).toBe(1227200);
  });

  it("is a full 10% well above 50,00,000 (case B: gross 59,64,000)", () => {
    const t = tax(5964000);
    expect(t.taxableIncome).toBe(5889000);
    expect(t.slabTax).toBe(1346700);
    expect(t.surcharge).toBeCloseTo(134670, 6);
    expect(t.annualTax).toBe(1540625);
    expect(t.monthlyTds).toBe(128385);
  });

  it("is 15% above 1 crore, with marginal relief (case C: gross 1,19,64,000)", () => {
    const t = tax(11964000);
    expect(t.annualTax).toBe(3763453);
    expect(t.monthlyTds).toBe(313621);

    // Taxable 1,01,00,000: tax 26,10,000; with 15% = 30,01,500.
    // Relief: (25,80,000 + 10%) + 1,00,000 = 29,38,000.
    const relief = tax(income(10100000));
    expect(relief.taxAfterRebate + relief.surcharge).toBeCloseTo(2938000, 6);
  });

  it("is 25% above 2 crore, with marginal relief", () => {
    // Taxable 3 crore: tax 3,00,000 + 2,76,00,000 x 30% = 85,80,000; + 25% = 1,07,25,000; + cess.
    expect(tax(income(30000000)).annualTax).toBe(11154000);
    // Taxable 2,01,00,000: relief caps at (55,80,000 + 15%) + 1,00,000 = 65,17,000.
    const relief = tax(income(20100000));
    expect(relief.taxAfterRebate + relief.surcharge).toBeCloseTo(6517000, 6);
  });
});

describe("settings are not hard-coded", () => {
  it("follows changed slabs, deduction, rebate and cess", () => {
    const custom: TdsSettings = {
      standardDeduction: 50000,
      slabs: [
        { upTo: 300000, rate: 0 },
        { upTo: null, rate: 10 },
      ],
      rebateLimit: 0,
      surcharge: [],
      cessRate: 0,
    };
    const t = tax(1050000, custom);
    expect(t.taxableIncome).toBe(1000000);
    expect(t.annualTax).toBe(70000);
    expect(t.monthlyTds).toBe(5833);
  });
});

describe("TDS deduction rule in payroll", () => {
  const components = [
    { name: "Basic Salary", monthlyAmount: 248500 },
    { name: "Other", monthlyAmount: 248500 },
  ]; // 4,97,000 a month, as in case B
  const rule = { id: 1, name: "TDS", type: "TDS" as const, tds: S };

  it("deducts one twelfth of the annual tax on the full monthly gross", () => {
    const r = calculatePayroll({ totalDays: 30, paidDays: 30, components, rules: [rule] });
    expect(r.deductions).toEqual([{ name: "TDS", amount: 128385, ruleId: 1 }]);
  });

  it("is not pro-rated for unpaid days", () => {
    const r = calculatePayroll({ totalDays: 30, paidDays: 15, components, rules: [rule] });
    expect(r.deductions[0].amount).toBe(128385);
  });

  it("is zero when no tax settings are attached", () => {
    const r = calculatePayroll({ totalDays: 30, paidDays: 30, components, rules: [{ id: 1, name: "TDS", type: "TDS" }] });
    expect(r.deductions[0].amount).toBe(0);
  });

  it('treats "Basic Salary" as Basic for percentage rules', () => {
    const r = calculatePayroll({
      totalDays: 30,
      paidDays: 30,
      components,
      rules: [{ id: 2, name: "PF", type: "PERCENTAGE", baseType: "BASIC", percentage: 12, baseCap: 25000 }],
    });
    expect(r.deductions[0].amount).toBe(3000);
  });
});
