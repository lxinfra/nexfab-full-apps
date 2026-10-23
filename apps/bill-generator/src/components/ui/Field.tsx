import type { ReactNode } from 'react';

export function Field({
  label,
  children,
  hint,
  error,
  required,
  className = '',
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {error ? <p className="err">{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function SectionCard({
  title,
  description,
  children,
  actions,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card-pad">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">{title}</h2>
          {description && <p className="hint">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="card grid place-items-center gap-2 px-6 py-14 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="max-w-md text-sm text-slate-500">{message}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
