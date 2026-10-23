import { describe, expect, it } from "vitest";
import { defaultPaidDays, monthsBetween } from "./joining";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("defaultPaidDays", () => {
  it("is the whole month for employees who joined earlier or have no joining date", () => {
    expect(defaultPaidDays(d("2025-04-01"), 2026, 9)).toBe(30);
    expect(defaultPaidDays(d("2026-08-31"), 2026, 9)).toBe(30);
    expect(defaultPaidDays(null, 2026, 2)).toBe(28);
  });

  it("counts from the joining date in the joining month", () => {
    expect(defaultPaidDays(d("2026-07-19"), 2026, 7)).toBe(13); // 19th to 31st
    expect(defaultPaidDays(d("2026-09-01"), 2026, 9)).toBe(30);
    expect(defaultPaidDays(d("2026-09-30"), 2026, 9)).toBe(1);
  });

  it("is null for months before the employee joined", () => {
    expect(defaultPaidDays(d("2026-07-19"), 2026, 6)).toBeNull();
    expect(defaultPaidDays(d("2026-01-01"), 2025, 12)).toBeNull();
  });
});

describe("monthsBetween", () => {
  it("lists every month, oldest first, across a year end", () => {
    expect(monthsBetween({ year: 2025, month: 11 }, { year: 2026, month: 2 })).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
    ]);
  });

  it("handles a single month and an empty range", () => {
    expect(monthsBetween({ year: 2026, month: 5 }, { year: 2026, month: 5 })).toEqual([{ year: 2026, month: 5 }]);
    expect(monthsBetween({ year: 2026, month: 6 }, { year: 2026, month: 5 })).toEqual([]);
  });
});
