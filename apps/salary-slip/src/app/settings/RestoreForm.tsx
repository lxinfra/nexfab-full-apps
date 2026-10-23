"use client";

import { useRef, useState } from "react";
import { ConfirmButton } from "@/components/ConfirmButton";

export function RestoreForm() {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const restore = async () => {
    const file = input.current?.files?.[0];
    if (!file) return { message: "Choose a backup file first." };
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/backup`, { method: "POST", body });
      const json = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !json.ok) return { message: json.message ?? "The backup could not be restored." };
      setDone(json.message ?? "Backup restored.");
      return { ok: true };
    } catch {
      return { message: "The backup could not be uploaded. Is the app still running?" };
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={input}
        type="file"          accept=".json,.db,.sqlite,.sqlite3,.bak"
        className="block text-sm"
        onChange={(e) => {
          setFileName(e.target.files?.[0]?.name ?? null);
          setDone(null);
        }}
      />
      {fileName && !done && (
        <ConfirmButton
          action={restore}
          title="Replace all data with this backup?"
          confirmLabel="Yes, restore the backup"
          className="btn btn-danger"
          body={
            <>
              Everything currently in the app will be replaced by the contents of <strong>{fileName}</strong>.
              Anything entered after that backup was made will no longer be shown.
            </>
          }
        >
          Restore this backup
        </ConfirmButton>
      )}
      {done && <p className="alert-ok">{done}</p>}
    </div>
  );
}
