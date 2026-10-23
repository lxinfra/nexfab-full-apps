"use client";

import { Check, Columns3, Minus, Paintbrush, Plus, Rows3, Trash2 } from "lucide-react";
import type { TableStyle } from "@/lib/editor/tableDesign";
import TableStyleFields from "./TableStyleFields";
import { useCallback, useEffect, useRef, useState } from "react";
import { columnCount, rowCount } from "@/lib/editor/tables";
import type { TemplateTable } from "@/lib/types";

/** What the user has clicked in the table: a cell, which names a column and a row. */
export interface CellPick {
  row: number;
  column: number;
}

interface Props {
  table: TemplateTable;
  zoom: number;
  pageWidth: number;
  pageHeight: number;
  picked: CellPick | null;
  onPick: (cell: CellPick | null) => void;
  onMoveColumn: (index: number, x: number) => void;
  onMoveRow: (index: number, y: number) => void;
  onInsertColumn: (after: number) => void;
  onDeleteColumn: (index: number) => void;
  onInsertRow: (after: number) => void;
  onDeleteRow: (index: number) => void;
  onHeaderRows: (count: number) => void;
  /** The look the table has now, and where a change goes. */
  style: TableStyle;
  onStyle: (style: TableStyle) => void;
  onRemove: () => void;
  onDone: () => void;
}

type Drag = { kind: "column" | "row"; index: number; at: number };

const HANDLE = 7; // px either side of an edge that grabs it

/**
 * Drawn over a table while it is being edited: its grid with draggable edges,
 * the picked column and row highlighted, and a small toolbar.
 */
export default function TableEditOverlay(props: Props) {
  const { table, zoom, picked, onPick, onMoveColumn, onMoveRow } = props;
  const [drag, setDrag] = useState<Drag | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const columns = columnCount(table);
  const rows = rowCount(table);
  const right = table.columns[table.columns.length - 1];
  const bottom = table.rows[table.rows.length - 1];
  // the overlay reaches a little past the table so the outer edges can be grabbed
  const pad = HANDLE / zoom;
  const left = table.x - pad, top = table.y - pad;
  const toPage = useCallback((event: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom + left, y: (event.clientY - rect.top) / zoom + top };
  }, [zoom, left, top]);

  // dragging an edge: the line follows the pointer, the table changes when it is let go
  useEffect(() => {
    if (!drag) return;
    const move = (event: PointerEvent) => {
      const at = toPage(event);
      setDrag((current) => current && { ...current, at: current.kind === "column" ? at.x : at.y });
    };
    const up = (event: PointerEvent) => {
      const at = toPage(event);
      if (drag.kind === "column") onMoveColumn(drag.index, at.x);
      else onMoveRow(drag.index, at.y);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, toPage, onMoveColumn, onMoveRow]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const at = toPage(event);
    const grab = HANDLE / zoom;
    const columnEdge = table.columns.findIndex((x) => Math.abs(x - at.x) <= grab);
    const rowEdge = table.rows.findIndex((y) => Math.abs(y - at.y) <= grab);
    // a corner picks the column edge; an edge wins over the cell under it
    if (columnEdge >= 0) {
      setDrag({ kind: "column", index: columnEdge, at: table.columns[columnEdge] });
      return;
    }
    if (rowEdge >= 0) {
      setDrag({ kind: "row", index: rowEdge, at: table.rows[rowEdge] });
      return;
    }
    const column = table.columns.findIndex((x, i) => i < columns && at.x >= x && at.x < table.columns[i + 1]);
    const row = table.rows.findIndex((y, i) => i < rows && at.y >= y && at.y < table.rows[i + 1]);
    onPick(column >= 0 && row >= 0 ? { row, column } : null);
  };

  const cursorFor = (event: React.PointerEvent<HTMLDivElement>) => {
    const at = toPage(event);
    const grab = HANDLE / zoom;
    if (table.columns.some((x) => Math.abs(x - at.x) <= grab)) return "col-resize";
    if (table.rows.some((y) => Math.abs(y - at.y) <= grab)) return "row-resize";
    return "cell";
  };
  const [cursor, setCursor] = useState("cell");
  const [styling, setStyling] = useState(false);

  const px = (v: number) => v * zoom;
  const button = "inline-flex h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";
  const toolbarTop = Math.max(0, px(table.y) - 34);

  return (
    <>
      {/* the grid */}
      <div ref={box} data-table-edit={table.id}
        className="absolute z-20 select-none touch-none"
        style={{ left: px(left), top: px(top), width: px(right - left + pad), height: px(bottom - top + pad), cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={(event) => !drag && setCursor(cursorFor(event))}>
        {/* highlight of the picked column and row */}
        {picked && (
          <>
            <div className="pointer-events-none absolute bg-indigo-500/10"
              style={{ left: px(table.columns[picked.column] - left), top: px(table.y - top), width: px(table.columns[picked.column + 1] - table.columns[picked.column]), height: px(bottom - table.y) }} />
            <div className="pointer-events-none absolute bg-indigo-500/10"
              style={{ left: px(table.x - left), top: px(table.rows[picked.row] - top), width: px(right - table.x), height: px(table.rows[picked.row + 1] - table.rows[picked.row]) }} />
          </>
        )}
        {table.columns.map((x, i) => (
          <div key={`c${i}`} data-column-edge={i} className="pointer-events-none absolute w-0 border-l-2 border-indigo-500"
            style={{ left: px(x - left) - 1, top: px(table.y - top), height: px(bottom - table.y), opacity: drag?.kind === "column" && drag.index === i ? 0.3 : 0.9 }} />
        ))}
        {table.rows.map((y, i) => (
          <div key={`r${i}`} data-row-edge={i} className="pointer-events-none absolute h-0 border-t-2 border-indigo-500"
            style={{ top: px(y - top) - 1, left: px(table.x - left), width: px(right - table.x), opacity: drag?.kind === "row" && drag.index === i ? 0.3 : 0.9 }} />
        ))}
        {/* the edge being dragged */}
        {drag?.kind === "column" && (
          <div className="pointer-events-none absolute w-0 border-l-2 border-dashed border-indigo-700"
            style={{ left: px(drag.at - left) - 1, top: px(table.y - top), height: px(bottom - table.y) }} />
        )}
        {drag?.kind === "row" && (
          <div className="pointer-events-none absolute h-0 border-t-2 border-dashed border-indigo-700"
            style={{ top: px(drag.at - top) - 1, left: px(table.x - left), width: px(right - table.x) }} />
        )}
      </div>

      {/* the toolbar */}
      <div role="toolbar" aria-label="Edit table" data-table-toolbar={table.id}
        className="absolute z-30 flex items-center gap-0.5 rounded-md border border-slate-300 bg-white px-1 py-0.5 text-slate-700 shadow-md"
        style={{ left: Math.max(0, px(table.x)), top: toolbarTop }}
        onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className={button} title={`Add a column after column ${(picked?.column ?? columns - 1) + 1}`}
          onClick={() => props.onInsertColumn(picked?.column ?? columns - 1)}>
          <Columns3 className="h-3.5 w-3.5" aria-hidden /><Plus className="h-3 w-3" aria-hidden />Column
        </button>
        <button type="button" className={button} title="Delete the picked column" disabled={!picked || columns <= 1}
          onClick={() => picked && props.onDeleteColumn(picked.column)}>
          <Columns3 className="h-3.5 w-3.5" aria-hidden /><Minus className="h-3 w-3" aria-hidden />Column
        </button>
        <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
        <button type="button" className={button} title={`Add a row after row ${(picked?.row ?? rows - 1) + 1}`}
          onClick={() => props.onInsertRow(picked?.row ?? rows - 1)}>
          <Rows3 className="h-3.5 w-3.5" aria-hidden /><Plus className="h-3 w-3" aria-hidden />Row
        </button>
        <button type="button" className={button} title="Delete the picked row" disabled={!picked || rows <= 1}
          onClick={() => picked && props.onDeleteRow(picked.row)}>
          <Rows3 className="h-3.5 w-3.5" aria-hidden /><Minus className="h-3 w-3" aria-hidden />Row
        </button>
        <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
        <label className="flex items-center gap-1 px-1 text-[11px]">
          Heading rows
          <input type="number" min={0} max={rows - 1} value={table.headerRows} aria-label="Heading rows"
            onChange={(event) => props.onHeaderRows(Number(event.target.value))}
            className="h-6 w-10 rounded border border-slate-300 px-1 text-right text-[11px] tabular-nums focus:border-indigo-500 focus:outline-none" />
        </label>
        <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
        <button type="button" className={button + (styling ? " bg-slate-100" : "")} aria-pressed={styling} title="Lines, backgrounds and text of the whole table"
          onClick={() => setStyling((on) => !on)}>
          <Paintbrush className="h-3.5 w-3.5" aria-hidden />Style
        </button>
        <span className="mx-0.5 h-4 w-px bg-slate-200" aria-hidden />
        <button type="button" className={button + " text-red-700 hover:bg-red-50"} title="This is not a table: remove the grid (the page is not changed)"
          onClick={props.onRemove}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />Not a table
        </button>
        <button type="button" className={button + " bg-indigo-600 text-white hover:bg-indigo-700"} onClick={props.onDone}>
          <Check className="h-3.5 w-3.5" aria-hidden />Done
        </button>
      </div>
      {styling && (
        <div role="group" aria-label="Table style" data-table-style-panel
          className="absolute z-30 w-60 rounded-md border border-slate-300 bg-white p-3 shadow-md"
          style={{ left: Math.max(0, px(table.x)), top: toolbarTop + 34 }}
          onPointerDown={(event) => event.stopPropagation()}>
          <TableStyleFields style={props.style} onChange={props.onStyle} />
          <p className="mt-2 text-[11px] text-slate-500">Changes apply at once to the whole table (Ctrl+Z undoes).</p>
        </div>
      )}
    </>
  );
}

/** While a table is being marked: the rectangle being dragged out. */
export function MarkTableOverlay({ zoom, onMark, onCancel }: {
  zoom: number;
  onMark: (rect: { x: number; y: number; width: number; height: number }) => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [now, setNow] = useState<{ x: number; y: number } | null>(null);
  const toPage = (event: { clientX: number; clientY: number }) => {
    const rect = box.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / zoom, y: (event.clientY - rect.top) / zoom };
  };
  const rect = start && now ? {
    x: Math.min(start.x, now.x), y: Math.min(start.y, now.y),
    width: Math.abs(now.x - start.x), height: Math.abs(now.y - start.y),
  } : null;
  return (
    <div ref={box} data-mark-table className="absolute inset-0 z-20 cursor-crosshair touch-none bg-indigo-500/5"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
        const at = toPage(event);
        setStart(at);
        setNow(at);
      }}
      onPointerMove={(event) => start && setNow(toPage(event))}
      onPointerUp={(event) => {
        if (!start) return;
        const end = toPage(event);
        const area = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
        setStart(null);
        setNow(null);
        if (area.width >= 20 && area.height >= 10) onMark(area);
        else onCancel();
      }}>
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-slate-900/80 px-2 py-1 text-xs text-white">
        Drag a rectangle around the table. Esc cancels.
      </div>
      {rect && (
        <div className="pointer-events-none absolute border-2 border-dashed border-indigo-600 bg-indigo-500/10"
          style={{ left: rect.x * zoom, top: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom }} />
      )}
    </div>
  );
}
