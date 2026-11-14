import { z } from "zod";

/** Logika murni maintenance: jatuh tempo rencana (hari/meter), downtime, MTBF/MTTR/ketersediaan; skema zod. */

const DAY = 86_400_000;
const parse = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const round2 = (x: number) => Math.round(x * 100) / 100;
export const addDaysIso = (d: string, n: number) => iso(new Date(parse(d).getTime() + n * DAY));

export const EQUIPMENT_STATE_LABEL: Record<string, [string, string]> = {
  operational: ["Beroperasi", "Operational"],
  down: ["Rusak", "Down"],
  retired: ["Tidak dipakai", "Retired"],
};
export const REQUEST_STATE_LABEL: Record<string, [string, string]> = {
  new: ["Baru", "New"],
  scheduled: ["Terjadwal", "Scheduled"],
  in_progress: ["Dikerjakan", "In progress"],
  done: ["Selesai", "Done"],
  cancelled: ["Batal", "Cancelled"],
};
export const PRIORITY_LABEL: Record<string, [string, string]> = {
  low: ["Rendah", "Low"],
  normal: ["Normal", "Normal"],
  high: ["Tinggi", "High"],
  urgent: ["Mendesak", "Urgent"],
};
export const METER_UNIT_LABEL: Record<string, [string, string]> = {
  hours: ["jam", "hours"],
  km: ["km", "km"],
  cycles: ["siklus", "cycles"],
};

export interface PlanDueInput {
  intervalDays: number | null;
  intervalMeter: number | string | null;
  leadDays: number;
  startDate: string;
  lastDoneDate: string | null;
  lastDoneMeter: number | string | null;
}

/**
 * Jatuh tempo berikutnya: tanggal (terakhir dikerjakan/tanggal mulai + interval hari) dan meter (meter terakhir
 * dikerjakan + interval). `due` = tanggal sudah masuk masa toleransi atau meter tercapai. `cycle` = kunci siklus
 * (dipakai agar request preventif dibuat sekali per siklus).
 */
export function planDue(plan: PlanDueInput, today: string, meter: number | string) {
  const dueDate = plan.intervalDays
    ? plan.lastDoneDate
      ? addDaysIso(plan.lastDoneDate, plan.intervalDays)
      : plan.startDate
    : null;
  const interval = plan.intervalMeter === null ? null : Number(plan.intervalMeter);
  const dueMeter = interval ? Number(plan.lastDoneMeter ?? 0) + interval : null;
  const byDate = dueDate !== null && addDaysIso(today, plan.leadDays) >= dueDate;
  const byMeter = dueMeter !== null && Number(meter) >= dueMeter;
  const cycle = `${plan.lastDoneDate ?? "-"}|${plan.lastDoneMeter ?? "-"}`;
  return { dueDate, dueMeter, due: byDate || byMeter, byDate, byMeter, cycle };
}

/** Lama downtime (jam) dari kerusakan s.d. selesai diperbaiki; 0 bila salah satu kosong. */
export function downtimeHours(from: Date | string | null, to: Date | string | null) {
  if (!from || !to) return 0;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return ms > 0 ? round2(ms / 3_600_000) : 0;
}

export interface ReliabilityInput {
  failures: number;
  downtimeHours: number;
  /** Jam kalender periode (atau jam operasi yang direncanakan). */
  periodHours: number;
}

/** MTBF = waktu operasi / jumlah kerusakan; MTTR = downtime / jumlah kerusakan; ketersediaan = operasi / periode. */
export function reliability({ failures, downtimeHours, periodHours }: ReliabilityInput) {
  const uptime = Math.max(0, periodHours - downtimeHours);
  return {
    uptimeHours: round2(uptime),
    mtbf: failures ? round2(uptime / failures) : null,
    mttr: failures ? round2(downtimeHours / failures) : null,
    availability: periodHours > 0 ? round2((uptime / periodHours) * 100) : null,
  };
}

/** Jam kalender dalam rentang tanggal [from, to] (inklusif). */
export const periodHours = (from: string, to: string) =>
  Math.max(0, (parse(to).getTime() - parse(from).getTime()) / 3_600_000 + 24);

// ---- Skema ----

const uuid = z.string().uuid();
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);
const money = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => v === "" || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) >= 0), "Nilai tidak valid")
  .transform((v) => v || "0");
const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim())
  .refine((v) => /^\d+(\.\d+)?$/.test(v), "Angka tidak valid");

export const maintenanceTeamSchema = z.object({
  name: z.string().trim().min(1, "Nama wajib diisi").max(120),
  memberIds: z.array(uuid).max(100).default([]),
  active: z.boolean().default(true),
});

export const equipmentSchema = z.object({
  code: z.string().trim().min(1, "Kode wajib diisi").max(40),
  name: z.string().trim().min(1, "Nama wajib diisi").max(160),
  category: text(80),
  assetId: uuid.nullish(),
  workCenterId: uuid.nullish(),
  location: text(160),
  branchId: uuid.nullish(),
  businessUnitId: uuid.nullish(),
  costCenterId: uuid.nullish(),
  serialNo: text(120),
  vendorId: uuid.nullish(),
  warrantyUntil: z.string().date().nullish(),
  teamId: uuid.nullish(),
  technicianUserId: uuid.nullish(),
  meterUnit: z.enum(["hours", "km", "cycles"]).nullish(),
  state: z.enum(["operational", "down", "retired"]).default("operational"),
  criticality: z.enum(["low", "medium", "high"]).default("medium"),
  note: text(2000),
  custom: z.record(z.unknown()).optional(),
});

export const meterReadingSchema = z.object({
  date: z.string().date(),
  value: decimal,
});

export const maintenancePlanSchema = z.object({
  equipmentId: uuid,
  name: z.string().trim().min(1, "Nama wajib diisi").max(160),
  intervalDays: z.number().int().min(1).max(3650).nullish(),
  intervalMeter: decimal.nullish(),
  leadDays: z.number().int().min(0).max(90).default(0),
  startDate: z.string().date(),
  lastDoneDate: z.string().date().nullish(),
  lastDoneMeter: decimal.nullish(),
  tasks: z
    .array(z.object({ label: z.string().trim().min(1).max(200) }))
    .max(50)
    .default([]),
  durationHours: decimal.nullish(),
  teamId: uuid.nullish(),
  technicianUserId: uuid.nullish(),
  active: z.boolean().default(true),
});
/** Rencana wajib punya interval hari atau interval meter. */
export const planHasInterval = (p: {
  intervalDays?: number | null;
  intervalMeter?: string | number | null;
}) => !!p.intervalDays || Number(p.intervalMeter ?? 0) > 0;

export const maintenanceRequestSchema = z.object({
  equipmentId: uuid,
  kind: z.enum(["preventive", "corrective"]).default("corrective"),
  title: z.string().trim().min(1, "Judul wajib diisi").max(200),
  description: text(5000),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  teamId: uuid.nullish(),
  technicianUserId: uuid.nullish(),
  scheduledDate: z.string().date().nullish(),
  /** Waktu mesin mulai rusak (korektif); default saat dilaporkan. */
  breakdownAt: z.string().datetime({ offset: true }).nullish(),
  vendorId: uuid.nullish(),
  vendorCost: money.default("0"),
  laborCost: money.default("0"),
  laborHours: decimal.nullish(),
  resolution: text(5000),
  checklist: z
    .array(z.object({ label: z.string().trim().min(1).max(200), done: z.boolean().default(false) }))
    .max(50)
    .optional(),
  custom: z.record(z.unknown()).optional(),
});

/** Laporan kerusakan dari portal (siapa pun yang login). */
export const breakdownReportSchema = z.object({
  equipmentId: uuid,
  title: z.string().trim().min(1, "Judul wajib diisi").max(200),
  description: text(5000),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  /** Mesin berhenti beroperasi (downtime dihitung sejak laporan). */
  stopped: z.boolean().default(true),
});

export const maintenancePartsSchema = z.object({
  parts: z
    .array(
      z.object({
        productId: uuid,
        quantity: decimal.refine((v) => Number(v) > 0, "Jumlah harus lebih dari 0"),
        locationId: uuid.nullish(),
        lotName: text(120),
      }),
    )
    .max(100),
});

export const maintenanceDoneSchema = z.object({
  finishedAt: z.string().datetime({ offset: true }).nullish(),
  resolution: text(5000),
  laborHours: decimal.nullish(),
  laborCost: money.optional(),
  checklist: z
    .array(z.object({ label: z.string().trim().min(1).max(200), done: z.boolean() }))
    .max(50)
    .optional(),
  /** Meter peralatan saat perawatan selesai (untuk rencana berbasis meter). */
  meter: decimal.nullish(),
});

export const maintenanceSettingsSchema = z.object({
  expenseAccountId: uuid.nullish(),
  partsLocationId: uuid.nullish(),
});
