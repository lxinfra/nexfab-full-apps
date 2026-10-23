import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Backup = one JSON snapshot of every table (logos and issued PDFs are
 * base64-encoded inside it). Restore replaces all data in a single
 * transaction: if anything fails, the current data stays untouched.
 */

// Insert order respects foreign keys; delete order is the reverse.
const MODELS = [
  "company",
  "salaryTemplate",
  "employee",
  "salaryComponent",
  "deductionRule",
  "deductionRuleEmployee",
  "payrollRun",
  "payrollEntry",
  "slip",
] as const;

const b64Replacer = (_key: string, value: unknown) =>
  value instanceof Uint8Array ? { __b64: Buffer.from(value).toString("base64") } : value;

const b64Reviver = (_key: string, value: unknown) =>
  value && typeof value === "object" && typeof (value as { __b64?: string }).__b64 === "string"
    ? new Uint8Array(Buffer.from((value as { __b64: string }).__b64, "base64"))
    : value;

/** Download the whole database as one JSON file. */
export async function GET() {
  const data: Record<string, unknown[]> = {};
  for (const model of MODELS) {
    data[model] = await (prisma as unknown as Record<string, { findMany: () => Promise<unknown[]> }>)[model].findMany();
  }
  const body = JSON.stringify({ format: "nexofab-salary-backup", version: 1, exportedAt: new Date().toISOString(), data }, b64Replacer);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="salary-slips-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Replace the database with an uploaded backup file. */
export async function POST(req: Request) {
  // Only accept uploads from this app's own pages, not from other websites.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return Response.json({ message: "Restore is only allowed from within the app." }, { status: 403 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ message: "Choose a backup file first." }, { status: 400 });
  }
  const text = await file.text();
  if (text.startsWith("SQLite format 3")) {
    return Response.json({
      message:
        "This is an old SQLite backup (.db). This version stores data in Postgres — download a fresh .json backup once your data is here.",
    }, { status: 400 });
  }
  let payload: { format?: string; data?: Record<string, unknown[]> };
  try {
    payload = JSON.parse(text, b64Reviver);
  } catch {
    payload = {};
  }
  if (payload.format !== "nexofab-salary-backup" || !payload.data || !Array.isArray(payload.data.company)) {
    return Response.json({ message: "This is not a backup file made by this app." }, { status: 400 });
  }
  const data = payload.data;

  let companies = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const t = tx as unknown as Record<string, { deleteMany: () => Promise<unknown>; createMany: (args: { data: unknown[] }) => Promise<unknown> }>;
      for (const model of [...MODELS].reverse()) await t[model].deleteMany();
      for (const model of MODELS) {
        const rows = Array.isArray(data[model]) ? data[model] : [];
        if (rows.length) await t[model].createMany({ data: rows });
      }
      // Explicit ids don't advance Postgres sequences — move them past the
      // restored maximum so new rows won't collide with restored ones.
      for (const table of ["Company", "SalaryTemplate", "Employee", "SalaryComponent", "DeductionRule", "PayrollRun", "PayrollEntry", "Slip"]) {
        await tx.$queryRawUnsafe(
          `SELECT setval(pg_get_serial_sequence('salary."${table}"', 'id'), COALESCE((SELECT MAX(id) FROM salary."${table}"), 1))`,
        );
      }
      companies = data.company.length;
    }, { timeout: 60_000 });
  } catch (e) {
    return Response.json(
      { message: `The backup could not be restored (current data was left untouched): ${e instanceof Error ? e.message : "unknown error"}` },
      { status: 500 },
    );
  }
  return Response.json({ ok: true, message: `Backup restored: ${companies} company(ies) loaded.` });
}
