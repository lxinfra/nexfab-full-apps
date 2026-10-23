"use client";

import { ActiveSelection, Canvas, type FabricObject, IText } from "fabric";
import { useEffect, useRef } from "react";
import { assetUrl } from "@/lib/api";
import { createObject, readObject } from "@/lib/editor/objects";
import type { TemplateElement, TemplateFont, TemplatePage } from "@/lib/types";

interface Props {
  templateId: string;
  fonts: TemplateFont[];
  page: TemplatePage;
  zoom: number;
  /** Bumped when web fonts finish loading, so text is measured again. */
  fontsVersion: number;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  /** Elements whose geometry or text changed on the canvas. */
  onChange: (updated: TemplateElement[], coalesceKey?: string) => void;
  /** The user has finished typing in a text (clicked away or pressed Escape). */
  onEditDone?: (id: string) => void;
}

interface Entry {
  el: TemplateElement;
  obj: FabricObject;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * The Fabric canvas for one page. The page's element list is the source of
 * truth: this component mirrors it into Fabric objects (recreating only the
 * ones whose element changed) and reports what the user does back as elements.
 */
export default function CanvasStage(props: Props) {
  const { templateId, fonts, page, zoom, fontsVersion, selectedIds, onSelect, onChange, onEditDone } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const entries = useRef(new Map<string, Entry>());
  const ids = useRef(new WeakMap<FabricObject, string>());
  const images = useRef(new Map<string, HTMLImageElement | null>());
  const applyingSelection = useRef(false);
  const builtWithFonts = useRef(fontsVersion);
  const callbacks = useRef({ onSelect, onChange, onEditDone });
  callbacks.current = { onSelect, onChange, onEditDone };
  const wantedSelection = useRef(selectedIds);
  wantedSelection.current = selectedIds;

  // ---- create / dispose the canvas
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // A fresh <canvas> per mount: Fabric cannot be initialised twice on one node.
    const node = document.createElement("canvas");
    host.appendChild(node);
    const canvas = new Canvas(node, {
      preserveObjectStacking: true,
      backgroundColor: "#ffffff",
      selectionColor: "rgba(79, 70, 229, 0.08)",
      selectionBorderColor: "#4f46e5",
      selectionLineWidth: 1,
      targetFindTolerance: 5, // px of slack when clicking thin strokes
    });
    canvasRef.current = canvas;
    const known = entries.current;
    const idOf = ids.current;

    const commit = (objects: FabricObject[], key?: string) => {
      const updated: TemplateElement[] = [];
      for (const obj of objects) {
        const id = idOf.get(obj);
        const entry = id ? known.get(id) : undefined;
        if (!entry) continue;
        const { element, rebuild } = readObject(obj, entry.el);
        if (element === entry.el) continue;
        updated.push(element);
        // Keeping the old element on the entry makes the next sync recreate the object.
        if (!rebuild) entry.el = element;
      }
      if (updated.length) callbacks.current.onChange(updated, key);
    };

    const reportSelection = () => {
      const active = canvas.getActiveObject();
      if (active instanceof ActiveSelection) {
        // a multi-selection can be moved as a block, nothing else
        active.set({ hasControls: false, lockRotation: true, lockScalingX: true, lockScalingY: true });
      }
      if (applyingSelection.current) return;
      const selected = canvas.getActiveObjects().map((obj) => idOf.get(obj)).filter((id): id is string => !!id);
      callbacks.current.onSelect(selected);
    };

    canvas.on("selection:created", reportSelection);
    canvas.on("selection:updated", reportSelection);
    canvas.on("selection:cleared", reportSelection);
    canvas.on("object:modified", ({ target }) => {
      if (target) commit(target instanceof ActiveSelection ? target.getObjects() : [target]);
    });
    canvas.on("text:changed", ({ target }) => {
      const id = idOf.get(target);
      commit([target], id ? `text:${id}` : undefined);
    });
    canvas.on("text:editing:exited", ({ target }) => {
      const id = idOf.get(target);
      if (id) callbacks.current.onEditDone?.(id);
    });

    return () => {
      canvasRef.current = null;
      known.clear();
      // Fabric puts the original node back when it is done; then drop it.
      void canvas.dispose().then(() => node.remove());
    };
  }, []);

  // ---- size and zoom
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setDimensions({ width: Math.round(page.width * zoom), height: Math.round(page.height * zoom) });
    canvas.setZoom(zoom);
    canvas.requestRenderAll();
  }, [page.width, page.height, zoom]);

  // ---- mirror the element list into Fabric objects
  useEffect(() => {
    let cancelled = false;

    const loadImages = async () => {
      const missing = [...new Set(page.elements.flatMap((el) => (el.type === "image" ? [el.src] : [])))].filter(
        (src) => !images.current.has(src),
      );
      await Promise.all(
        missing.map(
          (src) =>
            new Promise<void>((resolve) => {
              const img = new Image();
              img.crossOrigin = "anonymous";
              img.onload = () => {
                images.current.set(src, img);
                resolve();
              };
              img.onerror = () => {
                images.current.set(src, null);
                resolve();
              };
              img.src = assetUrl(src) ?? src;
            }),
        ),
      );
    };

    const sync = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const known = entries.current;
      const context = {
        template: { id: templateId, fonts },
        page: { width: page.width, height: page.height },
        image: (src: string) => images.current.get(src) ?? undefined,
      };
      const remeasure = builtWithFonts.current !== fontsVersion;
      builtWithFonts.current = fontsVersion;

      const wanted = new Map(page.elements.map((el) => [el.id, el]));
      const stale = [...known].filter(
        ([id, entry]) => wanted.get(id) !== entry.el || (remeasure && entry.el.type === "text"),
      );
      const desired = page.elements.filter((el) => el.visible !== false);
      const current = canvas.getObjects();
      const inOrder =
        stale.length === 0 &&
        current.length === desired.length &&
        desired.every((el, i) => known.get(el.id)?.obj === current[i]);
      if (inOrder) return;

      applyingSelection.current = true;
      canvas.discardActiveObject();

      for (const [id, entry] of stale) {
        canvas.remove(entry.obj);
        known.delete(id);
      }
      desired.forEach((el, index) => {
        let entry = known.get(el.id);
        if (!entry) {
          const obj = createObject(el, context);
          if (!obj) return;
          entry = { el, obj };
          known.set(el.id, entry);
          ids.current.set(obj, el.id);
        }
        const objects = canvas.getObjects();
        if (objects[index] === entry.obj) return;
        if (objects.includes(entry.obj)) canvas.moveObjectTo(entry.obj, index);
        else canvas.insertAt(index, entry.obj);
      });

      const objects = wantedSelection.current
        .map((id) => known.get(id)?.obj)
        .filter((obj): obj is FabricObject => !!obj);
      if (objects.length === 1) canvas.setActiveObject(objects[0]);
      else if (objects.length > 1) canvas.setActiveObject(new ActiveSelection(objects, { canvas }));
      applyingSelection.current = false;
      canvas.requestRenderAll();
    };

    const pending = page.elements.some((el) => el.type === "image" && !images.current.has(el.src));
    if (!pending) {
      sync(); // nothing to wait for: update in the same tick as the state change
    } else {
      void loadImages().then(() => {
        if (!cancelled) sync();
      });
    }
    return () => {
      cancelled = true;
    };
  }, [page.elements, page.width, page.height, templateId, fonts, fontsVersion]);

  // ---- selection driven from outside the canvas (duplicate, select all, ...)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const active = canvas.getActiveObjects().map((obj) => ids.current.get(obj)).filter((id): id is string => !!id);
    if (sameIds(active, selectedIds)) return;
    const current = canvas.getActiveObject();
    if (current instanceof IText && current.isEditing) current.exitEditing();
    applyingSelection.current = true;
    canvas.discardActiveObject();
    const objects = selectedIds
      .map((id) => entries.current.get(id)?.obj)
      .filter((obj): obj is FabricObject => !!obj);
    if (objects.length === 1) canvas.setActiveObject(objects[0]);
    else if (objects.length > 1) canvas.setActiveObject(new ActiveSelection(objects, { canvas }));
    applyingSelection.current = false;
    canvas.requestRenderAll();
  }, [selectedIds, page.elements]);

  return <div ref={hostRef} className="bg-white shadow-[0_1px_3px_rgba(15,23,42,0.2),0_8px_24px_rgba(15,23,42,0.12)]" />;
}
