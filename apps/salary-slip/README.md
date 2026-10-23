# Salary Slips

A web app for generating monthly salary slips for several companies. All data is stored in Supabase
Postgres (tables kept in a dedicated `salary` schema); local development can also run on a SQLite file by
changing the Prisma datasource provider.

## Setup

You need [Node.js](https://nodejs.org/) 20 or newer.

```
npm install
npm run dev
```

Then open http://localhost:3000.

The first `npm run dev` creates the database (`prisma/dev.db`) and adds the first company, Nexofab Industries
Limited, with four default deduction rules you can edit: PF 0% of Basic, ESI 0% of Gross, PT ₹208 a month and
TDS 10% of Gross. Every company you add later starts with the same four rules.

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the unit tests for the salary calculation, the CTC structure, income tax and the formatting helpers |
| `npm run build` then `npm start` | Runs the faster production build instead of the development server |

## How to use it

1. **Companies**: add or edit companies (logo, GSTIN, PAN, TAN, authorised signatory). Pick the company you are
   working on in the header; every screen then shows only that company.
2. **Employees**: add employees with their monthly salary structure, or import them from CSV / Excel. The
   import template is on the Employees page. Employees are matched by Employee Code.
3. **CTC Templates**: optional. Define a salary structure per grade (see "CTC structure" below), then pick
   the template and enter the CTC on the employee form.
4. **Deductions**: add the company's deduction rules (see below).
5. **Payroll**: open a month, enter paid days / LOP days, arrears, bonus and manual deductions. Click
   **Details** on a row for one-time earnings, one-off deductions, or to replace a calculated amount for that
   month. **Finalise** locks the month and issues the slips.
6. **Slips**: search and re-download any issued slip. **Register**: the monthly payroll register, with Excel
   export.
7. **Backup**: download the database file, or restore one.

## Deduction rules

Each company has its own rules. A rule has:

- **Type**
  - *Percentage* of Basic, Gross, or a chosen set of components
  - *Fixed amount* every month
  - *Slab-based*: the amount depends on which salary range Basic / Gross / chosen components falls in
  - *Manual entry*: typed in each month on the payroll screen (e.g. advances)
  - *TDS (new tax regime)*: one twelfth of the yearly income tax on the monthly salary x 12, using the tax
    settings under CTC Templates > Statutory settings
- **Cap on the base** (e.g. PF on at most 15,000) and/or a **maximum deduction**
- **Eligibility**: apply only if the employee's monthly gross is at or below a limit (e.g. ESI)
- **Applies to** all employees or selected employees only
- **Employer contribution** (percentage or fixed): shown separately, never deducted from net pay

## CTC structure

A template is an ordered list of components. Each one is an earning, an employer contribution or variable pay,
and is calculated as a % of CTC, % of Gross, % of Basic, a fixed monthly amount, or as the *balancing*
component (exactly one earning per template, which takes whatever is left of Gross). Employer contributions can
also be "Statutory PF" or "Statutory ESIC". A component can have a condition, e.g. Statutory Bonus only if Basic
is at or below the company's stat-bonus limit. The templates page can add the two templates from the CTC sheet
("M1 to M4" and "M5 & Above") as a starting point.

How the breakup is worked out (`src/lib/ctc/structure.ts`, tested in `structure.test.ts`):

- Total CTC = Fixed CTC + variable pay; Fixed CTC = Gross + employer contributions; Gross = sum of earnings.
- Gross depends on employer PF, which depends on Basic, which can be a % of Gross. The figures are recalculated
  until they stop changing.
- Employer PF = PF rate x Basic, up to the PF wage ceiling in force on the date (or on actual Basic if that
  option is on). Employer ESIC = ESIC rate x Gross, only when Gross is at or below the ESI limit.
- Gratuity (a % of Basic) is shown below the CTC box and is not part of the CTC.
- Monthly and yearly columns are each rounded per component; the balancing component absorbs the rounding so
  both columns add up exactly. If the balancing component would be negative, the CTC is rejected with a message.
- In-hand estimate = Gross - employee PF - employee ESI - professional tax - TDS, for a full month.

An employee on a template gets their monthly payroll components from this breakup. The employee list links to
the CTC statement, which downloads as PDF or Excel. Payroll months use the PF ceiling in force on the last day
of the month; the statement and previews use today's date.

**Statutory settings** (CTC Templates > Statutory settings, per company) hold every rate and limit: the two
thresholds from the sheet, PF rates and the date-effective wage ceiling (15,000 until 16 Sep 2026, 25,000 from
17 Sep 2026), ESI rates and limit, gratuity rate, professional tax slabs (defaults are Madhya Pradesh), and the
income tax settings (standard deduction, slabs, rebate limit, surcharge levels, cess). "Min Basic for HRA" is
stored but not used by any calculation yet.

Income tax (`src/lib/ctc/tds.ts`, tested in `tds.test.ts`): yearly gross less the standard deduction is taxed
by slab; no tax up to the rebate limit, with marginal relief just above it; surcharge with marginal relief at
each level; cess on tax plus surcharge; monthly TDS is the yearly tax divided by 12.

## How salaries are calculated

All calculation logic is in one pure module, `src/lib/payroll/calc.ts`, tested by
`src/lib/payroll/calc.test.ts`.

- Each earning component is pro-rated: `monthly amount x paid days / days in the month`.
- Every component is rounded to the nearest rupee on its own (50 paise rounds up). Totals are the sum of the
  rounded components.
- Arrears, bonus and other one-time earnings are not pro-rated.
- Percentage and slab rules use the amounts **earned** in the month (after pro-rating). "Gross" includes
  arrears and one-time earnings.
- The eligibility limit is compared with the **full monthly gross** from the salary structure, not the
  pro-rated amount.
- Fixed and manual deductions are not pro-rated.
- Net pay = gross earnings - total deductions.

## Older months

- **Payroll > Issue salary slips for older months** creates and finalises every month in a chosen range that has
  no payroll yet. Employees are included from their month of joining (their joining month is paid from the
  joining date), with full paid days otherwise, using their current salary and the current deduction rules.
  Existing months are never touched; any month can be reopened afterwards.
- **Employees > Slips** lists every slip issued to one employee and downloads the last 3, 6 or 12 months (or
  all of them) as one PDF, or all as a ZIP.
- In any payroll month, employees who join after that month are left out.

## Finalising and reopening

- Finalising stores each slip twice: the figures, and the PDF itself. Downloads always return that stored PDF,
  so a slip never changes when you later edit the company, an employee, or a rule.
- A finalised month can be reopened (with a confirmation). It is then recalculated with the current salary
  structures and rules. The old slips stay available until you finalise again, which replaces them.
- A draft month always lists exactly the active employees.

## Backup and restore

The Backup page downloads `prisma/dev.db` and can restore it. Restoring replaces all data for all companies;
the previous data is kept as `prisma/dev.db.before-restore.bak`. The file contains salary and bank details, so
store backups somewhere safe.

## Tech

Next.js (App Router) + TypeScript + Tailwind CSS, Prisma + Supabase Postgres, `@react-pdf/renderer` for the slips,
ExcelJS for Excel import/export, Vitest for tests.

```
prisma/schema.prisma          database schema
src/lib/payroll/calc.ts       salary calculation (pure)
src/lib/payroll/service.ts    payroll run: save, finalise, snapshot
src/lib/ctc/structure.ts       CTC breakup solver and in-hand estimate (pure)
src/lib/ctc/tds.ts             income tax, new regime (pure)
src/lib/ctc/settings.ts        statutory settings and their defaults
src/lib/pdf/SlipDocument.tsx  A4 salary slip layout
src/lib/format.ts             Indian number formatting, amount in words
src/app/                      pages, server actions and download routes
```
