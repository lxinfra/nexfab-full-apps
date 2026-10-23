"use client";

import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Bold, Copy, FileSpreadsheet, FlipHorizontal2, FlipVertical2, Grid2x2Plus, ImageUp, Italic, Lock, Pencil, ScanSearch, SquareDashed, Trash2, TriangleAlert, Unlock } from "lucide-react";
import { useRef, useState } from "react";
import { cleanFieldName, moveElement, updateText, type ReorderMode } from "@/lib/editor/elements";
import { COMMON_FAMILIES, isBold } from "@/lib/editor/fonts";
import { r3 } from "@/lib/editor/geometry";
import { isLocked } from "@/lib/editor/objects";
import { chainPages, columnCount, rowCount, tableChain, tableOf, tableText } from "@/lib/editor/tables";
import type {
  ImageElement, LineElement, PathElement, RectElement, ShapeElement, Template, TemplateElement, TemplatePage,
  TemplateTable, TextElement,
} from "@/lib/types";
import {
  ColorField, Field, IconButton, NumberField, OpacityField, Section, SelectField, inputClass,
} from "./fields";

interface Props {
  template: Template;
  page: TemplatePage;
  selected: TemplateElement[];
  /** Apply a change to every selected element. `key` groups rapid edits into one undo step. */
  onUpdate: (change: (el: TemplateElement) => TemplateElement, key?: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onReorder: (mode: ReorderMode) => void;
  /** Upload a replacement picture; resolves once the element has been updated. */
  onReplaceImage: (el: ImageElement, file: File) => Promise<void>;
  /** Open the "Import Excel" dialog for a detected table; `all` = for every table it continues in. */
  onImportTable: (tableId: string, all?: boolean) => void;
  onEditTable: (tableId: string) => void;
  onMarkTable: () => void;
  onNewTable: () => void;
  onRedetectTables: () => void;
}

const TYPE_LABEL = { image: "Image", text: "Text", rect: "Rectangle", line: "Line", path: "Shape" } as const;
const kindOf = (el: TemplateElement) => (el.type === "shape" ? el.shape : el.type);

export default function PropertiesPanel(props: Props) {
  const { template, page, selected } = props;
  if (selected.length === 0) {
    return <PageInfo template={template} page={page} onImportTable={props.onImportTable} onEditTable={props.onEditTable} onMarkTable={props.onMarkTable} onNewTable={props.onNewTable} onRedetectTables={props.onRedetectTables} />;
  }
  const importButtons = (table: TemplateTable) => (
    <TableImport template={template} page={page} table={table} onImportTable={props.onImportTable} onEditTable={props.onEditTable} />
  );
  if (selected.length > 1) {
    return (
      <div>
        <Header title={`${selected.length} elements selected`} />
        <Arrange {...props} />
        <p className="px-4 py-3 text-xs text-slate-500">Drag to move them together. Select one element to edit its properties.</p>
      </div>
    );
  }
  const el = selected[0];
  const table = el.type === "text" ? tableOf(page.tables ?? [], el) : undefined;
  return (
    <div>
      <Header title={TYPE_LABEL[kindOf(el)]} subtitle={el.type === "text" ? el.fieldName : undefined} />
      {table && (
        <Section title="Table">
          <p className="text-xs text-slate-600">This text is a cell of a {tableSize(table)} table.</p>
          {importButtons(table)}
        </Section>
      )}
      {el.type === "text" && <TextProperties el={el} {...props} />}
      {el.type === "image" && <ImageProperties el={el} {...props} />}
      {el.type === "shape" && <ShapeProperties el={el} {...props} />}
      <Geometry el={el} {...props} />
      <Arrange {...props} />
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-slate-200 px-4 py-3">
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
}

const tableSize = (table: TemplateTable) => `${rowCount(table)} × ${columnCount(table)}`;

function ImportButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-600 bg-white px-3 py-1.5 text-sm font-medium text-emerald-800 shadow-sm hover:bg-emerald-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">
      <FileSpreadsheet className="h-4 w-4 shrink-0" aria-hidden />
      {label}
    </button>
  );
}

interface TableImportProps {
  template: Template;
  page: TemplatePage;
  table: TemplateTable;
  onImportTable: (tableId: string, all?: boolean) => void;
  onEditTable: (tableId: string) => void;
}

/** "Import Excel" for one table, plus "for all pages" when the table continues elsewhere, and "Edit table". */
function TableImport({ template, page, table, onImportTable, onEditTable }: TableImportProps) {
  const chain = tableChain(template.pages, page.index, table);
  return (
    <div className="space-y-1.5">
      <ImportButton label="Import Excel" onClick={() => onImportTable(table.id)} />
      <button type="button" onClick={() => onEditTable(table.id)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        <Pencil className="h-4 w-4 shrink-0" aria-hidden />
        Edit table
      </button>
      {chain.length > 1 && (
        <>
          <ImportButton label={`Import for all ${chain.length} tables`} onClick={() => onImportTable(table.id, true)} />
          <p className="text-xs text-slate-500">
            This table continues with the same columns on {chainPages(chain)}. One spreadsheet can fill all of them.
          </p>
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- page
interface PageInfoProps {
  template: Template;
  page: TemplatePage;
  onImportTable: (tableId: string, all?: boolean) => void;
  onEditTable: (tableId: string) => void;
  onMarkTable: () => void;
  onNewTable: () => void;
  onRedetectTables: () => void;
}

function PageInfo({ template, page, onImportTable, onEditTable, onMarkTable, onNewTable, onRedetectTables }: PageInfoProps) {
  const tables = page.tables ?? [];
  const counts = { text: 0, image: 0, shape: 0 };
  for (const el of page.elements) counts[el.type] += 1;
  const hidden = page.elements.filter((el) => el.visible === false).length;
  const warnings = template.warnings.filter((w) => w.page === undefined || w.page === page.index + 1);
  return (
    <div>
      <Header title={`Page ${page.index + 1}`} />
      <Section title="Page">
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-slate-500">Size</dt>
          <dd className="text-right tabular-nums">
            {Math.round(page.width)} × {Math.round(page.height)} pt
          </dd>
          <dt className="text-slate-500">Text fields</dt>
          <dd className="text-right tabular-nums">{counts.text}</dd>
          <dt className="text-slate-500">Images</dt>
          <dd className="text-right tabular-nums">{counts.image}</dd>
          <dt className="text-slate-500">Shapes</dt>
          <dd className="text-right tabular-nums">{counts.shape}</dd>
        </dl>
        {hidden > 0 && <p className="text-xs text-slate-500">{hidden} hidden OCR text fields are not shown.</p>}
      </Section>
      <Section title="Tables">
          {tables.length === 0 && <p className="mb-2 text-xs text-slate-500">No table was found on this page.</p>}
          <ul className="space-y-3">
            {tables.map((table, i) => {
              const first = tableText(table, page.elements)[0].filter(Boolean).join(" · ");
              return (
                <li key={table.id}>
                  <p className="text-sm text-slate-800">
                    Table {i + 1} <span className="tabular-nums text-slate-500">· {tableSize(table)}</span>
                  </p>
                  {first && <p className="mb-1.5 truncate text-xs text-slate-500" title={first}>{first}</p>}
                  <TableImport template={template} page={page} table={table} onImportTable={onImportTable} onEditTable={onEditTable} />
                </li>
              );
            })}
          </ul>
          <button type="button" onClick={onMarkTable}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-400 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <SquareDashed className="h-4 w-4 shrink-0" aria-hidden />
            Mark a table
          </button>
          <p className="mt-1 text-xs text-slate-500">For a table that was not found: drag a rectangle around it on the page.</p>
          <button type="button" onClick={onNewTable}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <Grid2x2Plus className="h-4 w-4 shrink-0" aria-hidden />
            New table
          </button>
          <p className="mt-1 text-xs text-slate-500">Draw a table of your own: drag out its area, then choose rows, columns and look.</p>
          <button type="button" onClick={onRedetectTables}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
            <ScanSearch className="h-4 w-4 shrink-0" aria-hidden />
            Find tables again
          </button>
          <p className="mt-1 text-xs text-slate-500">Looks through the whole PDF again with the latest detection; hand-made changes to grids are lost.</p>
        </Section>
      {warnings.length > 0 && (
        <Section title="Notes from the import">
          <ul className="space-y-2">
            {warnings.map((warning, i) => (
              <li key={i} className="flex gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{warning.message}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <div className="space-y-1.5 px-4 py-3 text-xs text-slate-500">
        <p>Click an element to select it. Double-click text to edit it in place.</p>
        <p>Shift-click or drag on empty space to select several.</p>
      </div>
    </div>
  );
}

// -------------------------------------------------------------------- text
function TextProperties({ el, template, onUpdate }: Props & { el: TextElement }) {
  const set = (changes: Partial<TextElement>, key?: string) =>
    onUpdate((target) => (target.type === "text" ? updateText(target, changes) : target), key && `${key}:${el.id}`);
  const families = [...new Set([el.fontFamily, ...template.fonts.map((f) => f.family), ...COMMON_FAMILIES])];
  const bold = isBold(el.fontWeight);
  const alignments = [
    ["left", "Align left", AlignLeft], ["center", "Align centre", AlignCenter],
    ["right", "Align right", AlignRight], ["justify", "Justify", AlignJustify],
  ] as const;

  return (
    <>
      <Section title="Content">
        <textarea
          className={inputClass + " min-h-[4.5rem] resize-y leading-snug"}
          value={el.content}
          rows={Math.min(8, el.content.split("\n").length + 1)}
          aria-label="Text content"
          onChange={(event) => set({ content: event.target.value }, "content")}
        />
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            checked={el.isVariable}
            onChange={(event) => set({ isVariable: event.target.checked })}
          />
          Variable field
        </label>
        {el.isVariable && (
          <>
            <Field label="Field name">
              <input
                className={inputClass + " font-mono"}
                value={el.fieldName}
                spellCheck={false}
                onChange={(event) => set({ fieldName: cleanFieldName(event.target.value) }, "fieldName")}
              />
            </Field>
            <p className="text-xs text-slate-500">
              Bulk fill replaces this text with the CSV column <code className="font-mono">{el.fieldName || "…"}</code>.
              You can also write <code className="font-mono">{"{{name}}"}</code> inside any text.
            </p>
          </>
        )}
      </Section>

      <Section title="Typography">
        <SelectField
          label="Font"
          value={el.fontFamily}
          options={families.map((family) => ({ value: family, label: family }))}
          onChange={(fontFamily) => set({ fontFamily })}
        />
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Size" value={el.fontSize} min={1} max={800} step={0.5} suffix="pt"
            onChange={(fontSize) => set({ fontSize }, "fontSize")} />
          <NumberField label="Line height" value={el.lineHeight} min={0.5} max={5} step={0.05}
            onChange={(lineHeight) => set({ lineHeight }, "lineHeight")} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <IconButton label="Bold" active={bold} onClick={() => set({ fontWeight: bold ? "normal" : "bold" })}>
            <Bold className="h-4 w-4" />
          </IconButton>
          <IconButton label="Italic" active={el.fontStyle === "italic"}
            onClick={() => set({ fontStyle: el.fontStyle === "italic" ? "normal" : "italic" })}>
            <Italic className="h-4 w-4" />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
          {alignments.map(([align, label, Icon]) => (
            <IconButton key={align} label={label} active={el.align === align} onClick={() => set({ align })}>
              <Icon className="h-4 w-4" />
            </IconButton>
          ))}
        </div>
        <ColorField label="Colour" value={el.color} onChange={(color) => color && set({ color }, "color")} />
        <OpacityField label="Opacity" value={el.opacity ?? 1} onChange={(opacity) => set({ opacity }, "opacity")} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------- image
function ImageProperties({ el, onUpdate, onReplaceImage }: Props & { el: ImageElement }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (changes: Partial<ImageElement>, key?: string) =>
    onUpdate((target) => (target.type === "image" ? { ...target, ...changes } : target), key && `${key}:${el.id}`);
  const toggle = (key: "flipX" | "flipY") =>
    onUpdate((target) => {
      if (target.type !== "image") return target;
      const next = { ...target };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });

  return (
    <Section title="Image">
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            await onReplaceImage(el, file);
          } catch (err) {
            setError(err instanceof Error ? err.message : "The image could not be uploaded.");
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
      >
        <ImageUp className="h-4 w-4" aria-hidden />
        {busy ? "Uploading…" : "Replace image"}
      </button>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <SelectField
        label="How the picture fills its box"
        value={el.fit}
        options={[
          { value: "fit", label: "Fit: show all of it" },
          { value: "fill", label: "Fill: crop to cover" },
          { value: "stretch", label: "Stretch to the box" },
        ]}
        onChange={(fit) => set({ fit })}
      />
      <p className="text-xs tabular-nums text-slate-500">
        {el.naturalWidth} × {el.naturalHeight} px
      </p>
      <div className="flex items-center gap-1.5">
        <IconButton label="Flip horizontally" active={!!el.flipX} onClick={() => toggle("flipX")}>
          <FlipHorizontal2 className="h-4 w-4" />
        </IconButton>
        <IconButton label="Flip vertically" active={!!el.flipY} onClick={() => toggle("flipY")}>
          <FlipVertical2 className="h-4 w-4" />
        </IconButton>
      </div>
      <OpacityField label="Opacity" value={el.opacity ?? 1} onChange={(opacity) => set({ opacity }, "opacity")} />
    </Section>
  );
}

// ------------------------------------------------------------------- shape
function ShapeProperties({ el, onUpdate }: Props & { el: ShapeElement }) {
  const set = (changes: Partial<RectElement>, key?: string) =>
    onUpdate((target) => (target.type === "shape" ? ({ ...target, ...changes } as ShapeElement) : target),
      key && `${key}:${el.id}`);
  return (
    <Section title="Appearance">
      {el.shape !== "line" && (
        <>
          <ColorField label="Fill" value={el.fill} nullable onChange={(fill) => set({ fill }, "fill")} />
          {el.fill && (
            <OpacityField label="Fill opacity" value={el.fillOpacity ?? 1}
              onChange={(fillOpacity) => set({ fillOpacity }, "fillOpacity")} />
          )}
        </>
      )}
      <ColorField label="Stroke" value={el.stroke} nullable={el.shape !== "line"}
        onChange={(stroke) => set({ stroke, strokeWidth: stroke && !el.strokeWidth ? 1 : el.strokeWidth }, "stroke")} />
      {el.stroke && (
        <>
          <NumberField label="Stroke width" value={el.strokeWidth} min={0} max={200} step={0.25} suffix="pt"
            onChange={(strokeWidth) => set({ strokeWidth }, "strokeWidth")} />
          <OpacityField label="Stroke opacity" value={el.strokeOpacity ?? 1}
            onChange={(strokeOpacity) => set({ strokeOpacity }, "strokeOpacity")} />
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------- geometry
function Geometry({ el, page, onUpdate }: Props & { el: TemplateElement }) {
  const key = (name: string) => `${name}:${el.id}`;
  const locked = isLocked(el, page);
  const lock = (
    <label className="flex items-center gap-2 text-sm text-slate-800">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        checked={locked}
        onChange={(event) => onUpdate((target) => ({ ...target, locked: event.target.checked }))}
      />
      {locked ? <Lock className="h-3.5 w-3.5 text-slate-500" aria-hidden /> : <Unlock className="h-3.5 w-3.5 text-slate-500" aria-hidden />}
      Lock position
    </label>
  );

  if (el.type === "shape" && el.shape === "line") {
    const setPoint = (changes: Partial<LineElement>, name: string) =>
      onUpdate((target) => {
        if (target.type !== "shape" || target.shape !== "line") return target;
        const next = { ...target, ...changes };
        return {
          ...next,
          x: Math.min(next.x1, next.x2), y: Math.min(next.y1, next.y2),
          width: r3(Math.abs(next.x2 - next.x1)), height: r3(Math.abs(next.y2 - next.y1)),
        };
      }, key(name));
    return (
      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Start X" value={el.x1} suffix="pt" onChange={(x1) => setPoint({ x1 }, "x1")} />
          <NumberField label="Start Y" value={el.y1} suffix="pt" onChange={(y1) => setPoint({ y1 }, "y1")} />
          <NumberField label="End X" value={el.x2} suffix="pt" onChange={(x2) => setPoint({ x2 }, "x2")} />
          <NumberField label="End Y" value={el.y2} suffix="pt" onChange={(y2) => setPoint({ y2 }, "y2")} />
        </div>
        {lock}
      </Section>
    );
  }

  const resizable = el.type !== "text"; // a text box takes its size from its content
  const setSize = (changes: Partial<Pick<PathElement, "width" | "height">>, name: string) =>
    onUpdate((target) => ({ ...target, ...changes }), key(name));
  return (
    <Section title="Position">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" value={el.x} suffix="pt"
          onChange={(x) => onUpdate((target) => moveElement(target, x - target.x, 0), key("x"))} />
        <NumberField label="Y" value={el.y} suffix="pt"
          onChange={(y) => onUpdate((target) => moveElement(target, 0, y - target.y), key("y"))} />
        <NumberField label="Width" value={el.width} min={0.1} suffix="pt" disabled={!resizable}
          onChange={(width) => setSize({ width }, "width")} />
        <NumberField label="Height" value={el.height} min={0.1} suffix="pt" disabled={!resizable}
          onChange={(height) => setSize({ height }, "height")} />
        <NumberField label="Rotation" value={el.rotation} min={-360} max={360} suffix="°"
          onChange={(rotation) => onUpdate((target) => ({ ...target, rotation }), key("rotation"))} />
      </div>
      {lock}
    </Section>
  );
}

// ----------------------------------------------------------------- arrange
function Arrange({ onDelete, onDuplicate, onReorder }: Props) {
  return (
    <Section title="Arrange">
      <div className="flex flex-wrap items-center gap-1.5">
        <IconButton label="Bring to front" onClick={() => onReorder("front")}>
          <ArrowUpToLine className="h-4 w-4" />
        </IconButton>
        <IconButton label="Bring forward" onClick={() => onReorder("forward")}>
          <ArrowUp className="h-4 w-4" />
        </IconButton>
        <IconButton label="Send backward" onClick={() => onReorder("backward")}>
          <ArrowDown className="h-4 w-4" />
        </IconButton>
        <IconButton label="Send to back" onClick={() => onReorder("back")}>
          <ArrowDownToLine className="h-4 w-4" />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <IconButton label="Duplicate (Ctrl+D)" onClick={onDuplicate}>
          <Copy className="h-4 w-4" />
        </IconButton>
        <IconButton label="Delete (Del)" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </Section>
  );
}
