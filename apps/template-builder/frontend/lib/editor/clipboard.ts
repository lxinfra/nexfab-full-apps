// Copy and paste of elements, across pages and across templates (in the same browser).

import type { TemplateElement } from "../types";
import { moveElement, newElementId, uniqueFieldName, withZ } from "./elements";

const KEY = "ptb.clipboard";

export interface Clip {
  templateId: string;
  /** The page the elements were copied from (pasting back onto it offsets them). */
  pageKey: string | undefined;
  elements: TemplateElement[];
}

export function copyElements(templateId: string, pageKey: string | undefined, elements: TemplateElement[]): void {
  const clip: Clip = { templateId, pageKey, elements };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(clip));
  } catch {
    // storage full or blocked: nothing to paste later, which the paste reports
  }
}

export function readClipboard(): Clip | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const clip = raw ? (JSON.parse(raw) as Clip) : null;
    return clip && Array.isArray(clip.elements) && clip.elements.length ? clip : null;
  } catch {
    return null;
  }
}

/**
 * Add copies of `pasted` to a page's elements, on top, with fresh ids and field
 * names. They land where they were copied from, unless something of the same
 * kind already sits exactly there (the original, or an earlier paste): then
 * they are set off by 10 points so both can be seen.
 */
export function pasteElements(
  elements: TemplateElement[],
  pasted: TemplateElement[],
  pageIndex: number,
): { elements: TemplateElement[]; newIds: string[] } {
  const takenIds = new Set(elements.map((el) => el.id));
  const takenNames = new Set(elements.flatMap((el) => (el.type === "text" ? [el.fieldName] : [])));
  const covered = (el: TemplateElement, shift: number) =>
    elements.some((e) => e.type === el.type && Math.abs(e.x - el.x - shift) < 0.01 && Math.abs(e.y - el.y - shift) < 0.01);
  let shift = 0;
  while (shift < 100 && pasted.some((el) => covered(el, shift))) shift += 10;
  const added: TemplateElement[] = [];
  for (const el of pasted) {
    const copy = { ...(shift ? moveElement(el, shift, shift) : el), id: newElementId(pageIndex, takenIds) };
    if (copy.type === "text") copy.fieldName = uniqueFieldName(copy.fieldName, takenNames);
    added.push(copy);
  }
  return { elements: withZ([...elements, ...added]), newIds: added.map((el) => el.id) };
}
