// Indian-system amount in words: thousand / lakh / crore.

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ' ' + ONES[o] : '');
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(ONES[h], 'Hundred');
  if (r) parts.push(twoDigits(r));
  return parts.join(' ');
}

/** 1234567 -> "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven" */
export function numberToIndianWords(num: number): string {
  let n = Math.floor(Math.abs(num));
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const rest = n;
  if (crore) parts.push(numberToIndianWords(crore), 'Crore');
  if (lakh) parts.push(threeDigits(lakh), 'Lakh');
  if (thousand) parts.push(threeDigits(thousand), 'Thousand');
  if (rest) parts.push(threeDigits(rest));
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * 12345678 paise -> "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six
 *                    and Seventy Eight Paise Only"
 */
export function paiseToWords(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  let out = 'Rupees ' + numberToIndianWords(rupees);
  if (p > 0) out += ' and ' + twoDigits(p) + ' Paise';
  out += ' Only';
  return (neg ? 'Minus ' : '') + out;
}
