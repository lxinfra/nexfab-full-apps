"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { getTemplate } from "@/lib/api";
import type { Template } from "@/lib/types";

const Loading = ({ label }: { label: string }) => (
  <div className="flex h-screen items-center justify-center gap-2 text-sm text-slate-600" role="status">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
    {label}
  </div>
);

// Fabric.js needs the DOM, so the editor is only ever loaded in the browser.
const Editor = dynamic(() => import("@/components/editor/Editor"), {
  ssr: false,
  loading: () => <Loading label="Loading editor…" />,
});

function EditorPage() {
  const id = useSearchParams().get("id") ?? "";
  const [template, setTemplate] = useState<Template | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTemplate(null);
    setError(null);
    if (!id) {
      setError("The link has no template in it.");
      return;
    }
    getTemplate(id).then(
      (loaded) => !cancelled && setTemplate(loaded),
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error || (template && template.pages.length === 0)) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-base font-medium text-slate-900">This template could not be opened</p>
        <p className="text-sm text-slate-600">{error ?? "It has no pages."}</p>
        <Link href="/templates" className="text-sm font-medium text-indigo-700 hover:underline">
          Back to templates
        </Link>
      </div>
    );
  }
  if (!template) return <Loading label="Loading template…" />;
  // A new key per template gives the editor a clean state and history.
  return <Editor key={template.id} initial={template} />;
}

// The template is named in the address (/editor?id=…), which is only known in the browser.
export default function Page() {
  return (
    <Suspense fallback={<Loading label="Loading…" />}>
      <EditorPage />
    </Suspense>
  );
}
