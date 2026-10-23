import { cookies } from 'next/headers';
import { prisma } from './db';
import { COMPANY_COOKIE } from './constants';

export type CompanyLite = { id: string; legalName: string; tradeName: string | null };

export async function listCompanies(): Promise<CompanyLite[]> {
  return prisma.company.findMany({
    where: { isActive: true },
    orderBy: { legalName: 'asc' },
    select: { id: true, legalName: true, tradeName: true },
  });
}

/** The company selected in the top bar, falling back to the first one. */
export async function getActiveCompany() {
  const jar = await cookies();
  const id = jar.get(COMPANY_COOKIE)?.value;
  if (id) {
    const found = await prisma.company.findFirst({ where: { id, isActive: true } });
    if (found) return found;
  }
  return prisma.company.findFirst({ where: { isActive: true }, orderBy: { createdAt: 'asc' } });
}

/** Use in routes that cannot work without a company. */
export async function requireActiveCompany() {
  const company = await getActiveCompany();
  if (!company) throw new Error('NO_COMPANY');
  return company;
}

export async function getActiveCompanyId(): Promise<string | null> {
  return (await getActiveCompany())?.id ?? null;
}
