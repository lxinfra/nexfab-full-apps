import type { DiscountType, LineInput } from '@/lib/gst';
import { toBasisPoints, toPaise, toQtyMilli } from '@/lib/money';

/** One editable row in the items table. Kept as strings so typing feels natural. */
export type Row = {
  key: string;
  productId: string;
  name: string;
  description: string;
  hsnSac: string;
  unit: string;
  qty: string;
  rate: string;
  discountType: DiscountType;
  discountValue: string;
  gstRate: number;
};

export type ProductLite = {
  id: string;
  name: string;
  description: string | null;
  hsnSac: string | null;
  unit: string;
  ratePaise: number;
  gstRate: number;
};

export type CustomerLite = {
  id: string;
  name: string;
  gstin: string | null;
  billingLine1: string;
  billingLine2: string | null;
  billingCity: string;
  billingState: string;
  billingStateCode: string;
  billingPincode: string;
  shipSameAsBilling: boolean;
  shippingName: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingStateCode: string | null;
  shippingPincode: string | null;
  phone: string | null;
  email: string | null;
};

let counter = 0;
export function newRow(partial: Partial<Row> = {}): Row {
  counter += 1;
  return {
    key: `row-${Date.now()}-${counter}`,
    productId: '',
    name: '',
    description: '',
    hsnSac: '',
    unit: 'PCS',
    qty: '1',
    rate: '',
    discountType: 'PERCENT',
    discountValue: '0',
    gstRate: 18,
    ...partial,
  };
}

export function rowToLine(r: Row): LineInput {
  return {
    productId: r.productId || null,
    name: r.name,
    description: r.description || null,
    hsnSac: r.hsnSac || null,
    unit: r.unit,
    qtyMilli: toQtyMilli(r.qty),
    ratePaise: toPaise(r.rate),
    discountType: r.discountType,
    discountValue:
      r.discountType === 'PERCENT' ? toBasisPoints(r.discountValue) : toPaise(r.discountValue),
    gstRate: r.gstRate,
  };
}

/** Payload shape the API expects for one line. */
export function rowToPayload(r: Row) {
  const l = rowToLine(r);
  return {
    productId: l.productId,
    name: l.name,
    description: l.description,
    hsnSac: l.hsnSac,
    unit: l.unit,
    qtyMilli: l.qtyMilli,
    ratePaise: l.ratePaise,
    discountType: l.discountType,
    discountValue: l.discountValue,
    gstRate: l.gstRate,
  };
}
