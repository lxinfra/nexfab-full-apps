// Prepares the database before the app starts: syncs the schema
// (Supabase Postgres in production, or a local SQLite file in development)
// and seeds the first company whenever the database is empty.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

execSync("npx prisma db push", { cwd: root, stdio: "inherit" });

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
try {
  if ((await prisma.company.count()) === 0) {
    await prisma.company.create({
      data: {
        name: "Nexofab Industries Limited",
        address: "CH-73, MR 10 Road, Sukhliya, Indore, Madhya Pradesh 452010",
        phone: "6262666016",
        email: "nexofabindustrieslimited@hotmail.com",
        website: "https://nexofabindustriesltd.com/",
        // Default deduction rules: PF 0%, ESI 0%, PT 208, TDS 10%.
        deductionRules: {
          create: JSON.parse(readFileSync(path.join(root, "prisma", "default-rules.json"), "utf8")),
        },
      },
    });
    console.log("Seeded first company: Nexofab Industries Limited");
  }
} finally {
  await prisma.$disconnect();
}
