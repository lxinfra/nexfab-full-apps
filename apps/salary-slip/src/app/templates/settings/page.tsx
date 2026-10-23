import Link from "next/link";
import { requireCompany } from "@/lib/company";
import { loadStructureContext } from "@/lib/ctc/server";
import { StatutoryForm } from "./StatutoryForm";

export default async function StatutorySettingsPage() {
  const company = await requireCompany();
  const { settings } = await loadStructureContext(company.id);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/templates" className="text-sm text-indigo-700 hover:underline">
          ← CTC templates
        </Link>
        <h1 className="page-title mt-1">Statutory settings</h1>
        <p className="text-sm text-slate-600">
          Thresholds, PF, ESI, gratuity, professional tax and income tax for {company.name}. These drive the CTC
          breakup, the in-hand estimate and TDS deduction rules.
        </p>
      </div>
      <StatutoryForm initial={settings} />
    </div>
  );
}
