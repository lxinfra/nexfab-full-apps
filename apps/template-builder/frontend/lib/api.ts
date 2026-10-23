import { getSession, loginPath, setSession, type Session } from "./session";
import type { Template, TemplatePage, TemplateSummary, TemplateTable } from "./types";

declare global {
  interface Window {
    /** Set by /config.js, which can be edited on the host without rebuilding the site. */
    __APP_CONFIG__?: { apiUrl?: string };
  }
}

/**
 * Where the backend is. /config.js wins when it names one (a hosted site is
 * pointed at its backend there); otherwise the address the site was built with.
 */
export function apiUrl(): string {
  const configured = typeof window === "undefined" ? undefined : window.__APP_CONFIG__?.apiUrl;
  // the desktop app serves these pages and the API from one local address
  if (configured === "same-origin") return window.location.origin;
  return (configured || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
}
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Turn a "/storage/..." URL from the template JSON into an absolute one. */
export function assetUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  if (/^https?:/.test(path)) return path;
  // image tags and the canvas cannot send a header, so files carry a token in their address
  const token = path.startsWith("/storage/") ? getSession()?.fileToken : undefined;
  return `${apiUrl()}${path}${token ? `?k=${encodeURIComponent(token)}` : ""}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  return new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? res.statusText);
}

const unreachable = () => new ApiError(0, "network", `Cannot reach the server at ${apiUrl()}.`);

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw unreachable();
  }
  if (!res.ok) throw await toError(res);
  return res.json();
}

// ----------------------------------------------------------------- sign-in
/** Does the server ask for sign-in, may an account be created on the sign-in screen, and would it be the first? */
export async function authStatus(): Promise<{ required: boolean; signup: boolean; first: boolean; shared?: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/api/auth/status`, { cache: "no-store" });
  } catch {
    throw unreachable();
  }
  if (!res.ok) throw await toError(res);
  return res.json();
}

export async function signIn(email: string, password: string): Promise<Session> {
  const session = await post<Session>("/api/auth/login", { email, password });
  setSession(session);
  return session;
}

export async function signUp(email: string, password: string): Promise<Session> {
  const session = await post<Session>("/api/auth/signup", { email, password });
  setSession(session);
  return session;
}

export async function signOut(): Promise<void> {
  const session = getSession();
  if (session) {
    // end it on the server first: forgetting the session moves to the sign-in screen,
    // which would cut this request short
    await fetch(`${apiUrl()}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.accessToken}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => undefined);
  }
  setSession(null);
}

let renewing: Promise<Session | null> | null = null;

/** Trade the refresh token for a new session. Shared by requests that find out at the same time. */
function renewSession(): Promise<Session | null> {
  renewing ??= (async () => {
    const session = getSession();
    if (!session) return null;
    try {
      const renewed = await post<Session>("/api/auth/refresh", { refreshToken: session.refreshToken });
      setSession(renewed);
      return renewed;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // another tab may have renewed it already; otherwise the session is over
        const current = getSession();
        if (current && current.refreshToken !== session.refreshToken) return current;
        setSession(null);
        return null;
      }
      return session;   // server unreachable: keep the session, the request itself will say so
    }
  })().finally(() => {
    renewing = null;
  });
  return renewing;
}

/** The session to send with a request, renewed first if it is about to run out. */
async function currentSession(): Promise<Session | null> {
  const session = getSession();
  if (!session || session.expiresAt - Date.now() / 1000 > 60) return session;
  return renewSession();
}

function toSignIn(): void {
  setSession(null);
  if (!window.location.pathname.startsWith("/login")) window.location.assign(loginPath());
}

// A 401 is not always about the session: a password-protected PDF answers 401 as well.
const SESSION_ERRORS = ["unauthorized", "session_expired"];

async function sessionOver(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body = await res.clone().json().catch(() => null);
  return SESSION_ERRORS.includes(body?.error?.code);
}

/** fetch with the session attached; a refused session gets one renewal and retry, then the sign-in screen. */
async function send(path: string, init?: RequestInit): Promise<Response> {
  const attempt = (session: Session | null) => {
    const headers = new Headers(init?.headers);
    if (session) headers.set("Authorization", `Bearer ${session.accessToken}`);
    return fetch(`${apiUrl()}${path}`, { ...init, headers });
  };
  try {
    const session = await currentSession();
    let res = await attempt(session);
    if (await sessionOver(res)) {
      const renewed = session ? await renewSession() : null;
      if (renewed && renewed.accessToken !== session?.accessToken) res = await attempt(renewed);
      if (await sessionOver(res)) toSignIn();
    }
    return res;
  } catch {
    throw unreachable();
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, init);
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? (undefined as T) : res.json();
}

async function requestBlob(path: string, init?: RequestInit): Promise<Blob> {
  const res = await send(path, init);
  if (!res.ok) throw await toError(res);
  return res.blob();
}

const json = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const listTemplates = () => request<TemplateSummary[]>("/api/templates", { cache: "no-store" });
export const getTemplate = (id: string) => request<Template>(`/api/templates/${id}`, { cache: "no-store" });
export const deleteTemplate = (id: string) => request<void>(`/api/templates/${id}`, { method: "DELETE" });
/** Make this template its own copy of an image that belongs to another template (for pasting). */
export const copyImage = (id: string, src: string) =>
  request<{ src: string }>(`/api/templates/${id}/images/copy`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src }),
  });
/** Look for tables in the template's PDF again; returns every page's new grids. */
export const redetectTables = (id: string) =>
  request<{ pages: { index: number; tables: TemplateTable[] }[] }>(`/api/templates/${id}/tables`, { method: "POST" });
export const duplicateTemplate = (id: string) =>
  request<TemplateSummary>(`/api/templates/${id}/duplicate`, { method: "POST" });

/**
 * Save edits. Only the pages passed are rewritten on the server, matched by
 * `index`; with `replacePages` they are the complete new page list instead
 * (after adding, duplicating or deleting pages).
 */
export const saveTemplate = (id: string, changes: { name?: string; pages?: TemplatePage[]; replacePages?: boolean }) =>
  request<TemplateSummary>(`/api/templates/${id}`, json(changes));

export async function uploadImage(
  id: string,
  file: File,
): Promise<{ src: string; naturalWidth: number; naturalHeight: number }> {
  const form = new FormData();
  form.append("file", file);
  return request(`/api/templates/${id}/images`, { method: "POST", body: form });
}

/** Export a PDF. Passing the template exports it as it is in the editor, saved or not. */
export const exportPdf = (id: string, template?: Template) =>
  requestBlob(`/api/export/${id}`, {
    method: "POST",
    ...(template ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(template) } : {}),
  });

export function exportBulk(id: string, csv: File): Promise<Blob> {
  const form = new FormData();
  form.append("file", csv);
  return requestBlob(`/api/export/${id}/bulk`, { method: "POST", body: form });
}

export interface Sheet {
  name: string;
  /** Cell text as the spreadsheet displays it (number formats applied). */
  rows: string[][];
  rowCount: number;
  columnCount: number;
  /** The sheet was longer than the server reads. */
  truncated: boolean;
  /** Bold / italic stretches of cells, keyed "row:column" (Excel only). */
  styles?: Record<string, SheetSpan[]>;
}

/** Counted like `TextSpan`: over the characters that are not white space. */
export interface SheetSpan {
  start: number;
  end: number;
  bold?: boolean;
  italic?: boolean;
}

/** Read an .xlsx / .csv file on the server and get its sheets back as text. */
export function parseSpreadsheet(file: File): Promise<{ filename: string; sheets: Sheet[] }> {
  const form = new FormData();
  form.append("file", file);
  return request("/api/spreadsheets/parse", { method: "POST", body: form });
}

export interface UploadOptions {
  password?: string;
  ocr?: boolean;
  /** 0..1 while the file is being sent; the server then analyses it. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Upload a PDF. Uses XMLHttpRequest because fetch cannot report upload progress. */
export async function uploadPdf(
  file: File,
  options: UploadOptions = {},
): Promise<{ templateId: string; template: Template }> {
  const session = await currentSession();
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    if (options.password) form.append("password", options.password);
    if (options.ocr) form.append("ocr", "true");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiUrl()}/api/upload`);
    if (session) xhr.setRequestHeader("Authorization", `Bearer ${session.accessToken}`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response);
      } else {
        const error = xhr.response?.error;
        if (xhr.status === 401 && SESSION_ERRORS.includes(error?.code)) toSignIn();
        reject(new ApiError(xhr.status, error?.code ?? "error", error?.message ?? "The upload failed."));
      }
    };
    xhr.onerror = () => reject(unreachable());
    xhr.onabort = () => reject(new ApiError(0, "aborted", "Upload cancelled."));
    options.signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(form);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string, fallback = "template"): string {
  return name.replace(/[^\w.\- ]+/g, "_").replace(/^[ ._]+|[ ._]+$/g, "").slice(0, 80) || fallback;
}
