import type { Company, Customer } from '@prisma/client';
import { resolveLabels, type Labels } from './labels';

/** Frozen copy of the seller as printed on this invoice. */
export type CompanySnapshot = {
  legalName: string;
  tradeName?: string | null;
  initials?: string | null;
  tagline?: string | null;
  logoPath?: string | null;
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  country: string;
  gstin?: string | null;
  pan?: string | null;
  cin?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNo?: string | null;
  bankIfsc?: string | null;
  bankBranch?: string | null;
  bankAccountType?: string | null;
  upiId?: string | null;
  invoiceSubtitle?: string | null;
  signaturePath?: string | null;
  /** fixed wording for this bill, frozen at save time */
  labels?: Labels;
};

/** Frozen copy of the buyer as printed on this invoice. */
export type CustomerSnapshot = {
  name: string;
  initials?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  billingLine1: string;
  billingLine2?: string | null;
  billingCity: string;
  billingState: string;
  billingStateCode: string;
  billingPincode: string;
  shippingName?: string | null;
  shippingLine1?: string | null;
  shippingLine2?: string | null;
  shippingCity?: string | null;
  shippingState?: string | null;
  shippingStateCode?: string | null;
  shippingPincode?: string | null;
  shipSameAsBilling: boolean;
};

export function companySnapshot(c: Company): CompanySnapshot {
  return {
    legalName: c.legalName,
    tradeName: c.tradeName,
    initials: c.initials,
    tagline: c.tagline,
    logoPath: c.logoPath,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    state: c.state,
    stateCode: c.stateCode,
    pincode: c.pincode,
    country: c.country,
    gstin: c.gstin,
    pan: c.pan,
    cin: c.cin,
    phone: c.phone,
    email: c.email,
    website: c.website,
    bankName: c.bankName,
    bankAccountName: c.bankAccountName,
    bankAccountNo: c.bankAccountNo,
    bankIfsc: c.bankIfsc,
    bankBranch: c.bankBranch,
    bankAccountType: c.bankAccountType,
    upiId: c.upiId,
    invoiceSubtitle: c.invoiceSubtitle,
    signaturePath: c.signaturePath,
    labels: resolveLabels(c.labels),
  };
}

export function customerSnapshot(c: Customer): CustomerSnapshot {
  return {
    name: c.name,
    initials: c.initials,
    gstin: c.gstin,
    phone: c.phone,
    email: c.email,
    billingLine1: c.billingLine1,
    billingLine2: c.billingLine2,
    billingCity: c.billingCity,
    billingState: c.billingState,
    billingStateCode: c.billingStateCode,
    billingPincode: c.billingPincode,
    shipSameAsBilling: c.shipSameAsBilling,
    shippingName: c.shippingName,
    shippingLine1: c.shippingLine1,
    shippingLine2: c.shippingLine2,
    shippingCity: c.shippingCity,
    shippingState: c.shippingState,
    shippingStateCode: c.shippingStateCode,
    shippingPincode: c.shippingPincode,
  };
}

export function parseCompanySnapshot(json: string): CompanySnapshot {
  return JSON.parse(json) as CompanySnapshot;
}
export function parseCustomerSnapshot(json: string): CustomerSnapshot {
  return JSON.parse(json) as CustomerSnapshot;
}

/** One-line address used in the PDF and list views. */
export function addressLines(a: {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}): string[] {
  const out: string[] = [];
  if (a.addressLine1) out.push(a.addressLine1);
  if (a.addressLine2) out.push(a.addressLine2);
  const tail = [a.city, a.state].filter(Boolean).join(', ');
  const withPin = [tail, a.pincode].filter(Boolean).join(' - ');
  if (withPin) out.push(withPin);
  return out;
}
