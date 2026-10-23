import { prisma } from "@/lib/db";
import { getCurrentCompany } from "@/lib/company";
import { buildEmployeeTable, tableToCsv, tableToXlsx } from "@/lib/employees-io";
import { safeFileName } from "@/lib/files";

export async function GET(req: Request) {
  const company = await getCurrentCompany();
  if (!company) return new Response("No company selected", { status: 400 });
  const url = new URL(req.url);
  const template = url.searchParams.get("template") === "1";

  const employees = template
    ? []
    : await prisma.employee.findMany({
        where: { companyId: company.id },
        include: { components: { orderBy: { sortOrder: "asc" } } },
        orderBy: { code: "asc" },
      });
  const table = buildEmployeeTable(employees);
  const base = template ? "employee-import-template" : safeFileName(`Employees - ${company.name}`);

  if (url.searchParams.get("format") === "csv") {
    return new Response(tableToCsv(table), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.csv"`,
      },
    });
  }
  return new Response(new Uint8Array(await tableToXlsx(table, "Employees")), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}.xlsx"`,
    },
  });
}
