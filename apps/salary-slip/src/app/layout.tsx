import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { getCompanies, getCurrentCompany } from "@/lib/company";

export const metadata: Metadata = {
  title: "Salary Slips",
  description: "Monthly salary slips for multiple companies",
};

// Everything depends on the local database and the selected-company cookie.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [companies, current] = await Promise.all([getCompanies(), getCurrentCompany()]);
  return (
    <html lang="en">
      <body>
        <Header companies={companies.map((c) => ({ id: c.id, name: c.name }))} currentId={current?.id ?? null} />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
