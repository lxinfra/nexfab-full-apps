import { describe, expect, it } from "vitest";
import defaultRules from "../../prisma/default-rules.json";
import { calculatePayroll, type DeductionRuleInput } from "./payroll/calc";
import { SALARY_PRESETS } from "./salary-presets";

const rules = defaultRules.map((r, i) => ({ id: i + 1, ...r })) as DeductionRuleInput[];

describe("ready-made salaries", () => {
  it.each(SALARY_PRESETS.map((p) => [p.label, p] as const))("%s nets the stated amount under the default rules", (_label, p) => {
    const r = calculatePayroll({ totalDays: 30, paidDays: 30, components: p.components, rules });
    expect(r.netPay).toBe(p.inHand);
  });

  it("match the three sample slips", () => {
    const gross = SALARY_PRESETS.map((p) => p.components.reduce((a, c) => a + c.monthlyAmount, 0));
    expect(gross).toEqual([111342, 555787, 1111342]);
  });
});
