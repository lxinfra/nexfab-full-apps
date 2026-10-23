"use client";

import { Copy, FilePlus2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import AppHeader from "@/components/AppHeader";
import { assetUrl, deleteTemplate, duplicateTemplate, listTemplates, saveTemplate } from "@/lib/api";
import type { TemplateSummary } from "@/lib/types";

function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["day", 86400], ["hour", 3600], ["minute", 60]];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const guard = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  useEffect(() => {
    void guard(async () => setTemplates(await listTemplates()));
  }, []);

  const rename = (id: string, name: string) =>
    guard(async () => {
      const updated = await saveTemplate(id, { name });
      setTemplates((list) => list?.map((t) => (t.id === id ? { ...t, name: updated.name, updatedAt: updated.updatedAt } : t)) ?? null);
    });
  const duplicate = (id: string) =>
    guard(async () => {
      const copy = await duplicateTemplate(id);
      setTemplates((list) => (list ? [copy, ...list] : [copy]));
    });
  const remove = (id: string) =>
    guard(async () => {
      await deleteTemplate(id);
      setTemplates((list) => list?.filter((t) => t.id !== id) ?? null);
    });

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Templates</h1>
          <Link href="/"
            className="inline-flex items-center gap-2 rounded-md bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
            <FilePlus2 className="h-4 w-4" aria-hidden />
            Upload a PDF
          </Link>
        </div>

        {error && <p role="alert" className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p>}
        {templates === null && !error && <p className="mt-10 text-sm text-slate-500">Loading…</p>}
        {templates?.length === 0 && (
          <div className="mt-10 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-base font-medium text-slate-900">No templates yet</p>
            <p className="mt-1 text-sm text-slate-600">Upload a PDF to create your first one.</p>
          </div>
        )}

        <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {templates?.map((template) => (
            <TemplateCard key={template.id} template={template}
              onRename={(name) => rename(template.id, name)}
              onDuplicate={() => duplicate(template.id)}
              onDelete={() => remove(template.id)} />
          ))}
        </ul>
      </main>
    </>
  );
}

interface CardProps {
  template: TemplateSummary;
  onRename: (name: string) => Promise<void>;
  onDuplicate: () => Promise<void>;
  onDelete: () => Promise<void>;
}

function TemplateCard({ template, onRename, onDuplicate, onDelete }: CardProps) {
  const [mode, setMode] = useState<"view" | "rename" | "delete">("view");
  const [name, setName] = useState(template.name);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    await action();
    setBusy(false);
    setMode("view");
  };
  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || trimmed === template.name) setMode("view");
    else void run(() => onRename(trimmed));
  };
  const actionClass =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40";

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <Link href={`/editor?id=${template.id}`} aria-label={`Open ${template.name}`}
        className="block bg-slate-100 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
        {template.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(template.thumbnail)} alt="" loading="lazy"
            className="mx-auto h-48 w-auto max-w-full border border-slate-200 bg-white object-contain shadow-sm" />
        ) : (
          <div className="mx-auto h-48 w-36 border border-slate-200 bg-white" />
        )}
      </Link>

      <div className="flex flex-1 flex-col px-4 py-3">
        {mode === "rename" ? (
          <form onSubmit={submitRename}>
            <input autoFocus aria-label="Template name" value={name} disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onBlur={submitRename}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setName(template.name);
                  setMode("view");
                }
              }}
              className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          </form>
        ) : (
          <p className="truncate text-sm font-medium text-slate-900" title={template.name}>{template.name}</p>
        )}
        <p className="mt-0.5 text-xs text-slate-500">
          {template.pageCount} {template.pageCount === 1 ? "page" : "pages"} · edited {timeAgo(template.updatedAt)}
        </p>

        {mode === "delete" ? (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <span className="text-slate-700">Delete this template?</span>
            <button type="button" disabled={busy} onClick={() => run(onDelete)}
              className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:opacity-50">
              Delete
            </button>
            <button type="button" disabled={busy} onClick={() => setMode("view")}
              className="rounded-md px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-1">
            <button type="button" className={actionClass} title="Rename" aria-label={`Rename ${template.name}`}
              disabled={busy}
              onClick={() => {
                setName(template.name);
                setMode("rename");
              }}>
              <Pencil className="h-4 w-4" />
            </button>
            <button type="button" className={actionClass} title="Duplicate" aria-label={`Duplicate ${template.name}`}
              disabled={busy} onClick={() => run(onDuplicate)}>
              <Copy className="h-4 w-4" />
            </button>
            <button type="button" className={actionClass} title="Delete" aria-label={`Delete ${template.name}`}
              disabled={busy} onClick={() => setMode("delete")}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
