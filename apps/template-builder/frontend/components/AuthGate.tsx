"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { authStatus } from "@/lib/api";
import { loginPath, useSession } from "@/lib/session";

// Asked once per page load: does this server want people to sign in at all?
let required: boolean | undefined;

/**
 * Keeps the app behind the sign-in screen when the server asks for sign-in.
 * With a remembered session the page shows at once; a session that turns out
 * to be over is caught by the first request (see lib/api.ts).
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const onLogin = pathname.startsWith("/login");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (onLogin || session || required === false) {
      setOpen(true);
      return;
    }
    let cancelled = false;
    setOpen(false);
    const decide = (needed: boolean) => {
      if (cancelled) return;
      required = needed;
      if (needed) router.replace(loginPath());
      else setOpen(true);
    };
    if (required !== undefined) decide(required);
    // a server that cannot be reached: show the page, which reports that itself
    else authStatus().then((status) => decide(status.required), () => !cancelled && setOpen(true));
    return () => {
      cancelled = true;
    };
  }, [onLogin, session, router]);

  if (!open && !onLogin) {
    return (
      <div className="flex h-screen items-center justify-center gap-2 text-sm text-slate-600" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Loading…
      </div>
    );
  }
  return <>{children}</>;
}
