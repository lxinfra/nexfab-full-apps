"use client";

import { CircleCheck, FileUp, KeyRound, Loader2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import AppHeader from "@/components/AppHeader";
import { ApiError, MAX_UPLOAD_BYTES, uploadPdf } from "@/lib/api";
import type { Template } from "@/lib/types";

type Stage =
  | { name: "idle"; error?: string }
  | { name: "uploading"; file: File; progress: number }
  | { name: "password"; file: File; wrong: boolean }
  | { name: "done"; template: Template };

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function UploadPage() {
  const [stage, setStage] = useState<Stage>({ name: "idle" });
  const [ocr, setOcr] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [password, setPassword] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const start = async (file: File, pdfPassword?: string) => {
    if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setStage({ name: "idle", error: `"${file.name}" is not a PDF.` });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setStage({ name: "idle", error: `"${file.name}" is ${megabytes(file.size)}. The limit is 50 MB.` });
      return;
    }
    setStage({ name: "uploading", file, progress: 0 });
    try {
      const result = await uploadPdf(file, {
        password: pdfPassword,
        ocr,
        onProgress: (progress) => setStage({ name: "uploading", file, progress }),
      });
      setStage({ name: "done", template: result.template });
    } catch (err) {
      if (err instanceof ApiError && (err.code === "password_required" || err.code === "password_incorrect")) {
        setPassword("");
        setStage({ name: "password", file, wrong: err.code === "password_incorrect" });
      } else {
        setStage({ name: "idle", error: err instanceof Error ? err.message : "The upload failed." });
      }
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void start(file);
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (stage.name === "password" && password) void start(stage.file, password);
  };

  return (
    <>
      <AppHeader />
      <main className="mx-auto max-w-2xl px-6 py-14">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Turn a PDF into an editable template</h1>
        <p className="mt-2 text-slate-600">
          Every image, piece of text and shape is recreated in place. Edit it, mark the parts that change, and
          export new PDFs.
        </p>

        <div className="mt-8">
          {stage.name === "idle" && (
            <>
              <div
                role="button"
                tabIndex={0}
                aria-label="Choose a PDF to upload"
                onClick={() => input.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    input.current?.click();
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className={
                  "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-14 text-center transition-colors " +
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 " +
                  (dragging ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:border-indigo-400 hover:bg-slate-50")
                }
              >
                <FileUp className="h-10 w-10 text-indigo-500" aria-hidden />
                <p className="mt-4 text-base font-medium text-slate-900">Drop a PDF here, or click to choose one</p>
                <p className="mt-1 text-sm text-slate-500">Up to 50 MB</p>
                <input
                  ref={input}
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void start(file);
                  }}
                />
              </div>
              {stage.error && (
                <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-800">
                  <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  {stage.error}
                </p>
              )}
              <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  checked={ocr}
                  onChange={(event) => setOcr(event.target.checked)}
                />
                <span>
                  Run OCR on scanned pages
                  <span className="block text-slate-500">
                    Recovers text positions from pages that are only a picture. Needs Tesseract on the server.
                  </span>
                </span>
              </label>
            </>
          )}

          {stage.name === "uploading" && (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-8" role="status" aria-live="polite">
              <p className="truncate text-sm font-medium text-slate-900">{stage.file.name}</p>
              <p className="mt-0.5 text-sm text-slate-500">{megabytes(stage.file.size)}</p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200"
                role="progressbar" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={stage.progress < 1 ? Math.round(stage.progress * 100) : undefined}>
                {stage.progress < 1 ? (
                  <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-150"
                    style={{ width: `${Math.round(stage.progress * 100)}%` }} />
                ) : (
                  <div className="h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-indigo-600" />
                )}
              </div>
              <p className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                {stage.progress < 1 ? (
                  <>Uploading… {Math.round(stage.progress * 100)}%</>
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Analysing pages: extracting images, text and shapes…
                  </>
                )}
              </p>
            </div>
          )}

          {stage.name === "password" && (
            <form onSubmit={submitPassword} className="rounded-xl border border-slate-200 bg-white px-6 py-8">
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
                <div className="min-w-0">
                  <h2 className="text-base font-medium text-slate-900">This PDF is password-protected</h2>
                  <p className="mt-0.5 truncate text-sm text-slate-500">{stage.file.name}</p>
                </div>
              </div>
              <label className="mt-5 block text-sm font-medium text-slate-800" htmlFor="pdf-password">Password</label>
              <input
                id="pdf-password"
                type="password"
                autoFocus
                autoComplete="off"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={stage.wrong}
                aria-describedby={stage.wrong ? "pdf-password-error" : undefined}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              {stage.wrong && (
                <p id="pdf-password-error" role="alert" className="mt-1.5 text-sm text-red-700">
                  That password is not correct. Try again.
                </p>
              )}
              <div className="mt-5 flex gap-2">
                <button type="submit" disabled={!password}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-50">
                  Unlock and analyse
                </button>
                <button type="button" onClick={() => setStage({ name: "idle" })}
                  className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                  Choose another file
                </button>
              </div>
            </form>
          )}

          {stage.name === "done" && <Result template={stage.template} onAnother={() => setStage({ name: "idle" })} />}
        </div>
      </main>
    </>
  );
}

function Result({ template, onAnother }: { template: Template; onAnother: () => void }) {
  const counts = { text: 0, image: 0, shape: 0 };
  for (const page of template.pages) for (const el of page.elements) counts[el.type] += 1;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-6 py-8">
      <div className="flex items-start gap-3">
        <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium text-slate-900">{template.name}</h2>
          <p className="mt-0.5 text-sm text-slate-600">
            {plural(template.pageCount, "page")} · {plural(counts.text, "text field")} ·{" "}
            {plural(counts.image, "image")} · {plural(counts.shape, "shape")}
          </p>
        </div>
      </div>
      {template.warnings.length > 0 && (
        <ul className="mt-5 space-y-2">
          {template.warnings.map((warning, i) => (
            <li key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {warning.message}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex gap-2">
        <Link href={`/editor?id=${template.id}`} autoFocus
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">
          Open in the editor
        </Link>
        <button type="button" onClick={onAnother}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          Upload another
        </button>
      </div>
    </div>
  );
}
