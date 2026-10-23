"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { selectCompany } from "@/app/actions/companies";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/employees", label: "Employees" },
  { href: "/templates", label: "CTC Templates" },
  { href: "/deductions", label: "Deductions" },
  { href: "/payroll", label: "Payroll" },
  { href: "/slips", label: "Slips" },
  { href: "/reports/register", label: "Register" },
  { href: "/companies", label: "Companies" },
  { href: "/settings", label: "Backup" },
];

export function Header({
  companies,
  currentId,
}: {
  companies: { id: number; name: string }[];
  currentId: number | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onSwitch = (id: number) =>
    startTransition(async () => {
      await selectCompany(id);
      // Detail pages belong to one company; go back to the section's list.
      const section = "/" + (pathname.split("/")[1] ?? "");
      if (pathname !== section && section !== "/reports") router.push(section);
      router.refresh();
    });

  return (
    <header className="border-b border-slate-200 bg-white print:hidden">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5">
        <Link href="/" className="text-lg font-semibold text-indigo-700">
          Salary Slips
        </Link>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Company
          {companies.length > 0 ? (
            <select
              className="input w-72 font-medium text-slate-900"
              value={currentId ?? ""}
              disabled={pending}
              onChange={(e) => onSwitch(Number(e.target.value))}
              aria-label="Select company"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-slate-400">none yet</span>
          )}
        </label>
      </div>
      <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-3">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap ${
                active
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
