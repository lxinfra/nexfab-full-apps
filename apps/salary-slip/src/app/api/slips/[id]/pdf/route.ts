import { prisma } from "@/lib/db";
import { slipFileName } from "@/lib/files";

// Serves the PDF stored when the month was finalised: never re-rendered.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const slip = Number.isInteger(id) ? await prisma.slip.findUnique({ where: { id } }) : null;
  if (!slip) return new Response("Salary slip not found", { status: 404 });
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  return new Response(new Uint8Array(slip.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${slipFileName(slip)}"`,
      "Cache-Control": "no-store",
    },
  });
}
