import { PDFDocument } from "pdf-lib";
import { prisma } from "@/lib/db";
import { safeFileName } from "@/lib/files";
import { monthLabel } from "@/lib/format";

// All slips of a month joined into one PDF (the stored PDFs, page by page) for printing.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const run = Number.isInteger(id)
    ? await prisma.payrollRun.findUnique({
        where: { id },
        include: { company: { select: { name: true } }, slips: { orderBy: { employeeCode: "asc" } } },
      })
    : null;
  if (!run || run.slips.length === 0) return new Response("No salary slips found for this month", { status: 404 });

  const merged = await PDFDocument.create();
  for (const slip of run.slips) {
    const doc = await PDFDocument.load(slip.pdf);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => merged.addPage(p));
  }
  const name = safeFileName(`Salary Slips ${monthLabel(run.month, run.year)} - ${run.company.name}`);

  return new Response(new Uint8Array(await merged.save()), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
