import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { getCurrentCompany } from "@/lib/company";
import { safeFileName, slipFileNameWithMonth } from "@/lib/files";

// One employee's stored slips together: the latest N months (or all), as one PDF or a ZIP.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const company = await getCurrentCompany();
  if (!company) return new Response("No company selected", { status: 400 });
  const id = Number((await params).id);
  const url = new URL(req.url);
  const last = Number(url.searchParams.get("last"));

  const slips = Number.isInteger(id)
    ? await prisma.slip.findMany({
        where: { employeeId: id, run: { companyId: company.id } },
        orderBy: [{ year: "desc" }, { month: "desc" }],
        ...(Number.isInteger(last) && last > 0 ? { take: last } : {}),
      })
    : [];
  if (slips.length === 0) return new Response("No salary slips found for this employee", { status: 404 });
  slips.reverse(); // oldest first inside the file

  const newest = slips[slips.length - 1];
  const name = safeFileName(`${newest.employeeName} - ${newest.employeeCode} - Salary Slips`);

  if (url.searchParams.get("format") === "zip") {
    const zip = new JSZip();
    for (const slip of slips) zip.file(slipFileNameWithMonth(slip), slip.pdf);
    const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${name}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const merged = await PDFDocument.create();
  for (const slip of slips) {
    const doc = await PDFDocument.load(slip.pdf);
    (await merged.copyPages(doc, doc.getPageIndices())).forEach((p) => merged.addPage(p));
  }
  return new Response(new Uint8Array(await merged.save()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
