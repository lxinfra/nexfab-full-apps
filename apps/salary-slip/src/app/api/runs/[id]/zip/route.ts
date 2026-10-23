import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { safeFileName, slipFileName } from "@/lib/files";
import { monthLabel } from "@/lib/format";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const run = Number.isInteger(id)
    ? await prisma.payrollRun.findUnique({
        where: { id },
        include: { company: { select: { name: true } }, slips: { orderBy: { employeeCode: "asc" } } },
      })
    : null;
  if (!run || run.slips.length === 0) return new Response("No salary slips found for this month", { status: 404 });

  const zip = new JSZip();
  for (const slip of run.slips) zip.file(slipFileName(slip), slip.pdf);
  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const name = safeFileName(`Salary Slips ${monthLabel(run.month, run.year)} - ${run.company.name}`);

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${name}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
