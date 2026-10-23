// Keeping printed page numbers right when pages are added, duplicated or deleted.

import type { TemplateElement, TemplatePage, TextElement } from "../types";
import { updateText } from "./elements";

const WORD = "page|pg\\.?|p\\.|seite|página|pagina|pág\\.?";
const OF = "of|/|von|de|di";
// "Page 3 of 8", "page 3/8", anywhere in the text
const LABELLED_PAIR = new RegExp(`\\b(${WORD})(\\s*)(\\d+)(\\s*(?:${OF})\\s*)(\\d+)`, "iu");
// "3 of 8" or "3 / 8", only when that is the whole text (it could be a date or a fraction otherwise)
const BARE_PAIR = new RegExp(`^(\\W*)(\\d+)(\\s*(?:${OF})\\s*)(\\d+)(\\W*)$`, "iu");
// "Page 3" as the whole text
const LABELLED = new RegExp(`^(\\W*(?:${WORD})\\s*)(\\d+)(\\W*)$`, "iu");
// "3" or "- 3 -" as the whole text
const BARE = /^([-–—\s]*)(\d+)([-–—\s]*)$/u;

/**
 * The text with its page number (and page count) updated, or the same text if
 * it is not a page number. A number only counts when it matches the page's
 * current number, so "Page 3" is left alone on page 5.
 */
export function renumberText(
  content: string,
  from: { number: number; total: number },
  to: { number: number; total: number },
  inMargin: boolean,
): string {
  const number = (value: string) => (Number(value) === from.number ? String(to.number) : null);
  const total = (value: string) => (Number(value) === from.total ? String(to.total) : value);

  let match = LABELLED_PAIR.exec(content);
  if (match && number(match[3]) !== null) {
    const replaced = `${match[1]}${match[2]}${number(match[3])}${match[4]}${total(match[5])}`;
    return content.slice(0, match.index) + replaced + content.slice(match.index + match[0].length);
  }
  match = LABELLED.exec(content);
  if (match && number(match[2]) !== null) return `${match[1]}${number(match[2])}${match[3]}`;
  // Numbers with no "page" beside them only count in the header or footer.
  match = inMargin ? BARE_PAIR.exec(content) : null;
  if (match && number(match[2]) !== null) return `${match[1]}${number(match[2])}${match[3]}${total(match[4])}${match[5]}`;
  match = inMargin ? BARE.exec(content) : null;
  if (match && number(match[2]) !== null) return `${match[1]}${number(match[2])}${match[3]}`;
  return content;
}

const isUprightText = (el: TemplateElement): el is TextElement =>
  el.type === "text" && el.visible !== false && !el.rotation && !el.content.includes("\n");

/**
 * Renumber the page-number text on every page after the page list changed.
 *
 * `pages` is the new list, each page still carrying its old `index`;
 * `oldTotal` is the number of pages there were. Pages whose text does not
 * change are returned as they are.
 */
export function renumberPages(pages: TemplatePage[], oldTotal: number): TemplatePage[] {
  return pages.map((page, position) => {
    const from = { number: page.index + 1, total: oldTotal };
    const to = { number: position + 1, total: pages.length };
    if (from.number === to.number && from.total === to.total) return page;
    let changed = false;
    const elements = page.elements.map((el) => {
      if (!isUprightText(el)) return el;
      const middle = el.y + el.height / 2;
      const inMargin = middle < 0.1 * page.height || middle > 0.88 * page.height;
      const content = renumberText(el.content, from, to, inMargin);
      if (content === el.content) return el;
      changed = true;
      return updateText(el, { content });
    });
    return changed ? { ...page, elements } : page;
  });
}
