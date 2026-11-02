import { describe, expect, it } from "vitest";
import { DEFAULT_OVERTIME_RULES, overtimeFromAttendance } from "./overtime.js";

const tz = "Asia/Jakarta";
const at = (date: string, time: string) => new Date(`${date}T${time}:00+07:00`);
const office = { startTime: "08:00", endTime: "17:00" };

describe("lembur dari absensi", () => {
  it("hari kerja: setelah jam pulang jadwal, minimal & pembulatan ke bawah", () => {
    const calc = (out: string, rules = DEFAULT_OVERTIME_RULES) =>
      overtimeFromAttendance({
        checkIn: at("2026-11-02", "07:50"),
        checkOut: at("2026-11-02", out),
        date: "2026-11-02",
        timeZone: tz,
        schedule: office,
        workday: true,
        rules,
      });
    expect(calc("17:20").hours).toBe(0);
    expect(calc("18:50")).toMatchObject({ hours: 1.5, rawMinutes: 110, dayType: "workday" });
    expect(calc("23:59").hours).toBe(4);
    expect(calc("18:50", { ...DEFAULT_OVERTIME_RULES, roundMinutes: 1 }).hours).toBe(1.83);
    // Masuk lebih awal ikut dihitung bila diaktifkan: 10 menit + 110 menit = 2 jam.
    expect(calc("18:50", { ...DEFAULT_OVERTIME_RULES, countEarly: true }).hours).toBe(2);
  });

  it("shift malam berakhir keesokan hari; hari libur dihitung seluruhnya; tanpa jadwal setelah 8 jam", () => {
    expect(
      overtimeFromAttendance({
        checkIn: at("2026-11-02", "21:55"),
        checkOut: at("2026-11-03", "08:00"),
        date: "2026-11-02",
        timeZone: tz,
        schedule: { startTime: "22:00", endTime: "06:00" },
        workday: true,
      }).hours,
    ).toBe(2);
    expect(
      overtimeFromAttendance({
        checkIn: at("2026-11-08", "08:00"),
        checkOut: at("2026-11-08", "13:40"),
        date: "2026-11-08",
        timeZone: tz,
        schedule: office,
        workday: false,
      }),
    ).toMatchObject({ hours: 5.5, dayType: "rest_day", scheduleEnd: null });
    expect(
      overtimeFromAttendance({
        checkIn: at("2026-11-02", "08:00"),
        checkOut: at("2026-11-02", "19:00"),
        date: "2026-11-02",
        timeZone: tz,
        schedule: null,
        workday: true,
      }).hours,
    ).toBe(3);
  });
});
