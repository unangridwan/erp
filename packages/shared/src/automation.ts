import { z } from "zod";
import { CUSTOM_FIELD_MODEL_KEYS, type CustomFieldModel } from "./custom-fields.js";

export const AUTOMATION_TRIGGERS = ["created", "updated", "date", "scheduled"] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export const AUTOMATION_TRIGGER_LABEL: Record<AutomationTrigger, [string, string]> = {
  created: ["Saat data dibuat", "When a record is created"],
  updated: ["Saat data diubah", "When a record is updated"],
  date: ["Berdasarkan tanggal", "Based on a date"],
  scheduled: ["Terjadwal", "On a schedule"],
};

export const CONDITION_OPS = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "in",
  "empty",
  "notEmpty",
] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export const CONDITION_OP_LABEL: Record<ConditionOp, [string, string]> = {
  eq: ["sama dengan", "equals"],
  ne: ["tidak sama dengan", "not equal"],
  gt: [">", ">"],
  gte: [">=", ">="],
  lt: ["<", "<"],
  lte: ["<=", "<="],
  contains: ["mengandung", "contains"],
  in: ["salah satu dari (pisahkan koma)", "one of (comma separated)"],
  empty: ["kosong", "is empty"],
  notEmpty: ["terisi", "is set"],
};

export type AutomationFieldType = "text" | "number" | "date" | "select" | "boolean" | "user" | "partner";
export interface AutomationField {
  key: string;
  label: [string, string];
  type: AutomationFieldType;
  options?: [string, [string, string]][];
}

const f = (
  key: string,
  id: string,
  en: string,
  type: AutomationFieldType = "text",
  options?: [string, [string, string]][],
): AutomationField => ({ key, label: [id, en], type, ...(options ? { options } : {}) });
const o = (value: string, id: string, en: string): [string, [string, string]] => [value, [id, en]];
const CREATED = f("created_at", "Tanggal dibuat", "Created on", "date");

/** Kolom data (nama kolom DB) yang bisa dipakai di syarat, tanggal, & isian template; field kustom ditambahkan API. */
export const AUTOMATION_FIELDS: Record<CustomFieldModel, AutomationField[]> = {
  partner: [
    f("name", "Nama", "Name"),
    f("email", "Email", "Email"),
    f("phone", "Telepon", "Phone"),
    f("city", "Kota", "City"),
    f("is_customer", "Pelanggan", "Customer", "boolean"),
    f("is_supplier", "Pemasok", "Vendor", "boolean"),
    f("salesperson_id", "Salesperson", "Salesperson", "user"),
    f("active", "Aktif", "Active", "boolean"),
    CREATED,
  ],
  product: [
    f("sku", "SKU", "SKU"),
    f("name", "Nama", "Name"),
    f("product_type", "Jenis", "Type", "select", [
      o("storable", "Barang stok", "Storable"),
      o("consumable", "Barang habis pakai", "Consumable"),
      o("service", "Jasa", "Service"),
    ]),
    f("sale_price", "Harga jual", "Sales price", "number"),
    f("cost", "Biaya", "Cost", "number"),
    f("active", "Aktif", "Active", "boolean"),
    CREATED,
  ],
  employee: [
    f("employee_number", "No. karyawan", "Employee no."),
    f("name", "Nama", "Name"),
    f("work_email", "Email kantor", "Work email"),
    f("join_date", "Tanggal masuk", "Join date", "date"),
    f("resign_date", "Tanggal keluar", "Leaving date", "date"),
    f("birth_date", "Tanggal lahir", "Birth date", "date"),
    f("user_id", "Akun pengguna", "User account", "user"),
    f("active", "Aktif", "Active", "boolean"),
    CREATED,
  ],
  fleet_vehicle: [
    f("license_plate", "Nomor polisi", "License plate"),
    f("state", "Status", "Status", "select", [
      o("new_request", "Permintaan baru", "New request"),
      o("to_order", "Dipesan", "To order"),
      o("registered", "Terdaftar", "Registered"),
      o("downgraded", "Nonaktif", "Downgraded"),
    ]),
    f("stnk_expiry", "STNK berlaku s.d.", "Registration expiry", "date"),
    f("tax_due_date", "Jatuh tempo pajak", "Tax due date", "date"),
    f("kir_expiry", "KIR berlaku s.d.", "KIR expiry", "date"),
    f("odometer", "Odometer", "Odometer", "number"),
    f("manager_user_id", "Fleet manager", "Fleet manager", "user"),
    CREATED,
  ],
  crm_lead: [
    f("name", "Judul", "Title"),
    f("lead_type", "Jenis", "Type", "select", [
      o("lead", "Lead", "Lead"),
      o("opportunity", "Peluang", "Opportunity"),
    ]),
    f("state", "Status", "Status", "select", [
      o("open", "Terbuka", "Open"),
      o("won", "Menang", "Won"),
      o("lost", "Kalah", "Lost"),
    ]),
    f("expected_revenue", "Nilai harapan", "Expected revenue", "number"),
    f("probability", "Probabilitas (%)", "Probability (%)", "number"),
    f("priority", "Prioritas", "Priority", "number"),
    f("expected_close", "Perkiraan tutup", "Expected closing", "date"),
    f("source", "Sumber", "Source"),
    f("user_id", "Salesperson", "Salesperson", "user"),
    f("partner_id", "Pelanggan", "Customer", "partner"),
    CREATED,
  ],
  sale_order: [
    f("name", "Nomor", "Number"),
    f("state", "Status", "Status", "select", [
      o("draft", "Penawaran", "Quotation"),
      o("sent", "Penawaran terkirim", "Quotation sent"),
      o("sale", "Pesanan", "Sales order"),
      o("cancel", "Batal", "Cancelled"),
    ]),
    f("invoice_status", "Status tagih", "Invoice status", "select", [
      o("no", "Tidak ada", "Nothing"),
      o("to_invoice", "Perlu ditagih", "To invoice"),
      o("invoiced", "Sudah ditagih", "Invoiced"),
    ]),
    f("amount_untaxed", "Total sebelum pajak", "Untaxed total", "number"),
    f("amount_total", "Total", "Total", "number"),
    f("date_order", "Tanggal", "Date", "date"),
    f("validity_date", "Berlaku hingga", "Valid until", "date"),
    f("partner_id", "Pelanggan", "Customer", "partner"),
    f("user_id", "Salesperson", "Salesperson", "user"),
    CREATED,
  ],
  purchase_order: [
    f("name", "Nomor", "Number"),
    f("state", "Status", "Status", "select", [
      o("draft", "RFQ", "RFQ"),
      o("sent", "RFQ terkirim", "RFQ sent"),
      o("to_approve", "Menunggu persetujuan", "To approve"),
      o("purchase", "Pesanan", "Purchase order"),
      o("cancel", "Batal", "Cancelled"),
    ]),
    f("amount_total", "Total", "Total", "number"),
    f("date_order", "Tanggal", "Date", "date"),
    f("date_planned", "Tanggal rencana terima", "Expected arrival", "date"),
    f("partner_id", "Pemasok", "Vendor", "partner"),
    f("user_id", "Pembeli", "Buyer", "user"),
    CREATED,
  ],
  account_move: [
    f("name", "Nomor", "Number"),
    f("move_type", "Jenis", "Type", "select", [
      o("out_invoice", "Faktur pelanggan", "Customer invoice"),
      o("out_refund", "Nota kredit pelanggan", "Customer credit note"),
      o("in_invoice", "Tagihan pemasok", "Vendor bill"),
      o("in_refund", "Nota kredit pemasok", "Vendor credit note"),
      o("entry", "Jurnal umum", "Journal entry"),
    ]),
    f("state", "Status", "Status", "select", [
      o("draft", "Draft", "Draft"),
      o("posted", "Diposting", "Posted"),
    ]),
    f("payment_state", "Status bayar", "Payment status", "select", [
      o("not_paid", "Belum dibayar", "Not paid"),
      o("partial", "Sebagian", "Partial"),
      o("paid", "Lunas", "Paid"),
      o("reversed", "Dibalik", "Reversed"),
    ]),
    f("amount_total", "Total", "Total", "number"),
    f("amount_residual", "Sisa", "Amount due", "number"),
    f("date", "Tanggal", "Date", "date"),
    f("due_date", "Jatuh tempo", "Due date", "date"),
    f("partner_id", "Partner", "Partner", "partner"),
    CREATED,
  ],
  stock_picking: [
    f("name", "Nomor", "Number"),
    f("picking_type", "Jenis", "Type", "select", [
      o("incoming", "Penerimaan", "Receipt"),
      o("outgoing", "Pengiriman", "Delivery"),
      o("internal", "Internal", "Internal"),
      o("dropship", "Dropship", "Dropship"),
    ]),
    f("state", "Status", "Status", "select", [
      o("draft", "Draft", "Draft"),
      o("ready", "Siap", "Ready"),
      o("done", "Selesai", "Done"),
      o("cancel", "Batal", "Cancelled"),
    ]),
    f("scheduled_date", "Tanggal rencana", "Scheduled date", "date"),
    f("origin", "Dokumen asal", "Source document"),
    f("partner_id", "Partner", "Partner", "partner"),
    CREATED,
  ],
  production_order: [
    f("name", "Nomor", "Number"),
    f("state", "Status", "Status", "select", [
      o("draft", "Draft", "Draft"),
      o("confirmed", "Dikonfirmasi", "Confirmed"),
      o("in_progress", "Berjalan", "In progress"),
      o("done", "Selesai", "Done"),
      o("cancel", "Batal", "Cancelled"),
    ]),
    f("quantity", "Kuantitas", "Quantity", "number"),
    f("date_planned", "Tanggal rencana", "Planned date", "date"),
    f("unit_cost", "Biaya per unit", "Unit cost", "number"),
    CREATED,
  ],
};

/** Kolom pengguna penanggung jawab per model (penerima "penanggung jawab"). */
export const RESPONSIBLE_FIELD: Partial<Record<CustomFieldModel, string>> = {
  partner: "salesperson_id",
  employee: "user_id",
  fleet_vehicle: "manager_user_id",
  crm_lead: "user_id",
  sale_order: "user_id",
  purchase_order: "user_id",
};
/** Kolom partner per model (penerima email "partner"). */
export const PARTNER_FIELD: Partial<Record<CustomFieldModel, string>> = {
  partner: "id",
  crm_lead: "partner_id",
  sale_order: "partner_id",
  purchase_order: "partner_id",
  account_move: "partner_id",
  stock_picking: "partner_id",
};

/** Kolom rahasia yang tidak boleh keluar ke template/webhook. */
export const isSecretField = (key: string) =>
  /(_enc|_hash)$/.test(key) || key.startsWith("payslip_") || key === "attendance_pin_hash";

export const ACTIVITY_TYPES_AUTOMATION = ["todo", "call", "meeting", "email"] as const;

const uuid = z.string().uuid();
const tpl = (max: number) => z.string().trim().max(max);

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notify"),
    users: z.array(uuid).max(50).default([]),
    roleIds: z.array(uuid).max(20).default([]),
    responsible: z.boolean().default(false),
    creator: z.boolean().default(false),
    title: tpl(200).min(1, "Judul wajib diisi"),
    body: tpl(2000).default(""),
  }),
  z.object({
    type: z.literal("email"),
    to: z.enum(["partner", "address"]),
    address: z.string().trim().email("Email tidak valid").max(200).nullish(),
    subject: tpl(200).min(1, "Subjek wajib diisi"),
    body: tpl(5000).min(1, "Isi email wajib diisi"),
  }),
  z.object({
    type: z.literal("set_field"),
    field: z.string().trim().min(1).max(60),
    value: tpl(500).default(""),
  }),
  z.object({
    type: z.literal("activity"),
    activityType: z.enum(ACTIVITY_TYPES_AUTOMATION).default("todo"),
    summary: tpl(200).min(1, "Ringkasan wajib diisi"),
    note: tpl(2000).default(""),
    dueInDays: z.number().int().min(0).max(365).default(0),
    assignTo: z.enum(["responsible", "user"]).default("responsible"),
    userId: uuid.nullish(),
  }),
  z.object({
    type: z.literal("approval"),
    categoryId: uuid,
    description: tpl(1000).min(1, "Uraian wajib diisi"),
    amountField: z.string().max(60).nullish(),
  }),
  z.object({
    type: z.literal("webhook"),
    url: z
      .string()
      .trim()
      .url("URL tidak valid")
      .max(500)
      .refine((u) => /^https?:\/\//i.test(u), "URL harus diawali http(s)://"),
  }),
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;
export const AUTOMATION_ACTION_LABEL: Record<AutomationAction["type"], [string, string]> = {
  notify: ["Kirim notifikasi ke pengguna", "Notify users"],
  email: ["Kirim email", "Send email"],
  set_field: ["Ubah field", "Set a field"],
  activity: ["Buat aktivitas", "Create an activity"],
  approval: ["Minta persetujuan", "Request approval"],
  webhook: ["Panggil webhook", "Call a webhook"],
};

export const automationConditionSchema = z.object({
  field: z.string().trim().min(1).max(60),
  op: z.enum(CONDITION_OPS),
  value: z.string().trim().max(500).default(""),
});
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

export const automationRuleSchema = z
  .object({
    name: z.string().trim().min(1, "Nama wajib diisi").max(120),
    description: z.string().trim().max(500).nullish(),
    model: z.enum(CUSTOM_FIELD_MODEL_KEYS),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    conditions: z.array(automationConditionSchema).max(20).default([]),
    onlyWhenChanges: z.boolean().default(false),
    dateField: z.string().trim().max(60).nullish(),
    offsetDays: z.number().int().min(-365).max(365).default(0),
    frequency: z.enum(["daily", "weekly", "monthly"]).nullish(),
    hour: z.number().int().min(0).max(23).default(7),
    weekday: z.number().int().min(1).max(7).nullish(),
    monthday: z.number().int().min(1).max(28).nullish(),
    actions: z.array(automationActionSchema).min(1, "Tambahkan minimal satu aksi").max(10),
    active: z.boolean().default(true),
  })
  .superRefine((r, ctx) => {
    if (r.trigger === "date" && !r.dateField)
      ctx.addIssue({ code: "custom", path: ["dateField"], message: "Pilih kolom tanggal" });
    if (r.trigger === "scheduled") {
      if (!r.frequency) ctx.addIssue({ code: "custom", path: ["frequency"], message: "Pilih frekuensi" });
      if (r.frequency === "weekly" && !r.weekday)
        ctx.addIssue({ code: "custom", path: ["weekday"], message: "Pilih hari" });
      if (r.frequency === "monthly" && !r.monthday)
        ctx.addIssue({ code: "custom", path: ["monthday"], message: "Pilih tanggal" });
    }
    r.actions.forEach((a, i) => {
      if (a.type === "email" && a.to === "address" && !a.address)
        ctx.addIssue({ code: "custom", path: ["actions", i, "address"], message: "Isi alamat email" });
      if (a.type === "activity" && a.assignTo === "user" && !a.userId)
        ctx.addIssue({ code: "custom", path: ["actions", i, "userId"], message: "Pilih pengguna" });
      if (a.type === "notify" && !a.users.length && !a.roleIds.length && !a.responsible && !a.creator)
        ctx.addIssue({ code: "custom", path: ["actions", i, "users"], message: "Pilih penerima" });
    });
  });
export type AutomationRuleInput = z.infer<typeof automationRuleSchema>;

export const automationRunSchema = z.object({ resId: z.string().uuid().optional() });

// ---- Evaluasi ----

/** Nilai field data (`custom.<kunci>` membaca jsonb field kustom). */
export function fieldValue(record: Record<string, unknown>, key: string): unknown {
  if (key.startsWith("custom.")) return ((record.custom ?? {}) as Record<string, unknown>)[key.slice(7)];
  return record[key];
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const asNumber = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").trim()));
const asText = (v: unknown) =>
  Array.isArray(v) ? v.join(",") : v === null || v === undefined ? "" : String(v);

export function matchCondition(record: Record<string, unknown>, c: AutomationCondition): boolean {
  const v = fieldValue(record, c.field);
  if (c.op === "empty") return isEmpty(v);
  if (c.op === "notEmpty") return !isEmpty(v);
  if (c.op === "contains") return asText(v).toLowerCase().includes(c.value.toLowerCase());
  if (c.op === "in")
    return c.value
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .includes(asText(v).toLowerCase());
  const a = asNumber(v);
  const b = asNumber(c.value);
  const numeric = !isEmpty(v) && c.value !== "" && Number.isFinite(a) && Number.isFinite(b);
  if (numeric) return { eq: a === b, ne: a !== b, gt: a > b, gte: a >= b, lt: a < b, lte: a <= b }[c.op];
  const x = asText(v).toLowerCase();
  const y = c.value.toLowerCase();
  // Boolean ditulis ya/tidak atau true/false.
  const norm = (s: string) => ({ ya: "true", yes: "true", tidak: "false", no: "false" })[s] ?? s;
  switch (c.op) {
    case "eq":
      return norm(x) === norm(y);
    case "ne":
      return norm(x) !== norm(y);
    case "gt":
      return x > y;
    case "gte":
      return x >= y;
    case "lt":
      return x < y;
    default:
      return x <= y;
  }
}

/** Semua syarat terpenuhi (tanpa syarat = selalu). */
export const matchConditions = (
  record: Record<string, unknown> | null | undefined,
  conds: AutomationCondition[],
) => !!record && conds.every((c) => matchCondition(record, c));

/**
 * Apakah aturan "diubah" berlaku untuk perubahan ini: syarat terpenuhi pada data baru, dan bila `onlyWhenChanges`
 * maka tidak terpenuhi pada data lama (berubah menjadi terpenuhi).
 */
export function shouldFireOnUpdate(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  conds: AutomationCondition[],
  onlyWhenChanges: boolean,
) {
  if (!matchConditions(after, conds)) return false;
  if (!onlyWhenChanges) return true;
  return !matchConditions(before, conds);
}

/** Ganti `{{kolom}}` / `{{custom.kunci}}` / `{{link}}` dengan nilai data. Kolom rahasia tidak pernah diisi. */
export function renderTemplate(
  template: string,
  record: Record<string, unknown>,
  extra: Record<string, string> = {},
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    if (key in extra) return extra[key]!;
    if (isSecretField(key)) return "";
    const v = fieldValue(record, key);
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "object") return "";
    return String(v);
  });
}

/** Data tanpa kolom rahasia (untuk webhook & tampilan uji coba). */
export function publicRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([k]) => !isSecretField(k)));
}

/** Tanggal target pemicu tanggal: data dengan `field = today − offset` (offset −3 = 3 hari sebelum tanggal). */
export function dateTriggerTarget(today: string, offsetDays: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);
}
