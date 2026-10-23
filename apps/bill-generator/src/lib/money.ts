// All money is handled as an integer number of paise. No floats anywhere.

/** Integer division rounded half-up (away from zero on .5). */
export function divRound(numerator: number, denominator: number): number {
  if (denominator === 0) throw new Error('divRound: division by zero');
  const neg = numerator < 0 !== denominator < 0;
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  const q = Math.floor((n * 2 + d) / (d * 2));
  return neg ? -q : q;
}

/** "1,250.50" | 1250.5 -> 125050 paise. Tolerates ₹, commas, spaces, blanks. */
export function toPaise(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0;
    return Math.round(input * 100);
  }
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  const neg = cleaned.startsWith('-');
  const [rupeesRaw = '0', decRaw = ''] = cleaned.replace('-', '').split('.');
  const rupees = parseInt(rupeesRaw || '0', 10) || 0;
  const dec = (decRaw + '00').slice(0, 3);
  // use the 3rd decimal digit to round the paise half-up
  const paise2 = parseInt(dec.slice(0, 2), 10) || 0;
  const third = parseInt(dec.slice(2, 3), 10) || 0;
  let paise = rupees * 100 + paise2 + (third >= 5 ? 1 : 0);
  return neg ? -paise : paise;
}

/** 125050 -> "1,250.50" (Indian digit grouping, always 2 decimals). */
export function formatPaise(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}${groupIndian(rupees)}.${rem}`;
}

/** 125050 -> "₹1,250.50" */
export function formatINR(paise: number): string {
  const s = formatPaise(paise);
  return s.startsWith('-') ? `-₹${s.slice(1)}` : `₹${s}`;
}

/** Indian grouping: last 3 digits, then pairs. 12345678 -> "1,23,45,678" */
export function groupIndian(n: number): string {
  const s = String(Math.abs(Math.trunc(n)));
  if (s.length <= 3) return (n < 0 ? '-' : '') + s;
  const last3 = s.slice(-3);
  let rest = s.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return (n < 0 ? '-' : '') + parts.join(',') + ',' + last3;
}

/** 125050 -> "1250.50" for form inputs (no grouping). */
export function paiseToInput(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ---- quantities: integers in thousandths of a unit -------------------------

/** "2.5" -> 2500 */
export function toQtyMilli(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return Math.round(input * 1000);
  const cleaned = input.replace(/[^0-9.-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return 0;
  const neg = cleaned.startsWith('-');
  const [whole = '0', decRaw = ''] = cleaned.replace('-', '').split('.');
  const dec = (decRaw + '0000').slice(0, 4);
  const milli3 = parseInt(dec.slice(0, 3), 10) || 0;
  const fourth = parseInt(dec.slice(3, 4), 10) || 0;
  const v = (parseInt(whole || '0', 10) || 0) * 1000 + milli3 + (fourth >= 5 ? 1 : 0);
  return neg ? -v : v;
}

/** 2500 -> "2.5"  |  2000 -> "2" */
export function formatQty(qtyMilli: number): string {
  const neg = qtyMilli < 0;
  const abs = Math.abs(Math.trunc(qtyMilli));
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/** Percent values are stored as basis points: 12.5% -> 1250 */
export function toBasisPoints(input: string | number | null | undefined): number {
  return toPaise(input); // same 2-decimal scaling
}

export function formatBasisPoints(bp: number): string {
  const s = formatPaise(bp).replace(/,/g, '');
  return s.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}
