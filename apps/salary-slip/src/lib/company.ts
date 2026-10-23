import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "./db";

export const COMPANY_COOKIE = "companyId";

/** Companies without the logo bytes (the logo is served by its own route). */
export async function getCompanies() {
  return prisma.company.findMany({ omit: { logo: true }, orderBy: { name: "asc" } });
}

/** The company picked in the header switcher; falls back to the first company. */
export async function getCurrentCompany() {
  const companies = await getCompanies();
  if (companies.length === 0) return null;
  const id = Number((await cookies()).get(COMPANY_COOKIE)?.value);
  return companies.find((c) => c.id === id) ?? companies[0];
}

/** For pages that cannot work without a company. */
export async function requireCompany() {
  const company = await getCurrentCompany();
  if (!company) redirect("/companies/new");
  return company;
}
