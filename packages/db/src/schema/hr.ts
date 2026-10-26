import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { audit, tenantId } from "./core.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

// FK di database berbentuk komposit (tenant_id, id); di sini cukup dideklarasikan kolomnya.

export const PTKP_STATUSES = ["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"] as const;

export const RELIGIONS = [
  "islam",
  "protestant",
  "catholic",
  "hindu",
  "buddha",
  "confucian",
  "other",
] as const;
export const MARITAL_STATUSES = ["single", "married", "divorced", "widowed"] as const;

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  parentId: uuid("parent_id"),
  managerId: uuid("manager_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

/** Golongan upah (struktur & skala upah PP 36/2021). */
export const salaryGrades = pgTable("salary_grades", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  minWage: numeric("min_wage", { precision: 20, scale: 2 }).notNull(),
  maxWage: numeric("max_wage", { precision: 20, scale: 2 }).notNull(),
  sequence: integer("sequence").notNull().default(0),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const jobPositions = pgTable("job_positions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  gradeId: uuid("grade_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeNumber: text("employee_number").notNull(),
  name: text("name").notNull(),
  departmentId: uuid("department_id"),
  jobId: uuid("job_id"),
  managerId: uuid("manager_id"),
  userId: uuid("user_id"),
  workEmail: text("work_email"),
  workPhone: text("work_phone"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  nikEnc: text("nik_enc"),
  npwpEnc: text("npwp_enc"),
  bankAccountEnc: text("bank_account_enc"),
  birthDate: date("birth_date"),
  gender: text("gender", { enum: ["male", "female"] }),
  ptkpStatus: text("ptkp_status", { enum: PTKP_STATUSES }).notNull().default("TK/0"),
  bpjsKesNo: text("bpjs_kes_no"),
  bpjsTkNo: text("bpjs_tk_no"),
  // Kepesertaan per program — BPJS Kesehatan dan Ketenagakerjaan tidak digabung.
  bpjsKesEnrolled: boolean("bpjs_kes_enrolled").notNull().default(true),
  bpjsKesDate: date("bpjs_kes_date"),
  bpjsKesClass: smallint("bpjs_kes_class"),
  bpjsKesFacility: text("bpjs_kes_facility"),
  bpjsTkEnrolled: boolean("bpjs_tk_enrolled").notNull().default(true),
  bpjsTkDate: date("bpjs_tk_date"),
  bpjsJpEnrolled: boolean("bpjs_jp_enrolled").notNull().default(true),
  bankName: text("bank_name"),
  bankAccountName: text("bank_account_name"),
  joinDate: date("join_date").notNull(),
  resignDate: date("resign_date"),
  address: text("address"),
  emergencyContact: text("emergency_contact"),
  emergencyPhone: text("emergency_phone"),
  birthPlace: text("birth_place"),
  religion: text("religion", { enum: RELIGIONS }),
  maritalStatus: text("marital_status", { enum: MARITAL_STATUSES }),
  bloodType: text("blood_type", { enum: ["A", "B", "AB", "O"] }),
  rhesus: text("rhesus", { enum: ["+", "-"] }),
  nationality: text("nationality").notNull().default("WNI"),
  heightCm: smallint("height_cm"),
  weightKg: smallint("weight_kg"),
  personalEmail: text("personal_email"),
  personalPhone: text("personal_phone"),
  /** Alamat domisili bila berbeda dengan alamat KTP (`address`). */
  domicileAddress: text("domicile_address"),
  kkNoEnc: text("kk_no_enc"),
  gradeId: uuid("grade_id"),
  /** Jadwal kerja bawaan (dapat diganti per rentang tanggal lewat penugasan shift). */
  scheduleId: uuid("schedule_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const salaryComponents = pgTable("salary_components", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["allowance", "deduction"] }).notNull(),
  fixed: boolean("fixed").notNull().default(false),
  taxable: boolean("taxable").notNull().default(true),
  accountId: uuid("account_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  name: text("name").notNull(),
  contractType: text("contract_type", { enum: ["pkwt", "pkwtt"] })
    .notNull()
    .default("pkwtt"),
  dateStart: date("date_start").notNull(),
  dateEnd: date("date_end"),
  wage: numeric("wage", { precision: 20, scale: 2 }).notNull(),
  /** monthly = gaji bulanan; daily = upah per hari kerja; piece = tarif per satuan hasil kerja (borongan). */
  wageType: text("wage_type", { enum: ["monthly", "daily", "piece"] })
    .notNull()
    .default("monthly"),
  state: text("state", { enum: ["draft", "running", "closed", "cancel"] })
    .notNull()
    .default("draft"),
  note: text("note"),
  ...audit,
});

export const contractAllowances = pgTable("contract_allowances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  contractId: uuid("contract_id").notNull(),
  componentId: uuid("component_id").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
});

export const publicHolidays = pgTable("public_holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  date: date("date").notNull(),
  name: text("name").notNull(),
  ...audit,
});

export const leaveTypes = pgTable("leave_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  name: text("name").notNull(),
  paid: boolean("paid").notNull().default(true),
  requiresAllocation: boolean("requires_allocation").notNull().default(true),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const leaveAllocations = pgTable("leave_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  leaveTypeId: uuid("leave_type_id").notNull(),
  days: numeric("days", { precision: 6, scale: 2 }).notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  note: text("note"),
  ...audit,
});

export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  leaveTypeId: uuid("leave_type_id").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  days: numeric("days", { precision: 6, scale: 2 }).notNull(),
  reason: text("reason"),
  state: text("state", { enum: ["confirm", "approved", "refused", "cancel"] })
    .notNull()
    .default("confirm"),
  approvedBy: uuid("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvalStep: smallint("approval_step").notNull().default(1),
  approvalLevels: smallint("approval_levels").notNull().default(1),
  createdBy: uuid("created_by"),
  ...audit,
});

export const attendances = pgTable("attendances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  checkIn: timestamp("check_in", { withTimezone: true }).notNull(),
  checkOut: timestamp("check_out", { withTimezone: true }),
  latitude: numeric("latitude", { precision: 9, scale: 6 }),
  longitude: numeric("longitude", { precision: 9, scale: 6 }),
  source: text("source", { enum: ["web", "manual", "import"] })
    .notNull()
    .default("web"),
  createdAt: audit.createdAt,
});

export const overtimes = pgTable("overtimes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  date: date("date").notNull(),
  hours: numeric("hours", { precision: 5, scale: 2 }).notNull(),
  dayType: text("day_type", { enum: ["workday", "rest_day"] })
    .notNull()
    .default("workday"),
  description: text("description"),
  payslipId: uuid("payslip_id"),
  state: text("state", { enum: ["confirm", "approved", "refused"] })
    .notNull()
    .default("approved"),
  approvalStep: smallint("approval_step").notNull().default(1),
  approvalLevels: smallint("approval_levels").notNull().default(0),
  ...audit,
});

export const payrollSettings = pgTable("payroll_settings", {
  companyId: uuid("company_id").primaryKey(),
  tenantId: tenantId(),
  jkkRate: numeric("jkk_rate", { precision: 5, scale: 2 }).notNull().default("0.24"),
  kesWageCap: numeric("kes_wage_cap", { precision: 20, scale: 2 }).notNull().default("12000000"),
  jpWageCap: numeric("jp_wage_cap", { precision: 20, scale: 2 }).notNull().default("10547400"),
  salaryExpenseAccountId: uuid("salary_expense_account_id").notNull(),
  bpjsKesExpenseAccountId: uuid("bpjs_kes_expense_account_id").notNull(),
  bpjsTkExpenseAccountId: uuid("bpjs_tk_expense_account_id").notNull(),
  salaryPayableAccountId: uuid("salary_payable_account_id").notNull(),
  pph21PayableAccountId: uuid("pph21_payable_account_id").notNull(),
  bpjsKesPayableAccountId: uuid("bpjs_kes_payable_account_id").notNull(),
  bpjsTkPayableAccountId: uuid("bpjs_tk_payable_account_id").notNull(),
  journalId: uuid("journal_id").notNull(),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  employeeLoanAccountId: uuid("employee_loan_account_id"),
  leaveApprovalLevels: smallint("leave_approval_levels").notNull().default(1),
  overtimeApprovalLevels: smallint("overtime_approval_levels").notNull().default(0),
  casualFullBpjsMonths: smallint("casual_full_bpjs_months").notNull().default(3),
  expenseApprovalLevels: smallint("expense_approval_levels").notNull().default(1),
  thrComponentId: uuid("thr_component_id"),
  retroComponentId: uuid("retro_component_id"),
  /** Rekening perusahaan yang didebet untuk transfer gaji (file unggah bank). */
  transferSourceAccount: text("transfer_source_account"),
  /** Kode perusahaan/corporate ID di internet banking bisnis. */
  transferCompanyCode: text("transfer_company_code"),
  updatedAt: audit.updatedAt,
});

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  paymentDate: date("payment_date").notNull(),
  state: text("state", { enum: ["draft", "done", "paid", "cancel"] })
    .notNull()
    .default("draft"),
  accountMoveId: uuid("account_move_id"),
  paymentMoveId: uuid("payment_move_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const payslips = pgTable("payslips", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  runId: uuid("run_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  contractId: uuid("contract_id").notNull(),
  ptkpStatus: text("ptkp_status", { enum: PTKP_STATUSES }).notNull(),
  hasNpwp: boolean("has_npwp").notNull(),
  terCategory: text("ter_category").notNull(),
  terRate: numeric("ter_rate", { precision: 5, scale: 2 }),
  isFinal: boolean("is_final").notNull().default(false),
  workingDays: integer("working_days").notNull().default(0),
  unpaidDays: numeric("unpaid_days", { precision: 6, scale: 2 }).notNull().default("0"),
  earnings: numeric("earnings", { precision: 20, scale: 2 }).notNull().default("0"),
  gross: numeric("gross", { precision: 20, scale: 2 }).notNull().default("0"),
  pph21: numeric("pph21", { precision: 20, scale: 2 }).notNull().default("0"),
  employeeBpjs: numeric("employee_bpjs", { precision: 20, scale: 2 }).notNull().default("0"),
  employerBpjs: numeric("employer_bpjs", { precision: 20, scale: 2 }).notNull().default("0"),
  employeePension: numeric("employee_pension", { precision: 20, scale: 2 }).notNull().default("0"),
  deductions: numeric("deductions", { precision: 20, scale: 2 }).notNull().default("0"),
  net: numeric("net", { precision: 20, scale: 2 }).notNull().default("0"),
  annual: jsonb("annual"),
  branchId: uuid("branch_id"),
  businessUnitId: uuid("business_unit_id"),
  /** Dasar upah iuran BPJS bulan ini (upah sebelum batas per program). */
  bpjsWage: numeric("bpjs_wage", { precision: 20, scale: 2 }).notNull().default("0"),
  /** Iuran & dasar upah per program: BPJS Kesehatan dan BPJS Ketenagakerjaan (JHT, JKK, JKM, JP). */
  kesEmployee: numeric("kes_employee", { precision: 20, scale: 2 }).notNull().default("0"),
  kesEmployer: numeric("kes_employer", { precision: 20, scale: 2 }).notNull().default("0"),
  tkEmployee: numeric("tk_employee", { precision: 20, scale: 2 }).notNull().default("0"),
  tkEmployer: numeric("tk_employer", { precision: 20, scale: 2 }).notNull().default("0"),
  bpjsKesWage: numeric("bpjs_kes_wage", { precision: 20, scale: 2 }).notNull().default("0"),
  bpjsTkWage: numeric("bpjs_tk_wage", { precision: 20, scale: 2 }).notNull().default("0"),
  emailedAt: timestamp("emailed_at", { withTimezone: true }),
  emailError: text("email_error"),
  ...audit,
});

export const payslipLines = pgTable("payslip_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  payslipId: uuid("payslip_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  componentId: uuid("component_id"),
  loanId: uuid("loan_id"),
  expenseClaimId: uuid("expense_claim_id"),
});

export const payslipInputs = pgTable("payslip_inputs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  payslipId: uuid("payslip_id").notNull(),
  componentId: uuid("component_id").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  description: text("description"),
  /** manual = diisi pengguna; thr/retro = dihitung otomatis (rincian di detail). */
  source: text("source", { enum: ["manual", "thr", "retro"] })
    .notNull()
    .default("manual"),
  detail: jsonb("detail"),
});

export const workSchedules = pgTable("work_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  toleranceMinutes: integer("tolerance_minutes").notNull().default(0),
  penaltyPerMinute: numeric("penalty_per_minute", { precision: 18, scale: 2 }).notNull().default("0"),
  penaltyPerOccurrence: numeric("penalty_per_occurrence", { precision: 18, scale: 2 }).notNull().default("0"),
  workDays: smallint("work_days").array().notNull().default([1, 2, 3, 4, 5]),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const shiftAssignments = pgTable("shift_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  scheduleId: uuid("schedule_id").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  ...audit,
});

/** Jejak persetujuan berjenjang (cuti & lembur). */
export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  resModel: text("res_model", { enum: ["leave_request", "overtime", "expense_claim"] }).notNull(),
  resId: uuid("res_id").notNull(),
  step: smallint("step").notNull(),
  userId: uuid("user_id"),
  decision: text("decision", { enum: ["approved", "refused"] }).notNull(),
  note: text("note"),
  createdAt: audit.createdAt,
});

export const employeeLoans = pgTable("employee_loans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  name: text("name").notNull(),
  principal: numeric("principal", { precision: 20, scale: 2 }).notNull(),
  installment: numeric("installment", { precision: 20, scale: 2 }).notNull(),
  startPeriod: text("start_period").notNull(),
  state: text("state", { enum: ["draft", "running", "done", "cancel"] })
    .notNull()
    .default("draft"),
  disbursementDate: date("disbursement_date"),
  disbursementMoveId: uuid("disbursement_move_id"),
  note: text("note"),
  createdBy: uuid("created_by"),
  ...audit,
});

/** Hasil kerja borongan (satuan) per tanggal. */
export const workEntries = pgTable("work_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  date: date("date").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 4 }).notNull(),
  description: text("description"),
  payslipId: uuid("payslip_id"),
  ...audit,
});

export const severances = pgTable("severances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  reason: text("reason").notNull(),
  endDate: date("end_date").notNull(),
  monthlyWage: numeric("monthly_wage", { precision: 20, scale: 2 }).notNull(),
  unusedLeaveDays: numeric("unused_leave_days", { precision: 6, scale: 2 }).notNull().default("0"),
  otherRights: numeric("other_rights", { precision: 20, scale: 2 }).notNull().default("0"),
  separationPay: numeric("separation_pay", { precision: 20, scale: 2 }).notNull().default("0"),
  result: jsonb("result").notNull(),
  gross: numeric("gross", { precision: 20, scale: 2 }).notNull(),
  tax: numeric("tax", { precision: 20, scale: 2 }).notNull(),
  net: numeric("net", { precision: 20, scale: 2 }).notNull(),
  state: text("state", { enum: ["draft", "posted", "cancel"] })
    .notNull()
    .default("draft"),
  moveId: uuid("move_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const expenseCategories = pgTable("expense_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  accountId: uuid("account_id").notNull(),
  /** Plafon per karyawan per tahun kalender (null = tanpa plafon). */
  annualLimit: numeric("annual_limit", { precision: 20, scale: 2 }),
  /** Objek PPh 21 bila dibayar lewat slip gaji. */
  taxable: boolean("taxable").notNull().default(false),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const EXPENSE_CLAIM_STATES = ["draft", "confirm", "approved", "refused", "paid", "cancel"] as const;

export const expenseClaims = pgTable("expense_claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  name: text("name").notNull(),
  date: date("date").notNull(),
  description: text("description"),
  state: text("state", { enum: EXPENSE_CLAIM_STATES }).notNull().default("draft"),
  approvalStep: smallint("approval_step").notNull().default(1),
  approvalLevels: smallint("approval_levels").notNull().default(1),
  payMethod: text("pay_method", { enum: ["payslip", "cash"] })
    .notNull()
    .default("payslip"),
  total: numeric("total", { precision: 20, scale: 2 }).notNull().default("0"),
  payslipId: uuid("payslip_id"),
  moveId: uuid("move_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

export const expenseClaimLines = pgTable("expense_claim_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  claimId: uuid("claim_id").notNull(),
  categoryId: uuid("category_id").notNull(),
  date: date("date").notNull(),
  amount: numeric("amount", { precision: 20, scale: 2 }).notNull(),
  note: text("note"),
  attachment: bytea("attachment"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
});

export const employeeChangeRequests = pgTable("employee_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  /** Nilai baru per field; nomor rekening disimpan terenkripsi (`bankAccountEnc`). */
  changes: jsonb("changes").$type<Record<string, string | null>>().notNull(),
  note: text("note"),
  state: text("state", { enum: ["confirm", "approved", "refused"] })
    .notNull()
    .default("confirm"),
  decidedBy: uuid("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  createdBy: uuid("created_by"),
  ...audit,
});

// ---- Rekrutmen, dokumen, checklist ----

export const jobOpenings = pgTable("job_openings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  jobId: uuid("job_id"),
  departmentId: uuid("department_id"),
  description: text("description"),
  quota: integer("quota").notNull().default(1),
  state: text("state", { enum: ["open", "closed"] })
    .notNull()
    .default("open"),
  dateOpen: date("date_open").notNull().defaultNow(),
  dateClose: date("date_close"),
  ...audit,
});

export const APPLICANT_STAGES = ["new", "screening", "interview", "offer", "hired", "refused"] as const;

export const applicants = pgTable("applicants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  openingId: uuid("opening_id").notNull(),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  source: text("source", { enum: ["referral", "jobportal", "website", "walkin", "other"] })
    .notNull()
    .default("other"),
  stage: text("stage", { enum: APPLICANT_STAGES }).notNull().default("new"),
  expectedWage: numeric("expected_wage", { precision: 20, scale: 2 }),
  notes: text("notes"),
  refuseReason: text("refuse_reason"),
  employeeId: uuid("employee_id"),
  ...audit,
});

export const applicantInterviews = pgTable("applicant_interviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  applicantId: uuid("applicant_id").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  interviewerId: uuid("interviewer_id"),
  location: text("location"),
  result: text("result"),
  score: smallint("score"),
  done: boolean("done").notNull().default(false),
  ...audit,
});

export const HR_DOCUMENT_KINDS = [
  "ktp",
  "npwp",
  "kk",
  "bpjs_kes",
  "bpjs_tk",
  "sim",
  "passport",
  "bank_book",
  "ijazah",
  "cv",
  "contract",
  "decree",
  "certificate",
  "warning",
  "other",
] as const;

export const hrDocuments = pgTable("hr_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id"),
  applicantId: uuid("applicant_id"),
  kind: text("kind", { enum: HR_DOCUMENT_KINDS }).notNull(),
  name: text("name").notNull(),
  file: bytea("file").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  /** Nomor kartu/dokumen (mis. no. BPJS, SIM, paspor). */
  number: text("number"),
  issuedDate: date("issued_date"),
  expiryDate: date("expiry_date"),
  note: text("note"),
  createdBy: uuid("created_by"),
  ...audit,
});

const RESPONSIBLES = ["hr", "manager", "employee", "it"] as const;
const CHECKLIST_ACTIONS = ["severance", "deactivate_user"] as const;

export const hrChecklistTemplates = pgTable("hr_checklist_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  kind: text("kind", { enum: ["onboarding", "offboarding"] }).notNull(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const hrChecklistTemplateItems = pgTable("hr_checklist_template_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  templateId: uuid("template_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  name: text("name").notNull(),
  responsible: text("responsible", { enum: RESPONSIBLES }).notNull().default("hr"),
  dueDays: integer("due_days").notNull().default(0),
  action: text("action", { enum: CHECKLIST_ACTIONS }),
});

export const hrChecklists = pgTable("hr_checklists", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  kind: text("kind", { enum: ["onboarding", "offboarding"] }).notNull(),
  name: text("name").notNull(),
  baseDate: date("base_date").notNull(),
  state: text("state", { enum: ["open", "done"] })
    .notNull()
    .default("open"),
  ...audit,
});

export const hrChecklistTasks = pgTable("hr_checklist_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  checklistId: uuid("checklist_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  name: text("name").notNull(),
  responsible: text("responsible", { enum: RESPONSIBLES }).notNull(),
  responsibleUserId: uuid("responsible_user_id"),
  dueDate: date("due_date").notNull(),
  action: text("action", { enum: CHECKLIST_ACTIONS }),
  doneAt: timestamp("done_at", { withTimezone: true }),
  doneBy: uuid("done_by"),
});

export const hrReminderLog = pgTable("hr_reminder_log", {
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  sentOn: date("sent_on").notNull(),
});

// ---- Kinerja, pelatihan, riwayat karir ----

export const appraisalTemplates = pgTable("appraisal_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  jobId: uuid("job_id"),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const appraisalTemplateItems = pgTable("appraisal_template_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  templateId: uuid("template_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  name: text("name").notNull(),
  description: text("description"),
  weight: numeric("weight", { precision: 6, scale: 2 }).notNull(),
});

export const appraisalCycles = pgTable("appraisal_cycles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  dateStart: date("date_start").notNull(),
  dateEnd: date("date_end").notNull(),
  state: text("state", { enum: ["draft", "open", "closed"] })
    .notNull()
    .default("draft"),
  ...audit,
});

export const appraisals = pgTable("appraisals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  cycleId: uuid("cycle_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  templateId: uuid("template_id"),
  managerUserId: uuid("manager_user_id"),
  state: text("state", { enum: ["self", "manager", "calibration", "done"] })
    .notNull()
    .default("self"),
  selfScore: numeric("self_score", { precision: 4, scale: 2 }),
  managerScore: numeric("manager_score", { precision: 4, scale: 2 }),
  finalScore: numeric("final_score", { precision: 4, scale: 2 }),
  rating: text("rating", { enum: ["A", "B", "C", "D", "E"] }),
  employeeComment: text("employee_comment"),
  managerComment: text("manager_comment"),
  hrComment: text("hr_comment"),
  raisePercent: numeric("raise_percent", { precision: 5, scale: 2 }),
  selfSubmittedAt: timestamp("self_submitted_at", { withTimezone: true }),
  managerSubmittedAt: timestamp("manager_submitted_at", { withTimezone: true }),
  doneAt: timestamp("done_at", { withTimezone: true }),
  ...audit,
});

export const appraisalLines = pgTable("appraisal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  appraisalId: uuid("appraisal_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  name: text("name").notNull(),
  weight: numeric("weight", { precision: 6, scale: 2 }).notNull(),
  selfScore: smallint("self_score"),
  managerScore: smallint("manager_score"),
  comment: text("comment"),
});

export const trainings = pgTable("trainings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  name: text("name").notNull(),
  provider: text("provider"),
  dateStart: date("date_start").notNull(),
  dateEnd: date("date_end").notNull(),
  cost: numeric("cost", { precision: 20, scale: 2 }).notNull().default("0"),
  certificateValidMonths: integer("certificate_valid_months"),
  state: text("state", { enum: ["planned", "done", "cancel"] })
    .notNull()
    .default("planned"),
  description: text("description"),
  ...audit,
});

export const trainingParticipants = pgTable("training_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  trainingId: uuid("training_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  state: text("state", { enum: ["enrolled", "completed", "absent"] })
    .notNull()
    .default("enrolled"),
  certificateDocumentId: uuid("certificate_document_id"),
  certificateExpiry: date("certificate_expiry"),
  createdAt: audit.createdAt,
});

export const EMPLOYEE_HISTORY_KINDS = [
  "join",
  "department",
  "job",
  "branch",
  "manager",
  "wage",
  "resign",
  "promotion",
  "demotion",
  "transfer",
  "grade",
  "warning",
] as const;

export const employeeHistory = pgTable("employee_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  date: date("date").notNull(),
  kind: text("kind", { enum: EMPLOYEE_HISTORY_KINDS }).notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  note: text("note"),
  createdBy: uuid("created_by"),
  createdAt: audit.createdAt,
});

export const employeePhotos = pgTable("employee_photos", {
  employeeId: uuid("employee_id").primaryKey(),
  tenantId: tenantId(),
  photo: bytea("photo").notNull(),
  photoType: text("photo_type", { enum: ["image/jpeg", "image/png", "image/webp"] }).notNull(),
  updatedAt: audit.updatedAt,
});

export const FAMILY_RELATIONS = ["spouse", "child", "father", "mother", "sibling", "other"] as const;

export const employeeFamily = pgTable("employee_family", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  employeeId: uuid("employee_id").notNull(),
  relation: text("relation", { enum: FAMILY_RELATIONS }).notNull(),
  name: text("name").notNull(),
  nikEnc: text("nik_enc"),
  gender: text("gender", { enum: ["male", "female"] }),
  birthPlace: text("birth_place"),
  birthDate: date("birth_date"),
  education: text("education"),
  occupation: text("occupation"),
  phone: text("phone"),
  dependent: boolean("dependent").notNull().default(false),
  bpjsCovered: boolean("bpjs_covered").notNull().default(false),
  alive: boolean("alive").notNull().default(true),
  note: text("note"),
  ...audit,
});

export const EDUCATION_LEVELS = [
  "sd",
  "smp",
  "sma",
  "d1",
  "d2",
  "d3",
  "d4",
  "s1",
  "s2",
  "s3",
  "other",
] as const;

export const employeeEducation = pgTable("employee_education", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  employeeId: uuid("employee_id").notNull(),
  level: text("level", { enum: EDUCATION_LEVELS }).notNull(),
  institution: text("institution").notNull(),
  major: text("major"),
  yearStart: smallint("year_start"),
  yearEnd: smallint("year_end"),
  gpa: numeric("gpa", { precision: 4, scale: 2 }),
  documentId: uuid("document_id"),
  note: text("note"),
  ...audit,
});

export const employeeExperiences = pgTable("employee_experiences", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  employeeId: uuid("employee_id").notNull(),
  company: text("company").notNull(),
  position: text("position"),
  dateStart: date("date_start"),
  dateEnd: date("date_end"),
  reasonLeaving: text("reason_leaving"),
  note: text("note"),
  ...audit,
});

export const MOVEMENT_KINDS = ["promotion", "demotion", "transfer", "rotation"] as const;

export const employeeMovements = pgTable("employee_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  kind: text("kind", { enum: MOVEMENT_KINDS }).notNull(),
  decreeNo: text("decree_no"),
  effectiveDate: date("effective_date").notNull(),
  fromJobId: uuid("from_job_id"),
  toJobId: uuid("to_job_id"),
  fromDepartmentId: uuid("from_department_id"),
  toDepartmentId: uuid("to_department_id"),
  fromBranchId: uuid("from_branch_id"),
  toBranchId: uuid("to_branch_id"),
  fromManagerId: uuid("from_manager_id"),
  toManagerId: uuid("to_manager_id"),
  fromGradeId: uuid("from_grade_id"),
  toGradeId: uuid("to_grade_id"),
  oldWage: numeric("old_wage", { precision: 20, scale: 2 }),
  newWage: numeric("new_wage", { precision: 20, scale: 2 }),
  reason: text("reason"),
  state: text("state", { enum: ["draft", "done", "cancel"] })
    .notNull()
    .default("draft"),
  documentId: uuid("document_id"),
  contractId: uuid("contract_id"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  appliedBy: uuid("applied_by"),
  ...audit,
});

export const employeeWarnings = pgTable("employee_warnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  employeeId: uuid("employee_id").notNull(),
  level: text("level", { enum: ["sp1", "sp2", "sp3"] }).notNull(),
  decreeNo: text("decree_no"),
  date: date("date").notNull(),
  validUntil: date("valid_until").notNull(),
  reason: text("reason").notNull(),
  documentId: uuid("document_id"),
  createdBy: uuid("created_by"),
  ...audit,
});

/** Profil ekspor: kolom & filter yang disimpan per dataset (pribadi atau dipakai bersama). */
export const exportPresets = pgTable("export_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id").notNull(),
  dataset: text("dataset").notNull(),
  name: text("name").notNull(),
  columns: text("columns").array().notNull(),
  filters: jsonb("filters").$type<Record<string, string>>().notNull().default({}),
  shared: boolean("shared").notNull().default(false),
  ...audit,
});

// ---- Mesin persetujuan generik ----

export const APPROVAL_FIELD_KEYS = [
  "date",
  "period",
  "quantity",
  "amount",
  "reference",
  "location",
  "contact",
  "description",
  "attachment",
] as const;
export type ApprovalFieldKey = (typeof APPROVAL_FIELD_KEYS)[number];
export type ApprovalFieldMode = "required" | "optional" | "none";

export const approvalCategories = pgTable("approval_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  prefix: text("prefix").notNull(),
  fields: jsonb("fields").$type<Partial<Record<ApprovalFieldKey, ApprovalFieldMode>>>().notNull().default({}),
  managerFirst: boolean("manager_first").notNull().default(true),
  approvalMode: text("approval_mode", { enum: ["sequential", "parallel"] })
    .notNull()
    .default("sequential"),
  minApprovals: smallint("min_approvals").notNull().default(0),
  sequence: integer("sequence").notNull().default(10),
  active: boolean("active").notNull().default(true),
  ...audit,
});

export const approvalCategoryApprovers = pgTable("approval_category_approvers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  categoryId: uuid("category_id").notNull(),
  sequence: integer("sequence").notNull().default(10),
  userId: uuid("user_id").notNull(),
  label: text("label"),
  required: boolean("required").notNull().default(true),
  /** Batas nominal DoA: tahap berlaku bila nominal ≥ batas (null = selalu). */
  minAmount: numeric("min_amount", { precision: 20, scale: 2 }),
});

export const APPROVAL_REQUEST_STATES = ["draft", "submitted", "approved", "refused", "cancel"] as const;

export const approvalRequests = pgTable("approval_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  categoryId: uuid("category_id").notNull(),
  number: text("number"),
  subject: text("subject").notNull(),
  employeeId: uuid("employee_id"),
  requestedBy: uuid("requested_by"),
  state: text("state", { enum: APPROVAL_REQUEST_STATES }).notNull().default("draft"),
  date: date("date"),
  dateFrom: date("date_from"),
  dateTo: date("date_to"),
  quantity: numeric("quantity", { precision: 12, scale: 2 }),
  amount: numeric("amount", { precision: 20, scale: 2 }),
  reference: text("reference"),
  location: text("location"),
  contact: text("contact"),
  description: text("description"),
  attachment: bytea("attachment"),
  attachmentName: text("attachment_name"),
  attachmentType: text("attachment_type"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  ...audit,
});

export const approvalRequestSteps = pgTable("approval_request_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  requestId: uuid("request_id").notNull(),
  sequence: integer("sequence").notNull(),
  /** null = diputuskan HR (hr.manage). */
  approverUserId: uuid("approver_user_id"),
  label: text("label"),
  required: boolean("required").notNull().default(true),
  state: text("state", { enum: ["pending", "approved", "refused", "skipped"] })
    .notNull()
    .default("pending"),
  decidedBy: uuid("decided_by"),
  delegated: boolean("delegated").notNull().default(false),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  note: text("note"),
});

export const approvalDelegations = pgTable("approval_delegations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: tenantId(),
  companyId: uuid("company_id").notNull(),
  userId: uuid("user_id").notNull(),
  delegateUserId: uuid("delegate_user_id").notNull(),
  dateFrom: date("date_from").notNull(),
  dateTo: date("date_to").notNull(),
  reason: text("reason"),
  ...audit,
});
