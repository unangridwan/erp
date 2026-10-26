/** Logika murni rekrutmen hulu & offboarding: template penawaran, laporan time-to-fill, exit interview, Full & Final. */
import { Decimal } from "decimal.js";

/** Placeholder surat penawaran kerja. */
export const OFFER_PLACEHOLDERS = [
  "nama",
  "posisi",
  "departemen",
  "gaji",
  "tunjangan",
  "tanggal_mulai",
  "berlaku_sampai",
  "jenis_kontrak",
  "perusahaan",
  "tanggal",
] as const;
export type OfferPlaceholder = (typeof OFFER_PLACEHOLDERS)[number];

/** Isi placeholder `{kunci}`; placeholder yang tidak dikenal/tanpa nilai dibiarkan apa adanya. */
export function renderOfferTemplate(body: string, vars: Partial<Record<OfferPlaceholder, string | null>>) {
  return body.replace(/\{([a-z_]+)\}/g, (whole, key: string) => {
    const v = vars[key as OfferPlaceholder];
    return v === undefined || v === null ? whole : v;
  });
}

export const DEFAULT_OFFER_TEMPLATE = {
  name: "Surat Penawaran Kerja",
  body: `{tanggal}

Kepada Yth.
{nama}

Dengan hormat,

Menindaklanjuti proses seleksi yang telah Saudara/i ikuti, dengan senang hati {perusahaan} menawarkan posisi {posisi} di departemen {departemen} dengan ketentuan sebagai berikut:

1. Status hubungan kerja: {jenis_kontrak}
2. Gaji pokok: {gaji} per bulan
3. Tunjangan & fasilitas: {tunjangan}
4. Tanggal mulai bekerja: {tanggal_mulai}

Penawaran ini berlaku sampai dengan {berlaku_sampai}. Mohon konfirmasi persetujuan Saudara/i sebelum tanggal tersebut.

Hormat kami,
{perusahaan}`,
};

/** Alasan penolakan pelamar bawaan. */
export const DEFAULT_REFUSE_REASONS = [
  "Tidak memenuhi kualifikasi",
  "Ekspektasi gaji tidak sesuai",
  "Tidak lolos wawancara",
  "Tidak lolos tes/psikotes",
  "Kandidat mengundurkan diri",
  "Menolak penawaran",
  "Posisi sudah terisi",
  "Lainnya",
];

const DAY = 86_400_000;
const days = (from: string | Date, to: string | Date) =>
  Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY));

export const FUNNEL_STAGES = ["new", "screening", "interview", "offer", "hired"] as const;

/**
 * Laporan rekrutmen: time-to-fill per lowongan (buka → pelamar terakhir yang mengisi kuota diterima), time-to-hire per
 * pelamar (melamar → diterima), funnel (jumlah pelamar yang pernah mencapai tiap tahap; pelamar ditolak dihitung
 * di tahap terakhirnya bila diketahui, selain itu di tahap awal), sumber, dan alasan penolakan.
 */
export function recruitmentReport(input: {
  openings: { id: string; name: string; dateOpen: string; quota: number; state: string }[];
  applicants: {
    openingId: string;
    stage: string;
    source: string;
    createdAt: string | Date;
    hiredAt: string | Date | null;
    refuseReason: string | null;
    lastStage?: string | null;
  }[];
}) {
  const openings = input.openings.map((o) => {
    const hires = input.applicants
      .filter((a) => a.openingId === o.id && a.hiredAt)
      .map((a) => new Date(a.hiredAt!))
      .sort((x, y) => x.getTime() - y.getTime());
    const filled = hires.length >= o.quota;
    return {
      id: o.id,
      name: o.name,
      quota: o.quota,
      hired: hires.length,
      applicants: input.applicants.filter((a) => a.openingId === o.id).length,
      filled,
      daysToFill: filled ? days(o.dateOpen, hires[o.quota - 1]!) : null,
      daysOpen: filled ? null : days(o.dateOpen, new Date()),
    };
  });
  const filled = openings.filter((o) => o.daysToFill !== null);
  const hired = input.applicants.filter((a) => a.hiredAt);
  const avg = (xs: number[]) =>
    xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null;
  const reachedIndex = (a: (typeof input.applicants)[number]) => {
    const stage = a.stage === "refused" ? (a.lastStage ?? "new") : a.stage;
    return Math.max(0, FUNNEL_STAGES.indexOf(stage as (typeof FUNNEL_STAGES)[number]));
  };
  const funnel = FUNNEL_STAGES.map((stage, i) => ({
    stage,
    count: input.applicants.filter((a) => reachedIndex(a) >= i).length,
  }));
  const tally = (keys: (string | null)[]) => {
    const m = new Map<string, number>();
    for (const k of keys) if (k) m.set(k, (m.get(k) ?? 0) + 1);
    return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  };
  return {
    openings,
    avgTimeToFill: avg(filled.map((o) => o.daysToFill!)),
    avgTimeToHire: avg(hired.map((a) => days(a.createdAt, a.hiredAt!))),
    funnel,
    sources: tally(input.applicants.map((a) => a.source)).map((s) => ({
      ...s,
      hired: hired.filter((a) => a.source === s.key).length,
    })),
    refuseReasons: tally(
      input.applicants.filter((a) => a.stage === "refused").map((a) => a.refuseReason ?? "—"),
    ),
  };
}

/** Pertanyaan exit interview (skor 1–5). */
export const EXIT_QUESTIONS = [
  { key: "compensation", label: ["Gaji & tunjangan", "Pay & benefits"] },
  { key: "manager", label: ["Hubungan dengan atasan", "Relationship with manager"] },
  { key: "workload", label: ["Beban kerja", "Workload"] },
  { key: "career", label: ["Pengembangan karier", "Career development"] },
  { key: "environment", label: ["Lingkungan & rekan kerja", "Environment & colleagues"] },
  { key: "work_life", label: ["Keseimbangan kerja & kehidupan", "Work-life balance"] },
] as const;

/** Ringkasan exit interview: rata-rata skor per pertanyaan, alasan utama, persentase mau kembali/merekomendasikan. */
export function exitSummary(
  rows: {
    mainReason: string;
    scores: Record<string, number>;
    wouldRejoin: boolean | null;
    wouldRecommend: boolean | null;
  }[],
) {
  const pct = (xs: (boolean | null)[]) => {
    const known = xs.filter((x): x is boolean => x !== null);
    return known.length ? Math.round((known.filter(Boolean).length / known.length) * 100) : null;
  };
  const reasons = new Map<string, number>();
  for (const r of rows) reasons.set(r.mainReason, (reasons.get(r.mainReason) ?? 0) + 1);
  return {
    count: rows.length,
    scores: EXIT_QUESTIONS.map((q) => {
      const xs = rows.map((r) => r.scores[q.key]).filter((x): x is number => typeof x === "number");
      return {
        key: q.key,
        average: xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null,
      };
    }),
    reasons: [...reasons.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count),
    wouldRejoin: pct(rows.map((r) => r.wouldRejoin)),
    wouldRecommend: pct(rows.map((r) => r.wouldRecommend)),
  };
}

export type SettlementKind = "salary" | "severance" | "claim" | "loan" | "other";

/**
 * Full & Final Statement: hak yang masih harus dibayar ke karyawan (gaji belum dibayar/ditahan, pesangon, klaim)
 * dikurangi kewajiban karyawan (sisa pinjaman). Hasil positif = dibayar ke karyawan; negatif = ditagih ke karyawan.
 */
export function finalSettlement(
  items: { kind: SettlementKind; label: string; amount: Decimal.Value; direction: "pay" | "deduct" }[],
) {
  const sum = (dir: "pay" | "deduct") =>
    items.filter((i) => i.direction === dir).reduce((s, i) => s.plus(i.amount), new Decimal(0));
  const pay = sum("pay");
  const deduct = sum("deduct");
  return {
    items: items.map((i) => ({ ...i, amount: new Decimal(i.amount).toFixed(0) })),
    totalPay: pay.toFixed(0),
    totalDeduct: deduct.toFixed(0),
    net: pay.minus(deduct).toFixed(0),
  };
}
