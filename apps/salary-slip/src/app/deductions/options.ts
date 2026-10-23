import { prisma } from "@/lib/db";
import { DEFAULT_COMPONENTS } from "@/lib/validation";

/** Choices shown in the rule form: the company's component names and employees. */
export async function ruleFormOptions(companyId: number) {
  const [components, employees] = await Promise.all([
    prisma.salaryComponent.findMany({
      where: { employee: { companyId } },
      select: { name: true },
      distinct: ["name"],
      orderBy: { name: "asc" },
    }),
    prisma.employee.findMany({
      where: { companyId },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const componentNames = [...DEFAULT_COMPONENTS];
  for (const c of components) {
    if (!componentNames.some((n) => n.toLowerCase() === c.name.toLowerCase())) componentNames.push(c.name);
  }
  return { componentNames, employees };
}
