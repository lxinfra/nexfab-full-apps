import { z } from 'zod';
import { DOC_TYPES, GST_RATES, PAYMENT_METHODS, STATUSES, WITHIN_STATE_SUPPLY } from './constants';
import { GSTIN_REGEX, gstinCheckDigit } from './validate';
import { stateByCode } from './states';
import { validateHsn } from './hsn';

/** Optional text field: a missing value or an empty string both become null. */
const blankToNull = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    const t = (v ?? '').toString().trim();
    return t === '' ? null : t;
  });

const upper = (v: string | null) => (v ? v.toUpperCase() : v);

export const gstinField = blankToNull.refine(
  (v) => {
    if (!v) return true;
    const g = v.toUpperCase();
    if (!GSTIN_REGEX.test(g)) return false;
    if (!stateByCode(g.slice(0, 2))) return false;
    return gstinCheckDigit(g.slice(0, 14)) === g[14];
  },
  { message: 'Invalid GSTIN (check the 15-character format, state code and check digit)' },
).transform(upper);

const stateCodeField = z
  .string()
  .trim()
  .min(1, 'State is required')
  .refine((v) => !!stateByCode(v), 'Unknown state code');

export const companySchema = z
  .object({
    legalName: z.string().trim().min(2, 'Legal name is required'),
    tradeName: blankToNull,
    initials: blankToNull.transform(upper),
    tagline: blankToNull,
    logoPath: blankToNull,
    addressLine1: z.string().trim().min(2, 'Address is required'),
    addressLine2: blankToNull,
    city: z.string().trim().min(1, 'City is required'),
    stateCode: stateCodeField,
    pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'PIN code must be 6 digits'),
    country: z.string().trim().default('India'),
    gstin: gstinField,
    pan: blankToNull.refine(
      (v) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()),
      'PAN must look like AAAAA0000A',
    ).transform(upper),
    cin: blankToNull.refine(
      (v) => !v || /^[A-Z][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/.test(v.toUpperCase()),
      'CIN must be 21 characters, e.g. U74999MP2018PLC046065',
    ).transform(upper),
    phone: blankToNull,
    email: blankToNull.refine((v) => !v || z.email().safeParse(v).success, 'Invalid email'),
    website: blankToNull,
    bankName: blankToNull,
    bankAccountName: blankToNull,
    bankAccountNo: blankToNull,
    bankIfsc: blankToNull.refine(
      (v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase()),
      'IFSC must be 11 characters, e.g. HDFC0001234',
    ).transform(upper),
    bankBranch: blankToNull,
    bankAccountType: blankToNull,
    upiId: blankToNull.refine(
      (v) => !v || /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(v),
      'UPI ID must look like name@bank',
    ),
    invoicePrefix: z.string().trim().max(24).default('INV/'),
    numberFormat: z.string().trim().max(80).default('{SELLER}/{MM}/{BUYER}/{SEQ}'),
    invoiceSubtitle: blankToNull,
    includeFyInNo: z.boolean().default(true),
    numberPadding: z.coerce.number().int().min(1).max(8).default(4),
    numberStart: z.coerce.number().int().min(1).max(99999999).default(1),
    defaultTerms: blankToNull,
    signaturePath: blankToNull,
    labels: blankToNull,
  })
  .superRefine((val, ctx) => {
    if (val.gstin && val.gstin.slice(0, 2) !== val.stateCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: `GSTIN starts with ${val.gstin.slice(0, 2)} but the selected state is ${val.stateCode}`,
      });
    }
  })
  .transform((v) => ({ ...v, state: stateByCode(v.stateCode)!.name }));

export const customerSchema = z
  .object({
    name: z.string().trim().min(2, 'Customer name is required'),
    initials: blankToNull.transform(upper),
    gstin: gstinField,
    phone: blankToNull,
    email: blankToNull.refine((v) => !v || z.email().safeParse(v).success, 'Invalid email'),
    billingLine1: z.string().trim().min(2, 'Billing address is required'),
    billingLine2: blankToNull,
    billingCity: z.string().trim().min(1, 'City is required'),
    billingStateCode: stateCodeField,
    billingPincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'PIN code must be 6 digits'),
    shipSameAsBilling: z.boolean().default(true),
    shippingName: blankToNull,
    shippingLine1: blankToNull,
    shippingLine2: blankToNull,
    shippingCity: blankToNull,
    shippingStateCode: blankToNull,
    shippingPincode: blankToNull,
    notes: blankToNull,
  })
  .superRefine((val, ctx) => {
    if (val.gstin && val.gstin.slice(0, 2) !== val.billingStateCode) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: `GSTIN starts with ${val.gstin.slice(0, 2)} but the billing state is ${val.billingStateCode}`,
      });
    }
    if (!val.shipSameAsBilling && !val.shippingLine1) {
      ctx.addIssue({
        code: 'custom',
        path: ['shippingLine1'],
        message: 'Shipping address is required when it differs from billing',
      });
    }
  })
  .transform((v) => ({
    ...v,
    billingState: stateByCode(v.billingStateCode)!.name,
    shippingState: v.shipSameAsBilling ? null : (stateByCode(v.shippingStateCode)?.name ?? null),
  }));

export const productSchema = z.object({
  name: z.string().trim().min(1, 'Product name is required'),
  description: blankToNull,
  hsnSac: blankToNull.superRefine((v, ctx) => {
    const err = validateHsn(v);
    if (err) ctx.addIssue({ code: 'custom', message: err });
  }),
  unit: z.string().trim().min(1).default('PCS'),
  ratePaise: z.coerce.number().int().min(0, 'Rate cannot be negative'),
  gstRate: z.coerce
    .number()
    .int()
    .refine((v) => (GST_RATES as readonly number[]).includes(v), 'GST rate must be 0, 5, 12, 18 or 28'),
  isService: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const lineSchema = z.object({
  productId: blankToNull,
  name: z.string().trim().min(1, 'Item name is required'),
  description: blankToNull,
  hsnSac: blankToNull,
  unit: z.string().trim().min(1).default('PCS'),
  qtyMilli: z.coerce.number().int().min(1, 'Quantity must be more than zero'),
  ratePaise: z.coerce.number().int().min(0),
  discountType: z.enum(['PERCENT', 'AMOUNT']).default('PERCENT'),
  discountValue: z.coerce.number().int().min(0).default(0),
  gstRate: z.coerce.number().int().min(0).max(100),
});

export const invoiceSchema = z.object({
  docType: z.enum(DOC_TYPES).default('TAX_INVOICE'),
  customerId: z.string().trim().min(1, 'Choose a customer'),
  invoiceDate: z.string().trim().min(1, 'Invoice date is required'),
  dueDate: blankToNull,
  placeOfSupplyCode: stateCodeField,
  reverseCharge: z.boolean().default(false),
  roundOff: z.boolean().default(true),
  /** Only meaningful when the place of supply is inside the company's own state. */
  withinStateSupply: z.enum(WITHIN_STATE_SUPPLY).default('INTRA_STATE'),
  agreementNo: blankToNull,
  workOrderDate: blankToNull,
  rebateLabel: blankToNull,
  /** tender rebate in basis points: 21.01% -> 2101 */
  rebateBp: z.coerce.number().int().min(0).max(10000).default(0),
  /** Type a number here to use it instead of the next one in the series. */
  numberOverride: blankToNull,
  /** Why an already-issued bill was changed; stored with the revision. */
  editReason: blankToNull,
  notes: blankToNull,
  terms: blankToNull,
  items: z.array(lineSchema).min(1, 'Add at least one line item'),
  /** DRAFT keeps the invoice un-numbered; anything else issues a number. */
  status: z.enum(STATUSES).default('DRAFT'),
});

export const paymentSchema = z.object({
  paidOn: z.string().trim().min(1, 'Payment date is required'),
  amountPaise: z.coerce.number().int().min(1, 'Amount must be more than zero'),
  method: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
  reference: blankToNull,
  notes: blankToNull,
});

export type CompanyInput = z.infer<typeof companySchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type InvoiceInput = z.infer<typeof invoiceSchema>;
