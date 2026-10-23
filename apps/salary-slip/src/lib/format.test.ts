import { describe, expect, it } from "vitest";
import { amountInWords, daysInMonth, formatINR, maskAccount, numberToIndianWords } from "./format";

describe("formatINR", () => {
  it("uses Indian digit grouping", () => {
    expect(formatINR(0)).toBe("0.00");
    expect(formatINR(999)).toBe("999.00");
    expect(formatINR(1000)).toBe("1,000.00");
    expect(formatINR(120000)).toBe("1,20,000.00");
    expect(formatINR(12345678.5)).toBe("1,23,45,678.50");
    expect(formatINR(1234567890)).toBe("1,23,45,67,890.00");
  });

  it("handles negatives and no-decimal output", () => {
    expect(formatINR(-120000)).toBe("-1,20,000.00");
    expect(formatINR(120000, 0)).toBe("1,20,000");
  });
});

describe("amountInWords", () => {
  it("uses lakh and crore", () => {
    expect(amountInWords(120000)).toBe("Rupees One Lakh Twenty Thousand Only");
    expect(amountInWords(0)).toBe("Rupees Zero Only");
    expect(amountInWords(15)).toBe("Rupees Fifteen Only");
    expect(amountInWords(100)).toBe("Rupees One Hundred Only");
    expect(amountInWords(33622)).toBe("Rupees Thirty Three Thousand Six Hundred Twenty Two Only");
    expect(amountInWords(10000000)).toBe("Rupees One Crore Only");
    expect(amountInWords(12345678)).toBe(
      "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only",
    );
  });

  it("handles paise and negatives", () => {
    expect(amountInWords(10.5)).toBe("Rupees Ten and Fifty Paise Only");
    expect(amountInWords(-200)).toBe("Minus Rupees Two Hundred Only");
  });

  it("handles large crore values", () => {
    expect(numberToIndianWords(1250000000)).toBe("One Hundred Twenty Five Crore");
  });
});

describe("maskAccount", () => {
  it("shows only the last 4 digits", () => {
    expect(maskAccount("123456789012")).toBe("XXXXXXXX9012");
    expect(maskAccount("1234")).toBe("1234");
    expect(maskAccount("")).toBe("");
    expect(maskAccount(null)).toBe("");
  });
});

describe("daysInMonth", () => {
  it("knows month lengths and leap years", () => {
    expect(daysInMonth(1, 2026)).toBe(31);
    expect(daysInMonth(2, 2026)).toBe(28);
    expect(daysInMonth(2, 2028)).toBe(29);
    expect(daysInMonth(9, 2026)).toBe(30);
  });
});
