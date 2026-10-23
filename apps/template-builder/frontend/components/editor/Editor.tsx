"use client";

import { cache } from "fabric";
import {
  ArrowLeft, Check, CircleAlert, Copy, Download, Eye, FileJson, FilePlus2, FileSpreadsheet, Loader2, Pencil, Redo2,
  Table2, Trash2, Undo2, ZoomIn, ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { assetUrl, copyImage, downloadBlob, exportPdf, redetectTables, safeFilename, saveTemplate, uploadImage } from "@/lib/api";
import { copyElements, pasteElements, readClipboard } from "@/lib/editor/clipboard";
import {
  duplicateElements, moveElement, removeElements, reorderElements, type ReorderMode,
} from "@/lib/editor/elements";
import { loadTemplateFonts, measureText } from "@/lib/editor/fonts";
import { isLocked } from "@/lib/editor/objects";
import { hasUnsavedChanges, initialState, newPageKey, reducer, unsavedChanges } from "@/lib/editor/store";
import {
  deleteColumn, deleteRow, insertColumn, insertRow, markTable, moveColumnEdge, moveRowEdge, removeTable, setHeaderRows,
} from "@/lib/editor/tableEdit";
import { createTable, readStyle, restyleTable, type NewTableOptions } from "@/lib/editor/tableDesign";
import { fitEditedCell, tableChain } from "@/lib/editor/tables";
import type { ImageElement, Template, TemplateElement, TemplatePage, TextElement } from "@/lib/types";
import BulkFillDialog from "./BulkFillDialog";
import CanvasStage from "./CanvasStage";
import ImportTableDialog from "./ImportTableDialog";
import PropertiesPanel from "./PropertiesPanel";
import NewTableDialog from "./NewTableDialog";
import TableEditOverlay, { MarkTableOverlay, type CellPick } from "./TableEditOverlay";
import { IconButton } from "./fields";

const AUTOSAVE_DELAY = 1200;
const ZOOM_STEP = 1.25;
const clampZoom = (zoom: number) => Math.min(8, Math.max(0.1, zoom));

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export default function Editor({ initial }: { initial: Template }) {
  const [state, dispatch] = useReducer(reducer, initial, initialState);
  const { template } = state;
  const [pageIndex, setPageIndex] = useState(0);
  const page = template.pages[Math.min(pageIndex, template.pages.length - 1)];
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [fitZoom, setFitZoom] = useState(1);
  const [userZoom, setUserZoom] = useState<number | null>(null);
  const zoom = userZoom ?? fitZoom;
  const [showOriginal, setShowOriginal] = useState(false);
  const [fontsVersion, setFontsVersion] = useState(0);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  // Tables detected on this page each get an "Import Excel" button.
  const tables = useMemo(() => page.tables ?? [], [page.tables]);
  // `all`: fill every table this one continues in (a long table split over pages), not just this one
  const [importTarget, setImportTarget] = useState<{ tableId: string; all: boolean } | null>(null);
  const [hoveredTableId, setHoveredTableId] = useState<string | null>(null);
  const importTable = tables.find((table) => table.id === importTarget?.tableId);
  // Editing a table's grid by hand (its lines are drawn over the page), and marking a new one.
  const [tableEdit, setTableEdit] = useState<{ tableId: string; picked: CellPick | null } | null>(null);
  // marking: a table the detector missed; drawing: a new table from scratch (the dragged area, then its options)
  const [marking, setMarking] = useState<false | "mark" | "draw">(false);
  const [drawnArea, setDrawnArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const editingTable = tables.find((table) => table.id === tableEdit?.tableId);
  useEffect(() => {
    if (tableEdit && !editingTable) setTableEdit(null); // undone, or another page
  }, [tableEdit, editingTable]);
  const openImport = useCallback((tableId: string, all = false) => setImportTarget({ tableId, all }), []);
  // how many tables each table on this page is chained with (itself included)
  const chainLengths = useMemo(
    () => Object.fromEntries(tables.map((table) => [table.id, tableChain(template.pages, page.index, table).length])),
    [tables, template.pages, page.index],
  );
  // Where each table's button goes: above its top-left corner with a label
  // when nothing is there, otherwise a small icon hanging off its left edge.
  const tableButtons = useMemo(() => {
    const out: Record<string, { style: { left: number; top: number }; compact: boolean }> = {};
    const solid = page.elements.filter(
      (el) => el.visible !== false && el.width * el.height < 0.5 * page.width * page.height,
    );
    for (const table of tables) {
      const width = chainLengths[table.id] > 1 ? 172 : 90; // one button, or two side by side
      // (inset a little: touching the edge of something is not covering it)
      const label = { x: table.x + 3, y: table.y - 24 / zoom + 3, w: width / zoom - 6, h: 22 / zoom - 6 };
      const blocked =
        label.y < 0 ||
        solid.some((el) => el.x < label.x + label.w && el.x + el.width > label.x && el.y < label.y + label.h && el.y + el.height > label.y);
      out[table.id] = blocked
        ? { compact: true, style: { left: Math.max(0, table.x * zoom - 26), top: table.y * zoom } }
        : { compact: false, style: { left: table.x * zoom, top: table.y * zoom - 24 } };
    }
    return out;
  }, [tables, chainLengths, page.elements, page.width, page.height, zoom]);
  const closeImport = useCallback(() => setImportTarget(null), []);
  const measure = useCallback(
    (el: TextElement, text: string) => measureText(el, text, { id: template.id, fonts: template.fonts }),
    [template.id, template.fonts],
  );
  const stageRef = useRef<HTMLDivElement>(null);

  const stateRef = useRef(state);
  stateRef.current = state;
  const selected = useMemo(
    () => page.elements.filter((el) => selectedIds.includes(el.id)),
    [page.elements, selectedIds],
  );
  // Undo can remove the elements that were selected.
  useEffect(() => {
    if (selected.length !== selectedIds.length) setSelectedIds(selected.map((el) => el.id));
  }, [selected, selectedIds]);

  // ------------------------------------------------------------------ fonts
  const families = useMemo(() => {
    const used = new Set<string>();
    for (const p of template.pages) for (const el of p.elements) if (el.type === "text") used.add(el.fontFamily);
    return [...used].sort().join("|");
  }, [template.pages]);
  useEffect(() => {
    let cancelled = false;
    void loadTemplateFonts(stateRef.current.template, families.split("|")).then(() => {
      if (cancelled) return;
      cache.clearFontCache(); // text measured before its font arrived has the wrong width
      setFontsVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [families]);

  // ------------------------------------------------------------------- zoom
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const fit = Math.min((stage.clientWidth - 80) / page.width, (stage.clientHeight - 80) / page.height);
      setFitZoom(clampZoom(Math.round(fit * 100) / 100));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [page.width, page.height]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setUserZoom((current) => clampZoom((current ?? fitZoom) * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [fitZoom]);

  // --------------------------------------------------------------- autosave
  const saving = useRef<Promise<void> | null>(null);
  const save = useCallback(async () => {
    if (saving.current) await saving.current.catch(() => undefined);
    const snapshot = stateRef.current;
    const changes = unsavedChanges(snapshot);
    if (changes.name === undefined && changes.pages.length === 0 && !changes.structural) return;
    setSaveStatus("saving");
    const job = saveTemplate(
      snapshot.template.id,
      // after adding, duplicating or deleting pages the whole page list is sent
      changes.structural
        ? { name: changes.name, pages: snapshot.template.pages, replacePages: true }
        : { name: changes.name, pages: changes.pages.map((i) => snapshot.template.pages[i]) },
    ).then(() => {
      dispatch({ type: "saved", snapshot: snapshot.template });
      setSaveStatus("idle");
    });
    saving.current = job;
    try {
      await job;
    } catch (error) {
      setSaveStatus("error");
      throw error;
    } finally {
      saving.current = null;
    }
  }, []);

  const dirty = hasUnsavedChanges(state);
  useEffect(() => {
    if (!dirty) return;
    const timer = setTimeout(() => {
      save().catch(() => setTimeout(() => setRetry((n) => n + 1), 5000));
    }, AUTOSAVE_DELAY);
    return () => clearTimeout(timer);
  }, [dirty, state.template, save, retry]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---------------------------------------------------------------- actions
  const setElements = useCallback(
    (elements: TemplateElement[], key?: string) => dispatch({ type: "set", page: page.index, elements, key }),
    [page.index],
  );
  const updateSelected = useCallback(
    (change: (el: TemplateElement) => TemplateElement, key?: string) => {
      const ids = new Set(selectedIds);
      setElements(page.elements.map((el) => (ids.has(el.id) ? change(el) : el)), key);
    },
    [page.elements, selectedIds, setElements],
  );
  const removeSelected = useCallback(() => {
    if (!selectedIds.length) return;
    setElements(removeElements(page.elements, selectedIds));
    setSelectedIds([]);
  }, [page.elements, selectedIds, setElements]);
  const duplicateSelected = useCallback(() => {
    if (!selectedIds.length) return;
    const result = duplicateElements(page.elements, selectedIds, page.index);
    setElements(result.elements);
    setSelectedIds(result.newIds);
  }, [page.elements, page.index, selectedIds, setElements]);
  const reorderSelected = useCallback(
    (mode: ReorderMode) => setElements(reorderElements(page.elements, selectedIds, mode)),
    [page.elements, selectedIds, setElements],
  );
  const replaceImage = useCallback(
    async (el: ImageElement, file: File) => {
      const uploaded = await uploadImage(stateRef.current.template.id, file);
      const current = stateRef.current.template.pages[page.index].elements.find((e) => e.id === el.id);
      if (!current || current.type !== "image") return;
      const boxRatio = current.width / current.height;
      const sameShape = Math.abs(uploaded.naturalWidth / uploaded.naturalHeight - boxRatio) / boxRatio < 0.02;
      // A picture with a different shape should not be squashed into the old box.
      const fit = current.fit === "stretch" && !sameShape ? "fit" : current.fit;
      dispatch({ type: "patch", page: page.index, updated: [{ ...current, ...uploaded, fit }] });
    },
    [page.index],
  );

  const [confirmDeletePage, setConfirmDeletePage] = useState(false);
  // Pages picked with Ctrl+click or Shift+click besides the one on screen, to delete several at once.
  const [pickedPages, setPickedPages] = useState<number[]>([]);
  const selectedPages = useMemo(
    () => [...new Set([page.index, ...pickedPages])].filter((i) => i < template.pages.length).sort((a, b) => a - b),
    [page.index, pickedPages, template.pages.length],
  );
  const goToPage = (index: number) => {
    setPageIndex(index);
    setSelectedIds([]);
    setPickedPages([]);
    setConfirmDeletePage(false);
  };
  const pickPage = (index: number, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      setPickedPages((picked) => (picked.includes(index) ? picked.filter((i) => i !== index) : [...picked, index]));
    } else if (event.shiftKey) {
      const [lo, hi] = [Math.min(page.index, index), Math.max(page.index, index)];
      setPickedPages(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
    } else {
      goToPage(index);
    }
    setConfirmDeletePage(false);
  };

  // ------------------------------------------------------------------ pages
  const insertAfterCurrent = (added: TemplatePage) => {
    const pages = [...template.pages];
    pages.splice(page.index + 1, 0, added);
    dispatch({ type: "pages", pages });
    goToPage(page.index + 1);
  };
  /** A blank page of the same size, after the current one. */
  const addPage = () =>
    insertAfterCurrent({
      key: newPageKey(), index: 0, width: page.width, height: page.height, rotation: 0,
      preview: null, scanned: false, tables: [], elements: [],
    });
  /** A copy of the current page (its elements and tables), after it. */
  const duplicatePage = () => insertAfterCurrent({ ...page, key: newPageKey() });
  /** Delete every selected page (the one on screen and the ones picked with it). */
  const deletePages = () => {
    const gone = new Set(selectedPages);
    const kept = template.pages.filter((p) => !gone.has(p.index));
    if (!kept.length) return;
    dispatch({ type: "pages", pages: kept });
    const first = selectedPages[0];
    goToPage(Math.min(first, kept.length - 1));
  };
  const deletePage = () => {
    if (template.pages.length <= 1) return;
    dispatch({ type: "pages", pages: template.pages.filter((p) => p.index !== page.index) });
    goToPage(Math.min(page.index, template.pages.length - 2));
  };

  const downloadPdf = async () => {
    setExporting(true);
    setNotice(null);
    try {
      const pdf = await exportPdf(template.id, template);
      downloadBlob(pdf, `${safeFilename(template.name)}.pdf`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The PDF could not be exported.");
    } finally {
      setExporting(false);
    }
  };
  const downloadJson = () =>
    // (page keys are editor bookkeeping, not part of the template)
    downloadBlob(new Blob([JSON.stringify({ ...template, pages: template.pages.map(({ key: _key, ...rest }) => rest) }, null, 2)], { type: "application/json" }),
      `${safeFilename(template.name)}.json`);

  // -------------------------------------------------------------- keyboard
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (bulkOpen || importTarget || drawnArea || isTyping(event.target)) return;
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (marking) {
        if (key === "escape") setMarking(false);
        return;
      }
      if (tableEdit && !mod) {
        // the table's toolbar owns deleting; Escape leaves the table
        if (key === "escape") setTableEdit(null);
        if (key === "escape" || key === "delete" || key === "backspace") return;
      }
      if (mod && key === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });
      } else if (mod && key === "y") {
        event.preventDefault();
        dispatch({ type: "redo" });
      } else if (mod && key === "s") {
        event.preventDefault();
        save().catch(() => undefined);
      } else if (mod && key === "d") {
        event.preventDefault();
        duplicateSelected();
      } else if (mod && key === "c" && selectedIds.length) {
        event.preventDefault();
        copyElements(template.id, page.key, page.elements.filter((el) => selectedIds.includes(el.id)));
      } else if (mod && key === "v") {
        const clip = readClipboard();
        if (!clip) return;
        event.preventDefault();
        void (async () => {
          let pasted = clip.elements;
          if (clip.templateId !== template.id) {
            // pictures belong to the template they were extracted for: this one needs its own copies
            pasted = await Promise.all(pasted.map(async (el) =>
              el.type === "image" && el.src.startsWith("/storage/") && !el.src.startsWith(`/storage/${template.id}/`)
                ? { ...el, ...(await copyImage(template.id, el.src)) }
                : el));
          }
          const current = stateRef.current.template.pages.find((p) => p.index === page.index);
          if (!current) return;
          const result = pasteElements(current.elements, pasted, page.index);
          dispatch({ type: "set", page: page.index, elements: result.elements });
          setSelectedIds(result.newIds);
        })().catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Could not paste."));
      } else if (mod && key === "a") {
        event.preventDefault();
        setSelectedIds(page.elements.filter((el) => el.visible !== false && !isLocked(el, page)).map((el) => el.id));
      } else if (key === "delete" || key === "backspace") {
        if (selectedIds.length) event.preventDefault();
        removeSelected();
      } else if (key === "escape") {
        setSelectedIds([]);
      } else if (key.startsWith("arrow") && selectedIds.length) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        updateSelected((el) => (isLocked(el, page) ? el : moveElement(el, dx, dy)), `nudge:${selectedIds.join(",")}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bulkOpen, drawnArea, duplicateSelected, importTarget, marking, page, removeSelected, save, selectedIds, tableEdit, template.id, updateSelected]);

  const onCanvasChange = useCallback(
    (updated: TemplateElement[], key?: string) => dispatch({ type: "patch", page: page.index, updated, key }),
    [page.index],
  );
  /** Change this page (one undo step) from its latest state. */
  const editPage = useCallback(
    (change: (current: TemplatePage) => TemplatePage) => {
      const pages = stateRef.current.template.pages;
      const current = pages.find((p) => p.index === page.index);
      if (!current) return;
      const next = change(current);
      if (next !== current) dispatch({ type: "pages", pages: pages.map((p) => (p === current ? next : p)) });
    },
    [page.index],
  );
  /** The table being edited, as it is on the latest page, then the change applied to it. */
  const editTable = useCallback(
    (change: (current: TemplatePage, table: TemplatePage["tables"][number]) => TemplatePage) =>
      editPage((current) => {
        const table = current.tables.find((t) => t.id === tableEdit?.tableId);
        return table ? change(current, table) : current;
      }),
    [editPage, tableEdit?.tableId],
  );
  const startMarking = useCallback((mode: "mark" | "draw" = "mark") => {
    setTableEdit(null);
    setSelectedIds([]);
    setMarking(mode);
  }, []);
  const fontFamilies = useMemo(() => {
    const counts = new Map<string, number>();
    for (const el of page.elements) if (el.type === "text") counts.set(el.fontFamily, (counts.get(el.fontFamily) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([family]) => family);
  }, [page.elements]);
  /** Run table detection on the PDF again and take the result for every page. */
  const redetect = useCallback(async () => {
    setTableEdit(null);
    try {
      const found = await redetectTables(template.id);
      const pages = stateRef.current.template.pages;
      const byIndex = new Map(found.pages.map((p) => [p.index, p.tables]));
      dispatch({ type: "pages", pages: pages.map((p) => (byIndex.has(p.index) ? { ...p, tables: byIndex.get(p.index)! } : p)) });
      setNotice(`Found ${found.pages.reduce((n, p) => n + p.tables.length, 0)} table(s) in the PDF.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Tables could not be detected again.");
    }
  }, [template.id]);
  const startEditing = useCallback((tableId: string) => {
    setSelectedIds([]);
    setTableEdit({ tableId, picked: null });
  }, []);
  // After typing in a table cell: wrap the text to the cell and make the row tall enough for it.
  const onEditDone = useCallback(
    (id: string) => {
      const pages = stateRef.current.template.pages;
      const current = pages.find((p) => p.index === page.index);
      if (!current) return;
      const fitted = fitEditedCell(current, id, measure);
      if (fitted !== current) dispatch({ type: "pages", pages: pages.map((p) => (p === current ? fitted : p)) });
    },
    [page.index, measure],
  );

  const status =
    saveStatus === "saving" ? { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, text: "Saving…", tone: "text-slate-500" }
    : saveStatus === "error" ? { icon: <CircleAlert className="h-3.5 w-3.5" />, text: "Couldn't save. Retrying…", tone: "text-red-700" }
    : dirty ? { icon: null, text: "Unsaved changes", tone: "text-slate-500" }
    : { icon: <Check className="h-3.5 w-3.5" />, text: "Saved", tone: "text-slate-500" };

  return (
    <div className="flex h-screen flex-col bg-slate-100 text-slate-900">
      {/* ------------------------------------------------------------ top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3">
        <Link href="/templates" title="All templates" aria-label="All templates"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <input
          aria-label="Template name"
          className="w-56 rounded-md border border-transparent px-2 py-1 text-sm font-medium hover:border-slate-300 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          value={template.name}
          onChange={(event) => dispatch({ type: "rename", name: event.target.value })}
        />
        <span role="status" className={`flex items-center gap-1 text-xs ${status.tone}`}>
          {status.icon}
          {status.text}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <IconButton label="Undo (Ctrl+Z)" disabled={!state.past.length} onClick={() => dispatch({ type: "undo" })}>
            <Undo2 className="h-4 w-4" />
          </IconButton>
          <IconButton label="Redo (Ctrl+Shift+Z)" disabled={!state.future.length} onClick={() => dispatch({ type: "redo" })}>
            <Redo2 className="h-4 w-4" />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          <IconButton label="Zoom out" onClick={() => setUserZoom(clampZoom(zoom / ZOOM_STEP))}>
            <ZoomOut className="h-4 w-4" />
          </IconButton>
          <button type="button" title="Fit page to window" onClick={() => setUserZoom(null)}
            className="h-8 w-14 rounded-md border border-slate-300 bg-white text-xs tabular-nums text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            {Math.round(zoom * 100)}%
          </button>
          <IconButton label="Zoom in" onClick={() => setUserZoom(clampZoom(zoom * ZOOM_STEP))}>
            <ZoomIn className="h-4 w-4" />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          <button type="button" aria-pressed={showOriginal} disabled={!page.preview}
            onClick={() => setShowOriginal((on) => !on)}
            title="Overlay the original page to check alignment"
            className={
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 " +
              (showOriginal ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100")
            }>
            <Eye className="h-4 w-4" aria-hidden />
            Show original
          </button>
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          <button type="button" onClick={() => setBulkOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <Table2 className="h-4 w-4" aria-hidden />
            Bulk fill
          </button>
          <button type="button" onClick={downloadJson}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-sm text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <FileJson className="h-4 w-4" aria-hidden />
            JSON
          </button>
          <button type="button" onClick={downloadPdf} disabled={exporting}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-indigo-600 px-3 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
            Download PDF
          </button>
        </div>
      </header>
      {notice && (
        <div role="alert" className="flex items-center justify-between bg-red-50 px-4 py-2 text-sm text-red-800">
          {notice}
          <button type="button" className="font-medium underline" onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ------------------------------------------------------ page list */}
        <nav aria-label="Pages" className="w-36 shrink-0 overflow-y-auto border-r border-slate-200 bg-white">
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-3 py-2">
            <div className="flex items-center justify-between">
              <IconButton label="Add a blank page after this one" onClick={addPage}>
                <FilePlus2 className="h-4 w-4" />
              </IconButton>
              <IconButton label="Duplicate this page" onClick={duplicatePage}>
                <Copy className="h-4 w-4" />
              </IconButton>
              <IconButton label={selectedPages.length > 1 ? `Delete ${selectedPages.length} pages` : "Delete this page"}
                disabled={selectedPages.length >= template.pages.length} active={confirmDeletePage}
                onClick={() => setConfirmDeletePage((on) => !on)}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
            {selectedPages.length > 1 && (
              <p className="mt-1 text-[11px] text-slate-500">{selectedPages.length} pages selected</p>
            )}
            {confirmDeletePage && (
              <div className="mt-2 text-xs text-slate-700">
                {selectedPages.length > 1
                  ? `Delete pages ${selectedPages.map((i) => i + 1).join(", ")}?`
                  : `Delete page ${page.index + 1}?`}
                <div className="mt-1 flex gap-1.5">
                  <button type="button" onClick={selectedPages.length > 1 ? deletePages : deletePage}
                    className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-1">
                    Delete
                  </button>
                  <button type="button" onClick={() => setConfirmDeletePage(false)}
                    className="rounded px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
          <ol className="space-y-3 p-3">
            {template.pages.map((p) => (
              <li key={p.key ?? p.index}>
                <button type="button" onClick={(event) => pickPage(p.index, event)}
                  aria-current={p.index === page.index ? "page" : undefined}
                  data-selected={selectedPages.includes(p.index) ? "true" : undefined}
                  title="Click to open; Ctrl+click or Shift+click to select several pages"
                  className={
                    "block w-full rounded-md border-2 p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 " +
                    (p.index === page.index ? "border-indigo-500" : selectedPages.includes(p.index) ? "border-indigo-300 bg-indigo-50" : "border-transparent hover:border-slate-300")
                  }>
                  {p.preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(p.preview)} alt="" loading="lazy" className="w-full border border-slate-200 bg-white"
                      style={{ aspectRatio: `${p.width} / ${p.height}` }} />
                  ) : (
                    <div className="w-full border border-slate-200 bg-slate-50" style={{ aspectRatio: `${p.width} / ${p.height}` }} />
                  )}
                  <span className="mt-1 block text-center text-xs tabular-nums text-slate-600">
                    {p.index + 1}
                    {p.scanned && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">scan</span>}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {/* ---------------------------------------------------------- canvas */}
        <div ref={stageRef} className="min-w-0 flex-1 overflow-auto"
          onMouseDown={(event) => {
            // a click on the grey area around the page clears the selection
            if (!(event.target as HTMLElement).closest("[data-page]")) setSelectedIds([]);
          }}>
          <div className="flex min-h-full w-max min-w-full p-10">
            <div data-page className="relative m-auto" style={{ width: Math.round(page.width * zoom), height: Math.round(page.height * zoom) }}>
              <CanvasStage
                templateId={template.id}
                fonts={template.fonts}
                page={page}
                zoom={zoom}
                fontsVersion={fontsVersion}
                selectedIds={selectedIds}
                onSelect={setSelectedIds}
                onChange={onCanvasChange}
                onEditDone={onEditDone}
              />
              {showOriginal && page.preview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={assetUrl(page.preview)} alt="" aria-hidden
                  className="pointer-events-none absolute inset-0 h-full w-full opacity-50" />
              )}
              {tables.filter((table) => table.id !== tableEdit?.tableId).map((table) => (
                <Fragment key={table.id}>
                  {hoveredTableId === table.id && (
                    <div aria-hidden
                      className="pointer-events-none absolute border-2 border-dashed border-emerald-600 bg-emerald-500/10"
                      style={{ left: table.x * zoom, top: table.y * zoom, width: table.width * zoom, height: table.height * zoom }} />
                  )}
                  <div className="absolute z-10 flex gap-1" style={tableButtons[table.id]?.style}
                    onMouseEnter={() => setHoveredTableId(table.id)}
                    onMouseLeave={() => setHoveredTableId(null)}
                    onFocus={() => setHoveredTableId(table.id)}
                    onBlur={() => setHoveredTableId(null)}>
                    <button type="button" data-table={table.id}
                      aria-label="Import Excel"
                      title="Fill this table from an Excel or CSV file"
                      onClick={() => openImport(table.id)}
                      className="inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-md border border-emerald-600 bg-white px-1 text-[11px] font-medium text-emerald-800 shadow-sm hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
                      <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
                      {/* the label is dropped where it would cover part of the page, until the button is pointed at */}
                      {(!tableButtons[table.id]?.compact || hoveredTableId === table.id) && <span className="pr-0.5">Import Excel</span>}
                    </button>
                    {/* a table that continues on other pages can be filled in one go */}
                    {chainLengths[table.id] > 1 && (!tableButtons[table.id]?.compact || hoveredTableId === table.id) && (
                      <button type="button" data-table-all={table.id}
                        title="Fill this table and its continuation on the other pages from one file"
                        onClick={() => openImport(table.id, true)}
                        className="inline-flex h-[22px] items-center whitespace-nowrap rounded-md border border-emerald-600 bg-emerald-600 px-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-1">
                        All {chainLengths[table.id]} tables
                      </button>
                    )}
                    {(!tableButtons[table.id]?.compact || hoveredTableId === table.id) && (
                      <button type="button" data-table-edit-button={table.id} aria-label="Edit table"
                        title="Move the column and row lines, add or remove columns and rows"
                        onClick={() => startEditing(table.id)}
                        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-md border border-emerald-600 bg-white text-emerald-800 shadow-sm hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    )}
                  </div>
                </Fragment>
              ))}
              {editingTable && tableEdit && (
                <TableEditOverlay table={editingTable} zoom={zoom} pageWidth={page.width} pageHeight={page.height}
                  picked={tableEdit.picked}
                  onPick={(picked) => setTableEdit({ ...tableEdit, picked })}
                  onMoveColumn={(index, x) => editTable((current, table) => moveColumnEdge(current, table, index, x, measure))}
                  onMoveRow={(index, y) => editTable((current, table) => moveRowEdge(current, table, index, y))}
                  onInsertColumn={(after) => editTable((current, table) => insertColumn(current, table, after))}
                  onDeleteColumn={(index) => {
                    editTable((current, table) => deleteColumn(current, table, index));
                    setTableEdit({ ...tableEdit, picked: null });
                  }}
                  onInsertRow={(after) => editTable((current, table) => insertRow(current, table, after))}
                  onDeleteRow={(index) => {
                    editTable((current, table) => deleteRow(current, table, index));
                    setTableEdit({ ...tableEdit, picked: null });
                  }}
                  onHeaderRows={(count) => editTable((current, table) => setHeaderRows(current, table, count))}
                  style={readStyle(page, editingTable)}
                  onStyle={(style) => editTable((current, table) => restyleTable(current, table, style, measure))}
                  onRemove={() => {
                    editTable((current, table) => removeTable(current, table.id));
                    setTableEdit(null);
                  }}
                  onDone={() => setTableEdit(null)} />
              )}
              {marking && (
                <MarkTableOverlay zoom={zoom}
                  onMark={(rect) => {
                    if (marking === "draw") {
                      setMarking(false);
                      setDrawnArea(rect);
                      return;
                    }
                    setMarking(false);
                    let made: string | null = null;
                    editPage((current) => {
                      const next = markTable(current, rect);
                      made = next.tables[next.tables.length - 1]?.id ?? null;
                      return next;
                    });
                    if (made) setTableEdit({ tableId: made, picked: null });
                  }}
                  onCancel={() => setMarking(false)} />
              )}
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------ properties */}
        <aside aria-label="Properties" className="w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white">
          <PropertiesPanel
            template={template}
            page={page}
            selected={selected}
            onUpdate={updateSelected}
            onDelete={removeSelected}
            onDuplicate={duplicateSelected}
            onReorder={reorderSelected}
            onReplaceImage={replaceImage}
            onImportTable={openImport}
            onEditTable={startEditing}
            onMarkTable={() => startMarking("mark")}
            onNewTable={() => startMarking("draw")}
            onRedetectTables={() => void redetect()}
          />
        </aside>
      </div>

      {bulkOpen && <BulkFillDialog template={template} save={save} onClose={() => setBulkOpen(false)} />}
      {drawnArea && (
        <NewTableDialog area={drawnArea} fontFamilies={fontFamilies}
          onCreate={(options: NewTableOptions) => {
            let made: string | null = null;
            editPage((current) => {
              const next = createTable(current, drawnArea, options, measure);
              made = next.tables[next.tables.length - 1]?.id ?? null;
              return next;
            });
            if (made) setTableEdit({ tableId: made, picked: null });
          }}
          onClose={() => setDrawnArea(null)} />
      )}
      {importTable && (
        <ImportTableDialog key={`${importTable.id}-${importTarget?.all}`} pages={template.pages} page={page}
          table={importTable} startWithAll={!!importTarget?.all} measure={measure}
          onImport={(pages) => {
            dispatch({ type: "pages", pages });
            // pages may have been added before the one on screen: stay on the same page
            const position = pages.findIndex((p) => p.key === page.key);
            if (position >= 0) setPageIndex(position);
          }}
          onClose={closeImport} />
      )}
    </div>
  );
}
