"use client";

import { FileStack, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { authStatus, signIn, signUp } from "@/lib/api";
import { safeNext, useSession } from "@/lib/session";

const field =
  "mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 " +
  "placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const session = useSession();
  const [status, setStatus] = useState<{ required: boolean; signup: boolean; first: boolean; shared?: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    authStatus().then(
      (found) => {
        if (cancelled) return;
        setStatus(found);
        // nobody has an account yet: the first thing to do is make one
        setCreating(found.signup && found.first);
      },
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // already signed in, or a server without sign-in: nothing to do here
  useEffect(() => {
    if (session || status?.required === false) router.replace(next);
  }, [session, status, next, router]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await (creating ? signUp(email, password) : signIn(email, password));
      // the effect above moves on once the session is stored
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-base font-semibold text-slate-900">
          <FileStack className="h-6 w-6 text-indigo-600" aria-hidden />
          PDF Template Builder
        </div>
        <form onSubmit={submit} className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">{creating ? "Create your account" : "Sign in"}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {status?.shared
              ? "Everyone who signs in works on the same templates."
              : creating && status?.first
                ? "This is the first account. It becomes the owner of the templates saved so far."
                : "Your templates are private to your account."}
          </p>

          <label className="mt-5 block text-sm font-medium text-slate-700">
            E-mail
            <input type="email" name="email" autoComplete="email" required autoFocus value={email}
              onChange={(e) => setEmail(e.target.value)} className={field} placeholder="you@example.com" />
          </label>
          <label className="mt-4 block text-sm font-medium text-slate-700">
            Password
            <input type="password" name="password" required minLength={creating ? 8 : undefined} value={password}
              autoComplete={creating ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)} className={field} />
            {creating && <span className="mt-1 block text-xs font-normal text-slate-500">At least 8 characters.</span>}
          </label>

          {error && (
            <p role="alert" className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {creating ? "Create account" : "Sign in"}
          </button>

          {status?.signup && (
            <button type="button" onClick={() => { setCreating(!creating); setError(null); }}
              className="mt-4 block w-full text-center text-sm font-medium text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              {creating ? "I already have an account" : "Create an account"}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
