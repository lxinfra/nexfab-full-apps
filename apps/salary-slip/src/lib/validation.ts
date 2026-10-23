import { z } from "zod";

export type FieldErrors = Record<string, string>;
export type ActionResult = { ok?: boolean; errors?: FieldErrors; message?: string };

/** Flatten zod issues into { "field.path": "first message" }. */
export function zodErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export const DEFAULT_COMPONENTS = [
  "Basic",
  "HRA",
  "Conveyance Allowance",
  "Special Allowance",
  "Medical Allowance",
];

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const TAN_RE = /^[A-Z]{4}[0-9]{5}[A-Z]$/;
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

const required = (label: string, max = 200) =>
  z.preprocess(text, z.string().min(1, `${label} is required.`).max(max, `${label} is too long.`));

/** Optional free text: empty becomes null. */
const optional = (label: string, max = 200) =>
  z.preprocess(
    text,
    z
      .string()
      .max(max, `${label} is too long.`)
      .transform((v) => v || null),
  );

/** Optional text that must match a pattern when filled in. */
const optionalPattern = (re: RegExp, message: string, upper = false) =>
  z.preprocess(
    (v) => (upper ? text(v).toUpperCase() : text(v)),
    z
      .string()
      .refine((v) => v === "" || re.test(v), message)
      .transform((v) => v || null),
  );

const panField = optionalPattern(PAN_RE, "PAN must look like ABCDE1234F.", true);

export const companySchema = z.object({
  name: required("Company name"),
  address: required("Address", 500),
  phone: optionalPattern(/^[0-9+\-\s()]{6,20}$/, "Enter a valid phone number."),
  email: optionalPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address."),
  website: optionalPattern(/^https?:\/\/[^\s]+\.[^\s]+$/i, "Website must start with http:// or https://"),
  gstin: optionalPattern(GSTIN_RE, "GSTIN must be 15 characters, e.g. 23ABCDE1234F1Z5.", true),
  pan: panField,
  tan: optionalPattern(TAN_RE, "TAN must look like ABCD12345E.", true),
  signatoryName: optional("Signatory name"),
  signatoryDesignation: optional("Signatory designation"),
});

const amount = (label: string) =>
  z.coerce
    .number({ invalid_type_error: `${label} must be a number.` })
    .finite(`${label} must be a number.`)
    .min(0, `${label} cannot be negative.`)
    .max(100000000, `${label} is too large.`);

export const componentSchema = z.object({
  name: required("Component name", 60),
  monthlyAmount: amount("Amount"),
});

export const employeeSchema = z
  .object({
    code: required("Employee code", 30),
    name: required("Name"),
    designation: optional("Designation"),
    department: optional("Department"),
    dateOfJoining: z.preprocess(
      text,
      z
        .string()
        .refine((v) => v === "" || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))), {
          message: "Enter a valid date.",
        })
        .transform((v) => (v ? new Date(`${v}T00:00:00.000Z`) : null)),
    ),
    pan: panField,
    uan: optionalPattern(/^[0-9]{12}$/, "UAN must be 12 digits."),
    esiNumber: optionalPattern(/^[0-9]{10,17}$/, "ESI number must be 10 to 17 digits."),
    bankName: optional("Bank name"),
    bankAccount: optionalPattern(/^[0-9]{6,18}$/, "Bank account number must be 6 to 18 digits."),
    ifsc: optionalPattern(IFSC_RE, "IFSC must look like SBIN0001234.", true),
    status: z.enum(["ACTIVE", "INACTIVE"], { message: "Choose a status." }),
    components: z.array(componentSchema),
    // CTC structure: when a template is chosen, the components come from it.
    templateId: z.preprocess((v) => (v === "" || v === undefined ? null : v), z.coerce.number().int().nullable()).default(null),
    ctcAmount: z
      .preprocess(
        (v) => (v === "" || v === undefined ? null : v),
        z.coerce.number({ invalid_type_error: "CTC must be a number." }).positive("CTC must be greater than zero.").nullable(),
      )
      .default(null),
    ctcPeriod: z.enum(["YEARLY", "MONTHLY"]).default("YEARLY"),
  })
  .superRefine((data, ctx) => {
    if (data.templateId !== null && data.ctcAmount === null) {
      ctx.addIssue({ code: "custom", path: ["ctcAmount"], message: "Enter the CTC." });
    }
    const seen = new Set<string>();
    data.components.forEach((c, i) => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: "custom",
          path: ["components", i, "name"],
          message: `"${c.name}" is listed twice.`,
        });
      }
      seen.add(key);
    });
  });

export type EmployeeData = z.infer<typeof employeeSchema>;

const optionalPositive = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce
      .number({ invalid_type_error: `${label} must be a number.` })
      .positive(`${label} must be greater than zero.`)
      .nullable(),
  );

const optionalAmount = (label: string) =>
  z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce
      .number({ invalid_type_error: `${label} must be a number.` })
      .min(0, `${label} cannot be negative.`)
      .nullable(),
  );

const slabSchema = z.object({
  from: amount("From"),
  to: z.preprocess(
    (v) => (v === "" || v === null || v === undefined ? null : v),
    z.coerce.number({ invalid_type_error: "To must be a number." }).min(0).nullable(),
  ),
  amount: amount("Amount"),
});

export const ruleSchema = z
  .object({
    name: required("Rule name", 60),
    type: z.enum(["PERCENTAGE", "FIXED", "SLAB", "MANUAL", "TDS"], { message: "Choose a rule type." }),
    baseType: z.enum(["BASIC", "GROSS", "COMPONENTS"]).nullable().optional(),
    baseComponents: z.array(z.string().trim().min(1)).default([]),
    percentage: optionalAmount("Percentage"),
    fixedAmount: optionalAmount("Amount"),
    slabs: z.array(slabSchema).default([]),
    baseCap: optionalPositive("Base cap"),
    amountCap: optionalPositive("Amount cap"),
    eligibilityMaxGross: optionalPositive("Gross limit"),
    appliesToAll: z.boolean(),
    employeeIds: z.array(z.number().int()).default([]),
    employerType: z.enum(["NONE", "PERCENTAGE", "FIXED"]).default("NONE"),
    employerValue: optionalPositive("Employer contribution"),
    active: z.boolean().default(true),
  })
  .superRefine((d, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    const needsBase = d.type === "PERCENTAGE" || d.type === "SLAB" || d.employerType === "PERCENTAGE";
    if ((d.type === "PERCENTAGE" || d.type === "SLAB") && !d.baseType) {
      issue(["baseType"], "Choose what the rule is calculated on.");
    }
    if (needsBase && d.baseType === "COMPONENTS" && d.baseComponents.length === 0) {
      issue(["baseComponents"], "Select at least one component.");
    }
    if (d.type === "PERCENTAGE") {
      if (d.percentage == null) issue(["percentage"], "Enter the percentage.");
      else if (d.percentage > 100) issue(["percentage"], "Percentage cannot be more than 100.");
    }
    if (d.type === "FIXED" && d.fixedAmount == null) issue(["fixedAmount"], "Enter the amount.");
    if (d.type === "SLAB") {
      if (d.slabs.length === 0) issue(["slabs"], "Add at least one slab.");
      d.slabs.forEach((s, i) => {
        if (s.to !== null && s.to < s.from) issue(["slabs", i, "to"], "To must not be less than From.");
      });
      const sorted = d.slabs.map((s, i) => ({ ...s, i })).sort((a, b) => a.from - b.from);
      for (let k = 1; k < sorted.length; k++) {
        const prev = sorted[k - 1];
        if (prev.to === null || sorted[k].from <= prev.to) {
          issue(["slabs", sorted[k].i, "from"], "This slab overlaps another slab.");
        }
      }
    }
    if (!d.appliesToAll && d.employeeIds.length === 0) {
      issue(["employeeIds"], "Select at least one employee.");
    }
    if (d.employerType !== "NONE") {
      if (d.employerValue == null) issue(["employerValue"], "Enter the employer contribution.");
      else if (d.employerType === "PERCENTAGE" && d.employerValue > 100) {
        issue(["employerValue"], "Percentage cannot be more than 100.");
      }
    }
  });

export type RuleData = z.infer<typeof ruleSchema>;

const namedAmount = z.object({
  name: required("Name", 60),
  amount: amount("Amount"),
});

const overrideMap = z.record(amount("Amount")).default({});

export const entrySchema = z.object({
  employeeId: z.number().int(),
  paidDays: z.coerce.number({ invalid_type_error: "Paid days must be a number." }).min(0),
  arrears: amount("Arrears"),
  oneTimeEarnings: z.array(namedAmount).default([]),
  manualRules: overrideMap,
  adhoc: z.array(namedAmount).default([]),
  overrides: z
    .object({ earnings: overrideMap, deductions: overrideMap })
    .default({ earnings: {}, deductions: {} }),
});

export type EntryData = z.infer<typeof entrySchema>;
