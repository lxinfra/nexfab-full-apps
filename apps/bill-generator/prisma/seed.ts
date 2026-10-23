import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.company.findFirst({
    where: { legalName: 'Nexofab Industries Limited' },
  });
  if (existing) {
    console.log('Seed already applied - "Nexofab Industries Limited" exists. Nothing to do.');
    return;
  }

  const company = await prisma.company.create({
    data: {
      legalName: 'Nexofab Industries Limited',
      tradeName: 'Nexofab',
      initials: 'NXF',
      addressLine1: 'CH-73, MR 10 Road',
      addressLine2: 'Sukhliya',
      city: 'Indore',
      state: 'Madhya Pradesh',
      stateCode: '23',
      pincode: '452010',
      country: 'India',
      // Placeholders - fill these in from Settings > Company.
      gstin: null,
      pan: null,
      phone: '6262666016',
      email: 'nexofabindustrieslimited@hotmail.com',
      website: 'https://nexofabindustriesltd.com/',
      bankName: null,
      bankAccountName: 'Nexofab Industries Limited',
      bankAccountNo: null,
      bankIfsc: null,
      bankBranch: null,
      upiId: null,
      invoicePrefix: 'NXF/',
      numberFormat: '{BUYERWORD}/{MMM}/{YY}/{SEQ}',
      numberStart: 1,
      includeFyInNo: true,
      numberPadding: 4,
      defaultTerms: [
        '1. Goods once sold will not be taken back or exchanged.',
        '2. Interest @ 18% p.a. will be charged on bills not paid within the due date.',
        '3. All disputes are subject to Indore (M.P.) jurisdiction only.',
        '4. Our responsibility ceases once the goods leave our premises.',
      ].join('\n'),
    },
  });

  // One buyer inside MP (-> CGST + SGST) and one outside (-> IGST).
  await prisma.customer.create({
    data: {
      companyId: company.id,
      name: 'Shree Balaji Traders',
      initials: 'SBT',
      gstin: '23AABCS1429B1Z2',
      phone: '9826012345',
      email: 'accounts@shreebalajitraders.in',
      billingLine1: '42, Nanda Nagar Main Road',
      billingLine2: 'Near Bombay Hospital',
      billingCity: 'Indore',
      billingState: 'Madhya Pradesh',
      billingStateCode: '23',
      billingPincode: '452010',
      shipSameAsBilling: true,
    },
  });

  await prisma.customer.create({
    data: {
      companyId: company.id,
      name: 'Veracity Engineering Pvt Ltd',
      initials: 'VEPL',
      gstin: '27AAFCV2008A1ZW',
      phone: '9820098200',
      email: 'purchase@veracityeng.co.in',
      billingLine1: 'Unit 12, Prabhadevi Industrial Estate',
      billingLine2: 'Veer Savarkar Marg, Dadar West',
      billingCity: 'Mumbai',
      billingState: 'Maharashtra',
      billingStateCode: '27',
      billingPincode: '400025',
      shipSameAsBilling: false,
      shippingName: 'Veracity Engineering Pvt Ltd - Bhiwandi Warehouse',
      shippingLine1: 'Godown No. 7, Mankoli Naka',
      shippingLine2: 'Bhiwandi',
      shippingCity: 'Thane',
      shippingState: 'Maharashtra',
      shippingStateCode: '27',
      shippingPincode: '421302',
    },
  });

  await prisma.product.createMany({
    data: [
      {
        companyId: company.id,
        name: 'MS Fabricated Steel Frame',
        description: 'Mild steel fabricated frame, powder coated, as per drawing',
        hsnSac: '73089090',
        unit: 'NOS',
        ratePaise: 1250000, // Rs 12,500.00
        gstRate: 18,
        isService: false,
      },
      {
        companyId: company.id,
        name: 'SS 304 Sheet 2mm',
        description: 'Stainless steel 304 grade sheet, 2mm thickness',
        hsnSac: '72193590',
        unit: 'KG',
        ratePaise: 28500, // Rs 285.00
        gstRate: 18,
        isService: false,
      },
      {
        companyId: company.id,
        name: 'On-site Installation & Commissioning',
        description: 'Engineer visit, installation, alignment and commissioning',
        hsnSac: '998739',
        unit: 'HRS',
        ratePaise: 90000, // Rs 900.00
        gstRate: 18,
        isService: true,
      },
    ],
  });

  console.log('Seeded company:', company.legalName);
  console.log('  2 customers (Madhya Pradesh + Maharashtra), 3 products.');
  console.log('  GSTIN / bank details left blank - fill them in from the Company page.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
