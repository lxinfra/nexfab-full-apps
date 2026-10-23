import { getCurrentCompany } from "@/lib/company";
import { safeFileName } from "@/lib/files";
import { monthLabel } from "@/lib/format";
import { buildRegister, registerToXlsx } from "@/lib/register";

export async function GET(req: Request) {
  const company = await getCurrentCompany();
  if (!company) return new Response("No company selected", { status: 400 });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  const register = Number.isInteger(year) && Number.isInteger(month) ? await buildRegister(company.id, year, month) : null;
  if (!register) return new Response("No payroll found for this month", { status: 404 });

  const name = safeFileName(`Payroll Register ${monthLabel(month, year)} - ${company.name}`);
  return new Response(new Uint8Array(await registerToXlsx(register, company.name)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
