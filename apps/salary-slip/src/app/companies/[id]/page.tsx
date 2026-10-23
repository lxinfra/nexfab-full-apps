import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { CompanyForm } from "../CompanyForm";

export default async function EditCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const c = await prisma.company.findUnique({ where: { id }, omit: { logo: true } });
  if (!c) notFound();

  return (
    <div className="space-y-4">
      <h1 className="page-title">Edit company</h1>
      <CompanyForm
        initial={{
          id: c.id,
          name: c.name,
          address: c.address,
          phone: c.phone ?? "",
          email: c.email ?? "",
          website: c.website ?? "",
          gstin: c.gstin ?? "",
          pan: c.pan ?? "",
          tan: c.tan ?? "",
          signatoryName: c.signatoryName ?? "",
          signatoryDesignation: c.signatoryDesignation ?? "",
          logoUrl: c.logoMime
            ? `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/companies/${c.id}/logo?v=${c.updatedAt.getTime()}`
            : null,
        }}
      />
    </div>
  );
}
