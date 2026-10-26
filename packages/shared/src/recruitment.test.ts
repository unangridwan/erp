import { describe, expect, it } from "vitest";
import {
  DEFAULT_OFFER_TEMPLATE,
  exitSummary,
  finalSettlement,
  recruitmentReport,
  renderOfferTemplate,
} from "./recruitment.js";

describe("renderOfferTemplate", () => {
  it("mengisi placeholder yang diketahui, sisanya tetap", () => {
    expect(
      renderOfferTemplate("Halo {nama}, posisi {posisi} {x} {gaji}", { nama: "Ani", posisi: "Staf" }),
    ).toBe("Halo Ani, posisi Staf {x} {gaji}");
    const body = renderOfferTemplate(DEFAULT_OFFER_TEMPLATE.body, {
      nama: "Ani",
      posisi: "Kasir",
      departemen: "Toko",
      gaji: "Rp 5.000.000",
      tunjangan: "Makan",
      tanggal_mulai: "1 November 2026",
      berlaku_sampai: "31 Oktober 2026",
      jenis_kontrak: "PKWT",
      perusahaan: "PT Maju",
      tanggal: "26 Oktober 2026",
    });
    expect(body).not.toMatch(/\{[a-z_]+\}/);
    expect(body).toContain("posisi Kasir di departemen Toko");
  });
});

describe("recruitmentReport", () => {
  const r = recruitmentReport({
    openings: [
      { id: "a", name: "Kasir", dateOpen: "2026-09-01", quota: 2, state: "closed" },
      { id: "b", name: "Gudang", dateOpen: "2026-10-01", quota: 1, state: "open" },
    ],
    applicants: [
      {
        openingId: "a",
        stage: "hired",
        source: "referral",
        createdAt: "2026-09-05",
        hiredAt: "2026-09-21",
        refuseReason: null,
      },
      {
        openingId: "a",
        stage: "hired",
        source: "jobportal",
        createdAt: "2026-09-02",
        hiredAt: "2026-09-11",
        refuseReason: null,
      },
      {
        openingId: "a",
        stage: "refused",
        source: "jobportal",
        createdAt: "2026-09-03",
        hiredAt: null,
        refuseReason: "Tidak lolos wawancara",
        lastStage: "interview",
      },
      {
        openingId: "b",
        stage: "screening",
        source: "jobportal",
        createdAt: "2026-10-02",
        hiredAt: null,
        refuseReason: null,
      },
    ],
  });
  it("time-to-fill = buka → pelamar yang memenuhi kuota diterima; lowongan belum terisi null", () => {
    expect(r.openings[0]).toMatchObject({ hired: 2, filled: true, daysToFill: 20 });
    expect(r.openings[1]).toMatchObject({ filled: false, daysToFill: null });
    expect(r.avgTimeToFill).toBe(20);
    expect(r.avgTimeToHire).toBe(12.5); // 16 & 9 hari
  });
  it("funnel memakai tahap terakhir pelamar ditolak; sumber & alasan tolak", () => {
    expect(Object.fromEntries(r.funnel.map((f) => [f.stage, f.count]))).toEqual({
      new: 4,
      screening: 4,
      interview: 3,
      offer: 2,
      hired: 2,
    });
    expect(r.sources[0]).toEqual({ key: "jobportal", count: 3, hired: 1 });
    expect(r.refuseReasons).toEqual([{ key: "Tidak lolos wawancara", count: 1 }]);
  });
});

describe("exitSummary & finalSettlement", () => {
  it("rata-rata skor, alasan utama, persentase", () => {
    const s = exitSummary([
      {
        mainReason: "compensation",
        scores: { compensation: 2, manager: 4 },
        wouldRejoin: true,
        wouldRecommend: null,
      },
      { mainReason: "compensation", scores: { compensation: 3 }, wouldRejoin: false, wouldRecommend: true },
      { mainReason: "career", scores: {}, wouldRejoin: null, wouldRecommend: true },
    ]);
    expect(s.scores.find((x) => x.key === "compensation")?.average).toBe(2.5);
    expect(s.scores.find((x) => x.key === "workload")?.average).toBeNull();
    expect(s.reasons[0]).toEqual({ key: "compensation", count: 2 });
    expect(s).toMatchObject({ count: 3, wouldRejoin: 50, wouldRecommend: 100 });
  });
  it("hak dikurangi kewajiban", () => {
    const f = finalSettlement([
      { kind: "salary", label: "Gaji Oktober", amount: "5000000", direction: "pay" },
      { kind: "severance", label: "Pesangon", amount: "12000000.4", direction: "pay" },
      { kind: "loan", label: "Sisa pinjaman", amount: "3000000", direction: "deduct" },
    ]);
    expect(f).toMatchObject({ totalPay: "17000000", totalDeduct: "3000000", net: "14000000" });
  });
});
