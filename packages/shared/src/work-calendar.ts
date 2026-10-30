/** Kalender kerja: hari kerja menurut jadwal karyawan, hari libur per perusahaan, data libur nasional. */
import { z } from "zod";

export const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5] as const;

export const HOLIDAY_KINDS = ["national", "collective", "company"] as const;
export type HolidayKind = (typeof HOLIDAY_KINDS)[number];
export const HOLIDAY_KIND_LABEL: Record<HolidayKind, [string, string]> = {
  national: ["Libur nasional", "National holiday"],
  collective: ["Cuti bersama", "Collective leave"],
  company: ["Libur perusahaan", "Company holiday"],
};

/** Setiap tanggal (YYYY-MM-DD) dalam rentang inklusif. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Hari kerja bila hari itu ada di jadwal dan bukan hari libur. */
export function isWorkday(date: string, workDays: readonly number[], holidays: ReadonlySet<string>) {
  return workDays.includes(weekdayOf(date)) && !holidays.has(date);
}

/**
 * Pembagi upah harian per bulan (PP 35/2021 ps. 18 jo. penjelasan UU 13/2003 ps. 77): 6 hari kerja/minggu = 25,
 * 5 hari kerja/minggu = 21. Jadwal dengan hari kerja lain diproporsikan dari 52 minggu ÷ 12 bulan.
 */
export function workDaysPerMonth(workDays: readonly number[] = DEFAULT_WORK_DAYS): number {
  const n = new Set(workDays).size;
  if (n === 6) return 25;
  if (n === 5) return 21;
  return Math.max(1, Math.round((n * 52) / 12));
}

/** Alasan sebuah tanggal tidak dihitung sebagai hari kerja (untuk pratinjau durasi cuti). */
export type SkipReason = { date: string; reason: "day_off" | HolidayKind; name?: string };

export function dayBreakdown(
  from: string,
  to: string,
  workDaysOf: (date: string) => readonly number[],
  holidays: ReadonlyMap<string, { name: string; kind: HolidayKind }>,
) {
  const counted: string[] = [];
  const skipped: SkipReason[] = [];
  for (const date of eachDate(from, to)) {
    const holiday = holidays.get(date);
    if (!workDaysOf(date).includes(weekdayOf(date))) skipped.push({ date, reason: "day_off" });
    else if (holiday) skipped.push({ date, reason: holiday.kind, name: holiday.name });
    else counted.push(date);
  }
  return { counted, skipped };
}

/**
 * Libur nasional & cuti bersama resmi (SKB Menteri Agama, Menteri Ketenagakerjaan, MenPAN-RB). Tanggal hari besar
 * keagamaan bisa digeser pemerintah — periksa kembali setelah impor; tahun lain diimpor dari berkas.
 */
export const ID_NATIONAL_HOLIDAYS: Record<
  number,
  { date: string; name: string; kind: "national" | "collective" }[]
> = {
  2026: [
    { date: "2026-01-01", name: "Tahun Baru 2026 Masehi", kind: "national" },
    { date: "2026-01-16", name: "Isra Mikraj Nabi Muhammad SAW", kind: "national" },
    { date: "2026-02-16", name: "Cuti bersama Tahun Baru Imlek", kind: "collective" },
    { date: "2026-02-17", name: "Tahun Baru Imlek 2577 Kongzili", kind: "national" },
    { date: "2026-03-18", name: "Cuti bersama Hari Suci Nyepi", kind: "collective" },
    { date: "2026-03-19", name: "Hari Suci Nyepi Tahun Baru Saka 1948", kind: "national" },
    { date: "2026-03-20", name: "Cuti bersama Idul Fitri 1447 H", kind: "collective" },
    { date: "2026-03-21", name: "Idul Fitri 1447 H", kind: "national" },
    { date: "2026-03-22", name: "Idul Fitri 1447 H", kind: "national" },
    { date: "2026-03-23", name: "Cuti bersama Idul Fitri 1447 H", kind: "collective" },
    { date: "2026-03-24", name: "Cuti bersama Idul Fitri 1447 H", kind: "collective" },
    { date: "2026-04-03", name: "Wafat Yesus Kristus", kind: "national" },
    { date: "2026-04-05", name: "Kebangkitan Yesus Kristus (Paskah)", kind: "national" },
    { date: "2026-05-01", name: "Hari Buruh Internasional", kind: "national" },
    { date: "2026-05-14", name: "Kenaikan Yesus Kristus", kind: "national" },
    { date: "2026-05-15", name: "Cuti bersama Kenaikan Yesus Kristus", kind: "collective" },
    { date: "2026-05-27", name: "Idul Adha 1447 H", kind: "national" },
    { date: "2026-05-28", name: "Cuti bersama Idul Adha 1447 H", kind: "collective" },
    { date: "2026-05-31", name: "Hari Raya Waisak 2570 BE", kind: "national" },
    { date: "2026-06-01", name: "Hari Lahir Pancasila", kind: "national" },
    { date: "2026-06-16", name: "Tahun Baru Islam 1448 H", kind: "national" },
    { date: "2026-08-17", name: "Hari Kemerdekaan Republik Indonesia", kind: "national" },
    { date: "2026-08-25", name: "Maulid Nabi Muhammad SAW", kind: "national" },
    { date: "2026-12-24", name: "Cuti bersama Hari Raya Natal", kind: "collective" },
    { date: "2026-12-25", name: "Hari Raya Natal", kind: "national" },
  ],
};

export const holidayImportSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  /** Null = berlaku untuk semua perusahaan. */
  companyId: z.string().uuid().nullish(),
  /** Sertakan cuti bersama (bawaan ya). */
  collective: z.boolean().default(true),
});

export const leaveDaysPreviewSchema = z.object({
  employeeId: z.string().uuid(),
  leaveTypeId: z.string().uuid().nullish(),
  dateFrom: z.string().date(),
  dateTo: z.string().date(),
  halfDay: z.enum(["am", "pm"]).nullish(),
});
