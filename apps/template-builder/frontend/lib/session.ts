import { useSyncExternalStore } from "react";

/** What the backend returns after signing in. Kept in this browser until sign-out. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Unix seconds at which the access token stops working. */
  expiresAt: number;
  /** Goes into the address of images, fonts and previews (they cannot send a header). */
  fileToken: string;
  user: { id: string; email: string };
}

const KEY = "ptb.session";
const CHANGED = "ptb-session";
let cached: { raw: string | null; session: Session | null } = { raw: null, session: null };

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    // storage blocked (private mode): there is simply no remembered session
  }
  if (raw !== cached.raw) {
    let session: Session | null = null;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.accessToken && parsed?.refreshToken && parsed?.user?.id) session = parsed;
    } catch {
      session = null;
    }
    cached = { raw, session };
  }
  return cached.session;
}

export function setSession(session: Session | null): void {
  try {
    if (session) window.localStorage.setItem(KEY, JSON.stringify(session));
    else window.localStorage.removeItem(KEY);
  } catch {
    // nothing to do: the session then lasts until the page is closed
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGED, callback);
  window.addEventListener("storage", callback);   // signed in or out in another tab
  return () => {
    window.removeEventListener(CHANGED, callback);
    window.removeEventListener("storage", callback);
  };
}

/** The current session, re-rendering when someone signs in or out. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, () => null);
}

/** Where to go after signing in: only a path inside this site. */
export function safeNext(next: string | null | undefined, fallback = "/templates"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : fallback;
}

export function loginPath(): string {
  if (typeof window === "undefined") return "/login";
  const here = window.location.pathname + window.location.search;
  return here === "/" || here.startsWith("/login") ? "/login" : `/login?next=${encodeURIComponent(here)}`;
}
