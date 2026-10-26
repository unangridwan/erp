import { and, asc, eq, gte, inArray, lte, schema, sql, type Db } from "@erp/db";
import {
  addDays,
  contractSchema,
  employeeEducationSchema,
  employeeFamilySchema,
  employeeSchema,
  leaveAllocationSchema,
  localTime,
  overtimeSchema,
  zonedToUtc,
} from "@erp/shared";
import { localDate } from "../schedule.service.js";
import type { ChecklistService } from "../checklist.service.js";
import type { ContractService } from "../contract.service.js";
import type { EmployeeService } from "../employee.service.js";
import type { HistoryService } from "../history.service.js";
import { applyOvertimeApproval } from "../hr.module.js";
import {
  bool,
  code,
  date,
  employeeFilter,
  label,
  names,
  num,
  period,
  RowError,
  time,
  validate,
  type Column,
  type Ctx,
  type Dataset,
  type Lookups,
  type Row,
} from "./core.js";

const E = schema.employees;
const EMP_NO: Column = {
  key: "employeeNumber",
  header: "No. Karyawan",
  group: "Karyawan",
  required: true,
  example: "EMP/2024/0001",
  key0: true,
};
const EMP_NAME: Column = {
  key: "employeeName",
  header: "Nama Karyawan",
  group: "Karyawan",
  note: "Hanya info; diabaikan saat impor",
};

const get = (row: Row, key: string) => (row[key] ?? "").trim();
const today = () => new Date().toISOString().slice(0, 10);

export interface HrServices {
  employees: EmployeeService;
  history: HistoryService;
  checklists: ChecklistService;
  contracts: ContractService;
}

// ---- Karyawan ----

const EMPLOYEE_COLUMNS: Column[] = [
  {
    ...EMP_NO,
    required: false,
    note: "Kosong = karyawan baru dengan nomor otomatis; terisi & ada = diperbarui",
  },
  { key: "name", header: "Nama", group: "Pekerjaan", required: true, example: "Dewi Lestari" },
  {
    key: "department",
    header: "Departemen",
    group: "Pekerjaan",
    example: "Keuangan",
    note: "Nama departemen",
  },
  { key: "job", header: "Jabatan", group: "Pekerjaan", example: "Staf", note: "Nama jabatan" },
  { key: "grade", header: "Golongan", group: "Pekerjaan", note: "Kode atau nama golongan upah" },
  { key: "managerNumber", header: "No. Karyawan Atasan", group: "Pekerjaan" },
  { key: "branch", header: "Cabang", group: "Pekerjaan", note: "Kode atau nama cabang" },
  { key: "schedule", header: "Jadwal Kerja", group: "Pekerjaan" },
  { key: "workEmail", header: "Email Kerja", group: "Pekerjaan" },
  { key: "workPhone", header: "Telepon Kerja", group: "Pekerjaan" },
  { key: "joinDate", header: "Tanggal Masuk", group: "Pekerjaan", required: true, example: "2024-01-15" },
  { key: "resignDate", header: "Tanggal Keluar", group: "Pekerjaan" },
  { key: "active", header: "Aktif", group: "Pekerjaan", example: "ya", note: "ya/tidak" },
  { key: "nik", header: "NIK", group: "Identitas & Pajak", sensitive: true, example: "3201010101010001" },
  { key: "kkNo", header: "No. KK", group: "Identitas & Pajak", sensitive: true },
  { key: "npwp", header: "NPWP", group: "Identitas & Pajak", sensitive: true },
  { key: "ptkpStatus", header: "Status PTKP", group: "Identitas & Pajak", example: "TK/0" },
  { key: "bpjsKesNo", header: "No. BPJS Kesehatan", group: "BPJS Kesehatan" },
  {
    key: "bpjsKesEnrolled",
    header: "Peserta BPJS Kesehatan",
    group: "BPJS Kesehatan",
    example: "ya",
    note: "ya/tidak",
  },
  { key: "bpjsKesDate", header: "Tgl Kepesertaan BPJS Kesehatan", group: "BPJS Kesehatan" },
  { key: "bpjsKesClass", header: "Kelas BPJS Kesehatan", group: "BPJS Kesehatan", note: "1, 2, atau 3" },
  { key: "bpjsKesFacility", header: "Faskes Tingkat 1", group: "BPJS Kesehatan" },
  { key: "bpjsTkNo", header: "No. BPJS Ketenagakerjaan (KPJ)", group: "BPJS Ketenagakerjaan" },
  {
    key: "bpjsTkEnrolled",
    header: "Peserta BPJS Ketenagakerjaan",
    group: "BPJS Ketenagakerjaan",
    example: "ya",
    note: "ya/tidak (JHT, JKK, JKM)",
  },
  { key: "bpjsTkDate", header: "Tgl Kepesertaan BPJS Ketenagakerjaan", group: "BPJS Ketenagakerjaan" },
  {
    key: "bpjsJpEnrolled",
    header: "Ikut Jaminan Pensiun",
    group: "BPJS Ketenagakerjaan",
    example: "ya",
    note: "ya/tidak",
  },
  { key: "birthPlace", header: "Tempat Lahir", group: "Biodata", example: "Bandung" },
  { key: "birthDate", header: "Tanggal Lahir", group: "Biodata", example: "1993-05-12" },
  { key: "gender", header: "Jenis Kelamin", group: "Biodata", example: "Perempuan" },
  { key: "religion", header: "Agama", group: "Biodata" },
  { key: "maritalStatus", header: "Status Pernikahan", group: "Biodata" },
  { key: "bloodType", header: "Golongan Darah", group: "Biodata" },
  { key: "rhesus", header: "Rhesus", group: "Biodata" },
  { key: "nationality", header: "Kewarganegaraan", group: "Biodata" },
  { key: "heightCm", header: "Tinggi (cm)", group: "Biodata", numeric: true },
  { key: "weightKg", header: "Berat (kg)", group: "Biodata", numeric: true },
  { key: "address", header: "Alamat KTP", group: "Kontak" },
  { key: "domicileAddress", header: "Alamat Domisili", group: "Kontak" },
  { key: "personalPhone", header: "No. HP Pribadi", group: "Kontak" },
  { key: "personalEmail", header: "Email Pribadi", group: "Kontak" },
  { key: "emergencyContact", header: "Kontak Darurat", group: "Kontak" },
  { key: "emergencyPhone", header: "Telepon Kontak Darurat", group: "Kontak" },
  { key: "bankName", header: "Bank", group: "Rekening", example: "BCA" },
  { key: "bankAccount", header: "No. Rekening", group: "Rekening", sensitive: true },
  { key: "bankAccountName", header: "Nama Pemilik Rekening", group: "Rekening" },
];

const ENUM_FIELDS = ["gender", "religion", "maritalStatus", "bloodType", "rhesus", "ptkpStatus"] as const;
const TEXT_FIELDS = [
  "name",
  "workEmail",
  "workPhone",
  "nik",
  "kkNo",
  "npwp",
  "bpjsKesNo",
  "bpjsKesFacility",
  "bpjsTkNo",
  "birthPlace",
  "nationality",
  "address",
  "domicileAddress",
  "personalPhone",
  "personalEmail",
  "emergencyContact",
  "emergencyPhone",
  "bankName",
  "bankAccount",
  "bankAccountName",
] as const;
const SENSITIVE = new Set(["nik", "kkNo", "npwp", "bankAccount"]);

/** Isi kolom karyawan dari satu baris; sel kosong = tidak diubah (untuk data yang sudah ada). */
async function employeeInput(row: Row, ctx: Ctx, lookups: Lookups) {
  const input: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) {
    const v = get(row, f);
    if (!v) continue;
    if (SENSITIVE.has(f) && !ctx.manage)
      throw new RowError(f, "Kolom data pribadi hanya bisa diimpor pemegang hr.manage");
    input[f] = v;
  }
  for (const f of ENUM_FIELDS) if (get(row, f)) input[f] = code(f, f, get(row, f));
  for (const f of ["joinDate", "resignDate", "birthDate", "bpjsKesDate", "bpjsTkDate"])
    if (get(row, f)) input[f] = date(f, get(row, f));
  for (const f of ["bpjsKesEnrolled", "bpjsTkEnrolled", "bpjsJpEnrolled"])
    if (get(row, f)) input[f] = bool(f, get(row, f));
  if (get(row, "bpjsKesClass")) input.bpjsKesClass = Number(num("bpjsKesClass", get(row, "bpjsKesClass")));
  for (const f of ["heightCm", "weightKg"]) if (get(row, f)) input[f] = Number(num(f, get(row, f)));
  if (get(row, "active")) input.active = bool("active", get(row, "active"));
  if (get(row, "department"))
    input.departmentId = await lookups.ref("departments", "department", get(row, "department"));
  if (get(row, "job")) input.jobId = await lookups.ref("jobs", "job", get(row, "job"));
  if (get(row, "grade")) input.gradeId = await lookups.ref("grades", "grade", get(row, "grade"));
  if (get(row, "branch")) input.branchId = await lookups.ref("branches", "branch", get(row, "branch"));
  if (get(row, "schedule"))
    input.scheduleId = await lookups.ref("schedules", "schedule", get(row, "schedule"));
  if (get(row, "managerNumber"))
    input.managerId = (await lookups.employee("managerNumber", get(row, "managerNumber"))).id;
  return input;
}

const FIELD_COLUMN: Record<string, string> = {
  departmentId: "department",
  jobId: "job",
  gradeId: "grade",
  branchId: "branch",
  scheduleId: "schedule",
  managerId: "managerNumber",
  businessUnitId: "branch",
};

/** Kesalahan validasi layanan (fieldError) → kesalahan kolom baris. */
function rethrow(e: unknown): never {
  const res = (e as { getResponse?: () => unknown }).getResponse?.() as
    { message?: string; errors?: { path: string; message: string }[] } | undefined;
  const first = res?.errors?.[0];
  if (first) throw new RowError(FIELD_COLUMN[first.path] ?? first.path, first.message);
  if (res?.message) throw new RowError("", String(res.message));
  throw e;
}

function employeesDataset(svc: HrServices): Dataset {
  return {
    key: "employees",
    label: "Data karyawan",
    description: "Data induk karyawan: pekerjaan, identitas & pajak, biodata, kontak, rekening.",
    app: "hr",
    read: "hr.read",
    write: "hr.write",
    admin: "hr.manage",
    filters: [
      {
        key: "active",
        label: "Status",
        type: "select",
        options: [
          ["active", "Aktif"],
          ["inactive", "Tidak aktif"],
          ["all", "Semua"],
        ],
      },
      { key: "departmentId", label: "Departemen", type: "ref", resource: "departments" },
      { key: "branchId", label: "Cabang", type: "ref", resource: "branches" },
      { key: "jobId", label: "Jabatan", type: "ref", resource: "job-positions" },
    ],
    columns: () => EMPLOYEE_COLUMNS,
    async rows(tx, ctx, query) {
      const rows = await tx.select().from(E).where(employeeFilter(ctx.companyId, query)).orderBy(asc(E.name));
      const n = await names(tx, ctx.companyId);
      const numbers = new Map(
        (
          await tx.select({ id: E.id, no: E.employeeNumber }).from(E).where(eq(E.companyId, ctx.companyId))
        ).map((r) => [r.id, r.no]),
      );
      return rows.map((r) => {
        const open = svc.employees.decrypted(r);
        return {
          ...open,
          department: r.departmentId ? n.departments.get(r.departmentId) : "",
          job: r.jobId ? n.jobs.get(r.jobId) : "",
          grade: r.gradeId ? n.grades.get(r.gradeId) : "",
          branch: r.branchId ? n.branches.get(r.branchId) : "",
          schedule: r.scheduleId ? n.schedules.get(r.scheduleId) : "",
          managerNumber: r.managerId ? numbers.get(r.managerId) : "",
          active: r.active ? "ya" : "tidak",
          bpjsKesEnrolled: r.bpjsKesEnrolled ? "ya" : "tidak",
          bpjsTkEnrolled: r.bpjsTkEnrolled ? "ya" : "tidak",
          bpjsJpEnrolled: r.bpjsJpEnrolled ? "ya" : "tidak",
          ...Object.fromEntries(ENUM_FIELDS.map((f) => [f, label(f, r[f])])),
        };
      });
    },
    async importRow(tx, row, ctx, lookups) {
      const input = await employeeInput(row, ctx, lookups);
      const number = get(row, "employeeNumber");
      const existing = number ? await lookups.findEmployee(number) : null;
      try {
        if (existing) {
          const sent = validate(employeeSchema.partial().strip(), input) as Record<string, unknown>;
          // Kunci yang tidak dikirim di baris tidak boleh ikut diisi default skema (mis. PTKP, aktif).
          const values = Object.fromEntries(Object.entries(sent).filter(([k]) => k in input));
          if (!Object.keys(values).length) return "skipped";
          await svc.employees.update(tx, existing.id, values);
          const after = await svc.employees.find(tx, existing.id);
          await svc.history.diff(tx, existing, after);
          if (after.resignDate && !existing.resignDate)
            await svc.checklists.autoStart(tx, existing.id, "offboarding");
          await lookups.remember(after);
          return "updated";
        }
        const parsed = validate(employeeSchema, { ...input, employeeNumber: number || null });
        const created = await svc.employees.create(tx, parsed);
        await svc.history.record(tx, created, "join", { date: created.joinDate, newValue: created.joinDate });
        if (created.joinDate >= addDays(today(), -30))
          await svc.checklists.autoStart(tx, created.id, "onboarding");
        await lookups.remember(await svc.employees.find(tx, created.id));
        return "created";
      } catch (e) {
        if (e instanceof RowError) throw e;
        rethrow(e);
      }
    },
  };
}

// ---- Kontrak ----

async function componentColumns(tx: Db, companyId: string): Promise<Column[]> {
  const comps = await tx
    .select({ code: schema.salaryComponents.code, name: schema.salaryComponents.name })
    .from(schema.salaryComponents)
    .where(and(eq(schema.salaryComponents.companyId, companyId), eq(schema.salaryComponents.active, true)))
    .orderBy(asc(schema.salaryComponents.code));
  return comps.map((c) => ({
    key: `c_${c.code}`,
    header: `${c.code} ${c.name}`,
    group: "Tunjangan/potongan tetap",
    numeric: true,
    note: "Jumlah per bulan; kosong = tidak ada",
  }));
}

function contractsDataset(svc: HrServices): Dataset {
  return {
    key: "contracts",
    label: "Kontrak kerja",
    description: "Kontrak PKWT/PKWTT dengan upah pokok dan tunjangan tetap per komponen gaji.",
    app: "hr",
    read: "hr.manage",
    write: "hr.manage",
    admin: "hr.manage",
    filters: [
      {
        key: "state",
        label: "Status kontrak",
        type: "select",
        options: [
          ["running", "Berjalan"],
          ["draft", "Draft"],
          ["closed", "Selesai"],
          ["all", "Semua"],
        ],
      },
      { key: "departmentId", label: "Departemen", type: "ref", resource: "departments" },
    ],
    async columns(tx, ctx) {
      return [
        EMP_NO,
        EMP_NAME,
        { key: "name", header: "No. Kontrak", group: "Kontrak", note: "Hanya info; nomor dibuat otomatis" },
        {
          key: "contractType",
          header: "Jenis",
          group: "Kontrak",
          required: true,
          example: "PKWTT",
          note: "PKWT/PKWTT",
        },
        {
          key: "wageType",
          header: "Tipe Upah",
          group: "Kontrak",
          example: "Bulanan",
          note: "Bulanan/Harian/Borongan",
        },
        { key: "dateStart", header: "Mulai", group: "Kontrak", required: true, example: "2024-01-15" },
        { key: "dateEnd", header: "Berakhir", group: "Kontrak", note: "Wajib untuk PKWT" },
        {
          key: "wage",
          header: "Upah Pokok",
          group: "Kontrak",
          required: true,
          numeric: true,
          example: "6000000",
        },
        { key: "state", header: "Status", group: "Kontrak", note: "Hanya info" },
        {
          key: "start",
          header: "Mulai Berlaku",
          group: "Kontrak",
          example: "ya",
          note: "ya = langsung berjalan",
        },
        { key: "note", header: "Catatan", group: "Kontrak" },
        ...(await componentColumns(tx, ctx.companyId)),
      ];
    },
    async rows(tx, ctx, query) {
      const C = schema.contracts;
      const rows = await tx
        .select({ contract: C, employeeNumber: E.employeeNumber, employeeName: E.name })
        .from(C)
        .innerJoin(E, eq(E.id, C.employeeId))
        .where(
          and(
            eq(C.companyId, ctx.companyId),
            query.state === "all" ? undefined : eq(C.state, (query.state ?? "running") as "running"),
            query.departmentId ? eq(E.departmentId, query.departmentId) : undefined,
          ),
        )
        .orderBy(asc(E.name), asc(C.dateStart));
      const allowances = rows.length
        ? await tx
            .select({
              contractId: schema.contractAllowances.contractId,
              code: schema.salaryComponents.code,
              amount: schema.contractAllowances.amount,
            })
            .from(schema.contractAllowances)
            .innerJoin(
              schema.salaryComponents,
              eq(schema.salaryComponents.id, schema.contractAllowances.componentId),
            )
            .where(
              inArray(
                schema.contractAllowances.contractId,
                rows.map((r) => r.contract.id),
              ),
            )
        : [];
      return rows.map((r) => ({
        ...r.contract,
        employeeNumber: r.employeeNumber,
        employeeName: r.employeeName,
        contractType: label("contractType", r.contract.contractType),
        wageType: label("wageType", r.contract.wageType),
        state: label("contractState", r.contract.state),
        start: r.contract.state === "running" ? "ya" : "tidak",
        ...Object.fromEntries(
          allowances.filter((a) => a.contractId === r.contract.id).map((a) => [`c_${a.code}`, a.amount]),
        ),
      }));
    },
    async importRow(tx, row, _ctx, lookups) {
      const employee = await lookups.employee("employeeNumber", get(row, "employeeNumber"));
      const allowances: { componentId: string; amount: string }[] = [];
      for (const [key, raw] of Object.entries(row)) {
        if (!key.startsWith("c_") || !raw.trim()) continue;
        const amount = num(key, raw);
        if (Number(amount) === 0) continue;
        allowances.push({ componentId: await lookups.ref("components", key, key.slice(2)), amount });
      }
      const input = validate(
        contractSchema,
        {
          employeeId: employee.id,
          contractType: get(row, "contractType")
            ? code("contractType", "contractType", get(row, "contractType"))
            : undefined,
          wageType: get(row, "wageType") ? code("wageType", "wageType", get(row, "wageType")) : undefined,
          dateStart: get(row, "dateStart") && date("dateStart", get(row, "dateStart")),
          dateEnd: get(row, "dateEnd") ? date("dateEnd", get(row, "dateEnd")) : null,
          wage: get(row, "wage") && num("wage", get(row, "wage")),
          note: get(row, "note") || null,
          allowances,
        },
        { employeeId: "employeeNumber" },
      );
      try {
        const id = await svc.contracts.create(tx, input);
        if (get(row, "start") && bool("start", get(row, "start"))) await svc.contracts.start(tx, id);
      } catch (e) {
        if (e instanceof RowError) throw e;
        rethrow(e);
      }
      return "created";
    },
  };
}

// ---- Keluarga & pendidikan ----

function familyDataset(svc: HrServices): Dataset {
  const F = schema.employeeFamily;
  return {
    key: "family",
    label: "Data keluarga",
    description:
      "Anggota keluarga karyawan, tanggungan PTKP & BPJS Kesehatan. Baris dengan nama & hubungan sama diperbarui.",
    app: "hr",
    read: "hr.read",
    write: "hr.manage",
    admin: "hr.manage",
    filters: [{ key: "departmentId", label: "Departemen", type: "ref", resource: "departments" }],
    columns: () => [
      EMP_NO,
      EMP_NAME,
      {
        key: "relation",
        header: "Hubungan",
        group: "Keluarga",
        required: true,
        example: "Anak",
        note: "Suami/istri, Anak, Ayah, Ibu, Saudara kandung, Lainnya",
      },
      { key: "name", header: "Nama", group: "Keluarga", required: true, example: "Nadia" },
      { key: "nik", header: "NIK", group: "Keluarga", sensitive: true },
      { key: "gender", header: "Jenis Kelamin", group: "Keluarga" },
      { key: "birthPlace", header: "Tempat Lahir", group: "Keluarga" },
      { key: "birthDate", header: "Tanggal Lahir", group: "Keluarga", example: "2020-03-03" },
      { key: "education", header: "Pendidikan", group: "Keluarga" },
      { key: "occupation", header: "Pekerjaan", group: "Keluarga" },
      { key: "phone", header: "Telepon", group: "Keluarga" },
      { key: "dependent", header: "Tanggungan PTKP", group: "Keluarga", example: "ya" },
      { key: "bpjsCovered", header: "Ditanggung BPJS Kesehatan", group: "Keluarga", example: "ya" },
      { key: "alive", header: "Masih Hidup", group: "Keluarga", example: "ya" },
    ],
    async rows(tx, ctx, query) {
      const rows = await tx
        .select({ f: F, employeeNumber: E.employeeNumber, employeeName: E.name })
        .from(F)
        .innerJoin(E, eq(E.id, F.employeeId))
        .where(employeeFilter(ctx.companyId, { ...query, active: "all" }))
        .orderBy(asc(E.name), asc(F.createdAt));
      return rows.map(({ f, ...r }) => ({
        ...f,
        ...r,
        nik: f.nikEnc ? svc.employees.open(f.nikEnc, true) : "",
        relation: label("relation", f.relation),
        gender: label("gender", f.gender),
        dependent: f.dependent ? "ya" : "tidak",
        bpjsCovered: f.bpjsCovered ? "ya" : "tidak",
        alive: f.alive ? "ya" : "tidak",
      }));
    },
    async importRow(tx, row, ctx, lookups) {
      const employee = await lookups.employee("employeeNumber", get(row, "employeeNumber"));
      if (get(row, "nik") && !ctx.manage)
        throw new RowError("nik", "Kolom data pribadi hanya bisa diimpor pemegang hr.manage");
      const input = validate(employeeFamilySchema, {
        relation: get(row, "relation") && code("relation", "relation", get(row, "relation")),
        name: get(row, "name"),
        nik: get(row, "nik") || null,
        gender: get(row, "gender") ? code("gender", "gender", get(row, "gender")) : null,
        birthPlace: get(row, "birthPlace") || null,
        birthDate: get(row, "birthDate") ? date("birthDate", get(row, "birthDate")) : null,
        education: get(row, "education") || null,
        occupation: get(row, "occupation") || null,
        phone: get(row, "phone") || null,
        dependent: get(row, "dependent") ? bool("dependent", get(row, "dependent")) : false,
        bpjsCovered: get(row, "bpjsCovered") ? bool("bpjsCovered", get(row, "bpjsCovered")) : false,
        alive: get(row, "alive") ? bool("alive", get(row, "alive")) : true,
      });
      const { nik, ...rest } = input;
      const values = { ...rest, nikEnc: nik ? svc.employees.seal(nik) : null };
      const [existing] = await tx
        .select({ id: F.id })
        .from(F)
        .where(
          and(
            eq(F.employeeId, employee.id),
            eq(F.relation, input.relation),
            sql`lower(${F.name}) = lower(${input.name})`,
          ),
        );
      if (existing) {
        await tx
          .update(F)
          .set({ ...values, updatedAt: sql`now()` })
          .where(eq(F.id, existing.id));
        return "updated";
      }
      await tx.insert(F).values({ ...values, employeeId: employee.id });
      return "created";
    },
  };
}

const educationDataset: Dataset = {
  key: "education",
  label: "Riwayat pendidikan",
  description: "Pendidikan formal karyawan. Baris dengan jenjang & institusi sama diperbarui.",
  app: "hr",
  read: "hr.read",
  write: "hr.manage",
  admin: "hr.manage",
  filters: [{ key: "departmentId", label: "Departemen", type: "ref", resource: "departments" }],
  columns: () => [
    EMP_NO,
    EMP_NAME,
    {
      key: "level",
      header: "Jenjang",
      group: "Pendidikan",
      required: true,
      example: "S1",
      note: "SD, SMP, SMA/SMK, D1–D4, S1–S3, Lainnya",
    },
    {
      key: "institution",
      header: "Institusi",
      group: "Pendidikan",
      required: true,
      example: "Universitas Indonesia",
    },
    { key: "major", header: "Jurusan", group: "Pendidikan", example: "Akuntansi" },
    { key: "yearStart", header: "Tahun Masuk", group: "Pendidikan", numeric: true, example: "2011" },
    { key: "yearEnd", header: "Tahun Lulus", group: "Pendidikan", numeric: true, example: "2015" },
    { key: "gpa", header: "IPK/Nilai", group: "Pendidikan", numeric: true, example: "3.40" },
  ],
  async rows(tx, ctx, query) {
    const D = schema.employeeEducation;
    const rows = await tx
      .select({ d: D, employeeNumber: E.employeeNumber, employeeName: E.name })
      .from(D)
      .innerJoin(E, eq(E.id, D.employeeId))
      .where(employeeFilter(ctx.companyId, { ...query, active: "all" }))
      .orderBy(asc(E.name), asc(D.yearEnd));
    return rows.map(({ d, ...r }) => ({ ...d, ...r, level: label("level", d.level) }));
  },
  async importRow(tx, row, _ctx, lookups) {
    const D = schema.employeeEducation;
    const employee = await lookups.employee("employeeNumber", get(row, "employeeNumber"));
    const input = validate(employeeEducationSchema, {
      level: get(row, "level") && code("level", "level", get(row, "level")),
      institution: get(row, "institution"),
      major: get(row, "major") || null,
      yearStart: get(row, "yearStart") ? num("yearStart", get(row, "yearStart")) : null,
      yearEnd: get(row, "yearEnd") ? num("yearEnd", get(row, "yearEnd")) : null,
      gpa: get(row, "gpa") ? num("gpa", get(row, "gpa")) : null,
    });
    const values = { ...input, gpa: input.gpa == null ? null : String(input.gpa) };
    const [existing] = await tx
      .select({ id: D.id })
      .from(D)
      .where(
        and(
          eq(D.employeeId, employee.id),
          eq(D.level, input.level),
          sql`lower(${D.institution}) = lower(${input.institution})`,
        ),
      );
    if (existing) {
      await tx
        .update(D)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(D.id, existing.id));
      return "updated";
    }
    await tx.insert(D).values({ ...values, employeeId: employee.id });
    return "created";
  },
};

// ---- Absensi, cuti, lembur ----

const PERIOD_FILTERS: Dataset["filters"] = [
  { key: "from", label: "Dari tanggal", type: "date" },
  { key: "to", label: "Sampai tanggal", type: "date" },
  { key: "departmentId", label: "Departemen", type: "ref", resource: "departments" },
];

const attendanceDataset: Dataset = {
  key: "attendance",
  label: "Absensi",
  description:
    "Jam masuk & pulang (mis. hasil ekspor mesin absensi). Jam mengikuti zona waktu di Pengaturan Payroll; data yang sudah ada dilewati.",
  app: "hr",
  read: "hr.read",
  write: "hr.write",
  admin: "hr.manage",
  filters: PERIOD_FILTERS,
  columns: () => [
    EMP_NO,
    EMP_NAME,
    { key: "date", header: "Tanggal", group: "Absensi", required: true, example: "2026-10-01" },
    {
      key: "checkIn",
      header: "Jam Masuk",
      group: "Absensi",
      required: true,
      example: "08:02",
      note: "HH:MM",
    },
    {
      key: "checkOut",
      header: "Jam Pulang",
      group: "Absensi",
      example: "17:05",
      note: "HH:MM; lebih kecil dari jam masuk = hari berikutnya",
    },
    { key: "workedHours", header: "Jam Kerja", group: "Absensi", numeric: true, note: "Hanya info" },
    { key: "source", header: "Sumber", group: "Absensi", note: "Hanya info" },
  ],
  async rows(tx, ctx, query) {
    const A = schema.attendances;
    const { from, to } = period(query);
    // Rentang instan diperlebar sehari lalu disaring per tanggal lokal (zona waktu perusahaan).
    const rows = await tx
      .select({ a: A, employeeNumber: E.employeeNumber, employeeName: E.name })
      .from(A)
      .innerJoin(E, eq(E.id, A.employeeId))
      .where(
        and(
          eq(A.companyId, ctx.companyId),
          gte(A.checkIn, new Date(`${addDays(from, -1)}T00:00:00Z`)),
          lte(A.checkIn, new Date(`${addDays(to, 1)}T23:59:59Z`)),
          query.departmentId ? eq(E.departmentId, query.departmentId) : undefined,
        ),
      )
      .orderBy(asc(E.name), asc(A.checkIn));
    return rows
      .map(({ a, ...r }) => ({
        ...r,
        date: localDate(a.checkIn, ctx.timeZone),
        checkIn: localTime(a.checkIn, ctx.timeZone),
        checkOut: a.checkOut ? localTime(a.checkOut, ctx.timeZone) : "",
        workedHours: a.checkOut ? ((a.checkOut.getTime() - a.checkIn.getTime()) / 3_600_000).toFixed(2) : "",
        source: label("source", a.source),
      }))
      .filter((r) => r.date >= from && r.date <= to);
  },
  async importRow(tx, row, ctx, lookups) {
    const A = schema.attendances;
    const employee = await lookups.employee("employeeNumber", get(row, "employeeNumber"));
    // Kolom jam masuk boleh berisi tanggal+jam ("2026-10-01 08:02") bila kolom tanggal kosong.
    let day = get(row, "date");
    let inRaw = get(row, "checkIn");
    const combined = /^(\S+)\s+(\d{1,2}[:.]\d{2}(?:[:.]\d{2})?)$/.exec(inRaw);
    if (combined && !day) [, day = "", inRaw = ""] = combined;
    if (!day) throw new RowError("date", "Tanggal wajib diisi");
    if (!inRaw) throw new RowError("checkIn", "Jam masuk wajib diisi");
    const d = date("date", day);
    const checkIn = zonedToUtc(d, time("checkIn", inRaw), ctx.timeZone);
    let checkOut: Date | null = null;
    if (get(row, "checkOut")) {
      checkOut = zonedToUtc(d, time("checkOut", get(row, "checkOut")), ctx.timeZone);
      if (checkOut <= checkIn) checkOut = new Date(checkOut.getTime() + 86_400_000);
    }
    const [existing] = await tx
      .select({ id: A.id })
      .from(A)
      .where(and(eq(A.employeeId, employee.id), eq(A.checkIn, checkIn)));
    if (existing) return "skipped";
    await tx.insert(A).values({
      companyId: employee.companyId,
      employeeId: employee.id,
      checkIn,
      checkOut,
      source: "import",
    });
    return "created";
  },
};

const allocationsDataset: Dataset = {
  key: "leave-allocations",
  label: "Jatah cuti",
  description:
    "Saldo/jatah cuti per karyawan & jenis cuti. Baris dengan karyawan, jenis & tanggal mulai sama diperbarui.",
  app: "hr",
  read: "hr.read",
  write: "hr.manage",
  admin: "hr.manage",
  filters: PERIOD_FILTERS,
  columns: () => [
    EMP_NO,
    EMP_NAME,
    { key: "leaveType", header: "Jenis Cuti", group: "Cuti", required: true, example: "Cuti Tahunan" },
    { key: "days", header: "Jumlah Hari", group: "Cuti", required: true, numeric: true, example: "12" },
    { key: "dateFrom", header: "Berlaku Dari", group: "Cuti", required: true, example: "2026-01-01" },
    { key: "dateTo", header: "Berlaku Sampai", group: "Cuti", required: true, example: "2026-12-31" },
    { key: "note", header: "Catatan", group: "Cuti" },
  ],
  async rows(tx, ctx, query) {
    const LA = schema.leaveAllocations;
    const n = await names(tx, ctx.companyId);
    const { from, to } = period({
      from: query.from || `${today().slice(0, 4)}-01-01`,
      to: query.to || `${today().slice(0, 4)}-12-31`,
    });
    const rows = await tx
      .select({ a: LA, employeeNumber: E.employeeNumber, employeeName: E.name })
      .from(LA)
      .innerJoin(E, eq(E.id, LA.employeeId))
      .where(
        and(
          eq(LA.companyId, ctx.companyId),
          lte(LA.dateFrom, to),
          gte(LA.dateTo, from),
          query.departmentId ? eq(E.departmentId, query.departmentId) : undefined,
        ),
      )
      .orderBy(asc(E.name), asc(LA.dateFrom));
    return rows.map(({ a, ...r }) => ({ ...a, ...r, leaveType: n.leaveTypes.get(a.leaveTypeId) }));
  },
  async importRow(tx, row, _ctx, lookups) {
    const LA = schema.leaveAllocations;
    const employee = await lookups.employee("employeeNumber", get(row, "employeeNumber"));
    const input = validate(
      leaveAllocationSchema,
      {
        employeeId: employee.id,
        leaveTypeId:
          get(row, "leaveType") && (await lookups.ref("leaveTypes", "leaveType", get(row, "leaveType"))),
        days: get(row, "days") && num("days", get(row, "days")),
        dateFrom: get(row, "dateFrom") && date("dateFrom", get(row, "dateFrom")),
        dateTo: get(row, "dateTo") && date("dateTo", get(row, "dateTo")),
        note: get(row, "note") || null,
      },
      { leaveTypeId: "leaveType" },
    );
    if (input.dateTo < input.dateFrom) throw new RowError("dateTo", "Tanggal akhir sebelum tanggal mulai");
    const [existing] = await tx
      .select({ id: LA.id })
      .from(LA)
      .where(
        and(
          eq(LA.employeeId, employee.id),
          eq(LA.leaveTypeId, input.leaveTypeId),
          eq(LA.dateFrom, input.dateFrom),
        ),
      );
    if (existing) {
      await tx
        .update(LA)
        .set({ days: input.days, dateTo: input.dateTo, note: input.note, updatedAt: sql`now()` })
        .where(eq(LA.id, existing.id));
      return "updated";
    }
    await tx.insert(LA).values({ ...input, companyId: employee.companyId });
    return "created";
  },
};

const overtimesDataset: Dataset = {
  key: "overtimes",
  label: "Lembur",
  description:
    "Jam lembur per tanggal. Mengikuti aturan persetujuan lembur di Pengaturan Payroll; baris yang sama persis dilewati.",
  app: "hr",
  read: "hr.read",
  write: "hr.write",
  admin: "hr.manage",
  filters: PERIOD_FILTERS,
  columns: () => [
    EMP_NO,
    EMP_NAME,
    { key: "date", header: "Tanggal", group: "Lembur", required: true, example: "2026-10-03" },
    { key: "hours", header: "Jam", group: "Lembur", required: true, numeric: true, example: "2" },
    {
      key: "dayType",
      header: "Jenis Hari",
      group: "Lembur",
      example: "Hari kerja",
      note: "Hari kerja/Hari libur",
    },
    { key: "description", header: "Keterangan", group: "Lembur" },
    { key: "state", header: "Status", group: "Lembur", note: "Hanya info" },
  ],
  async rows(tx, ctx, query) {
    const O = schema.overtimes;
    const { from, to } = period(query);
    const rows = await tx
      .select({ o: O, employeeNumber: E.employeeNumber, employeeName: E.name })
      .from(O)
      .innerJoin(E, eq(E.id, O.employeeId))
      .where(
        and(
          eq(O.companyId, ctx.companyId),
          gte(O.date, from),
          lte(O.date, to),
          query.departmentId ? eq(E.departmentId, query.departmentId) : undefined,
        ),
      )
      .orderBy(asc(O.date), asc(E.name));
    return rows.map(({ o, ...r }) => ({
      ...o,
      ...r,
      dayType: label("dayType", o.dayType),
      state: label("overtimeState", o.state),
    }));
  },
  async importRow(tx, row, _ctx, lookups) {
    const O = schema.overtimes;
    const employee = await lookups.employee("employeeNumber", get(row, "employeeNumber"));
    const input = validate(overtimeSchema, {
      employeeId: employee.id,
      date: get(row, "date") && date("date", get(row, "date")),
      hours: get(row, "hours") && num("hours", get(row, "hours")),
      dayType: get(row, "dayType") ? code("dayType", "dayType", get(row, "dayType")) : undefined,
      description: get(row, "description") || null,
    });
    const [existing] = await tx
      .select({ id: O.id })
      .from(O)
      .where(
        and(
          eq(O.employeeId, employee.id),
          eq(O.date, input.date),
          eq(O.hours, input.hours),
          sql`coalesce(${O.description}, '') = ${input.description ?? ""}`,
        ),
      );
    if (existing) return "skipped";
    const [created] = await tx
      .insert(O)
      .values({ ...input, companyId: employee.companyId })
      .returning({ id: O.id, companyId: O.companyId });
    await applyOvertimeApproval(tx, created!);
    return "created";
  },
};

const leavesDataset: Dataset = {
  key: "leaves",
  label: "Pengajuan cuti",
  description: "Rekap pengajuan cuti per periode (hanya ekspor).",
  app: "hr",
  read: "hr.read",
  admin: "hr.manage",
  filters: [
    ...PERIOD_FILTERS!,
    {
      key: "state",
      label: "Status",
      type: "select",
      options: [
        ["", "Semua"],
        ["approved", "Disetujui"],
        ["confirm", "Menunggu persetujuan"],
        ["refused", "Ditolak"],
      ],
    },
  ],
  columns: () => [
    EMP_NO,
    EMP_NAME,
    { key: "leaveType", header: "Jenis Cuti", group: "Cuti" },
    { key: "dateFrom", header: "Dari", group: "Cuti" },
    { key: "dateTo", header: "Sampai", group: "Cuti" },
    { key: "days", header: "Hari", group: "Cuti", numeric: true },
    { key: "halfDay", header: "Setengah Hari", group: "Cuti" },
    { key: "state", header: "Status", group: "Cuti" },
    { key: "reason", header: "Alasan", group: "Cuti" },
    { key: "delegateName", header: "Delegasi Tugas", group: "Cuti" },
  ],
  async rows(tx, ctx, query) {
    const L = schema.leaveRequests;
    const n = await names(tx, ctx.companyId);
    const { from, to } = period(query);
    const rows = await tx
      .select({ l: L, employeeNumber: E.employeeNumber, employeeName: E.name })
      .from(L)
      .innerJoin(E, eq(E.id, L.employeeId))
      .where(
        and(
          eq(L.companyId, ctx.companyId),
          lte(L.dateFrom, to),
          gte(L.dateTo, from),
          query.state ? eq(L.state, query.state as "approved") : undefined,
          query.departmentId ? eq(E.departmentId, query.departmentId) : undefined,
        ),
      )
      .orderBy(asc(L.dateFrom), asc(E.name));
    const delegates = new Map(
      (await tx.select({ id: E.id, name: E.name }).from(E).where(eq(E.companyId, ctx.companyId))).map((e) => [
        e.id,
        e.name,
      ]),
    );
    return rows.map(({ l: { attachment: _file, ...l }, ...r }) => ({
      ...l,
      ...r,
      leaveType: n.leaveTypes.get(l.leaveTypeId),
      state: label("leaveState", l.state),
      halfDay: l.halfDay === "am" ? "Pagi" : l.halfDay === "pm" ? "Siang" : "",
      delegateName: l.delegateEmployeeId ? (delegates.get(l.delegateEmployeeId) ?? "") : "",
    }));
  },
};

export function hrDatasets(svc: HrServices): Dataset[] {
  return [
    employeesDataset(svc),
    contractsDataset(svc),
    familyDataset(svc),
    educationDataset,
    attendanceDataset,
    allocationsDataset,
    overtimesDataset,
    leavesDataset,
  ];
}
