/** Lembur otomatis dari absensi: selisih jam pulang (dan masuk lebih awal) terhadap jadwal kerja. */
import { z } from "zod";
import { zonedToUtc } from "./hr.js";
import type { OvertimeDay } from "./payroll.js";
import { addDays } from "./sales.js";

export interface OvertimeRules {
  /** Lembur di bawah batas ini tidak dihitung. */
  minMinutes: number;
  /** Menit dibulatkan ke bawah ke kelipatan ini (mis. 30 → 1 jam 50 menit = 1,5 jam). */
  roundMinutes: number;
  /** Batas jam lembur per hari kerja (PP 35/2021: 4 jam). */
  maxWorkdayHours: number;
  /** Hitung juga masuk sebelum jam mulai jadwal. */
  countEarly: boolean;
}

export const DEFAULT_OVERTIME_RULES: OvertimeRules = {
  minMinutes: 30,
  roundMinutes: 30,
  maxWorkdayHours: 4,
  countEarly: false,
};

/** Batas lembur hari istirahat/libur per hari (pola 5 hari kerja: 8 + 1 + 3 jam). */
export const MAX_REST_DAY_HOURS = 12;
/** Tanpa jadwal: lembur dihitung setelah 8 jam kerja (UU 13/2003 ps. 77, pola 5 hari kerja). */
const DEFAULT_WORK_MINUTES = 8 * 60;

export interface AttendanceOvertime {
  dayType: OvertimeDay;
  /** Menit lembur mentah sebelum batas minimum, pembulatan & batas maksimum. */
  rawMinutes: number;
  /** Jam lembur dihitung (2 desimal), 0 bila tidak ada. */
  hours: number;
  /** Jam pulang jadwal (instan) bila hari kerja berjadwal. */
  scheduleEnd: Date | null;
}

/**
 * Jam lembur satu absensi. Hari kerja: menit setelah jam pulang jadwal (+ sebelum jam masuk bila `countEarly`);
 * tanpa jadwal: menit setelah 8 jam kerja. Hari istirahat/libur: seluruh jam kerja. Shift malam (jam pulang ≤ jam
 * masuk) berakhir keesokan harinya.
 */
export function overtimeFromAttendance(input: {
  checkIn: Date;
  checkOut: Date;
  /** Tanggal lokal absen masuk. */
  date: string;
  timeZone: string;
  /** Jadwal yang berlaku hari itu (null = tanpa jadwal). */
  schedule: { startTime: string; endTime: string } | null;
  /** Hari kerja menurut jadwal & kalender libur. */
  workday: boolean;
  rules?: OvertimeRules;
}): AttendanceOvertime {
  const rules = input.rules ?? DEFAULT_OVERTIME_RULES;
  const worked = Math.max(0, (input.checkOut.getTime() - input.checkIn.getTime()) / 60_000);
  let raw: number;
  let scheduleEnd: Date | null = null;
  let max: number;
  if (!input.workday) {
    raw = worked;
    max = MAX_REST_DAY_HOURS * 60;
  } else if (input.schedule) {
    const start = zonedToUtc(input.date, input.schedule.startTime, input.timeZone);
    const overnight = input.schedule.endTime <= input.schedule.startTime;
    scheduleEnd = zonedToUtc(
      overnight ? addDays(input.date, 1) : input.date,
      input.schedule.endTime,
      input.timeZone,
    );
    const late = Math.max(0, (input.checkOut.getTime() - scheduleEnd.getTime()) / 60_000);
    const early = rules.countEarly ? Math.max(0, (start.getTime() - input.checkIn.getTime()) / 60_000) : 0;
    raw = late + early;
    max = rules.maxWorkdayHours * 60;
  } else {
    raw = Math.max(0, worked - DEFAULT_WORK_MINUTES);
    max = rules.maxWorkdayHours * 60;
  }
  raw = Math.floor(raw);
  let minutes = raw < Math.max(1, rules.minMinutes) ? 0 : raw;
  if (rules.roundMinutes > 1) minutes = Math.floor(minutes / rules.roundMinutes) * rules.roundMinutes;
  minutes = Math.min(minutes, max);
  return {
    dayType: input.workday ? "workday" : "rest_day",
    rawMinutes: raw,
    hours: Math.round((minutes / 60) * 100) / 100,
    scheduleEnd,
  };
}

export const overtimeGenerateSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  employeeId: z.string().uuid().nullish(),
});

/** Keputusan atasan atas lembur: jam yang disetujui boleh dikurangi dari hasil hitung absensi. */
export const overtimeDecisionSchema = z.object({
  note: z.string().trim().max(500).nullish(),
  hours: z.coerce
    .number()
    .positive()
    .max(MAX_REST_DAY_HOURS)
    .refine((v) => Number(v.toFixed(2)) === v, "Maksimal 2 desimal")
    .nullish(),
});
