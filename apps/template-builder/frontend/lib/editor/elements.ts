// Pure operations on a page's element list. Every function returns new
// objects for what changed and keeps the identity of what did not, which is
// what lets the canvas update only the objects that need it.

import type { Template, TemplateElement, TextElement } from "../types";
import { r3 } from "./geometry";

const PLACEHOLDER = /\{\{\s*([\w.\- ]+?)\s*\}\}/g;

/** z always equals the element's index in the list (0 is painted first). */
export function withZ(elements: TemplateElement[]): TemplateElement[] {
  return elements.map((el, z) => (el.z === z ? el : { ...el, z }));
}

export function replaceElements(elements: TemplateElement[], updated: TemplateElement[]): TemplateElement[] {
  const byId = new Map(updated.map((el) => [el.id, el]));
  return elements.map((el) => byId.get(el.id) ?? el);
}

export function moveElement<T extends TemplateElement>(el: T, dx: number, dy: number): T {
  const next = { ...el, x: r3(el.x + dx), y: r3(el.y + dy) };
  if (next.type === "shape" && next.shape === "line") {
    next.x1 = r3(next.x1 + dx);
    next.y1 = r3(next.y1 + dy);
    next.x2 = r3(next.x2 + dx);
    next.y2 = r3(next.y2 + dy);
  }
  return next;
}

export function removeElements(elements: TemplateElement[], ids: string[]): TemplateElement[] {
  const drop = new Set(ids);
  return withZ(elements.filter((el) => !drop.has(el.id)));
}

/** An id no element on the page uses yet. */
export function newElementId(pageIndex: number, taken: Set<string>): string {
  let id: string;
  do {
    id = `p${pageIndex + 1}-n${Math.random().toString(36).slice(2, 8)}`;
  } while (taken.has(id));
  taken.add(id);
  return id;
}

export function uniqueFieldName(base: string, taken: Set<string>): string {
  let name = `${base}_copy`;
  for (let n = 2; taken.has(name); n += 1) name = `${base}_copy${n}`;
  taken.add(name);
  return name;
}

/** Copies are placed just above their originals, nudged down and right. */
export function duplicateElements(
  elements: TemplateElement[],
  ids: string[],
  pageIndex: number,
): { elements: TemplateElement[]; newIds: string[] } {
  const pick = new Set(ids);
  const takenIds = new Set(elements.map((el) => el.id));
  const takenNames = new Set(elements.flatMap((el) => (el.type === "text" ? [el.fieldName] : [])));
  const out: TemplateElement[] = [];
  const newIds: string[] = [];
  for (const el of elements) {
    out.push(el);
    if (!pick.has(el.id)) continue;
    const copy = { ...moveElement(el, 10, 10), id: newElementId(pageIndex, takenIds) };
    if (copy.type === "text") copy.fieldName = uniqueFieldName(copy.fieldName, takenNames);
    out.push(copy);
    newIds.push(copy.id);
  }
  return { elements: withZ(out), newIds };
}

export type ReorderMode = "forward" | "backward" | "front" | "back";

export function reorderElements(elements: TemplateElement[], ids: string[], mode: ReorderMode): TemplateElement[] {
  const pick = new Set(ids);
  const list = [...elements];
  if (mode === "front" || mode === "back") {
    const chosen = list.filter((el) => pick.has(el.id));
    const rest = list.filter((el) => !pick.has(el.id));
    return withZ(mode === "front" ? [...rest, ...chosen] : [...chosen, ...rest]);
  }
  if (mode === "forward") {
    for (let i = list.length - 2; i >= 0; i -= 1) {
      if (pick.has(list[i].id) && !pick.has(list[i + 1].id)) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    }
  } else {
    for (let i = 1; i < list.length; i += 1) {
      if (pick.has(list[i].id) && !pick.has(list[i - 1].id)) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
  }
  return withZ(list);
}

/**
 * Change text properties from the properties panel.
 *
 * Anything that alters how the text is measured (font, size, alignment, line
 * height, line count) drops `layout`, the record of where each word sat in the
 * source PDF, so export lays the text out afresh from the box and alignment.
 */
export function updateText(el: TextElement, changes: Partial<TextElement>): TextElement {
  const next: TextElement = { ...el, ...changes };
  const lines = next.content.split("\n").length;
  const oldLines = el.content.split("\n").length;
  const firstLine = el.height - (oldLines - 1) * el.lineHeight * el.fontSize;

  if (next.fontSize !== el.fontSize && el.fontSize > 0 && next.fontSize > 0) {
    const k = next.fontSize / el.fontSize;
    const width = r3(el.width * k);
    // grow from the edge the text is aligned to
    if (el.align === "right") next.x = r3(el.x + el.width - width);
    else if (el.align === "center") next.x = r3(el.x + (el.width - width) / 2);
    next.width = width;
    next.baseline = r3(el.baseline * k);
    next.height = r3(firstLine * k + (lines - 1) * next.lineHeight * next.fontSize);
  } else if (lines !== oldLines || next.lineHeight !== el.lineHeight) {
    next.height = r3(firstLine + (lines - 1) * next.lineHeight * next.fontSize);
  }

  const remeasured =
    next.fontSize !== el.fontSize || next.fontFamily !== el.fontFamily || next.fontWeight !== el.fontWeight ||
    next.fontStyle !== el.fontStyle || next.align !== el.align || next.lineHeight !== el.lineHeight ||
    lines !== oldLines;
  if (remeasured) delete next.layout;
  return next;
}

export function cleanFieldName(value: string): string {
  return value.trim().replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
}

/** Variable names a CSV can fill: `{{placeholders}}` plus fields marked as variables. */
export function variableNames(template: Template): string[] {
  const names = new Set<string>();
  for (const page of template.pages) {
    for (const el of page.elements) {
      if (el.type !== "text") continue;
      const placeholders = [...el.content.matchAll(PLACEHOLDER)].map((m) => m[1]);
      placeholders.forEach((name) => names.add(name));
      if (el.isVariable && el.fieldName && placeholders.length === 0) names.add(el.fieldName);
    }
  }
  return [...names];
}

/** Current value of each variable, used as the example row of a CSV template. */
export function variableSamples(template: Template): Record<string, string> {
  const samples: Record<string, string> = {};
  for (const page of template.pages) {
    for (const el of page.elements) {
      if (el.type === "text" && el.isVariable && el.fieldName && !PLACEHOLDER.test(el.content)) {
        samples[el.fieldName] ??= el.content.replace(/\n/g, " ");
      }
      PLACEHOLDER.lastIndex = 0;
    }
  }
  return samples;
}
