import { formatINR } from "@/lib/format";
import { IN_HAND_NOTE, inHandRows, statementRows } from "@/lib/ctc/statement";
import type { CtcBreakup, InHandEstimate } from "@/lib/ctc/structure";

const money = (n: number) => (n === 0 ? "-" : formatINR(n, 0));

/** The CTC breakup in the layout of the sheet, with the in-hand estimate below it. */
export function CtcBreakupView({
  title,
  breakup,
  inHand,
}: {
  title: string;
  breakup: CtcBreakup;
  inHand: InHandEstimate;
}) {
  const cell = "border border-slate-300 px-3 py-1.5";
  return (
    <div className="max-w-xl space-y-4 text-sm">
      <table className="w-full border-collapse bg-white">
        <thead>
          <tr>
            <th rowSpan={2} className={`${cell} text-left font-semibold`}>
              CTC Components
            </th>
            <th colSpan={2} className={`${cell} text-center font-semibold`}>
              {title}
            </th>
          </tr>
          <tr>
            <th className={`${cell} w-32 text-right font-semibold`}>Yearly</th>
            <th className={`${cell} w-32 text-right font-semibold`}>Monthly</th>
          </tr>
        </thead>
        <tbody>
          {statementRows(breakup).map((r) => (
            <tr key={r.label} className={r.highlight ? "bg-indigo-100 font-semibold" : ""}>
              <td className={cell}>{r.label}</td>
              <td className={`${cell} num`}>{money(r.yearly)}</td>
              <td className={`${cell} num`}>{money(r.monthly)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="w-full border-collapse bg-white">
        <tbody>
          <tr className="font-semibold">
            <td className={cell}>
              Gratuity <span className="font-normal text-slate-500">(not part of CTC)</span>
            </td>
            <td className={`${cell} num w-32`}>{money(breakup.gratuity.yearly)}</td>
            <td className={`${cell} num w-32`}>{money(breakup.gratuity.monthly)}</td>
          </tr>
        </tbody>
      </table>

      <div>
        <h3 className="mb-1 font-semibold">In-hand estimate (monthly)</h3>
        <table className="w-full border-collapse bg-white">
          <tbody>
            {inHandRows(inHand, (n) => formatINR(n, 0)).map((r) => (
              <tr key={r.label} className={r.total ? "bg-green-100 font-semibold" : ""}>
                <td className={cell}>
                  {r.label}
                  {r.note && <span className="ml-2 text-xs text-slate-500">({r.note})</span>}
                </td>
                <td className={`${cell} num w-32`}>{r.monthly === 0 ? "-" : formatINR(r.monthly, 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-slate-500">{IN_HAND_NOTE}</p>
      </div>
    </div>
  );
}
