import { prisma } from './db';

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  gstin: true,
  billingLine1: true,
  billingLine2: true,
  billingCity: true,
  billingState: true,
  billingStateCode: true,
  billingPincode: true,
  shipSameAsBilling: true,
  shippingName: true,
  shippingLine1: true,
  shippingLine2: true,
  shippingCity: true,
  shippingState: true,
  shippingStateCode: true,
  shippingPincode: true,
  phone: true,
  email: true,
} as const;

const PRODUCT_SELECT = {
  id: true,
  name: true,
  description: true,
  hsnSac: true,
  unit: true,
  ratePaise: true,
  gstRate: true,
} as const;

/** Everything the invoice form needs in one round trip. */
export async function formData(companyId: string) {
  const [customers, products] = await Promise.all([
    prisma.customer.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
      select: CUSTOMER_SELECT,
    }),
    prisma.product.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: 'asc' },
      select: PRODUCT_SELECT,
    }),
  ]);
  return { customers, products };
}
