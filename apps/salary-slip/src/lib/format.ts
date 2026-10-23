// Pure formatting helpers shared by the UI, the PDF and the Excel exports.

export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const monthName = (month: number) => MONTHS[month - 1] ?? "";
export const monthLabel = (month: number, year: number) => `${monthName(month)} ${year}`;
export const daysInMonth = (month: number, year: number) => new Date(year, month, 0).getDate();

/** Indian digit grouping with two decimals: 120000 -> "1,20,000.00". */
export function formatINR(value: number, decimals = 2): string {
  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  let grouped = whole;
  if (whole.length > 3) {
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
    grouped = `${rest},${last3}`;
  }
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function threeDigits(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
  if (n % 100) parts.push(twoDigits(n % 100));
  return parts.join(" ");
}

/** Whole number in words using the Indian system (thousand, lakh, crore). */
export function numberToIndianWords(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${numberToIndianWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/** 120000 -> "Rupees One Lakh Twenty Thousand Only". */
export function amountInWords(amount: number): string {
  const negative = amount < 0;
  const totalPaise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;
  let words = `Rupees ${numberToIndianWords(rupees)}`;
  if (paise) words += ` and ${twoDigits(paise)} Paise`;
  return `${negative ? "Minus " : ""}${words} Only`;
}

/** Hide all but the last 4 characters: "123456789012" -> "XXXXXXXX9012". */
export function maskAccount(account: string | null | undefined): string {
  if (!account) return "";
  const trimmed = account.trim();
  if (trimmed.length <= 4) return trimmed;
  return "X".repeat(trimmed.length - 4) + trimmed.slice(-4);
}

/** Date as DD/MM/YYYY (dates are stored as UTC midnight). */
export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/** Date as YYYY-MM-DD for <input type="date">. */
export function toDateInput(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
