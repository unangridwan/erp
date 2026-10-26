import { describe, expect, it } from "vitest";
import { autoCheckoutTime, dailyStatus, distanceMeters, monthlySummary } from "./attendance.js";
import { zonedToUtc } from "./hr.js";

const TZ = "Asia/Jakarta";
const at = (date: string, time: string) => zonedToUtc(date, time, TZ);
const schedule = { start: "08:00", end: "17:00", toleranceMinutes: 10, workDays: [1, 2, 3, 4, 5] };
// 2026-10-05 Senin.
const day = (over: Partial<Parameters<typeof dailyStatus>[0]>) =>
  dailyStatus({
    date: "2026-10-05",
    today: "2026-10-20",
    timeZone: TZ,
    schedule,
    holiday: false,
    leave: null,
    attendances: [],
    ...over,
  });

describe("distanceMeters", () => {
  it("haversine: Monas → Bundaran HI ± 2,3 km; titik sama = 0", () => {
    const monas = { latitude: -6.175392, longitude: 106.827153 };
    const hi = { latitude: -6.195, longitude: 106.823 };
    expect(distanceMeters(monas, hi)).toBeGreaterThan(2100);
    expect(distanceMeters(monas, hi)).toBeLessThan(2400);
    expect(distanceMeters(monas, monas)).toBe(0);
  });
});

describe("dailyStatus", () => {
  it("tepat waktu (dalam toleransi), terlambat, pulang cepat", () => {
    expect(
      day({ attendances: [{ checkIn: at("2026-10-05", "08:09"), checkOut: at("2026-10-05", "17:05") }] })
        .status,
    ).toBe("on_time");
    const late = day({
      attendances: [{ checkIn: at("2026-10-05", "08:25"), checkOut: at("2026-10-05", "17:00") }],
    });
    expect(late).toMatchObject({ status: "late", lateMinutes: 25, workedMinutes: 515 });
    expect(
      day({ attendances: [{ checkIn: at("2026-10-05", "07:55"), checkOut: at("2026-10-05", "16:30") }] }),
    ).toMatchObject({ status: "early_out", earlyMinutes: 30 });
  });

  it("tidak absen pulang, sedang bekerja, tidak hadir, belum hadir, mendatang", () => {
    const open = [{ checkIn: at("2026-10-05", "08:00"), checkOut: null }];
    expect(day({ attendances: open }).status).toBe("no_checkout");
    expect(day({ attendances: open, today: "2026-10-05" }).status).toBe("working");
    expect(day({}).status).toBe("absent");
    expect(day({ today: "2026-10-05" }).status).toBe("not_yet");
    expect(day({ today: "2026-10-01" }).status).toBe("upcoming");
  });

  it("libur, hari istirahat, cuti, masuk di hari libur", () => {
    expect(day({ holiday: true }).status).toBe("holiday");
    expect(day({ date: "2026-10-04" }).status).toBe("day_off");
    expect(day({ leave: "full" }).status).toBe("time_off");
    expect(day({ leave: "half" }).status).toBe("time_off");
    expect(
      day({
        date: "2026-10-04",
        attendances: [{ checkIn: at("2026-10-04", "09:00"), checkOut: at("2026-10-04", "13:00") }],
      }).status,
    ).toBe("extra_day");
    // Cuti setengah hari: datang siang tidak dihitung terlambat.
    expect(
      day({
        leave: "half",
        attendances: [{ checkIn: at("2026-10-05", "13:00"), checkOut: at("2026-10-05", "17:00") }],
      }),
    ).toMatchObject({ status: "on_time", lateMinutes: 0 });
  });

  it("rekap bulanan", () => {
    const s = monthlySummary([
      { status: "on_time" },
      { status: "late", lateMinutes: 20 },
      { status: "late", lateMinutes: 5 },
      { status: "absent" },
      { status: "time_off" },
    ]);
    expect(s.counts).toMatchObject({ on_time: 1, late: 2, absent: 1, time_off: 1 });
    expect(s).toMatchObject({ lateMinutes: 25, present: 3 });
  });
});

describe("autoCheckoutTime", () => {
  const checkIn = at("2026-10-05", "08:00");
  it("jam pulang jadwal bila wajar, selain itu masuk + batas jam", () => {
    expect(autoCheckoutTime(checkIn, at("2026-10-05", "17:00"), 12)).toEqual(at("2026-10-05", "17:00"));
    expect(autoCheckoutTime(checkIn, null, 12)).toEqual(at("2026-10-05", "20:00"));
    expect(autoCheckoutTime(at("2026-10-05", "18:00"), at("2026-10-05", "17:00"), 10)).toEqual(
      at("2026-10-06", "04:00"),
    );
  });
});
