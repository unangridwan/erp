/** Logika murni absensi lanjutan: jarak/geofence, status harian & rekap bulanan, auto-checkout. */

const EARTH_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Jarak dua titik (meter, rumus haversine), dibulatkan. */
export function distanceMeters(
  a: { latitude: number | string; longitude: number | string },
  b: { latitude: number | string; longitude: number | string },
) {
  const [lat1, lon1, lat2, lon2] = [a.latitude, a.longitude, b.latitude, b.longitude].map(Number) as [
    number,
    number,
    number,
    number,
  ];
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return Math.round(2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export type DayStatus =
  | "on_time"
  | "late"
  | "early_out"
  | "no_checkout"
  | "working"
  | "absent"
  | "not_yet"
  | "upcoming"
  | "day_off"
  | "holiday"
  | "time_off"
  | "extra_day";

export interface DaySchedule {
  /** "HH:MM" lokal. */
  start: string;
  end: string;
  toleranceMinutes: number;
  workDays: number[];
}

/** Tanggal & menit-sejak-tengah-malam lokal sebuah instan. */
export function localMinutes(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
};

/**
 * Status satu hari kerja (seperti log kehadiran Talenta): cuti penuh → time_off; bukan hari kerja / libur →
 * day_off/holiday (extra_day bila tetap masuk); tanpa absen → absent (lewat), not_yet (hari ini), upcoming (nanti);
 * absen terbuka → no_checkout (hari lewat) / working (hari ini); selain itu late / early_out / on_time.
 */
export function dailyStatus(input: {
  date: string;
  today: string;
  timeZone: string;
  schedule: DaySchedule | null;
  holiday: boolean;
  leave: "full" | "half" | null;
  attendances: { checkIn: Date; checkOut: Date | null }[];
}): {
  status: DayStatus;
  lateMinutes: number;
  earlyMinutes: number;
  workedMinutes: number;
  firstIn: Date | null;
  lastOut: Date | null;
} {
  const rows = [...input.attendances].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());
  const firstIn = rows[0]?.checkIn ?? null;
  const open = rows.some((r) => !r.checkOut);
  const outs = rows.map((r) => r.checkOut).filter((x): x is Date => !!x);
  const lastOut = outs.length ? outs.reduce((m, x) => (x > m ? x : m)) : null;
  const workedMinutes = Math.round(
    rows.reduce((s, r) => s + (r.checkOut ? r.checkOut.getTime() - r.checkIn.getTime() : 0), 0) / 60_000,
  );
  const base = { lateMinutes: 0, earlyMinutes: 0, workedMinutes, firstIn, lastOut };
  if (input.leave === "full") return { status: "time_off", ...base };
  const weekday = new Date(`${input.date}T00:00:00Z`).getUTCDay();
  const workday = !!input.schedule && input.schedule.workDays.includes(weekday);
  if (input.holiday || !workday) {
    if (rows.length) return { status: "extra_day", ...base };
    return { status: input.holiday ? "holiday" : "day_off", ...base };
  }
  if (!rows.length) {
    if (input.leave === "half") return { status: "time_off", ...base };
    if (input.date > input.today) return { status: "upcoming", ...base };
    return { status: input.date === input.today ? "not_yet" : "absent", ...base };
  }
  const schedule = input.schedule!;
  const start = localMinutes(firstIn!, input.timeZone).minutes;
  const late = Math.max(0, start - toMinutes(schedule.start));
  const lateMinutes = late > schedule.toleranceMinutes && input.leave !== "half" ? late : 0;
  const earlyMinutes =
    !open && lastOut && input.leave !== "half"
      ? Math.max(0, toMinutes(schedule.end) - localMinutes(lastOut, input.timeZone).minutes)
      : 0;
  const result = { ...base, lateMinutes, earlyMinutes };
  if (open) return { status: input.date < input.today ? "no_checkout" : "working", ...result };
  if (lateMinutes) return { status: "late", ...result };
  if (earlyMinutes) return { status: "early_out", ...result };
  return { status: "on_time", ...result };
}

/** Rekap jumlah hari per status. */
export function monthlySummary(days: { status: DayStatus; lateMinutes?: number }[]) {
  const counts = Object.fromEntries(
    (
      [
        "on_time",
        "late",
        "early_out",
        "no_checkout",
        "working",
        "absent",
        "not_yet",
        "upcoming",
        "day_off",
        "holiday",
        "time_off",
        "extra_day",
      ] as DayStatus[]
    ).map((s) => [s, 0]),
  ) as Record<DayStatus, number>;
  for (const d of days) counts[d.status]++;
  return {
    counts,
    lateMinutes: days.reduce((s, d) => s + (d.lateMinutes ?? 0), 0),
    present:
      counts.on_time +
      counts.late +
      counts.early_out +
      counts.no_checkout +
      counts.working +
      counts.extra_day,
  };
}

/**
 * Jam pulang otomatis untuk absensi yang lupa ditutup: jam pulang jadwal bila masuk akal (setelah masuk dan tidak
 * lebih dari `maxHours`), selain itu masuk + `maxHours`.
 */
export function autoCheckoutTime(checkIn: Date, scheduleEnd: Date | null, maxHours: number) {
  const limit = new Date(checkIn.getTime() + maxHours * 3_600_000);
  if (scheduleEnd && scheduleEnd > checkIn && scheduleEnd <= limit) return scheduleEnd;
  return limit;
}

/** Kode singkat status untuk matriks rekap bulanan. */
export const DAY_STATUS_CODE: Record<DayStatus, string> = {
  on_time: "H",
  late: "T",
  early_out: "PC",
  no_checkout: "TP",
  working: "•",
  absent: "A",
  not_yet: "·",
  upcoming: "",
  day_off: "-",
  holiday: "L",
  time_off: "C",
  extra_day: "HL",
};
