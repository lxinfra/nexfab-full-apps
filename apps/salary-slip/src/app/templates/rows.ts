// Shared by the template pages (server) and the template form (client).
import type { CalcMethod, ComponentKind, TemplateComponent } from "@/lib/ctc/structure";

/** One component as typed in the form. */
export interface Row {
  name: string;
  kind: ComponentKind;
  method: CalcMethod;
  value: string;
  /** "" = always; STAT = Basic at or below the company's stat-bonus limit; CUSTOM = the three fields below. */
  when: "" | "STAT" | "CUSTOM";
  basis: "BASIC" | "GROSS" | "CTC";
  op: "LTE" | "GTE";
  amount: string;
}

export const usesValue = (m: CalcMethod) => ["PCT_CTC", "PCT_GROSS", "PCT_BASIC", "FIXED"].includes(m);

export function toRows(components: TemplateComponent[]): Row[] {
  return components.map((c) => ({
    name: c.name,
    kind: c.kind,
    method: c.method,
    value: usesValue(c.method) ? String(c.value) : "",
    when: !c.condition ? "" : c.condition.source === "STAT_BONUS_LIMIT" && c.condition.basis === "BASIC" && c.condition.op === "LTE" ? "STAT" : "CUSTOM",
    basis: c.condition?.basis ?? "BASIC",
    op: c.condition?.op ?? "LTE",
    amount: c.condition?.amount != null ? String(c.condition.amount) : "",
  }));
}

