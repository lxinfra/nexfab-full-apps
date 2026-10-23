"use client";

import { FileStack, LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/api";
import { useSession } from "@/lib/session";

const LINKS = [
  { href: "/", label: "Upload" },
  { href: "/templates", label: "Templates" },
];

export default function AppHeader() {
  const pathname = usePathname().replace(/(.)\/$/, "$1");   // a static host serves /templates/
  const session = useSession();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileStack className="h-5 w-5 text-indigo-600" aria-hidden />
          PDF Template Builder
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " +
                  (active ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")
                }>
                {link.label}
              </Link>
            );
          })}
        </nav>
        {session && (
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <span className="truncate text-sm text-slate-600" title={session.user.email}>{session.user.email}</span>
            <button type="button" onClick={() => void signOut()}
              className="flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
