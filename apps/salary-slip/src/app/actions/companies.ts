"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { COMPANY_COOKIE } from "@/lib/company";
import { companySchema, zodErrors, type ActionResult } from "@/lib/validation";
import defaultRules from "../../../prisma/default-rules.json";

const MAX_LOGO_BYTES = 500 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg"];

async function setCompanyCookie(id: number) {
  (await cookies()).set(COMPANY_COOKIE, String(id), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

export async function selectCompany(id: number) {
  await setCompanyCookie(id);
  revalidatePath("/", "layout");
}

export async function saveCompany(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const id = form.get("id") ? Number(form.get("id")) : null;
  const parsed = companySchema.safeParse(Object.fromEntries(form));
  const errors = parsed.success ? {} : zodErrors(parsed.error);

  let logo: { logo: Uint8Array<ArrayBuffer>; logoMime: string } | { logo: null; logoMime: null } | undefined;
  const file = form.get("logo");
  if (file instanceof File && file.size > 0) {
    if (!LOGO_TYPES.includes(file.type)) errors.logo = "The logo must be a PNG or JPEG image.";
    else if (file.size > MAX_LOGO_BYTES) errors.logo = "The logo must be smaller than 500 KB.";
    else logo = { logo: new Uint8Array(await file.arrayBuffer()), logoMime: file.type };
  } else if (form.get("removeLogo") === "on") {
    logo = { logo: null, logoMime: null };
  }

  if (!parsed.success || Object.keys(errors).length > 0) {
    return { errors, message: "Please fix the highlighted fields." };
  }

  const duplicate = await prisma.company.findFirst({
    where: { name: parsed.data.name, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (duplicate) return { errors: { name: "A company with this name already exists." } };

  const data = { ...parsed.data, ...(logo ?? {}) };
  if (id) {
    await prisma.company.update({ where: { id }, data });
  } else {
    // Every new company starts with the default deduction rules (PF, ESI, PT, TDS).
    const created = await prisma.company.create({ data: { ...data, deductionRules: { create: defaultRules } } });
    await setCompanyCookie(created.id);
  }
  revalidatePath("/", "layout");
  redirect("/companies");
}

export async function deleteCompany(id: number): Promise<ActionResult> {
  // Runs go first: payroll entries reference employees and would block the cascade.
  await prisma.$transaction([
    prisma.payrollRun.deleteMany({ where: { companyId: id } }),
    prisma.company.delete({ where: { id } }),
  ]);
  revalidatePath("/", "layout");
  return { ok: true };
}
