import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const company = Number.isInteger(id)
    ? await prisma.company.findUnique({ where: { id }, select: { logo: true, logoMime: true } })
    : null;
  if (!company?.logo || !company.logoMime) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(company.logo), {
    headers: { "Content-Type": company.logoMime, "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
