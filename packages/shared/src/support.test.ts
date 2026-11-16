import { describe, expect, it } from "vitest";
import {
  parseEmailAddress,
  slaDueDates,
  slaPolicyError,
  slaPolicySchema,
  slaState,
  ticketNumberFromSubject,
  ticketSchema,
  ticketStats,
} from "./support.js";

describe("support", () => {
  it("tenggat SLA dari waktu dibuat", () => {
    const d = slaDueDates("2026-11-16T08:00:00Z", { firstResponseHours: 4, resolutionHours: "24" });
    expect(d.firstResponseDue.toISOString()).toBe("2026-11-16T12:00:00.000Z");
    expect(d.resolveDue.toISOString()).toBe("2026-11-17T08:00:00.000Z");
    expect(
      slaDueDates("2026-11-16T08:00:00Z", {
        firstResponseHours: 0.5,
        resolutionHours: 1,
      }).firstResponseDue.toISOString(),
    ).toBe("2026-11-16T08:30:00.000Z");
  });

  it("status SLA: tepat waktu, terlambat, hampir lewat, berjalan", () => {
    const start = "2026-11-16T08:00:00Z";
    const due = "2026-11-16T12:00:00Z";
    expect(slaState(start, due, "2026-11-16T11:00:00Z")).toBe("met");
    expect(slaState(start, due, "2026-11-16T12:30:00Z")).toBe("breached");
    expect(slaState(start, due, null, "2026-11-16T13:00:00Z")).toBe("breached");
    expect(slaState(start, due, null, "2026-11-16T11:30:00Z")).toBe("at_risk");
    expect(slaState(start, due, null, "2026-11-16T09:00:00Z")).toBe("on_track");
    expect(slaState(start, null, null)).toBe("none");
  });

  it("statistik tiket: rata-rata jam, kepatuhan SLA, kepuasan", () => {
    const s = ticketStats([
      {
        createdAt: "2026-11-16T08:00:00Z",
        firstRespondedAt: "2026-11-16T09:00:00Z",
        resolvedAt: "2026-11-16T18:00:00Z",
        firstResponseDue: "2026-11-16T12:00:00Z",
        resolveDue: "2026-11-17T08:00:00Z",
        satisfaction: 5,
      },
      {
        createdAt: "2026-11-16T08:00:00Z",
        firstRespondedAt: "2026-11-16T14:00:00Z",
        firstResponseDue: "2026-11-16T12:00:00Z",
        resolveDue: "2026-11-17T08:00:00Z",
        satisfaction: 2,
      },
      { createdAt: "2026-11-16T08:00:00Z" },
    ]);
    expect(s).toEqual({
      total: 3,
      avgFirstResponseHours: 3.5,
      avgResolutionHours: 10,
      firstResponseCompliance: 50,
      resolutionCompliance: 100,
      avgSatisfaction: 3.5,
      rated: 2,
    });
    expect(ticketStats([])).toMatchObject({
      total: 0,
      avgFirstResponseHours: null,
      firstResponseCompliance: null,
    });
  });

  it("nomor tiket dari subjek & alamat email", () => {
    expect(ticketNumberFromSubject("Re: [TKT/2026/0007] Pompa rusak")).toBe("TKT/2026/0007");
    expect(ticketNumberFromSubject("Pompa rusak")).toBeNull();
    expect(parseEmailAddress('"Budi Santoso" <Budi@Contoh.ID>')).toEqual({
      email: "budi@contoh.id",
      name: "Budi Santoso",
    });
    expect(parseEmailAddress("sari@contoh.id")).toEqual({ email: "sari@contoh.id", name: null });
    expect(parseEmailAddress("bukan email")).toEqual({ email: null, name: null });
  });

  it("skema tiket & SLA", () => {
    expect(ticketSchema.parse({ subject: "Pompa rusak" })).toMatchObject({
      channel: "phone",
      priority: "normal",
      status: "new",
    });
    expect(ticketSchema.safeParse({ subject: "x", priority: "darurat" }).success).toBe(false);
    expect(
      slaPolicySchema.safeParse({ name: "x", priority: "high", firstResponseHours: 0, resolutionHours: 4 })
        .success,
    ).toBe(false);
    expect(slaPolicyError({ firstResponseHours: "8", resolutionHours: "4" })?.[0]).toBe("resolutionHours");
    expect(slaPolicyError({ firstResponseHours: "4", resolutionHours: "8" })).toBeNull();
  });
});
