// Editor state: the template being edited, undo/redo history, and the last
// version known to be saved on the server.

import type { Template, TemplateElement, TemplatePage } from "../types";
import { replaceElements, withZ } from "./elements";
import { renumberPages } from "./pages";

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1000;

export interface EditorState {
  template: Template;
  /** What the server has. Pages that differ from it still need saving. */
  saved: Template;
  past: Template[];
  future: Template[];
  lastKey?: string;
  lastTime: number;
}

export type EditorAction =
  /** Replace a page's whole element list (delete, duplicate, reorder, panel edits). */
  | { type: "set"; page: number; elements: TemplateElement[]; key?: string }
  /**
   * Replace the page list as one undo step: a page was added, duplicated or
   * deleted, or an import changed several pages (and perhaps added some).
   * Pages carry their old `index`; they are renumbered here.
   */
  | { type: "pages"; pages: TemplatePage[] }
  /** Replace individual elements by id (changes coming from the canvas). */
  | { type: "patch"; page: number; updated: TemplateElement[]; key?: string }
  | { type: "rename"; name: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "saved"; snapshot: Template };

export const newPageKey = () => `page-${Math.random().toString(36).slice(2, 10)}`;

export function initialState(loaded: Template): EditorState {
  // every page gets a key, so the editor can tell pages apart when their order changes
  const template = { ...loaded, pages: loaded.pages.map((page) => ({ ...page, key: page.key ?? newPageKey() })) };
  return { template, saved: template, past: [], future: [], lastTime: 0 };
}

function commit(state: EditorState, template: Template, key?: string): EditorState {
  const now = Date.now();
  // Rapid edits of the same thing (typing, dragging a slider) are one undo step.
  const coalesce = key !== undefined && key === state.lastKey && now - state.lastTime < COALESCE_MS;
  return {
    ...state,
    template,
    past: coalesce ? state.past : [...state.past.slice(-HISTORY_LIMIT + 1), state.template],
    future: [],
    lastKey: key,
    lastTime: now,
  };
}

function withElements(template: Template, pageIndex: number, elements: TemplateElement[]): Template {
  return {
    ...template,
    pages: template.pages.map((page, i) => (i === pageIndex ? { ...page, elements: withZ(elements) } : page)),
  };
}

export function reducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "set":
      return commit(state, withElements(state.template, action.page, action.elements), action.key);
    case "pages": {
      if (action.pages.length === 0) return state;
      // printed page numbers ("Page 3 of 8") follow the pages to their new positions
      const pages = renumberPages(action.pages, state.template.pages.length)
        .map((page, index) => (page.index === index ? page : { ...page, index }));
      return commit(state, { ...state.template, pages, pageCount: pages.length });
    }
    case "patch": {
      const page = state.template.pages[action.page];
      if (!page) return state;
      return commit(state, withElements(state.template, action.page, replaceElements(page.elements, action.updated)), action.key);
    }
    case "rename":
      return action.name === state.template.name ? state : commit(state, { ...state.template, name: action.name }, "rename");
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { ...state, template: previous, past: state.past.slice(0, -1), future: [state.template, ...state.future], lastKey: undefined };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...state, template: next, past: [...state.past, state.template], future: rest, lastKey: undefined };
    }
    case "saved":
      return { ...state, saved: action.snapshot };
  }
}

/** What differs between the editor and the server. */
export interface UnsavedChanges {
  name?: string;
  /** Indexes of pages whose elements changed. */
  pages: number[];
  /** The page list itself changed (pages added, duplicated or deleted): everything must be sent. */
  structural: boolean;
}

export function unsavedChanges(state: EditorState): UnsavedChanges {
  const { template, saved } = state;
  const structural =
    template.pages.length !== saved.pages.length || template.pages.some((page, i) => page.key !== saved.pages[i].key);
  return {
    name: template.name !== saved.name ? template.name : undefined,
    pages: template.pages.flatMap((page, i) =>
      page.elements !== saved.pages[i]?.elements || page.tables !== saved.pages[i]?.tables ? [i] : [],
    ),
    structural,
  };
}

export const hasUnsavedChanges = (state: EditorState): boolean => {
  const changes = unsavedChanges(state);
  return changes.name !== undefined || changes.pages.length > 0 || changes.structural;
};
