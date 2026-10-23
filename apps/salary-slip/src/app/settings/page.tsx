import { RestoreForm } from "./RestoreForm";

export default function SettingsPage() {
  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="page-title">Backup &amp; restore</h1>
        <p className="text-sm text-slate-600">
          All data for every company (employees, rules, payroll months, issued slips and logos) lives in the
          database (Supabase Postgres).
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Download a backup</h2>
        <p className="text-sm text-slate-600">
          Saves a copy of the whole database. Keep it somewhere safe, such as a pen drive or cloud storage. It
          contains salary and bank details, so treat it as confidential.
        </p>
        <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ""}/api/backup`} className="btn btn-primary">
          Download backup
        </a>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Restore from a backup</h2>
        <p className="text-sm text-slate-600">
          Replaces <strong>everything</strong> currently in the app, for all companies, with the contents of the
          backup file. The restore happens in one step — if it fails, the current data stays untouched.
        </p>
        <RestoreForm />
      </div>
    </div>
  );
}
