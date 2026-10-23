import { stateByCode } from './states';

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
export const HSN_REGEX = /^[0-9]{4,8}$/;

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** GSTIN check digit (mod-36 double-and-sum, as published by GSTN). */
export function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = ALPHABET.indexOf(first14[i]);
    if (value < 0) return '';
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

export type GstinCheck = {
  ok: boolean;
  /** true when the string is structurally valid but the check digit is wrong */
  checksumFailed: boolean;
  stateCode?: string;
  stateName?: string;
  pan?: string;
  error?: string;
};

export function validateGstin(raw?: string | null): GstinCheck {
  const gstin = (raw ?? '').trim().toUpperCase();
  if (!gstin) return { ok: true, checksumFailed: false };
  if (gstin.length !== 15) {
    return { ok: false, checksumFailed: false, error: 'GSTIN must be exactly 15 characters' };
  }
  if (!GSTIN_REGEX.test(gstin)) {
    return {
      ok: false,
      checksumFailed: false,
      error: 'Format must be 22AAAAA0000A1Z5 (2 digits, 5 letters, 4 digits, letter, alphanumeric, Z, checksum)',
    };
  }
  const code = gstin.slice(0, 2);
  const st = stateByCode(code);
  if (!st) return { ok: false, checksumFailed: false, error: `"${code}" is not a valid GST state code` };
  const expected = gstinCheckDigit(gstin.slice(0, 14));
  if (expected !== gstin[14]) {
    return {
      ok: false,
      checksumFailed: true,
      stateCode: code,
      stateName: st.name,
      pan: gstin.slice(2, 12),
      error: `Check digit should be "${expected}" but is "${gstin[14]}"`,
    };
  }
  return { ok: true, checksumFailed: false, stateCode: code, stateName: st.name, pan: gstin.slice(2, 12) };
}

/** The GSTIN's leading 2 digits must agree with the chosen state. */
export function gstinMatchesState(gstin?: string | null, stateCode?: string | null): boolean {
  const g = (gstin ?? '').trim();
  if (!g || !stateCode) return true;
  return g.slice(0, 2) === String(stateCode).padStart(2, '0');
}

export function validatePan(raw?: string | null): string | null {
  const pan = (raw ?? '').trim().toUpperCase();
  if (!pan) return null;
  return PAN_REGEX.test(pan) ? null : 'PAN must look like AAAAA0000A';
}

export function validateIfsc(raw?: string | null): string | null {
  const v = (raw ?? '').trim().toUpperCase();
  if (!v) return null;
  return IFSC_REGEX.test(v) ? null : 'IFSC must be 11 characters, e.g. HDFC0001234';
}

export function validatePincode(raw?: string | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  return PINCODE_REGEX.test(v) ? null : 'PIN code must be 6 digits';
}

export function validateUpiId(raw?: string | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  return /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v) ? null : 'UPI ID must look like name@bank';
}
