const STYLES: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-amber-100 text-amber-800" },
  FINALISED: { label: "Finalised", className: "bg-green-100 text-green-800" },
  ACTIVE: { label: "Active", className: "bg-green-100 text-green-800" },
  INACTIVE: { label: "Inactive", className: "bg-slate-200 text-slate-600" },
};

export function StatusBadge({ status }: { status: string }) {
  const style = STYLES[status] ?? { label: status, className: "bg-slate-200 text-slate-600" };
  return <span className={`badge ${style.className}`}>{style.label}</span>;
}
