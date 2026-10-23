import { prisma } from "@/lib/db";
import { employeeBreakup, loadStructureContext, today } from "./server";
import type { CtcStatement } from "./statement-files";
import { estimateInHand } from "./structure";

export type StatementResult =
  | { ok: true; statement: CtcStatement }
  | { ok: false; reason: "NOT_FOUND" | "NO_TEMPLATE" | "ERROR"; error?: string; employeeName?: string };

/** Build today's CTC statement for an employee of the given company. */
export async function loadCtcStatement(companyId: number, employeeId: number): Promise<StatementResult> {
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, companyId },
    include: { company: { select: { name: true, address: true } } },
  });
  if (!employee) return { ok: false, reason: "NOT_FOUND" };

  const ctx = await loadStructureContext(companyId);
  const asOf = today();
  const result = employeeBreakup(employee, ctx, asOf);
  if (!result) return { ok: false, reason: "NO_TEMPLATE", employeeName: employee.name };
  if (!result.ok) return { ok: false, reason: "ERROR", error: result.error, employeeName: employee.name };

  return {
    ok: true,
    statement: {
      company: employee.company,
      employee: {
        code: employee.code,
        name: employee.name,
        designation: employee.designation,
        department: employee.department,
        dateOfJoining: employee.dateOfJoining,
      },
      templateName: ctx.templates.get(employee.templateId!)?.name ?? "",
      asOf,
      breakup: result.breakup,
      inHand: estimateInHand(result.breakup, ctx.settings),
    },
  };
}
