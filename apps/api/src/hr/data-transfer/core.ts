import { and, eq, schema, type Db } from "@erp/db";
import type { Permission } from "@erp/shared";
import type { ZodTypeAny, z } from "zod";

/** Kolom dataset impor/ekspor. `header` = judul kolom berkas (Bahasa Indonesia). */
export interface Column {
  key: string;
  header: string;
  group: string;
  required?: boolean;
  example?: string;
  note?: string;
  /** NIK, NPWP, No. KK, rekening: hanya untuk pemegang hak kelola. */
  sensitive?: boolean;
  numeric?: boolean;
  /** Kolom kunci: selalu ikut diekspor agar berkas bisa diimpor ulang. */
  key0?: boolean;
}

export interface Ctx {
  companyId: string;
  /** Boleh melihat/mengubah data sensitif. */
  manage: boolean;
  timeZone: string;
  runId?: string;
}

export type Outcome = "created" | "updated" | "skipped";
export type Row = Record<string, string>;

export interface Dataset {
  key: string;
  label: string;
  description: string;
  app: "hr" | "payroll";
  read: Permission;
  /** Tanpa `write` = hanya ekspor. */
  write?: Permission;
  /** Hak membuat profil ekspor bersama. */
  admin: Permission;
  needsRun?: boolean;
  filters?: {
    key: string;
    label: string;
    type: "date" | "select" | "ref";
    options?: [string, string][];
    resource?: string;
  }[];
  columns(tx: Db, ctx: Ctx): Promise<Column[]> | Column[];
  rows(tx: Db, ctx: Ctx, query: Record<string, string | undefined>): Promise<Record<string, unknown>[]>;
  /** Proses satu baris (dalam savepoint). */
  importRow?(tx: Db, row: Row, ctx: Ctx, lookups: Lookups): Promise<Outcome>;
  /** Alternatif `importRow` untuk dataset yang diproses berkelompok (mis. input slip per karyawan). */
  importAll?(
    tx: Db,
    rows: { line: number; row: Row }[],
    ctx: Ctx,
    lookups: Lookups,
    fail: (line: number, column: string, message: string) => void,
  ): Promise<Record<Outcome, number>>;
}

/** Kesalahan nilai pada satu kolom baris impor. */
export class RowError extends Error {
  constructor(
    readonly column: string,
    message: string,
  ) {
    super(message);
  }
}

// ---- Nilai pilihan: kode ↔ label Indonesia (impor menerima kode atau label/alias) ----

export const ENUMS: Record<string, Record<string, string[]>> = {
  gender: { male: ["Laki-laki", "L", "pria", "male"], female: ["Perempuan", "P", "wanita", "female"] },
  religion: {
    islam: ["Islam"],
    protestant: ["Kristen Protestan", "Kristen", "Protestan", "protestant"],
    catholic: ["Katolik", "Katholik", "catholic"],
    hindu: ["Hindu"],
    buddha: ["Buddha", "Budha"],
    confucian: ["Konghucu", "Khonghucu", "confucian"],
    other: ["Lainnya", "other"],
  },
  maritalStatus: {
    single: ["Belum kawin", "Lajang", "single"],
    married: ["Kawin", "Menikah", "married"],
    divorced: ["Cerai hidup", "Cerai", "divorced"],
    widowed: ["Cerai mati", "widowed"],
  },
  bloodType: { A: ["A"], B: ["B"], AB: ["AB"], O: ["O"] },
  rhesus: { "+": ["+", "Positif"], "-": ["-", "Negatif"] },
  ptkpStatus: Object.fromEntries(
    ["TK/0", "TK/1", "TK/2", "TK/3", "K/0", "K/1", "K/2", "K/3"].map((s) => [s, [s]]),
  ),
  contractType: { pkwt: ["PKWT", "Kontrak"], pkwtt: ["PKWTT", "Tetap"] },
  wageType: { monthly: ["Bulanan", "monthly"], daily: ["Harian", "daily"], piece: ["Borongan", "piece"] },
  relation: {
    spouse: ["Suami/istri", "Suami", "Istri", "spouse"],
    child: ["Anak", "child"],
    father: ["Ayah", "Bapak", "father"],
    mother: ["Ibu", "mother"],
    sibling: ["Saudara kandung", "Saudara", "sibling"],
    other: ["Lainnya", "other"],
  },
  level: {
    sd: ["SD"],
    smp: ["SMP", "SLTP"],
    sma: ["SMA/SMK", "SMA", "SMK", "SLTA", "MA"],
    d1: ["D1"],
    d2: ["D2"],
    d3: ["D3"],
    d4: ["D4"],
    s1: ["S1"],
    s2: ["S2"],
    s3: ["S3"],
    other: ["Lainnya", "other"],
  },
  dayType: { workday: ["Hari kerja", "kerja", "workday"], rest_day: ["Hari libur", "libur", "rest_day"] },
  leaveState: {
    confirm: ["Menunggu persetujuan"],
    approved: ["Disetujui"],
    refused: ["Ditolak"],
    cancel: ["Dibatalkan"],
  },
  overtimeState: { confirm: ["Menunggu persetujuan"], approved: ["Disetujui"], refused: ["Ditolak"] },
  contractState: { draft: ["Draft"], running: ["Berjalan"], closed: ["Selesai"], cancel: ["Batal"] },
  source: { web: ["Web/portal"], manual: ["Input HR"], import: ["Impor"] },
};

/** Label tampilan (alias pertama) sebuah kode pilihan. */
export const label = (field: string, code: string | null | undefined) =>
  code === null || code === undefined ? "" : (ENUMS[field]?.[code]?.[0] ?? code);

export const choices = (field: string) =>
  Object.values(ENUMS[field] ?? {})
    .map((a) => a[0])
    .join(", ");

/** Kode pilihan dari teks sel (kode atau label/alias, tanpa beda huruf besar-kecil). */
export function code(field: string, column: string, raw: string) {
  const value = raw.trim().toLowerCase();
  for (const [c, aliases] of Object.entries(ENUMS[field] ?? {}))
    if (c.toLowerCase() === value || aliases.some((a) => a.toLowerCase() === value)) return c;
  throw new RowError(column, `Nilai "${raw}" tidak dikenal (pilihan: ${choices(field)})`);
}

const TRUE = new Set(["ya", "y", "yes", "true", "1", "x", "✓"]);
const FALSE = new Set(["tidak", "t", "no", "false", "0", "n", "-"]);

export function bool(column: string, raw: string) {
  const v = raw.trim().toLowerCase();
  if (TRUE.has(v)) return true;
  if (FALSE.has(v)) return false;
  throw new RowError(column, `Isi "ya" atau "tidak", bukan "${raw}"`);
}

/** Tanggal YYYY-MM-DD; juga menerima DD/MM/YYYY atau DD-MM-YYYY (format Excel Indonesia). */
export function date(column: string, raw: string) {
  const v = raw.trim();
  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
  const dmy = ymd ? null : /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  const parts = ymd ? [ymd[1], ymd[2], ymd[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : null;
  const iso = parts ? `${parts[0]}-${parts[1]!.padStart(2, "0")}-${parts[2]!.padStart(2, "0")}` : null;
  if (
    !iso ||
    Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ||
    new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso
  )
    throw new RowError(column, `Tanggal "${raw}" tidak valid (gunakan YYYY-MM-DD atau DD/MM/YYYY)`);
  return iso;
}

/** Angka: "1500000", "1.500.000", "1,5" atau "1.500.000,50" (format Indonesia). */
export function num(column: string, raw: string) {
  let v = raw.trim().replace(/\s|Rp/gi, "");
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(v)) v = v.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(v)) v = v.replace(/,/g, "");
  else if (/^-?\d+,\d+$/.test(v)) v = v.replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new RowError(column, `Angka "${raw}" tidak valid`);
  return v;
}

/** Jam HH:MM (menerima juga 8.05 atau 08:05:30). */
export function time(column: string, raw: string) {
  const m = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?$/.exec(raw.trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59)
    throw new RowError(column, `Jam "${raw}" tidak valid (HH:MM)`);
  return `${m[1]!.padStart(2, "0")}:${m[2]}${m[3] ? `:${m[3]}` : ""}`;
}

/** Validasi zod; kesalahan dipetakan ke kolom (path pertama). */
export function validate<S extends ZodTypeAny>(
  zod: S,
  input: unknown,
  fieldColumn: Record<string, string> = {},
) {
  const result = zod.safeParse(input);
  if (result.success) return result.data as z.infer<S>;
  const issue = result.error.issues[0]!;
  const path = String(issue.path[0] ?? "");
  throw new RowError(fieldColumn[path] ?? path, issue.message);
}

// ---- Rujukan berdasarkan nama/kode ----

type RefKind = "departments" | "jobs" | "grades" | "branches" | "schedules" | "leaveTypes" | "components";

const REF_LABEL: Record<RefKind, string> = {
  departments: "Departemen",
  jobs: "Jabatan",
  grades: "Golongan",
  branches: "Cabang",
  schedules: "Jadwal kerja",
  leaveTypes: "Jenis cuti",
  components: "Komponen gaji",
};

/** Cache rujukan per impor: nama/kode → id; karyawan per No. Karyawan. */
export class Lookups {
  private refs = new Map<RefKind, { id: string; name: string; code?: string | null }[]>();
  private employees?: Map<string, typeof schema.employees.$inferSelect>;

  constructor(
    private readonly tx: Db,
    private readonly companyId: string,
  ) {}

  async list(kind: RefKind) {
    let rows = this.refs.get(kind);
    if (!rows) {
      const c = this.companyId;
      rows =
        kind === "departments"
          ? await this.tx
              .select({ id: schema.departments.id, name: schema.departments.name })
              .from(schema.departments)
              .where(eq(schema.departments.companyId, c))
          : kind === "jobs"
            ? await this.tx
                .select({ id: schema.jobPositions.id, name: schema.jobPositions.name })
                .from(schema.jobPositions)
            : kind === "grades"
              ? await this.tx
                  .select({
                    id: schema.salaryGrades.id,
                    name: schema.salaryGrades.name,
                    code: schema.salaryGrades.code,
                  })
                  .from(schema.salaryGrades)
              : kind === "branches"
                ? await this.tx
                    .select({
                      id: schema.branches.id,
                      name: schema.branches.name,
                      code: schema.branches.code,
                    })
                    .from(schema.branches)
                    .where(eq(schema.branches.companyId, c))
                : kind === "schedules"
                  ? await this.tx
                      .select({ id: schema.workSchedules.id, name: schema.workSchedules.name })
                      .from(schema.workSchedules)
                      .where(eq(schema.workSchedules.companyId, c))
                  : kind === "leaveTypes"
                    ? await this.tx
                        .select({ id: schema.leaveTypes.id, name: schema.leaveTypes.name })
                        .from(schema.leaveTypes)
                    : await this.tx
                        .select({
                          id: schema.salaryComponents.id,
                          name: schema.salaryComponents.name,
                          code: schema.salaryComponents.code,
                        })
                        .from(schema.salaryComponents)
                        .where(eq(schema.salaryComponents.companyId, c));
      this.refs.set(kind, rows);
    }
    return rows;
  }

  /** Id rujukan dari nama atau kode (tanpa beda huruf besar-kecil). */
  async ref(kind: RefKind, column: string, raw: string) {
    const v = raw.trim().toLowerCase();
    const rows = await this.list(kind);
    const hit =
      rows.find((r) => r.code?.toLowerCase() === v) ??
      rows.filter((r) => r.name.trim().toLowerCase() === v)[0];
    if (!hit) throw new RowError(column, `${REF_LABEL[kind]} "${raw}" tidak ditemukan`);
    return hit.id;
  }

  private async employeeMap() {
    if (!this.employees) {
      const rows = await this.tx
        .select()
        .from(schema.employees)
        .where(eq(schema.employees.companyId, this.companyId));
      this.employees = new Map(rows.map((r) => [r.employeeNumber.trim().toLowerCase(), r]));
    }
    return this.employees;
  }

  async findEmployee(number: string) {
    return (await this.employeeMap()).get(number.trim().toLowerCase()) ?? null;
  }

  async employee(column: string, number: string) {
    const row = await this.findEmployee(number);
    if (!row) throw new RowError(column, `Karyawan dengan No. Karyawan "${number}" tidak ditemukan`);
    return row;
  }

  /** Daftarkan karyawan yang baru dibuat/diubah agar baris berikutnya (mis. atasan) bisa merujuknya. */
  async remember(row: typeof schema.employees.$inferSelect) {
    (await this.employeeMap()).set(row.employeeNumber.trim().toLowerCase(), row);
  }
}

/** Nama rujukan per id (untuk ekspor). */
export async function names(tx: Db, companyId: string) {
  const l = new Lookups(tx, companyId);
  const map = async (kind: RefKind, useCode = false) =>
    new Map((await l.list(kind)).map((r) => [r.id, useCode && r.code ? r.code : r.name]));
  return {
    departments: await map("departments"),
    jobs: await map("jobs"),
    grades: await map("grades", true),
    branches: await map("branches"),
    schedules: await map("schedules"),
    leaveTypes: await map("leaveTypes"),
  };
}

/** Karyawan perusahaan untuk ekspor (dengan filter umum). */
export function employeeFilter(companyId: string, query: Record<string, string | undefined>) {
  const E = schema.employees;
  return and(
    eq(E.companyId, companyId),
    query.active === "inactive"
      ? eq(E.active, false)
      : query.active === "all"
        ? undefined
        : eq(E.active, true),
    query.departmentId ? eq(E.departmentId, query.departmentId) : undefined,
    query.branchId ? eq(E.branchId, query.branchId) : undefined,
    query.jobId ? eq(E.jobId, query.jobId) : undefined,
  );
}

/** Periode filter (YYYY-MM-DD); bawaan bulan berjalan. */
export function period(query: Record<string, string | undefined>) {
  const today = new Date().toISOString().slice(0, 10);
  const from = query.from || `${today.slice(0, 7)}-01`;
  const [y, m] = from.split("-").map(Number);
  const to = query.to || new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from)
    throw new RowError("from", "Periode tidak valid");
  return { from, to };
}
