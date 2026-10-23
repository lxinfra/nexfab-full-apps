/**
 * HSN / SAC codes.
 *
 * India uses the 8-digit Customs Tariff classification:
 *   2 digits  -> Chapter
 *   4 digits  -> Heading
 *   6 digits  -> Sub-heading   (the internationally harmonised part)
 *   8 digits  -> Tariff item   (the national extension)
 *
 * Services use SAC instead: chapter 99, always 6 digits (e.g. 995461).
 */

export const HSN_CHAPTERS: Record<string, string> = {
  '01': 'Live animals',
  '02': 'Meat and edible meat offal',
  '03': 'Fish and crustaceans, molluscs and other aquatic invertebrates',
  '04': "Dairy produce; birds' eggs; natural honey; edible products of animal origin",
  '05': 'Products of animal origin, not elsewhere specified',
  '06': 'Live trees and other plants; bulbs, roots; cut flowers and ornamental foliage',
  '07': 'Edible vegetables and certain roots and tubers',
  '08': 'Edible fruit and nuts; peel of citrus fruit or melons',
  '09': 'Coffee, tea, maté and spices',
  '10': 'Cereals',
  '11': 'Products of the milling industry; malt; starches; inulin; wheat gluten',
  '12': 'Oil seeds and oleaginous fruits; miscellaneous grains, seeds and fruit',
  '13': 'Lac; gums, resins and other vegetable saps and extracts',
  '14': 'Vegetable plaiting materials; vegetable products not elsewhere specified',
  '15': 'Animal or vegetable fats and oils; prepared edible fats; waxes',
  '16': 'Preparations of meat, fish, crustaceans or molluscs',
  '17': 'Sugars and sugar confectionery',
  '18': 'Cocoa and cocoa preparations',
  '19': "Preparations of cereals, flour, starch or milk; pastrycooks' products",
  '20': 'Preparations of vegetables, fruit, nuts or other parts of plants',
  '21': 'Miscellaneous edible preparations',
  '22': 'Beverages, spirits and vinegar',
  '23': 'Residues and waste from the food industries; prepared animal fodder',
  '24': 'Tobacco and manufactured tobacco substitutes',
  '25': 'Salt; sulphur; earths and stone; plastering materials, lime and cement',
  '26': 'Ores, slag and ash',
  '27': 'Mineral fuels, mineral oils and products of their distillation',
  '28': 'Inorganic chemicals; compounds of precious metals and radioactive elements',
  '29': 'Organic chemicals',
  '30': 'Pharmaceutical products',
  '31': 'Fertilisers',
  '32': 'Tanning or dyeing extracts; dyes, pigments, paints, varnishes, inks',
  '33': 'Essential oils and resinoids; perfumery, cosmetic or toilet preparations',
  '34': 'Soap, washing and lubricating preparations, waxes, candles, modelling pastes',
  '35': 'Albuminoidal substances; modified starches; glues; enzymes',
  '36': 'Explosives; pyrotechnic products; matches; pyrophoric alloys',
  '37': 'Photographic or cinematographic goods',
  '38': 'Miscellaneous chemical products',
  '39': 'Plastics and articles thereof',
  '40': 'Rubber and articles thereof',
  '41': 'Raw hides and skins (other than furskins) and leather',
  '42': 'Articles of leather; saddlery and harness; travel goods, handbags',
  '43': 'Furskins and artificial fur; manufactures thereof',
  '44': 'Wood and articles of wood; wood charcoal',
  '45': 'Cork and articles of cork',
  '46': 'Manufactures of straw, esparto or other plaiting materials; basketware',
  '47': 'Pulp of wood or other fibrous cellulosic material; recovered paper',
  '48': 'Paper and paperboard; articles of paper pulp, paper or paperboard',
  '49': 'Printed books, newspapers, pictures; manuscripts, typescripts and plans',
  '50': 'Silk',
  '51': 'Wool, fine or coarse animal hair; horsehair yarn and woven fabric',
  '52': 'Cotton',
  '53': 'Other vegetable textile fibres; paper yarn and woven fabrics of paper yarn',
  '54': 'Man-made filaments; strip and the like of man-made textile materials',
  '55': 'Man-made staple fibres',
  '56': 'Wadding, felt and nonwovens; special yarns; twine, cordage, ropes and cables',
  '57': 'Carpets and other textile floor coverings',
  '58': 'Special woven fabrics; tufted textile fabrics; lace; tapestries; embroidery',
  '59': 'Impregnated, coated, covered or laminated textile fabrics',
  '60': 'Knitted or crocheted fabrics',
  '61': 'Articles of apparel and clothing accessories, knitted or crocheted',
  '62': 'Articles of apparel and clothing accessories, not knitted or crocheted',
  '63': 'Other made up textile articles; sets; worn clothing; rags',
  '64': 'Footwear, gaiters and the like; parts of such articles',
  '65': 'Headgear and parts thereof',
  '66': 'Umbrellas, sun umbrellas, walking-sticks, whips, riding-crops and parts',
  '67': 'Prepared feathers and down; artificial flowers; articles of human hair',
  '68': 'Articles of stone, plaster, cement, asbestos, mica or similar materials',
  '69': 'Ceramic products',
  '70': 'Glass and glassware',
  '71': 'Pearls, precious stones and metals; imitation jewellery; coin',
  '72': 'Iron and steel',
  '73': 'Articles of iron or steel',
  '74': 'Copper and articles thereof',
  '75': 'Nickel and articles thereof',
  '76': 'Aluminium and articles thereof',
  '77': '(Reserved for possible future use)',
  '78': 'Lead and articles thereof',
  '79': 'Zinc and articles thereof',
  '80': 'Tin and articles thereof',
  '81': 'Other base metals; cermets; articles thereof',
  '82': 'Tools, implements, cutlery, spoons and forks, of base metal',
  '83': 'Miscellaneous articles of base metal',
  '84': 'Nuclear reactors, boilers, machinery and mechanical appliances; parts',
  '85': 'Electrical machinery and equipment; sound and television recorders; parts',
  '86': 'Railway or tramway locomotives, rolling-stock, track fixtures and fittings',
  '87': 'Vehicles other than railway or tramway rolling-stock; parts and accessories',
  '88': 'Aircraft, spacecraft, and parts thereof',
  '89': 'Ships, boats and floating structures',
  '90': 'Optical, photographic, measuring, medical or surgical instruments; parts',
  '91': 'Clocks and watches and parts thereof',
  '92': 'Musical instruments; parts and accessories',
  '93': 'Arms and ammunition; parts and accessories thereof',
  '94': 'Furniture; bedding and mattresses; lamps and lighting fittings; prefabs',
  '95': 'Toys, games and sports requisites; parts and accessories thereof',
  '96': 'Miscellaneous manufactured articles',
  '97': "Works of art, collectors' pieces and antiques",
  '98': 'Project goods; laboratory chemicals; passengers’ baggage; special uses',
  '99': 'Services (SAC)',
};

export type HsnLevel = 'CHAPTER' | 'HEADING' | 'SUB_HEADING' | 'TARIFF_ITEM';

export type HsnParts = {
  code: string;
  /** 2 digits */
  chapter: string;
  /** 4 digits, blank until the code is that long */
  heading: string;
  /** 6 digits */
  subHeading: string;
  /** 8 digits */
  tariffItem: string;
  level: HsnLevel;
  isService: boolean;
  chapterName: string;
};

export function digitsOnly(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\D/g, '');
}

/** Splits a code into its four hierarchical levels. Returns null if unusable. */
export function parseHsn(raw: string | null | undefined): HsnParts | null {
  const code = digitsOnly(raw);
  if (code.length < 2) return null;

  const chapter = code.slice(0, 2);
  const level: HsnLevel =
    code.length >= 8 ? 'TARIFF_ITEM' : code.length >= 6 ? 'SUB_HEADING' : code.length >= 4 ? 'HEADING' : 'CHAPTER';

  return {
    code,
    chapter,
    heading: code.length >= 4 ? code.slice(0, 4) : '',
    subHeading: code.length >= 6 ? code.slice(0, 6) : '',
    tariffItem: code.length >= 8 ? code.slice(0, 8) : '',
    level,
    isService: chapter === '99',
    chapterName: HSN_CHAPTERS[chapter] ?? 'Unknown chapter',
  };
}

/**
 * GST invoices accept 4, 6 or 8 digit HSN (6 for SAC). A bare 2-digit chapter is
 * a classification level, not something you can put on a bill.
 */
export function validateHsn(raw: string | null | undefined): string | null {
  const code = digitsOnly(raw);
  if (!code) return null;

  if (code.length === 2) {
    return 'That is only a chapter. An invoice needs at least 4 digits (the heading).';
  }
  if (![4, 6, 8].includes(code.length)) {
    return `HSN must be 4, 6 or 8 digits — you have ${code.length}.`;
  }
  const chapter = code.slice(0, 2);
  if (!HSN_CHAPTERS[chapter]) {
    return `"${chapter}" is not a valid chapter (01–99).`;
  }
  if (chapter === '99' && code.length !== 6) {
    return 'Services use a 6-digit SAC, e.g. 995461.';
  }
  return null;
}

/** "73089090" -> "7308 90 90" for readable printing. */
export function formatHsn(raw: string | null | undefined): string {
  const code = digitsOnly(raw);
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4, 6)} ${code.slice(6, 8)}`;
  if (code.length === 6) return `${code.slice(0, 4)} ${code.slice(4, 6)}`;
  return code;
}

/** Human-readable breakdown for the product form. */
export function describeHsn(raw: string | null | undefined): string[] {
  const p = parseHsn(raw);
  if (!p) return [];
  const out = [`Chapter ${p.chapter} — ${p.chapterName}`];
  if (p.heading) out.push(`Heading ${p.heading}`);
  if (p.subHeading) out.push(`Sub-heading ${p.subHeading} (international)`);
  if (p.tariffItem) out.push(`Tariff item ${p.tariffItem} (national)`);
  return out;
}

/**
 * Minimum HSN digits a supplier must quote, by previous-year turnover.
 * Notification 78/2020-Central Tax.
 */
export const HSN_DIGIT_RULE = [
  { upToCrore: 5, b2b: 4, b2c: 4 },
  { upToCrore: Infinity, b2b: 6, b2c: 6 },
];
