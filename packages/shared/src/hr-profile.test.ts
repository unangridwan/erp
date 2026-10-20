import { describe, expect, it } from "vitest";
import {
  localTime,
  zonedToUtc,
  highestEducation,
  profileCompleteness,
  suggestedPtkp,
  warningActive,
  warningValidUntil,
} from "./hr.js";
import {
  employeeEducationSchema,
  employeeMovementSchema,
  employeePhotoSchema,
  employeeSchema,
  employeeWarningSchema,
} from "./schemas.js";

const child = { relation: "child" as const, dependent: true, alive: true };

describe("SDM: profil karyawan", () => {
  it("saran PTKP dari status kawin & tanggungan (maks. 3)", () => {
    expect(suggestedPtkp("male", "single", [])).toBe("TK/0");
    expect(suggestedPtkp("male", "married", [{ relation: "spouse", dependent: true, alive: true }])).toBe(
      "K/0",
    );
    expect(suggestedPtkp("male", "married", [child, child])).toBe("K/2");
    expect(suggestedPtkp("male", "married", [child, child, child, child])).toBe("K/3");
    expect(suggestedPtkp("male", "married", [child, { ...child, alive: false }])).toBe("K/1");
    expect(suggestedPtkp("male", "married", [child, { ...child, dependent: false }])).toBe("K/1");
    // Karyawan wanita kawin: TK/0 (tanggungan melekat pada suami).
    expect(suggestedPtkp("female", "married", [child])).toBe("TK/0");
    expect(suggestedPtkp("female", "divorced", [child])).toBe("TK/1");
  });

  it("masa berlaku surat peringatan 6 bulan", () => {
    expect(warningValidUntil("2026-01-15")).toBe("2026-07-14");
    expect(warningValidUntil("2026-08-31")).toBe("2027-02-27");
    expect(warningValidUntil("2026-03-01")).toBe("2026-08-31");
    const sp = { date: "2026-01-15", validUntil: "2026-07-14" };
    expect(warningActive(sp, "2026-07-14")).toBe(true);
    expect(warningActive(sp, "2026-07-15")).toBe(false);
    expect(warningActive(sp, "2026-01-14")).toBe(false);
  });

  it("pendidikan tertinggi", () => {
    expect(highestEducation([])).toBeNull();
    expect(
      highestEducation([
        { level: "sma", yearEnd: 2010 },
        { level: "s1", yearEnd: 2014 },
        { level: "d3", yearEnd: 2016 },
      ])?.level,
    ).toBe("s1");
    expect(
      highestEducation([
        { level: "s1", yearEnd: 2014 },
        { level: "s1", yearEnd: 2018 },
      ])?.yearEnd,
    ).toBe(2018);
  });

  it("kelengkapan profil", () => {
    const empty = profileCompleteness({}, { photo: false, family: 0, education: 0, documents: [] });
    // Belum kawin → data keluarga tidak wajib.
    expect(empty.missing).not.toContain("family");
    expect(empty.percent).toBe(5);
    const married = profileCompleteness(
      { maritalStatus: "married", nik: "1", birthDate: "1990-01-01" },
      { photo: true, family: 0, education: 1, documents: ["ktp"] },
    );
    expect(married.missing).toContain("family");
    expect(married.missing).not.toContain("photo");
    expect(married.missing).not.toContain("doc:ktp");
    expect(married.missing).toContain("doc:kk");
  });

  it("validasi skema profil", () => {
    const base = { name: "A", joinDate: "2026-01-01" };
    expect(employeeSchema.safeParse({ ...base, kkNo: "123" }).success).toBe(false);
    expect(employeeSchema.parse({ ...base, kkNo: "3201.0101.0101.0001", bloodType: "AB" }).kkNo).toBe(
      "3201010101010001",
    );
    expect(employeeSchema.safeParse({ ...base, bloodType: "X" }).success).toBe(false);
    expect(employeePhotoSchema.safeParse({ type: "application/pdf", data: "AAAA" }).success).toBe(false);
    expect(employeePhotoSchema.safeParse({ type: "image/png", data: "A".repeat(1_500_000) }).success).toBe(
      false,
    );
    expect(
      employeeEducationSchema.safeParse({ level: "s1", institution: "UI", yearStart: 2015, yearEnd: 2010 })
        .success,
    ).toBe(false);
    const id = "00000000-0000-4000-8000-000000000000";
    expect(
      employeeMovementSchema.safeParse({ employeeId: id, kind: "promotion", effectiveDate: "2026-01-01" })
        .success,
    ).toBe(false);
    expect(
      employeeMovementSchema.safeParse({
        employeeId: id,
        kind: "promotion",
        effectiveDate: "2026-01-01",
        newWage: 9000000,
      }).success,
    ).toBe(true);
    expect(
      employeeWarningSchema.safeParse({
        employeeId: id,
        level: "sp1",
        date: "2026-05-01",
        validUntil: "2026-04-01",
        reason: "Mangkir",
      }).success,
    ).toBe(false);
  });

  it("konversi waktu lokal ↔ UTC untuk impor absensi", () => {
    expect(zonedToUtc("2026-10-01", "08:02", "Asia/Jakarta").toISOString()).toBe("2026-10-01T01:02:00.000Z");
    expect(zonedToUtc("2026-10-01", "07:30", "Asia/Makassar").toISOString()).toBe("2026-09-30T23:30:00.000Z");
    expect(zonedToUtc("2026-07-01", "09:00", "Europe/Berlin").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(localTime(new Date("2026-10-01T10:15:00Z"), "Asia/Jayapura")).toBe("19:15");
  });
});
