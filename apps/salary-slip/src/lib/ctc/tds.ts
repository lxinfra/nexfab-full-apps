// Income tax under the new regime. Pure: every rate and slab comes from settings.

export interface TaxSlab {
  upTo: number | null; // upper limit of the slab (annual taxable income); null = no limit
  rate: number; // percent
}

export interface SurchargeTier {
  above: number; // surcharge applies when taxable income is above this
  rate: number; // percent of tax
}

export interface TdsSettings {
  standardDeduction: number;
  slabs: TaxSlab[];
  /** Tax is nil up to this taxable income; marginal relief applies just above it. 0 = no rebate. */
  rebateLimit: number;
  surcharge: SurchargeTier[];
  cessRate: number; // percent of tax + surcharge
}

export interface TaxComputation {
  annualIncome: number;
  taxableIncome: number;
  slabTax: number;
  /** Slab tax after the rebate and its marginal relief. */
  taxAfterRebate: number;
  surcharge: number;
  cess: number;
  annualTax: number; // rounded to the rupee
  monthlyTds: number; // annualTax / 12, rounded to the rupee
}

const round = (n: number) => Math.round(Number(n.toFixed(6)));

/** Tax on a taxable income from the slabs alone. */
export function slabTax(taxable: number, slabs: TaxSlab[]): number {
  let tax = 0;
  let lower = 0;
  for (const slab of [...slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity))) {
    const upper = slab.upTo ?? Infinity;
    if (taxable > lower) tax += ((Math.min(taxable, upper) - lower) * slab.rate) / 100;
    lower = upper;
  }
  return tax;
}

export function computeTax(annualIncome: number, settings: TdsSettings): TaxComputation {
  const taxable = Math.max(0, annualIncome - settings.standardDeduction);
  const fromSlabs = slabTax(taxable, settings.slabs);

  // Rebate: no tax up to the limit. Just above it, the tax cannot be more than
  // the income earned over the limit (marginal relief).
  let tax = fromSlabs;
  if (settings.rebateLimit > 0) {
    if (taxable <= settings.rebateLimit) tax = 0;
    else tax = Math.min(fromSlabs, taxable - settings.rebateLimit);
  }

  // Surcharge, with marginal relief at each threshold: crossing a threshold must
  // not cost more than the income earned over it.
  const tiers = [...settings.surcharge].sort((a, b) => a.above - b.above);
  let withSurcharge = tax;
  tiers.forEach((tier, i) => {
    if (taxable <= tier.above) return;
    const rateBelow = i > 0 ? tiers[i - 1].rate : 0;
    const atThreshold = slabTax(tier.above, settings.slabs) * (1 + rateBelow / 100);
    withSurcharge = Math.min(tax * (1 + tier.rate / 100), atThreshold + (taxable - tier.above));
  });

  const cess = (withSurcharge * settings.cessRate) / 100;
  const annualTax = round(withSurcharge + cess);
  return {
    annualIncome,
    taxableIncome: taxable,
    slabTax: fromSlabs,
    taxAfterRebate: tax,
    surcharge: withSurcharge - tax,
    cess,
    annualTax,
    monthlyTds: round(annualTax / 12),
  };
}
