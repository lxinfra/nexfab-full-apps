"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteDraftRun,
  finaliseMonth,
  reopenMonth,
  saveRun,
  type PayrollActionResult,
} from "@/app/actions/payroll";
import { ConfirmButton } from "@/components/ConfirmButton";
import { formatINR } from "@/lib/format";
import {
  calculatePayroll,
  type DeductionRuleInput,
  type EarningComponent,
  type NamedAmount,
  type PayrollOverrides,
  type PayrollResult,
} from "@/lib/payroll/calc";

export interface PayrollRow {
  employeeId: number;
  code: string;
  name: string;
  designation: string;
  totalDays: number;
  components: EarningComponent[];
  rules: DeductionRuleInput[];
  initial: {
    paidDays: number;
    arrears: number;
    oneTimeEarnings: NamedAmount[];
    manualRules: Record<string, number>;
    adhoc: NamedAmount[];
    overrides: PayrollOverrides;
  };
  /** Finalised months only: the figures as issued. */
  issued?: PayrollResult;
  slipId?: number;
}

interface TextAmount {
  name: string;
  amount: string;
}

/** What the user is typing; everything is text until it is validated. */
interface RowState {
  paidDays: string;
  lopDays: string;
  arrears: string;
  bonus: string;
  otherEarnings: TextAmount[];
  manual: Record<string, string>;
  adhoc: TextAmount[];
  earningOverrides: Record<string, string>;
  deductionOverrides: Record<string, string>;
}

const BONUS = "Bonus";
const str = (n: number | undefined) => (n ? String(n) : "");
const textMap = (m: Record<string, number> | undefined) =>
  Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, String(v)]));

function initialState(row: PayrollRow): RowState {
  const { initial } = row;
  const bonusIndex = initial.oneTimeEarnings.findIndex((e) => e.name === BONUS);
  return {
    paidDays: String(initial.paidDays),
    lopDays: String(Number((row.totalDays - initial.paidDays).toFixed(2))),
    arrears: str(initial.arrears),
    bonus: bonusIndex >= 0 ? str(initial.oneTimeEarnings[bonusIndex].amount) : "",
    otherEarnings: initial.oneTimeEarnings
      .filter((_, i) => i !== bonusIndex)
      .map((e) => ({ name: e.name, amount: String(e.amount) })),
    manual: Object.fromEntries(Object.entries(initial.manualRules).map(([k, v]) => [k, str(v)])),
    adhoc: initial.adhoc.map((e) => ({ name: e.name, amount: String(e.amount) })),
    earningOverrides: textMap(initial.overrides.earnings),
    deductionOverrides: textMap(initial.overrides.deductions),
  };
}

const toNumber = (s: string) => (s.trim() === "" ? 0 : Number(s));
const invalid = (s: string) => {
  const n = toNumber(s);
  return !Number.isFinite(n) || n < 0;
};
const numberMap = (m: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(m)
      .filter(([, v]) => v.trim() !== "")
      .map(([k, v]) => [k, Number(v)]),
  );

/** Validate one row and turn it into the payload saved on the server. */
function evaluate(row: PayrollRow, s: RowState) {
  const paidDays = Number(s.paidDays);
  let error: string | null = null;
  if (s.paidDays.trim() === "" || !Number.isFinite(paidDays) || paidDays < 0 || paidDays > row.totalDays) {
    error = `Paid days must be between 0 and ${row.totalDays}.`;
  } else if (
    [s.arrears, s.bonus, ...Object.values(s.manual), ...Object.values(s.earningOverrides), ...Object.values(s.deductionOverrides)].some(invalid) ||
    [...s.otherEarnings, ...s.adhoc].some((e) => invalid(e.amount))
  ) {
    error = "Amounts must be numbers and cannot be negative.";
  } else if ([...s.otherEarnings, ...s.adhoc].some((e) => e.name.trim() === "" && toNumber(e.amount) !== 0)) {
    error = "Give every extra earning or deduction a name (see Details).";
  }

  const named = (list: TextAmount[]) =>
    list.filter((e) => e.name.trim() !== "").map((e) => ({ name: e.name.trim(), amount: toNumber(e.amount) }));
  const payload = {
    employeeId: row.employeeId,
    paidDays,
    arrears: toNumber(s.arrears),
    oneTimeEarnings: [...(toNumber(s.bonus) > 0 ? [{ name: BONUS, amount: toNumber(s.bonus) }] : []), ...named(s.otherEarnings)],
    manualRules: numberMap(s.manual),
    adhoc: named(s.adhoc),
    overrides: { earnings: numberMap(s.earningOverrides), deductions: numberMap(s.deductionOverrides) },
  };

  let result: PayrollResult | null = null;
  if (!error) {
    try {
      result = calculatePayroll({
        totalDays: row.totalDays,
        paidDays,
        components: row.components,
        arrears: payload.arrears,
        oneTimeEarnings: payload.oneTimeEarnings,
        rules: row.rules,
        manualAmounts: payload.manualRules,
        adhocDeductions: payload.adhoc,
        overrides: payload.overrides,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : "This row could not be calculated.";
    }
  }
  return { payload, result, error };
}

const cellInput = "input num w-20 px-1.5 py-1";

function ListEditor({
  label,
  addLabel,
  items,
  onChange,
}: {
  label: string;
  addLabel: string;
  items: TextAmount[];
  onChange: (items: TextAmount[]) => void;
}) {
  const patch = (i: number, p: Partial<TextAmount>) => onChange(items.map((e, k) => (k === i ? { ...e, ...p } : e)));
  return (
    <div className="mt-2">
      {items.map((e, i) => (
        <div key={i} className="mb-1 flex items-center gap-1.5">
          <input className="input flex-1 py-1" placeholder={label} value={e.name} onChange={(ev) => patch(i, { name: ev.target.value })} aria-label={`${label} name`} />
          <input className={`${cellInput} w-28`} type="number" min="0" placeholder="0" value={e.amount} onChange={(ev) => patch(i, { amount: ev.target.value })} aria-label={`${label} amount`} />
          <button type="button" className="btn btn-sm" onClick={() => onChange(items.filter((_, k) => k !== i))}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" onClick={() => onChange([...items, { name: "", amount: "" }])}>
        {addLabel}
      </button>
    </div>
  );
}

/** The earnings / deductions breakdown of one employee. Editable while the month is a draft. */
function Details({
  result,
  state,
  update,
}: {
  result: PayrollResult;
  state?: RowState;
  update?: (patch: Partial<RowState>) => void;
}) {
  const editable = !!state && !!update;
  const line = "flex items-center justify-between gap-2 py-0.5";
  return (
    <div className="grid grid-cols-2 gap-6 bg-slate-50 p-4 text-sm">
      <div>
        <h3 className="mb-1 font-semibold">Earnings</h3>
        {result.earnings.map((e) => (
          <div key={e.name} className={line}>
            <span>
              {e.name}
              {e.fullAmount !== null && <span className="text-xs text-slate-500"> (monthly {formatINR(e.fullAmount, 0)})</span>}
            </span>
            {editable && e.fullAmount !== null ? (
              <input
                className={`${cellInput} w-28`}
                type="number"
                min="0"
                placeholder={formatINR(e.amount, 0)}
                title="Leave empty to use the calculated amount"
                value={state.earningOverrides[e.name] ?? ""}
                onChange={(ev) => update({ earningOverrides: { ...state.earningOverrides, [e.name]: ev.target.value } })}
                aria-label={`${e.name} earned amount`}
              />
            ) : (
              <span className="num">{formatINR(e.amount)}</span>
            )}
          </div>
        ))}
        <div className={`${line} mt-1 border-t border-slate-300 font-semibold`}>
          <span>Gross earnings</span>
          <span className="num">{formatINR(result.gross)}</span>
        </div>
        {editable && (
          <ListEditor label="Other one-time earning" addLabel="+ Add one-time earning" items={state.otherEarnings} onChange={(otherEarnings) => update({ otherEarnings })} />
        )}
      </div>

      <div>
        <h3 className="mb-1 font-semibold">Deductions</h3>
        {result.deductions.length === 0 && <p className="text-slate-500">No deductions.</p>}
        {result.deductions.map((d) => (
          <div key={`${d.ruleId ?? "x"}-${d.name}`} className={line}>
            <span>
              {d.name}
              {d.manual && <span className="text-xs text-slate-500"> (entered in the table)</span>}
            </span>
            {editable && d.ruleId !== undefined && !d.manual ? (
              <input
                className={`${cellInput} w-28`}
                type="number"
                min="0"
                placeholder={formatINR(d.amount, 0)}
                title="Leave empty to use the calculated amount"
                value={state.deductionOverrides[d.name] ?? ""}
                onChange={(ev) => update({ deductionOverrides: { ...state.deductionOverrides, [d.name]: ev.target.value } })}
                aria-label={`${d.name} deduction amount`}
              />
            ) : (
              <span className="num">{formatINR(d.amount)}</span>
            )}
          </div>
        ))}
        <div className={`${line} mt-1 border-t border-slate-300 font-semibold`}>
          <span>Total deductions</span>
          <span className="num">{formatINR(result.totalDeductions)}</span>
        </div>
        {editable && (
          <ListEditor label="Other deduction" addLabel="+ Add one-off deduction" items={state.adhoc} onChange={(adhoc) => update({ adhoc })} />
        )}
        {result.employerContributions.length > 0 && (
          <div className="mt-3 text-xs text-slate-600">
            <span className="font-semibold">Employer contributions (not deducted): </span>
            {result.employerContributions.map((e) => `${e.name} ${formatINR(e.amount)}`).join(", ")}
          </div>
        )}
        {editable && (
          <p className="mt-3 text-xs text-slate-500">
            Type in a box to replace the calculated amount for this month only. Clear the box to go back to the
            calculated amount (shown in grey).
          </p>
        )}
      </div>
    </div>
  );
}

export function PayrollTable({
  year,
  month,
  label,
  status,
  runId,
  rows,
}: {
  year: number;
  month: number;
  label: string;
  status: "DRAFT" | "FINALISED";
  runId: number;
  rows: PayrollRow[];
}) {
  const router = useRouter();
  const draft = status === "DRAFT";
  const [state, setState] = useState<Record<number, RowState>>(() =>
    Object.fromEntries(rows.map((r) => [r.employeeId, initialState(r)])),
  );
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [dirty, setDirty] = useState(false);
  const [feedback, setFeedback] = useState<PayrollActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const evaluated = useMemo(
    () =>
      rows.map((row) => {
        // An employee added after this table was first shown has no typed state yet.
        const rowState = state[row.employeeId] ?? initialState(row);
        if (!draft && row.issued) return { row, rowState, payload: null, result: row.issued, error: null };
        return { row, rowState, ...evaluate(row, rowState) };
      }),
    [rows, state, draft],
  );

  const manualRules = useMemo(() => {
    const seen = new Map<number, string>();
    rows.forEach((r) => r.rules.filter((x) => x.type === "MANUAL").forEach((x) => seen.set(x.id, x.name)));
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [rows]);

  const update = (row: PayrollRow, patch: Partial<RowState>) => {
    setState((s) => ({ ...s, [row.employeeId]: { ...(s[row.employeeId] ?? initialState(row)), ...patch } }));
    setDirty(true);
    setFeedback(null);
  };

  const setDays = (row: PayrollRow, field: "paidDays" | "lopDays", value: string) => {
    const n = Number(value);
    const other = value.trim() !== "" && Number.isFinite(n) ? String(Number((row.totalDays - n).toFixed(2))) : "";
    update(row, field === "paidDays" ? { paidDays: value, lopDays: other } : { lopDays: value, paidDays: other });
  };

  const hasErrors = evaluated.some((e) => e.error);
  const totals = evaluated.reduce(
    (t, e) => ({
      gross: t.gross + (e.result?.gross ?? 0),
      deductions: t.deductions + (e.result?.totalDeductions ?? 0),
      net: t.net + (e.result?.netPay ?? 0),
    }),
    { gross: 0, deductions: 0, net: 0 },
  );
  const payload = () => evaluated.map((e) => e.payload);

  const save = () =>
    startTransition(async () => {
      const result = await saveRun(year, month, payload());
      setFeedback(result);
      if (result.ok) {
        setDirty(false);
        router.refresh();
      }
    });

  const finalise = async () => {
    const result = await finaliseMonth(year, month, payload());
    if (result.ok) setDirty(false);
    else setFeedback(result);
    // Row errors are shown in the table, so let the dialog close.
    return result.rowErrors ? { ok: true } : result;
  };

  const columnCount = 10 + manualRules.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">
          {draft
            ? "Enter paid days and any extras. Figures update as you type. Finalise to lock the month and issue the slips."
            : "This month is finalised and locked. Salary slips are stored exactly as issued."}
        </p>
        <div className="flex flex-wrap gap-2">
          {draft ? (
            <>
              <ConfirmButton
                action={deleteDraftRun.bind(null, year, month)}
                title={`Delete the draft for ${label}?`}
                confirmLabel="Delete draft"
                body="Everything entered for this month (paid days, arrears, bonuses, manual deductions) will be removed."
                className="btn btn-danger"
              >
                Delete draft
              </ConfirmButton>
              <button type="button" className="btn" onClick={save} disabled={pending || hasErrors || rows.length === 0}>
                {pending ? "Saving..." : dirty ? "Save draft" : "Saved"}
              </button>
              {hasErrors || rows.length === 0 ? (
                <button type="button" className="btn btn-primary" disabled>
                  Finalise
                </button>
              ) : (
                <ConfirmButton
                  action={finalise}
                  title={`Finalise ${label}?`}
                  confirmLabel="Finalise and issue slips"
                  className="btn btn-primary"
                  body={
                    <>
                      This locks the month and issues salary slips for {rows.length} employee(s). Total net pay:{" "}
                      <strong>₹{formatINR(totals.net)}</strong>. You can reopen the month later if something needs
                      to change.
                    </>
                  }
                >
                  Finalise
                </ConfirmButton>
              )}
            </>
          ) : (
            <>
              <a className="btn btn-primary" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/runs/${runId}/zip`}>
                Download all slips (ZIP)
              </a>
              <a className="btn" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/runs/${runId}/print`} target="_blank" rel="noreferrer">
                Print all
              </a>
              <a className="btn" href={`/reports/register?year=${year}&month=${month}`}>
                Payroll register
              </a>
              <ConfirmButton
                action={reopenMonth.bind(null, year, month)}
                title={`Reopen ${label}?`}
                confirmLabel="Yes, reopen the month"
                className="btn btn-danger"
                body="The month is unlocked for editing and recalculated with the current salary structures and deduction rules. The slips already issued stay available until you finalise again; finalising replaces them with new slips."
              >
                Reopen month
              </ConfirmButton>
            </>
          )}
        </div>
      </div>

      {feedback?.message && <p className={feedback.ok ? "alert-ok" : "alert-error"}>{feedback.message}</p>}

      {rows.length === 0 ? (
        <div className="card text-sm text-slate-600">
          This company has no active employees. Add employees first, then come back to this month.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="num">Days</th>
                <th className="num">Paid days</th>
                <th className="num">LOP days</th>
                <th className="num">Arrears</th>
                <th className="num">Bonus</th>
                {manualRules.map((r) => (
                  <th key={r.id} className="num">
                    {r.name}
                  </th>
                ))}
                <th className="num">Gross</th>
                <th className="num">Deductions</th>
                <th className="num">Net pay</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {evaluated.map(({ row, rowState: s, result, error }) => {
                const rowError = error ?? feedback?.rowErrors?.[row.employeeId];
                const issued = !draft ? result : null;
                const amountOf = (name: string) => issued?.earnings.find((e) => e.name === name)?.amount ?? 0;
                return (
                  <Fragment key={row.employeeId}>
                    <tr className={rowError ? "bg-red-50" : ""}>
                      <td>
                        <div className="font-medium">{row.name}</div>
                        <div className="text-xs text-slate-500">
                          <span className="font-mono">{row.code}</span>
                          {row.designation && ` · ${row.designation}`}
                        </div>
                      </td>
                      <td className="num">{result?.totalDays ?? row.totalDays}</td>
                      {draft ? (
                        <>
                          <td className="num">
                            <input className={cellInput} type="number" min="0" max={row.totalDays} step="0.5" value={s.paidDays} onChange={(e) => setDays(row, "paidDays", e.target.value)} aria-label={`Paid days for ${row.name}`} />
                          </td>
                          <td className="num">
                            <input className={cellInput} type="number" min="0" max={row.totalDays} step="0.5" value={s.lopDays} onChange={(e) => setDays(row, "lopDays", e.target.value)} aria-label={`LOP days for ${row.name}`} />
                          </td>
                          <td className="num">
                            <input className={`${cellInput} w-24`} type="number" min="0" placeholder="0" value={s.arrears} onChange={(e) => update(row, { arrears: e.target.value })} aria-label={`Arrears for ${row.name}`} />
                          </td>
                          <td className="num">
                            <input className={`${cellInput} w-24`} type="number" min="0" placeholder="0" value={s.bonus} onChange={(e) => update(row, { bonus: e.target.value })} aria-label={`Bonus for ${row.name}`} />
                          </td>
                          {manualRules.map((r) => (
                            <td key={r.id} className="num">
                              {row.rules.some((x) => x.id === r.id) ? (
                                <input className={`${cellInput} w-24`} type="number" min="0" placeholder="0" value={s.manual[r.id] ?? ""} onChange={(e) => update(row, { manual: { ...s.manual, [r.id]: e.target.value } })} aria-label={`${r.name} for ${row.name}`} />
                              ) : (
                                <span className="text-slate-400">-</span>
                              )}
                            </td>
                          ))}
                        </>
                      ) : (
                        <>
                          <td className="num">{issued?.paidDays}</td>
                          <td className="num">{issued?.lopDays}</td>
                          <td className="num">{formatINR(amountOf("Arrears"), 0)}</td>
                          <td className="num">{formatINR(amountOf(BONUS), 0)}</td>
                          {manualRules.map((r) => (
                            <td key={r.id} className="num">
                              {formatINR(issued?.deductions.find((d) => d.ruleId === r.id)?.amount ?? 0, 0)}
                            </td>
                          ))}
                        </>
                      )}
                      <td className="num">{result ? formatINR(result.gross) : "-"}</td>
                      <td className="num">{result ? formatINR(result.totalDeductions) : "-"}</td>
                      <td className={`num font-semibold ${result && result.netPay < 0 ? "text-red-700" : ""}`}>
                        {result ? formatINR(result.netPay) : "-"}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1.5">
                          <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => ({ ...o, [row.employeeId]: !o[row.employeeId] }))} aria-expanded={!!open[row.employeeId]}>
                            {open[row.employeeId] ? "Hide" : "Details"}
                          </button>
                          {!draft && row.slipId && (
                            <>
                              <a className="btn btn-sm" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/slips/${row.slipId}/pdf`}>
                                PDF
                              </a>
                              <a className="btn btn-sm" href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/slips/${row.slipId}/pdf?inline=1`} target="_blank" rel="noreferrer">
                                Print
                              </a>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {(rowError || (result && result.warnings.length > 0)) && (
                      <tr>
                        <td colSpan={columnCount} className={`py-1 text-xs ${rowError ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
                          {rowError ?? result?.warnings.join(" ")}
                        </td>
                      </tr>
                    )}
                    {open[row.employeeId] && result && (
                      <tr>
                        <td colSpan={columnCount} className="p-0">
                          <Details result={result} state={draft ? s : undefined} update={draft ? (patch) => update(row, patch) : undefined} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-semibold">
                <td colSpan={6 + manualRules.length} className="px-3 py-2">
                  Total ({rows.length} employees)
                </td>
                <td className="num px-3 py-2">{formatINR(totals.gross)}</td>
                <td className="num px-3 py-2">{formatINR(totals.deductions)}</td>
                <td className="num px-3 py-2">{formatINR(totals.net)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
