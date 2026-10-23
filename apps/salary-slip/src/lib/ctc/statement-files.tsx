// The downloadable CTC statement: PDF and Excel, in the layout of the CTC sheet.
import React from "react";
import ExcelJS from "exceljs";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, formatINR } from "@/lib/format";
import { IN_HAND_NOTE, inHandRows, statementRows } from "./statement";
import type { CtcBreakup, InHandEstimate } from "./structure";

export interface CtcStatement {
  company: { name: string; address: string };
  employee: { code: string; name: string; designation: string | null; department: string | null; dateOfJoining: Date | null };
  templateName: string;
  asOf: string; // YYYY-MM-DD
  breakup: CtcBreakup;
  inHand: InHandEstimate;
}

const money = (n: number) => (n === 0 ? "-" : formatINR(n, 0));

const BORDER = "#9ca3af";
const HIGHLIGHT = "#dbe4f3";
const s = StyleSheet.create({
  page: { padding: 36, paddingBottom: 56, fontSize: 9.5, fontFamily: "Helvetica", color: "#111827" },
  header: { flexDirection: "row", alignItems: "center", paddingBottom: 10 },
  logo: { width: 56, height: 56, objectFit: "contain", marginRight: 12 },
  companyName: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: "#4b5563" },
  title: { textAlign: "center", fontSize: 12, fontFamily: "Helvetica-Bold", paddingVertical: 6, borderTopWidth: 1, borderBottomWidth: 1, borderColor: BORDER, backgroundColor: "#f3f4f6" },
  details: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, marginBottom: 12 },
  detail: { width: "50%", flexDirection: "row", paddingVertical: 2 },
  detailLabel: { width: 90, color: "#4b5563" },
  bold: { fontFamily: "Helvetica-Bold" },
  table: { borderWidth: 1, borderColor: BORDER, width: 380 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderColor: BORDER },
  lastRow: { borderBottomWidth: 0 },
  label: { flex: 1, paddingVertical: 4, paddingHorizontal: 6 },
  amount: { width: 95, paddingVertical: 4, paddingHorizontal: 6, textAlign: "right", borderLeftWidth: 1, borderColor: BORDER },
  highlight: { backgroundColor: HIGHLIGHT },
  total: { backgroundColor: "#dcfce7" },
  section: { marginTop: 14, marginBottom: 4, fontFamily: "Helvetica-Bold", fontSize: 10.5 },
  note: { marginTop: 4, fontSize: 8, color: "#6b7280", width: 380 },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, textAlign: "center", fontSize: 8, color: "#6b7280", borderTopWidth: 1, borderColor: "#e5e7eb", paddingTop: 6 },
});

type RowStyle = Extract<React.ComponentProps<typeof View>["style"], unknown[]>;

function Row({ label, cells, style, last }: { label: string; cells: string[]; style?: RowStyle; last?: boolean }) {
  return (
    <View style={[s.row, ...(last ? [s.lastRow] : []), ...(style ?? [])]}>
      <Text style={s.label}>{label}</Text>
      {cells.map((c, i) => (
        <Text key={i} style={s.amount}>
          {c}
        </Text>
      ))}
    </View>
  );
}

export async function ctcStatementPdf(st: CtcStatement, logo?: string | null): Promise<Buffer> {
  const rows = statementRows(st.breakup);
  const inHand = inHandRows(st.inHand, (n) => formatINR(n, 0));
  const e = st.employee;
  const detail = (label: string, value: string | null) => (
    <View style={s.detail}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.bold}>{value || "-"}</Text>
    </View>
  );
  return renderToBuffer(
    <Document title={`CTC Statement - ${e.name}`} author={st.company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          {logo ? <Image src={logo} style={s.logo} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={s.companyName}>{st.company.name}</Text>
            <Text style={s.muted}>{st.company.address}</Text>
          </View>
        </View>
        <Text style={s.title}>CTC Statement</Text>

        <View style={s.details}>
          {detail("Employee Code", e.code)}
          {detail("Employee Name", e.name)}
          {detail("Designation", e.designation)}
          {detail("Department", e.department)}
          {detail("Date of Joining", formatDate(e.dateOfJoining))}
          {detail("Structure", st.templateName)}
          {detail("As on", formatDate(`${st.asOf}T00:00:00.000Z`))}
        </View>

        <View style={s.table}>
          <Row label="CTC Components" cells={["Yearly (Rs.)", "Monthly (Rs.)"]} style={[s.bold, { backgroundColor: "#f3f4f6" }]} />
          {rows.map((r, i) => (
            <Row
              key={r.label}
              label={r.label}
              cells={[money(r.yearly), money(r.monthly)]}
              style={r.highlight ? [s.highlight, s.bold] : undefined}
              last={i === rows.length - 1}
            />
          ))}
        </View>

        <View style={[s.table, { marginTop: 10 }]}>
          <Row label="Gratuity (not part of CTC)" cells={[money(st.breakup.gratuity.yearly), money(st.breakup.gratuity.monthly)]} style={[s.bold]} last />
        </View>

        <Text style={s.section}>In-hand estimate (monthly)</Text>
        <View style={s.table}>
          {inHand.map((r, i) => (
            <Row
              key={r.label}
              label={r.note ? `${r.label}  (${r.note})` : r.label}
              cells={[r.monthly === 0 ? "-" : formatINR(r.monthly, 0)]}
              style={r.total ? [s.total, s.bold] : undefined}
              last={i === inHand.length - 1}
            />
          ))}
        </View>
        <Text style={s.note}>{IN_HAND_NOTE}</Text>

        <Text style={s.footer} fixed>
          This is a computer-generated statement. Figures are rounded to the nearest rupee.
        </Text>
      </Page>
    </Document>,
  );
}

const INR_FORMAT = "[>=10000000]##\\,##\\,##\\,##0;[>=100000]##\\,##\\,##0;##,##0";
/** Zero is shown as a dash, as on the sheet. */
const dash = (n: number) => (n === 0 ? "-" : n);

export async function ctcStatementXlsx(st: CtcStatement): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CTC Statement");
  ws.columns = [{ width: 34 }, { width: 16 }, { width: 16 }];
  const thin = { style: "thin" as const };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

  ws.addRow([st.company.name]).font = { bold: true, size: 14 };
  ws.addRow(["CTC Statement"]).font = { bold: true };
  ws.addRow([]);
  const e = st.employee;
  for (const [label, value] of [
    ["Employee Code", e.code],
    ["Employee Name", e.name],
    ["Designation", e.designation ?? "-"],
    ["Department", e.department ?? "-"],
    ["Date of Joining", formatDate(e.dateOfJoining) || "-"],
    ["As on", formatDate(`${st.asOf}T00:00:00.000Z`)],
  ]) {
    ws.addRow([label, value]);
  }
  ws.addRow([]);

  const tableRow = (values: (string | number)[], opts: { bold?: boolean; color?: string } = {}) => {
    const row = ws.addRow(values);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > values.length) return;
      cell.border = box;
      if (opts.bold) cell.font = { bold: true };
      if (opts.color) cell.fill = fill(opts.color);
      if (col > 1) {
        cell.numFmt = INR_FORMAT;
        cell.alignment = { horizontal: "right" };
      }
    });
    return row;
  };

  const head = tableRow(["CTC Components", st.templateName, ""], { bold: true });
  ws.mergeCells(head.number, 2, head.number, 3);
  head.getCell(2).alignment = { horizontal: "center" };
  tableRow(["", "Yearly", "Monthly"], { bold: true });
  ws.mergeCells(head.number, 1, head.number + 1, 1);
  head.getCell(1).alignment = { vertical: "middle", horizontal: "center" };

  for (const r of statementRows(st.breakup)) {
    tableRow([r.label, dash(r.yearly), dash(r.monthly)], r.highlight ? { bold: true, color: "FFB8CCE4" } : {});
  }
  ws.addRow([]);
  tableRow(["Gratuity", dash(st.breakup.gratuity.yearly), dash(st.breakup.gratuity.monthly)], { bold: true });

  ws.addRow([]);
  ws.addRow(["In-hand estimate (monthly)"]).font = { bold: true };
  for (const r of inHandRows(st.inHand, (n) => formatINR(n, 0))) {
    const row = tableRow([r.label, dash(r.monthly)], r.total ? { bold: true, color: "FFDCFCE7" } : {});
    if (r.note) row.getCell(3).value = r.note;
  }
  ws.addRow([IN_HAND_NOTE]).font = { italic: true, size: 9, color: { argb: "FF6B7280" } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
