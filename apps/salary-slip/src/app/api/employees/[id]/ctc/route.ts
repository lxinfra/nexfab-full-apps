import { prisma } from "@/lib/db";
import { getCurrentCompany } from "@/lib/company";
import { loadCtcStatement } from "@/lib/ctc/load-statement";
import { ctcStatementPdf, ctcStatementXlsx } from "@/lib/ctc/statement-files";
import { safeFileName } from "@/lib/files";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const company = await getCurrentCompany();
  if (!company) return new Response("No company selected", { status: 400 });
  const id = Number((await params).id);
  const result = Number.isInteger(id) ? await loadCtcStatement(company.id, id) : null;
  if (!result || !result.ok) {
    const message = result && result.reason === "ERROR" ? result.error : "No CTC statement for this employee";
    return new Response(message, { status: 404 });
  }
  const st = result.statement;
  const name = safeFileName(`CTC Statement - ${st.employee.code} - ${st.employee.name}`);

  if (new URL(req.url).searchParams.get("format") === "xlsx") {
    return new Response(new Uint8Array(await ctcStatementXlsx(st)), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const logoRow = await prisma.company.findUnique({ where: { id: company.id }, select: { logo: true, logoMime: true } });
  const logo =
    logoRow?.logo && logoRow.logoMime
      ? `data:${logoRow.logoMime};base64,${Buffer.from(logoRow.logo).toString("base64")}`
      : null;
  return new Response(new Uint8Array(await ctcStatementPdf(st, logo)), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
