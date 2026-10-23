# GST Bill Generator

A multi-company GST invoicing app. Pick a company, pick or add a customer, add line
items, and get a professional A4 tax invoice as a PDF. Companies, customers,
products, invoices and payments are all stored locally, so past bills can be
searched, re-downloaded and duplicated.

Built with **Next.js (App Router) + TypeScript + Tailwind CSS**, **Supabase Postgres via Prisma**,
and **@react-pdf/renderer** for the PDFs.

---

## Setup

Requires Node 20 or newer, and a Supabase project.

```bash
npm install
cp .env.example .env      # then fill in the Supabase values, see below
npm run setup             # prisma generate + push the schema + seed sample data
npm run dev               # http://localhost:3000
```

### Environment

The app reads every credential from `.env`; nothing is hard-coded. `.env` is
git-ignored — keep it that way.

| Variable | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Prisma (server) | Supabase Postgres connection string. Percent-encode special characters in the password (`@` becomes `%40`). |
| `DIRECT_URL` | Prisma migrations | The non-pooled connection, for `prisma db push` / `migrate`. |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Safe to ship to the browser. |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Used for Storage writes. Never give this a `NEXT_PUBLIC_` prefix. |

If the Supabase variables are absent the app still runs: uploads fall back to
`public/uploads` on disk. The database connection is not optional.

See [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) for the one-time project setup
(bucket, row level security, numbering function), and `supabase/migrations/` for
the SQL if you would rather run it by hand.

`npm run setup` is the three steps below rolled into one; run them individually if
you prefer:

```bash
npx prisma generate
npx prisma db push
npm run db:seed
```

> **npm 11 note:** this project needs install scripts for `prisma`, `@prisma/client`
> and `esbuild`. If npm reports "packages have install scripts not yet covered by
> allowScripts", run `npm approve-scripts prisma @prisma/client @prisma/engines esbuild`
> and then `npm rebuild`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run check:import` | assertions for the monthly sheet import, including all the grouping scenarios |
| `npm run migrate:uploads` | moves locally-stored logos and signatures into Supabase Storage |
| `npx tsx scripts/make-monthly-sample.ts` | writes a deliberately messy monthly sheet to `samples/` for trying the import |
| `npm run dev` | Dev server on port 3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm run setup` | Generate client, create DB, seed |
| `npm run db:seed` | Seed the sample company (safe to re-run; it skips if present) |
| `npm run db:studio` | Prisma Studio, to poke at the data directly |
| `npm run check:math` | Sanity checks for the money / GST / words engine |
| `npm run dump:sheet <file>` | Print every cell of a workbook — handy when an import misreads a file |
| `npm run samples` | Writes one PDF of each document type to `./samples` (needs `npm run dev` running) |

---

## What's seeded

One company — **Nexofab Industries Limited**, CH-73, MR 10 Road, Sukhliya, Indore,
Madhya Pradesh 452010 (state code 23), with prefix `NXF/`. **GSTIN and bank details
are deliberately blank** — fill them in under **Companies → Edit**.

Two customers so both tax paths can be seen immediately:

- **Shree Balaji Traders**, Indore, MP (code 23) → same state as the company → **CGST + SGST**
- **Veracity Engineering Pvt Ltd**, Mumbai, MH (code 27) → different state → **IGST**
  (it also has a separate shipping address, so the Ship-To block shows up)

Three products: an MS fabricated frame (NOS), SS 304 sheet (KG) and on-site
installation (HRS, an SAC-coded service). All at 18% GST.

---

## How it works

### Multi-company

Everything — customers, products, invoices, numbering counters — is scoped to a
company. The switcher in the top bar sets a cookie; every page reads from it. Add
as many companies as you like under **Companies**.

### GST logic

The supplier's state is compared with the **place of supply**:

- same state → **CGST + SGST**, each half the GST rate
- different state → **IGST** at the full rate

Picking a customer defaults the place of supply to their billing state, and you can
override it per invoice. The form shows which path is active while you type.

#### Supply type

When the place of supply is the supplier's own state, the form offers a choice
between **Intra-State Supply** and **Intra-City Supply**. Both are taxed
identically — CGST + SGST — because GST law draws no distinction between them; the
setting exists so the bill can state which it is, as the printed bills do. Across
state lines the supply type is **Inter-State Supply** and is not selectable.

The chosen value is saved on the invoice, restored when you edit it, and printed in
the Order Details block of the PDF.

### Importing a bill (PDF, Excel or CSV)

On **New invoice → Line items → Import bill**, drop in a `.pdf`, `.xlsx` or `.csv`.
If the file is a whole printed bill rather than a bare item list, the importer
reads the document fields too and fills the entire form:

| Read from the sheet | Fills |
| --- | --- |
| Buyer / Bill To block | customer (matched against your saved customers) |
| Date, Due Date | invoice and due dates |
| Invoice No. | kept in the notes as a reference |
| Agreement No / Work Order No / PO No | agreement number |
| Work Order Date / PO Date | work order date |
| Below / Less / Rebate % | the tender rebate |
| the item table | line items |

A tick-box in the preview lets you take only the line items instead. Everything
arrives editable — nothing is saved until you press Save draft or Issue.

The item table is located by scoring each row against known column names, so a
letterhead, bank block and buyer block sitting above it are skipped automatically.

**PDFs** have no table structure — only glyphs at coordinates — so the text is
read with its positions, grouped into rows by y, and clustered into columns by x.
Each cell then attaches to its *nearest* header column, which absorbs the drift a
right-aligned number creates. A PDF with no text layer (a scan or photo) is
rejected with a clear message; there is no OCR.

- **Required columns:** Item, Qty, Rate. Everything else is optional.
- Headers are matched loosely — *Particulars*, *Quantity*, *Unit Price*, *UOM*,
  *HSN Code*, *Disc %*, *Tax*, and *Month* (as a quantity) all resolve correctly.
- Dates are read as **day/month** (Indian convention) and flagged when the other
  reading would be equally valid.
- *Amount*, *Total*, *CGST*, *SGST* and *Sr No* columns are ignored, because the
  app recalculates them. Trailing "Total" summary rows are dropped too.
- `₹ 1,250.50`, `1,250`, `18%` and `0.18` are all understood. Unit synonyms
  (`kgs`, `Pieces`, `hrs`, `job`) map to the right codes; anything unrecognised
  becomes `OTH` with a warning. Non-standard GST rates snap to the nearest slab,
  also with a warning.
- An item name that exactly matches a saved product inherits its HSN, unit, rate
  and GST, so those cells can be left blank.
- A **multi-sheet workbook** shows a sheet picker in the preview, so a file holding
  one bill per sheet can be imported a sheet at a time.
- Rows with no description are skipped, which drops the `Below`, `CGST 9%` and
  `Total Amount` lines that sit under a printed bill's table.

**Download template** in the dialog gives you an `.xlsx` already filled with your
saved products plus a "How to use" sheet. `samples/example-import-messy.xlsx` is a
deliberately untidy sheet you can try the importer on.

The bill number is never copied — the app issues its own from your numbering
format, and the original is recorded in the invoice notes.

Legacy `.xls` (pre-2007 binary) isn't supported — open it in Excel and *Save As*
`.xlsx` or `.csv`. Limits: 5 MB, 500 item rows.

### Upload Monthly Details (whole-month import)

**Monthly Import** in the top bar takes a month's sales sheet and turns it into
individual invoices. It is a five-step flow, and nothing is written to the
database until the last step.

1. **Upload** an `.xlsx`, `.xls` or `.csv` of one row per product line.
2. **Map & validate** — the columns are detected, every row is checked, and the
   report lists each problem with the row numbers it affects.
3. **Preview** — bills grouped by date and company, with a total count.
4. **Generate** — invoices are created in chunks with a progress bar.
5. **Done** — a summary, plus links to the invoices and the import report.

#### Columns it recognises

Headers are matched case-insensitively with punctuation and spaces ignored, so
`HSN/SAC`, `hsn code` and `HSNCode` are the same column. Anything can be
re-pointed by hand on the mapping screen.

| Field | Required | Also accepted as |
| --- | --- | --- |
| Date | yes | Invoice Date, Bill Date, Transaction Date, Dt, Voucher Date |
| Company / Customer | yes | Customer, Client, Party Name, Buyer, Bill To, Firm Name, Consignee |
| Product | yes | Item, Item Name, Particulars, Goods, Material, Service, Commodity |
| Quantity | yes | Qty, Qnty, Nos, Units, Pcs, Count |
| Rate | yes | Price, Unit Price, Unit Rate, Rate Per Unit, MRP, Basic Rate |
| Bill / Invoice No. | no | Invoice No, Transaction ID, Order No, Reference No, Challan No, Voucher No |
| HSN / SAC | no | HSN, HSN Code, SAC, HSN/SAC, Tariff Code |
| GST | no | GST %, Tax, Tax Rate, Tax %, GST Slab, IGST, CGST+SGST |
| Supply type | no | Type of Supply, Nature of Supply, Supply |
| Description | no | Product Description, Remarks, Specification, Notes |
| Unit | no | UOM, Unit of Measure, Per |
| Amount | no | Value, Taxable Value, Net Amount, Total Amount |

A missing GST column defaults to 18%. An **Amount** column is only used as a
cross-check: if it disagrees with quantity x rate by more than a rupee the row
is flagged, and quantity x rate is what the invoice uses.

Dates are read day-first, as Indian sheets are written, so `05/09/2026` is
5 September. Excel date cells, Excel serial numbers, `2026-09-05`,
`5-Sep-2026` and `10 September 26` all work. A pair that can only be
month-first (`09/25/2026`) is read that way and warned about.

#### How rows become bills

This is the part that matters, and the rule is that **rows are never merged
because their values happen to match**. Two rows with the same date, company,
product, HSN and rate are two bills unless something positively says they are
one.

| Grouping | What shares an invoice |
| --- | --- |
| **Use the sheet's bill number** (default when one exists) | Rows with the same bill number, for the same company, on the same date |
| **Treat every row as a separate bill** (default when there is none) | Nothing is ever combined |
| **Group rows by date and company** | Every row for one company on one date |

Bill numbers are scoped by company and date, so `B001` used by two customers,
or reused next month, does not collapse two invoices into one.

When the sheet has no bill number column the default is one invoice per row.
Merging on the *absence* of evidence is the one thing the importer will not do
on its own — `Group rows by date and company` has to be chosen deliberately.

Identical rows are reported as duplicates and still generate separate invoices,
so a copy-paste accident is visible without the importer deciding for you.

#### Numbering, and the sheet's own bill number

Generated invoices take the next number from the company's own series
(`TRIVEDI/SEP/26/0001`), allocated one at a time as each invoice is created.
The sheet's bill number is **never** used as the invoice number; it is stored on
the invoice as its external bill number, shown on the import report, and
searchable from the invoice list.

#### Supply type

A `Supply type` column is read where present — `Intra-State`,
`Intra State Supply`, `Intrastate`, `Intra-City`, `Local` are all
recognised. Rows that say nothing get the default chosen on the import screen.

Inter-state is not taken from the sheet: whether a supply crosses a state line
follows from the seller's state and the place of supply, and the tax engine
decides it. A customer registered in another state is IGST whatever the sheet
claims, and the import says so in its warnings.

#### New companies in the sheet

A monthly sheet carries only a name, so a company that is not already a
customer is created with a placeholder address (`Address not provided`) and a
note explaining where it came from. The bill totals correctly; the address is
worth completing afterwards from **Customers**. The import summary lists
everyone it created.

#### Duplicate imports

Every upload is hashed. Re-uploading the same file is detected before anything
is generated, and the warning shows when it was first imported and how many
invoices it produced. Continuing requires ticking a box.

Generation is also resumable: a batch that stopped part-way can be finished
from its import page, and only rows with no invoice yet are picked up, so
finishing an import cannot duplicate what it already created.

#### Audit trail

Each import keeps the sheet itself in Supabase Storage, every row as it was
read, which bill each row was grouped into, and which invoice it produced. From
any generated invoice you can get back to the file, the batch and the original
bill number. The issue report downloads as CSV.

### Money and rounding

Every amount is stored as an **integer number of paise**, and quantities as integers
in thousandths of a unit. There is no floating-point arithmetic anywhere in the
calculation path, so totals can't drift by a paisa.

Rounding happens at exactly three defined points:

1. `qty × rate` → rounded to the paise once, giving the line's gross value
2. `taxable × GST%` → rounded to the paise once per line
3. the invoice total → optionally rounded to the nearest rupee, recorded as a
   separate **Round Off** line

For intra-state supply the line's tax is halved; any odd paise goes to CGST, so
`CGST + SGST` always equals the line tax exactly.

### Invoice numbering

The number is built from a per-company template. The default is:

```
{BUYERWORD}/{MMM}/{YY}/{SEQ}      ->   TRIVEDI/SEP/26/0001
```

That is the first word of the **customer** being billed, the three-letter month,
the two-digit year, and a four-digit sequence. The number is generated by the
database when the bill is saved — it cannot be typed by hand.

The sequence restarts for **each customer, each month**, so two customers both
billed in September each start at 0001.

Available tokens:

| Token | Meaning |
| --- | --- |
| `{BUYERWORD}` / `{SELLERWORD}` | first word of the customer / company name, uppercased |
| `{BUYER4}` / `{SELLER4}` | first four letters of the name |
| `{BUYER}` / `{SELLER}` | initials, i.e. the acronym (`IDA`) |
| `{SEQ}` | running sequence, zero-padded to the configured width |
| `{MMM}` / `{MMMM}` / `{MM}` | `SEP` / `SEPT` / `09` |
| `{YY}` / `{YYYY}` / `{FY}` | `26` / `2026` / `2026-27` |
| `{DOC}` | series marker (`QT`, `PI`, `DC`) |
| `{PREFIX}` | the company number prefix |

Empty tokens collapse, so a document with no buyer initials still numbers cleanly.

Initials default to the first letters of the significant words in a name
(`Indore Development Authority` → `IDA`, ignoring Ltd/Pvt/and/of), and can be
overridden on the company and on each customer.

- **Drafts get no number.** A number is consumed only when a document is issued,
  so an abandoned draft never burns one.
- Numbers are **never reused**. An issued document cannot be deleted — cancel it
  instead and the number stays reserved, leaving no gap in the series.

### Editing a bill that is already issued

Issued bills can be corrected. Open one and press **Edit bill**.

- The **number, its sequence and its financial year never change** — the bill
  keeps its exact place in the series, and the counter does not advance.
- Before the change is applied, the current version is written to
  **InvoiceRevision**: the number, dates, parties, every line and all the totals
  as they stood. The invoice's `revision` count goes up by one.
- You can add a **reason for the change**; it is stored with that revision.
- The **Revision history** panel on the invoice lists every earlier version with
  its totals, the lines it had, and how much the total has moved since.
- From revision 1 onwards the printed bill carries a **Revision N** line under
  the date, so a reissued copy is never mistaken for the original.
- **Cancelled documents stay locked.** They are void; duplicate one to raise a
  fresh bill.

A correction is the right tool for a typo or an agreed change before the customer
acts on the bill. Once they have paid or claimed input credit against it, a
credit note or a fresh bill is the cleaner route — the app does not stop you, but
the revision trail is what makes the change explainable.
- Quotations, proformas and challans each keep their own series (`QT`, `PI`, `DC`).
- **If the format contains no year token the sequence never restarts** — otherwise
  last year's numbers would come round again and collide. Formats carrying
  `{FY}` / `{YYYY}` / `{YY}` reset each financial year as usual.

### Tender rebate ("below" percentage)

Government and tender billing often quotes a percentage below the schedule of
rates. Set **Rebate %** on an invoice and it is deducted from the basic total,
printed as its own row, then spread across the lines in proportion to their
taxable value so each GST slab is taxed on its own reduced share. That is what
the law requires and it keeps the HSN summary adding up.

### HSN / SAC codes

India's 8-digit classification is hierarchical, and the product form shows the
breakdown as you type:

| Digits | Level | Example |
| --- | --- | --- |
| 2 | Chapter | `73` — Articles of iron or steel |
| 4 | Heading | `7308` |
| 6 | Sub-heading (international) | `730890` |
| 8 | Tariff item (national) | `73089090` |

Invoices accept 4, 6 or 8 digits; a bare 2-digit chapter is rejected. Services
use a 6-digit SAC in chapter 99 (`995461`). All 99 chapter names are built in,
so the form names the chapter as soon as you type two digits. Codes print
grouped — `73089090` appears as `7308 90 90`.

### Frozen snapshots

When a document is saved it stores a JSON snapshot of the company and customer
exactly as they were at that moment. Editing your address or a customer's GSTIN
later never rewrites a past invoice or its PDF.

### Validation

- **GSTIN** — 15-character format, a known state code, *and* the mod-36 check digit.
  The leading two digits must also match the selected state; a mismatch is reported
  rather than silently accepted.
- PAN, IFSC, PIN code, UPI ID and HSN/SAC are format-checked. All optional fields
  stay optional, so placeholder-free records can still be saved.

### PDF output

A4, laid out as a printed Indian tax invoice:

- registration bar — CIN on the left, GSTIN on the right
- centred letterhead: company name, tagline, office address and phone
- title band with the document type and an optional subtitle (e.g. TAX / RETAIL)
- Buyer block beside invoice no / date / PAN / GSTIN
- bank details (with a scannable UPI QR) and the seller address beside
  "Types of Services" and the order details (agreement no, work order date,
  place of supply, supply type, reverse charge)
- item table: S.No, Description, HSN/SAC, Qty, Unit, Rate, Amount
- HSN/SAC-wise tax summary beside the totals: Basic Total, rebate, Taxable
  Value, CGST/SGST or IGST, Round Off, Total Amount
- amount in words (Indian lakh/crore), notes, terms, and the signature block

The copy label is selectable — *Original for Recipient*, *Duplicate for
Transporter*, *Triplicate for Supplier*, or none:

```
/api/invoices/<id>/pdf?copy=original&download=1
```

The PDF embeds Noto Sans (`public/fonts`) because the built-in PDF fonts have no
**₹** glyph. Logos and signatures may be PNG/JPG/WEBP/GIF — **SVG will not embed
in a PDF**, so upload a raster image for those two.

### Invoice history, payments and export

Filter by date range, customer, status, document type, or search by number. Record
part payments — the status moves to **Partially Paid**, then **Paid**, on its own.
**Export CSV** respects the active filters and uses GSTR-1-style column names for
filing.

Statuses: Draft → Sent → Partially Paid → Paid, plus Cancelled.

---

## Project layout

```
prisma/
  schema.prisma          data model
  seed.ts                sample company, customers, products
public/
  fonts/                 Noto Sans, embedded into every PDF
  uploads/               logos and signatures (gitignored)
src/
  app/
    page.tsx             dashboard
    invoices/            list, new, [id] view, [id]/edit
    customers/  products/  companies/
    api/                 REST routes incl. /invoices/[id]/pdf, /invoices/import, /invoices/export
  components/
    invoice/             InvoiceForm, ItemsEditor, TotalsPanel, InvoicePreview, ImportDialog…
    ui/                  small shared form pieces
  lib/
    money.ts             paise arithmetic, Indian digit grouping
    gst.ts               line maths, totals, HSN summary, CGST/SGST vs IGST
    words.ts             amount in words (lakh / crore)
    numbering.ts         financial year + atomic number allocation
    validate.ts          GSTIN checksum, PAN, IFSC, PIN
    invoice-service.ts   transactional create / update / duplicate / cancel / pay
    sheet-reader.ts      xlsx + CSV readers, header-row detection
    import-mapping.ts    column matching and cell coercion for imports
    bill-extract.ts      reads buyer, dates, order refs and rebate from a bill
    pdf-reader.ts        rebuilds a row/column grid from a PDF's positioned text
  pdf/
    InvoiceDocument.tsx  the A4 layout
    build.ts             data assembly + render
    qr.ts                UPI intent → QR
scripts/
  check-math.ts          money/GST/words assertions
  generate-samples.ts    one PDF per document type into ./samples
```

---

## Data storage

Everything persists in **Supabase Postgres** — companies, customers, products,
invoices, line items, counters, revisions, monthly-import batches and rows, and
upload metadata. Nothing of
consequence lives in `localStorage`, session storage, a static JSON file or
in-memory state; a refresh, a logout or a redeploy loses nothing.

Uploaded files (logos, signatures, imported bills) go to the Supabase Storage
bucket `bill-files`, which is **private**. Only the file's metadata is stored in
the database; the bytes never sit in a table row. Downloads go through short-lived
signed URLs. Without Supabase credentials the same code writes to
`public/uploads` instead, so the app still works offline.

Row level security is enabled on all nine application tables. The app reaches
Postgres with the database password and Storage with the service-role key, both of
which bypass RLS by design; the anon key — the only one that can reach a browser —
has no policy granting it anything, so it can read nothing. If you later add
end-user accounts, write policies against `auth.uid()` before relying on the anon
key for anything.

Sequence allocation also exists as a database function,
`public.next_invoice_sequence(company, doc_type, bucket, start)`, so numbering is
atomic at the Postgres level and not only inside the application transaction.

---

## Deploying

Netlify, via its Next.js runtime — see **[DEPLOY.md](DEPLOY.md)**.

There is no `dist` or `out` folder to publish: every route is server-rendered
and the API routes need Prisma and the service-role key. Netlify builds `.next`
into functions instead, which [`netlify.toml`](netlify.toml) already configures.

Two things to do before the first deploy:

```bash
npm run migrate:uploads   # move local logos into Supabase Storage
```

and point `DATABASE_URL` at the Supabase **connection pooler** (port 6543), not
the direct host — serverless functions open a connection per invocation and will
exhaust the direct limit.

---

## Known limitations

- **No authentication.** It's a single-user local app; anyone who can reach the port
  can use it. Don't expose it to the internet as-is.
- **No e-invoice / IRN or e-way bill integration** with the GST portal.
- **SVG logos** are shown in the browser preview but are skipped in the PDF.
- Uploaded files are not garbage-collected when a company is edited to point at a
  different logo or signature; the old object stays in the bucket.
- **Row level security has no policies.** Access control relies on the app holding
  the database password and service-role key server-side. That is correct for a
  single-tenant deployment but means the anon key grants nothing — add policies
  before building anything that talks to Supabase straight from the browser.
