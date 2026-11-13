import { z } from "zod";

/** Data yang bisa diberi field kustom: master + dokumen utama. */
export const CUSTOM_FIELD_MODELS = {
  partner: { label: ["Kontak", "Contact"], read: "partner.read", write: "partner.write" },
  product: { label: ["Produk", "Product"], read: "product.read", write: "product.write" },
  employee: { label: ["Karyawan", "Employee"], read: "hr.read", write: "hr.write" },
  fleet_vehicle: { label: ["Kendaraan", "Vehicle"], read: "fleet.read", write: "fleet.write" },
  crm_lead: { label: ["Lead / peluang", "Lead / opportunity"], read: "crm.read", write: "crm.write" },
  sale_order: { label: ["Pesanan penjualan", "Sales order"], read: "sales.read", write: "sales.write" },
  purchase_order: {
    label: ["Pesanan pembelian", "Purchase order"],
    read: "purchase.read",
    write: "purchase.write",
  },
  account_move: {
    label: ["Faktur, tagihan & jurnal", "Invoices, bills & entries"],
    read: "accounting.read",
    write: "accounting.write",
  },
  stock_picking: {
    label: ["Transfer stok", "Stock transfer"],
    read: "inventory.read",
    write: "inventory.write",
  },
  production_order: {
    label: ["Order produksi", "Manufacturing order"],
    read: "mrp.read",
    write: "mrp.write",
  },
} as const satisfies Record<string, { label: [string, string]; read: string; write: string }>;
export type CustomFieldModel = keyof typeof CUSTOM_FIELD_MODELS;
export const CUSTOM_FIELD_MODEL_KEYS = Object.keys(CUSTOM_FIELD_MODELS) as [
  CustomFieldModel,
  ...CustomFieldModel[],
];

export const CUSTOM_FIELD_TYPES = {
  text: ["Teks singkat", "Short text"],
  textarea: ["Teks panjang", "Long text"],
  number: ["Angka", "Number"],
  money: ["Nominal uang", "Amount"],
  date: ["Tanggal", "Date"],
  boolean: ["Ya/Tidak", "Yes/No"],
  select: ["Pilihan", "Selection"],
  multiselect: ["Pilihan ganda", "Multiple selection"],
  url: ["Tautan (URL)", "Link (URL)"],
  email: ["Email", "Email"],
  ref: ["Rujukan data", "Record reference"],
} as const satisfies Record<string, [string, string]>;
export type CustomFieldType = keyof typeof CUSTOM_FIELD_TYPES;
const TYPE_KEYS = Object.keys(CUSTOM_FIELD_TYPES) as [CustomFieldType, ...CustomFieldType[]];

export const CUSTOM_REF_MODELS = {
  partner: ["Kontak", "Contact"],
  product: ["Produk", "Product"],
  employee: ["Karyawan", "Employee"],
  user: ["Pengguna", "User"],
} as const satisfies Record<string, [string, string]>;
export type CustomRefModel = keyof typeof CUSTOM_REF_MODELS;
const REF_KEYS = Object.keys(CUSTOM_REF_MODELS) as [CustomRefModel, ...CustomRefModel[]];

export interface CustomFieldDef {
  key: string;
  label: string;
  labelEn?: string | null;
  fieldType: CustomFieldType;
  options?: { value: string; label: string }[];
  refModel?: CustomRefModel | null;
  required?: boolean;
  defaultValue?: unknown;
  help?: string | null;
  section?: string | null;
  sequence?: number;
  showInList?: boolean;
  showOnPdf?: boolean;
  active?: boolean;
}

const optionSchema = z.object({
  value: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(80),
});

export const customFieldSchema = z
  .object({
    model: z.enum(CUSTOM_FIELD_MODEL_KEYS),
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, "Huruf kecil, angka, garis bawah; diawali huruf (maks. 40)"),
    label: z.string().trim().min(1).max(80),
    labelEn: z.string().trim().max(80).nullish(),
    fieldType: z.enum(TYPE_KEYS),
    options: z.array(optionSchema).max(100).default([]),
    refModel: z.enum(REF_KEYS).nullish(),
    required: z.boolean().default(false),
    defaultValue: z.unknown().optional(),
    help: z.string().trim().max(300).nullish(),
    section: z.string().trim().max(60).nullish(),
    sequence: z.number().int().min(0).max(9999).default(0),
    showInList: z.boolean().default(false),
    showOnPdf: z.boolean().default(false),
    active: z.boolean().default(true),
    companyId: z.string().uuid().nullish(),
  })
  .superRefine((v, ctx) => {
    const choice = v.fieldType === "select" || v.fieldType === "multiselect";
    if (choice && v.options.length === 0)
      ctx.addIssue({ code: "custom", path: ["options"], message: "Isi minimal satu pilihan" });
    if (new Set(v.options.map((o) => o.value)).size !== v.options.length)
      ctx.addIssue({ code: "custom", path: ["options"], message: "Nilai pilihan tidak boleh ganda" });
    if (v.fieldType === "ref" && !v.refModel)
      ctx.addIssue({ code: "custom", path: ["refModel"], message: "Pilih jenis data yang dirujuk" });
    if (v.defaultValue !== undefined && v.defaultValue !== null && v.defaultValue !== "") {
      if (v.fieldType === "ref")
        ctx.addIssue({
          code: "custom",
          path: ["defaultValue"],
          message: "Rujukan tidak bisa diberi nilai bawaan",
        });
      else {
        const r = coerceCustomValue({ ...v, refModel: v.refModel ?? null }, v.defaultValue);
        if ("error" in r) ctx.addIssue({ code: "custom", path: ["defaultValue"], message: r.error });
      }
    }
  });
export type CustomFieldInput = z.infer<typeof customFieldSchema>;

/** Nilai field kustom yang dikirim bersama data: `{ kunci: nilai }`. */
export const customValuesInput = z.record(z.string(), z.unknown());

export const customValuesUpdateSchema = z.object({ custom: customValuesInput });

const empty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validasi & normalisasi satu nilai; kosong → `{ value: null }`. */
export function coerceCustomValue(def: CustomFieldDef, raw: unknown): { value: unknown } | { error: string } {
  if (empty(raw)) return { value: null };
  switch (def.fieldType) {
    case "text":
    case "textarea": {
      const s = String(raw).trim();
      const max = def.fieldType === "text" ? 200 : 5000;
      return s.length > max ? { error: `Maksimal ${max} karakter` } : { value: s || null };
    }
    case "number":
    case "money": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim().replace(",", "."));
      if (!Number.isFinite(n)) return { error: "Harus berupa angka" };
      return { value: def.fieldType === "money" ? Math.round(n * 100) / 100 : n };
    }
    case "date": {
      const s = String(raw).trim().slice(0, 10);
      const d = new Date(`${s}T00:00:00Z`);
      if (!DATE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s)
        return { error: "Tanggal tidak valid" };
      return { value: s };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      const s = String(raw).trim().toLowerCase();
      if (["1", "true", "ya", "yes", "y"].includes(s)) return { value: true };
      if (["0", "false", "tidak", "no", "n"].includes(s)) return { value: false };
      return { error: "Harus ya atau tidak" };
    }
    case "select": {
      const s = String(raw).trim();
      const opt = (def.options ?? []).find((o) => o.value === s || o.label.toLowerCase() === s.toLowerCase());
      return opt ? { value: opt.value } : { error: "Pilihan tidak dikenal" };
    }
    case "multiselect": {
      const list = Array.isArray(raw)
        ? raw.map(String)
        : String(raw)
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter(Boolean);
      const out: string[] = [];
      for (const s of list) {
        const opt = (def.options ?? []).find(
          (o) => o.value === s || o.label.toLowerCase() === s.toLowerCase(),
        );
        if (!opt) return { error: `Pilihan tidak dikenal: ${s}` };
        if (!out.includes(opt.value)) out.push(opt.value);
      }
      return { value: out.length ? out : null };
    }
    case "url": {
      const s = String(raw).trim();
      return /^https?:\/\/\S+$/i.test(s) && s.length <= 500
        ? { value: s }
        : { error: "URL harus diawali http(s)://" };
    }
    case "email": {
      const s = String(raw).trim().toLowerCase();
      return EMAIL.test(s) && s.length <= 200 ? { value: s } : { error: "Email tidak valid" };
    }
    case "ref": {
      const s = String(raw).trim();
      return UUID.test(s) ? { value: s } : { error: "Rujukan tidak valid" };
    }
  }
}

export interface CoercedCustom {
  values: Record<string, unknown>;
  errors: Record<string, string>;
  /** Rujukan yang perlu dicek keberadaannya (RLS) oleh pemanggil. */
  refs: { key: string; model: CustomRefModel; id: string }[];
}

/**
 * Gabungkan nilai kiriman ke nilai tersimpan. Hanya field aktif yang bisa diubah; nilai field nonaktif/terhapus
 * dibiarkan. Data baru (`existing` undefined) memakai nilai bawaan untuk field yang tidak dikirim. Field wajib dicek
 * setelah digabung, kecuali `skipRequired` (data yang dibuat sistem, mis. faktur dari pesanan).
 */
export function coerceCustomValues(
  defs: CustomFieldDef[],
  input: Record<string, unknown> | undefined | null,
  existing?: Record<string, unknown> | null,
  opts: { skipRequired?: boolean } = {},
): CoercedCustom {
  const active = defs.filter((d) => d.active !== false);
  const byKey = new Map(active.map((d) => [d.key, d]));
  const values: Record<string, unknown> = { ...(existing ?? {}) };
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input ?? {})) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = "Field kustom tidak dikenal";
      continue;
    }
    const r = coerceCustomValue(def, raw);
    if ("error" in r) errors[key] = r.error;
    else if (r.value === null) delete values[key];
    else values[key] = r.value;
  }
  if (!existing)
    for (const d of active)
      if (!(d.key in (input ?? {})) && !empty(d.defaultValue)) {
        const r = coerceCustomValue(d, d.defaultValue);
        if ("value" in r && r.value !== null) values[d.key] = r.value;
      }
  if (!opts.skipRequired)
    for (const d of active)
      if (d.required && empty(values[d.key]) && !errors[d.key]) errors[d.key] = "Wajib diisi";
  const refs = active
    .filter((d) => d.fieldType === "ref" && d.refModel && typeof values[d.key] === "string" && !errors[d.key])
    .map((d) => ({ key: d.key, model: d.refModel as CustomRefModel, id: values[d.key] as string }));
  return { values, errors, refs };
}

/** Teks tampilan nilai untuk daftar, ekspor, & PDF (rujukan memakai `refNames`). */
export function formatCustomValue(
  def: CustomFieldDef,
  value: unknown,
  opts: { lang?: "id" | "en"; refNames?: Record<string, string> } = {},
): string {
  if (empty(value)) return "";
  const en = opts.lang === "en";
  const optLabel = (v: string) => (def.options ?? []).find((o) => o.value === v)?.label ?? v;
  switch (def.fieldType) {
    case "boolean":
      return value ? (en ? "Yes" : "Ya") : en ? "No" : "Tidak";
    case "select":
      return optLabel(String(value));
    case "multiselect":
      return (Array.isArray(value) ? value : [value]).map((v) => optLabel(String(v))).join("; ");
    case "money":
    case "number":
      return Number(value).toLocaleString(en ? "en-US" : "id-ID", { maximumFractionDigits: 4 });
    case "ref":
      return opts.refNames?.[String(value)] ?? String(value);
    default:
      return String(value);
  }
}

/** Label sesuai bahasa. */
export const customFieldLabel = (def: CustomFieldDef, lang: "id" | "en" = "id") =>
  (lang === "en" && def.labelEn) || def.label;

/** Kolom ekspor/impor untuk field kustom: `custom.<kunci>`. */
export const customColumnName = (key: string) => `custom.${key}`;
