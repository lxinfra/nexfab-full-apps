import React from "react";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { amountInWords, formatDate, formatINR, monthLabel } from "@/lib/format";
import type { SlipSnapshot } from "@/lib/payroll/types";

const BORDER = "#9ca3af";
const s = StyleSheet.create({
  page: { padding: 32, paddingBottom: 56, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
  header: { flexDirection: "row", alignItems: "center", paddingBottom: 10 },
  logo: { width: 64, height: 64, objectFit: "contain", marginRight: 12 },
  companyName: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  muted: { color: "#4b5563", marginTop: 2 },
  title: {
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: BORDER,
    backgroundColor: "#f3f4f6",
  },
  details: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, borderWidth: 1, borderColor: BORDER, padding: 6 },
  detail: { width: "50%", flexDirection: "row", paddingVertical: 2.5 },
  detailLabel: { width: 90, color: "#4b5563" },
  detailValue: { flex: 1, fontFamily: "Helvetica-Bold" },
  table: { flexDirection: "row", marginTop: 10, borderWidth: 1, borderColor: BORDER },
  col: { flex: 1 },
  colLeft: { borderRightWidth: 1, borderColor: BORDER },
  row: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 6, minHeight: 16 },
  headRow: { backgroundColor: "#f3f4f6", borderBottomWidth: 1, borderColor: BORDER },
  totalRow: { borderTopWidth: 1, borderColor: BORDER, backgroundColor: "#f9fafb" },
  bold: { fontFamily: "Helvetica-Bold" },
  name: { flex: 1 },
  amount: { width: 90, textAlign: "right" },
  net: { marginTop: 10, borderWidth: 1, borderColor: BORDER, padding: 8, backgroundColor: "#f3f4f6" },
  netRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  totalSalaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 6,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderColor: BORDER,
  },
  totalSalary: { fontSize: 10.5, fontFamily: "Helvetica-Bold" },
  netAmount: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  employer: { marginTop: 10 },
  signatory: { marginTop: 36, width: 200, alignSelf: "flex-end" },
  signText: { textAlign: "center" },
  signLine: { marginTop: 36, borderTopWidth: 1, borderColor: BORDER, paddingTop: 4 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 32,
    right: 32,
    textAlign: "center",
    fontSize: 8,
    color: "#6b7280",
    borderTopWidth: 1,
    borderColor: "#e5e7eb",
    paddingTop: 6,
  },
});

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <View style={s.detail}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value === null || value === undefined || value === "" ? "-" : String(value)}</Text>
    </View>
  );
}

function Line({ name, amount, style }: { name: string; amount: string; style?: object | object[] }) {
  return (
    <View style={[s.row, ...(Array.isArray(style) ? style : style ? [style] : [])]}>
      <Text style={s.name}>{name}</Text>
      <Text style={s.amount}>{amount}</Text>
    </View>
  );
}

export function SlipPage({ slip, logo }: { slip: SlipSnapshot; logo?: string | null }) {
  const { company, employee, result } = slip;
  // Leave out lines that are zero both in the salary structure and this month.
  const earnings = result.earnings.filter((e) => e.amount !== 0 || !!e.fullAmount);
  const deductions = result.deductions.filter((d) => d.amount !== 0);
  const employer = result.employerContributions.filter((e) => e.amount !== 0);
  const rows = Math.max(earnings.length, deductions.length, 1);
  const pad = (n: number) => Array.from({ length: rows - n }, (_, i) => <Line key={`pad-${i}`} name=" " amount=" " />);

  const contact = [
    company.phone && `Phone: ${company.phone}`,
    company.email && `Email: ${company.email}`,
    company.website && `Website: ${company.website}`,
  ].filter(Boolean);
  const taxIds = [
    company.gstin && `GSTIN: ${company.gstin}`,
    company.pan && `PAN: ${company.pan}`,
    company.tan && `TAN: ${company.tan}`,
  ].filter(Boolean);
  const bank = [employee.bankName, employee.bankAccountMasked].filter(Boolean).join(" - ");

  return (
    <Page size="A4" style={s.page}>
      <View style={s.header}>
        {logo ? <Image src={logo} style={s.logo} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={s.companyName}>{company.name}</Text>
          <Text style={s.muted}>{company.address}</Text>
          {contact.length > 0 && <Text style={s.muted}>{contact.join("  |  ")}</Text>}
          {taxIds.length > 0 && <Text style={s.muted}>{taxIds.join("  |  ")}</Text>}
        </View>
      </View>

      <Text style={s.title}>Salary Slip for {monthLabel(slip.month, slip.year)}</Text>

      <View style={s.details}>
        <Detail label="Employee Code" value={employee.code} />
        <Detail label="Employee Name" value={employee.name} />
        <Detail label="Designation" value={employee.designation} />
        <Detail label="Department" value={employee.department} />
        <Detail label="Date of Joining" value={formatDate(employee.dateOfJoining)} />
        <Detail label="PAN" value={employee.pan} />
        <Detail label="UAN" value={employee.uan} />
        <Detail label="Bank Account" value={bank} />
        <Detail label="Paid Days" value={`${result.paidDays} of ${result.totalDays}`} />
        <Detail label="LOP Days" value={result.lopDays} />
      </View>

      <View style={s.table}>
        <View style={[s.col, s.colLeft]}>
          <Line name="Earnings" amount="Amount (Rs.)" style={[s.headRow, s.bold]} />
          {earnings.map((e) => (
            <Line key={e.name} name={e.name} amount={formatINR(e.amount)} />
          ))}
          {pad(earnings.length)}
          <Line name="Gross Earnings" amount={formatINR(result.gross)} style={[s.totalRow, s.bold]} />
        </View>
        <View style={s.col}>
          <Line name="Deductions" amount="Amount (Rs.)" style={[s.headRow, s.bold]} />
          {deductions.map((d) => (
            <Line key={d.name} name={d.name} amount={formatINR(d.amount)} />
          ))}
          {pad(deductions.length)}
          <Line name="Total Deductions" amount={formatINR(result.totalDeductions)} style={[s.totalRow, s.bold]} />
        </View>
      </View>

      <View style={s.net}>
        {/* Total salary is the gross earnings, before deductions. */}
        <View style={s.totalSalaryRow}>
          <Text style={s.totalSalary}>Total Salary</Text>
          <Text style={s.totalSalary}>Rs. {formatINR(result.gross)}</Text>
        </View>
        <View style={s.netRow}>
          <Text style={s.netAmount}>Net Pay</Text>
          <Text style={s.netAmount}>Rs. {formatINR(result.netPay)}</Text>
        </View>
        <Text>{amountInWords(result.netPay)}</Text>
      </View>

      {employer.length > 0 && (
        <View style={s.employer}>
          <Text style={[s.muted, { marginBottom: 3 }]}>
            Employer contributions (paid by the company, not deducted from salary):
          </Text>
          <Text>{employer.map((e) => `${e.name}: Rs. ${formatINR(e.amount)}`).join("   |   ")}</Text>
        </View>
      )}

      {company.signatoryName && (
        <View style={s.signatory}>
          <Text style={s.signText}>For {company.name}</Text>
          <View style={s.signLine}>
            <Text style={[s.signText, s.bold]}>{company.signatoryName}</Text>
            {company.signatoryDesignation ? <Text style={s.signText}>{company.signatoryDesignation}</Text> : null}
            <Text style={[s.signText, s.muted, { fontSize: 8 }]}>Authorised Signatory</Text>
          </View>
        </View>
      )}

      <Text style={s.footer} fixed>
        This is a computer-generated slip and does not require a signature.
      </Text>
    </Page>
  );
}

/** Render one slip to PDF bytes. `logo` is a data URI (PNG or JPEG). */
export async function renderSlipPdf(slip: SlipSnapshot, logo?: string | null): Promise<Buffer> {
  return renderToBuffer(
    <Document title={`Salary Slip - ${slip.employee.name} - ${monthLabel(slip.month, slip.year)}`} author={slip.company.name}>
      <SlipPage slip={slip} logo={logo} />
    </Document>,
  );
}
