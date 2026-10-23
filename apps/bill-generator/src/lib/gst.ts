import { divRound } from './money';

export type SupplyType = 'INTRA_STATE' | 'INTRA_CITY' | 'INTER_STATE';

/**
 * Which pair of taxes applies.
 *
 * Under GST the levy depends on whether the supply crosses a state border, not
 * a city one: a supply inside the same state attracts CGST + SGST whether or
 * not it stays within one city. So INTRA_CITY is taxed exactly like
 * INTRA_STATE, and only INTER_STATE attracts IGST. INTRA_CITY is recorded
 * separately because it is useful on the document and in reporting.
 */
export function chargesCgstSgst(supplyType: SupplyType): boolean {
  return supplyType !== 'INTER_STATE';
}
export type DiscountType = 'PERCENT' | 'AMOUNT';

/** What the caller supplies for one line. All integers. */
export type LineInput = {
  name: string;
  description?: string | null;
  hsnSac?: string | null;
  unit: string;
  qtyMilli: number;
  ratePaise: number;
  /** PERCENT -> basis points (12.5% = 1250); AMOUNT -> paise off the whole line */
  discountType: DiscountType;
  discountValue: number;
  gstRate: number;
  productId?: string | null;
};

/** A fully computed line. */
export type ComputedLine = LineInput & {
  grossPaise: number;
  /** this line's share of any invoice-wide rebate */
  rebatePaise?: number;
  discountPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  totalPaise: number;
};

/**
 * Decides CGST+SGST vs IGST. Intra-state (supplier state == place of supply)
 * attracts CGST + SGST; anything else attracts IGST.
 */
export function supplyTypeFor(
  companyStateCode: string,
  placeOfSupplyCode: string,
  /** Within the same state the user picks whether it is also within the city. */
  withinState: 'INTRA_STATE' | 'INTRA_CITY' = 'INTRA_STATE',
): SupplyType {
  const a = String(companyStateCode ?? '').padStart(2, '0');
  const b = String(placeOfSupplyCode ?? '').padStart(2, '0');
  return a && b && a === b ? withinState : 'INTER_STATE';
}

/**
 * One line, exact integer maths.
 *   gross    = qty x rate                      (rounded to paise once)
 *   discount = % of gross, or a flat amount    (never more than gross)
 *   taxable  = gross - discount
 *   tax      = taxable x gstRate%              (rounded to paise once)
 * For intra-state supply the tax is halved; the odd paise goes to CGST so
 * CGST + SGST always equals the line tax exactly.
 */
export function computeLine(line: LineInput, supplyType: SupplyType): ComputedLine {
  const grossPaise = divRound(line.qtyMilli * line.ratePaise, 1000);

  let discountPaise =
    line.discountType === 'PERCENT'
      ? divRound(grossPaise * line.discountValue, 10000)
      : line.discountValue;
  if (discountPaise < 0) discountPaise = 0;
  if (discountPaise > grossPaise) discountPaise = grossPaise;

  const taxablePaise = grossPaise - discountPaise;
  const taxPaise = divRound(taxablePaise * line.gstRate, 100);

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (chargesCgstSgst(supplyType)) {
    sgstPaise = Math.floor(taxPaise / 2);
    cgstPaise = taxPaise - sgstPaise;
  } else {
    igstPaise = taxPaise;
  }

  return {
    ...line,
    grossPaise,
    discountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    taxPaise,
    totalPaise: taxablePaise + taxPaise,
  };
}

/**
 * An invoice-wide rebate, as used in tender billing ("21.01% below the schedule
 * of rates"). It applies to the basic total, after any per-line discount.
 *
 * The rebate is spread across the lines in proportion to their taxable value so
 * each GST slab is taxed on its own reduced share - which is what the law
 * requires, and what keeps the HSN summary adding up. The largest-remainder
 * method hands out the odd paise so the parts sum to the whole exactly.
 */
export function applyRebate(
  lines: ComputedLine[],
  rebateBp: number,
  supplyType: SupplyType,
): {
  lines: ComputedLine[];
  basicTotalPaise: number;
  rebatePaise: number;
} {
  const basicTotalPaise = lines.reduce((a, l) => a + l.taxablePaise, 0);
  if (!rebateBp || rebateBp <= 0 || basicTotalPaise <= 0) {
    return { lines, basicTotalPaise, rebatePaise: 0 };
  }

  const capped = Math.min(rebateBp, 10000); // never more than 100%
  const rebatePaise = Math.min(divRound(basicTotalPaise * capped, 10000), basicTotalPaise);

  // Exact shares, then distribute the rounding remainder to the biggest lines.
  const exact = lines.map((l) => (l.taxablePaise * rebatePaise) / basicTotalPaise);
  const floors = exact.map((v) => Math.floor(v));
  let left = rebatePaise - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const share = [...floors];
  for (let k = 0; k < order.length && left > 0; k++, left--) share[order[k].i] += 1;

  const adjusted = lines.map((l, i) => {
    const taxablePaise = l.taxablePaise - share[i];
    const taxPaise = divRound(taxablePaise * l.gstRate, 100);
    const sgstPaise = chargesCgstSgst(supplyType) ? Math.floor(taxPaise / 2) : 0;
    const cgstPaise = chargesCgstSgst(supplyType) ? taxPaise - sgstPaise : 0;
    const igstPaise = chargesCgstSgst(supplyType) ? 0 : taxPaise;
    return {
      ...l,
      rebatePaise: share[i],
      taxablePaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      taxPaise,
      totalPaise: taxablePaise + taxPaise,
    };
  });

  return { lines: adjusted, basicTotalPaise, rebatePaise };
}

export type Totals = {
  subtotalPaise: number;
  discountPaise: number;
  /** sum of line taxables, before the invoice-wide rebate */
  basicTotalPaise: number;
  rebatePaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
  /** total before round-off */
  grossTotalPaise: number;
  roundOffPaise: number;
  totalPaise: number;
};

/** Sums computed lines and applies an optional round-off to the nearest rupee. */
export function computeTotals(
  lines: ComputedLine[],
  roundOff = true,
  extra?: { basicTotalPaise?: number; rebatePaise?: number },
): Totals {
  const t = lines.reduce(
    (acc, l) => ({
      subtotalPaise: acc.subtotalPaise + l.grossPaise,
      discountPaise: acc.discountPaise + l.discountPaise,
      taxablePaise: acc.taxablePaise + l.taxablePaise,
      cgstPaise: acc.cgstPaise + l.cgstPaise,
      sgstPaise: acc.sgstPaise + l.sgstPaise,
      igstPaise: acc.igstPaise + l.igstPaise,
    }),
    { subtotalPaise: 0, discountPaise: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 },
  );

  const taxPaise = t.cgstPaise + t.sgstPaise + t.igstPaise;
  const rebatePaise = extra?.rebatePaise ?? 0;
  const basicTotalPaise = extra?.basicTotalPaise ?? t.taxablePaise;
  const grossTotalPaise = t.taxablePaise + taxPaise;
  const nearestRupee = divRound(grossTotalPaise, 100) * 100;
  const roundOffPaise = roundOff ? nearestRupee - grossTotalPaise : 0;

  return {
    ...t,
    basicTotalPaise,
    rebatePaise,
    taxPaise,
    grossTotalPaise,
    roundOffPaise,
    totalPaise: grossTotalPaise + roundOffPaise,
  };
}

export type HsnSummaryRow = {
  hsnSac: string;
  gstRate: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  taxPaise: number;
};

/** HSN/SAC-wise tax summary table required on a GST tax invoice. */
export function hsnSummary(lines: ComputedLine[]): HsnSummaryRow[] {
  const map = new Map<string, HsnSummaryRow>();
  for (const l of lines) {
    const hsn = (l.hsnSac ?? '').trim() || '-';
    const key = `${hsn}|${l.gstRate}`;
    const row =
      map.get(key) ??
      { hsnSac: hsn, gstRate: l.gstRate, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, taxPaise: 0 };
    row.taxablePaise += l.taxablePaise;
    row.cgstPaise += l.cgstPaise;
    row.sgstPaise += l.sgstPaise;
    row.igstPaise += l.igstPaise;
    row.taxPaise += l.cgstPaise + l.sgstPaise + l.igstPaise;
    map.set(key, row);
  }
  return [...map.values()].sort(
    (a, b) => a.hsnSac.localeCompare(b.hsnSac) || a.gstRate - b.gstRate,
  );
}

/** Rate-wise breakup used in the totals panel ("CGST @ 9%", "IGST @ 18%" ...). */
export type TaxBreakupRow = { label: string; ratePercent: number; amountPaise: number };

export function taxBreakup(lines: ComputedLine[], supplyType: SupplyType): TaxBreakupRow[] {
  const byRate = new Map<number, { cgst: number; sgst: number; igst: number }>();
  for (const l of lines) {
    if (l.gstRate === 0) continue;
    const e = byRate.get(l.gstRate) ?? { cgst: 0, sgst: 0, igst: 0 };
    e.cgst += l.cgstPaise;
    e.sgst += l.sgstPaise;
    e.igst += l.igstPaise;
    byRate.set(l.gstRate, e);
  }
  const rows: TaxBreakupRow[] = [];
  for (const rate of [...byRate.keys()].sort((a, b) => a - b)) {
    const e = byRate.get(rate)!;
    if (chargesCgstSgst(supplyType)) {
      if (e.cgst) rows.push({ label: `CGST @ ${rate / 2}%`, ratePercent: rate / 2, amountPaise: e.cgst });
      if (e.sgst) rows.push({ label: `SGST @ ${rate / 2}%`, ratePercent: rate / 2, amountPaise: e.sgst });
    } else if (e.igst) {
      rows.push({ label: `IGST @ ${rate}%`, ratePercent: rate, amountPaise: e.igst });
    }
  }
  return rows;
}
