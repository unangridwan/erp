import { z } from "zod";

export const PROJECT_STATUSES = ["active", "on_hold", "done", "cancelled"] as const;
export const TASK_STATUSES = ["todo", "in_progress", "review", "done", "cancelled"] as const;
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, [string, string]> = {
  active: ["Berjalan", "Active"],
  on_hold: ["Ditunda", "On hold"],
  done: ["Selesai", "Done"],
  cancelled: ["Dibatalkan", "Cancelled"],
};
export const TASK_STATUS_LABEL: Record<TaskStatus, [string, string]> = {
  todo: ["Belum mulai", "To do"],
  in_progress: ["Dikerjakan", "In progress"],
  review: ["Ditinjau", "In review"],
  done: ["Selesai", "Done"],
  cancelled: ["Dibatalkan", "Cancelled"],
};

/** Task terbuka = belum selesai/dibatalkan. */
export const isOpenTask = (status: TaskStatus) => status !== "done" && status !== "cancelled";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus format YYYY-MM-DD");
const externalId = z.string().trim().min(1).max(200);
const url = z.string().trim().url().max(500);

/** Rujukan karyawan dari aplikasi: id ERP, email (kerja/akun), atau nomor karyawan. */
export const employeeRefSchema = z
  .object({
    employeeId: z.string().uuid().optional(),
    employeeEmail: z.string().trim().toLowerCase().email().optional(),
    employeeNumber: z.string().trim().min(1).max(50).optional(),
  })
  .refine((r) => r.employeeId || r.employeeEmail || r.employeeNumber, {
    message: "Isi employeeId, employeeEmail, atau employeeNumber",
  });
export type EmployeeRef = z.infer<typeof employeeRefSchema>;

export const projectSyncSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().max(50).nullish(),
    description: z.string().trim().max(2000).nullish(),
    status: z.enum(PROJECT_STATUSES).default("active"),
    startDate: isoDate.nullish(),
    endDate: isoDate.nullish(),
    url: url.nullish(),
    /** Perusahaan ERP pemilik proyek; kosong = perusahaan default akun layanan. */
    companyId: z.string().uuid().optional(),
    manager: employeeRefSchema.nullish(),
    /** Daftar anggota lengkap (mengganti yang lama); tidak dikirim = anggota tidak diubah. */
    members: z
      .array(
        employeeRefSchema.and(
          z.object({
            role: z.string().trim().max(100).nullish(),
            allocation: z.number().min(0).max(100).nullish(),
            startDate: isoDate.nullish(),
            endDate: isoDate.nullish(),
          }),
        ),
      )
      .max(500)
      .optional(),
  })
  .refine((p) => !p.startDate || !p.endDate || p.startDate <= p.endDate, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    path: ["endDate"],
  });
export type ProjectSyncInput = z.infer<typeof projectSyncSchema>;

export const taskSyncSchema = z.object({
  projectExternalId: externalId,
  title: z.string().trim().min(1).max(300),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assignee: employeeRefSchema.nullish(),
  dueDate: isoDate.nullish(),
  closedAt: z.string().datetime({ offset: true }).nullish(),
  url: url.nullish(),
});
export type TaskSyncInput = z.infer<typeof taskSyncSchema>;

export const timesheetEntrySchema = employeeRefSchema.and(
  z.object({
    externalId,
    projectExternalId: externalId,
    taskExternalId: externalId.nullish(),
    date: isoDate,
    hours: z.number().gt(0, "Jam harus lebih dari 0").max(24, "Jam maksimal 24 per baris"),
    description: z.string().trim().max(1000).nullish(),
    approved: z.boolean().default(false),
  }),
);
export type TimesheetEntryInput = z.infer<typeof timesheetEntrySchema>;

/** Batch timesheet: tiap baris divalidasi terpisah agar baris yang salah tidak menggagalkan semuanya. */
export const timesheetBatchSchema = z.object({
  entries: z.array(z.unknown()).min(1).max(1000, "Maksimal 1000 baris per batch"),
});
