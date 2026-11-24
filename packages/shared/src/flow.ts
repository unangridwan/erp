import { z } from "zod";
import type { RecordModel } from "./record-links.js";

/**
 * Alur bisnis end-to-end: proses (Order-to-Cash, Procure-to-Pay, Produksi, Rekrut-sampai-Gaji) sebagai urutan tahap.
 * Tiap dokumen membawa waktu masuk tiap tahap yang sudah dicapai; dari situ dihitung posisi sekarang, umur, SLA,
 * konversi kohort, lama per tahap (hambatan), dan waktu siklus. Diturunkan dari data transaksi yang sudah ada.
 */

export const FLOW_PROCESSES = ["o2c", "p2p", "mfg", "h2p"] as const;
export type FlowProcess = (typeof FLOW_PROCESSES)[number];

export interface FlowStageDef {
  key: string;
  label: [string, string];
  /** Yang sedang ditunggu di tahap ini. */
  waiting: [string, string];
  /** SLA bawaan (hari sejak masuk tahap); null = tahap akhir. */
  slaDays: number | null;
  /** Departemen yang lazim memegang tahap (petunjuk bila belum diatur). */
  dept: [string, string];
  /** Tahap opsional (mis. persetujuan PO): dokumen boleh melewatinya. */
  optional?: boolean;
}

export interface FlowDef {
  key: FlowProcess;
  label: [string, string];
  description: [string, string];
  model: RecordModel;
  /** Hak baca yang dibutuhkan. */
  permission: string;
  /** Input → proses → output → outcome (penjelasan ringkas di halaman alur). */
  chain: {
    input: [string, string];
    process: [string, string];
    output: [string, string];
    outcome: [string, string];
  };
  valueLabel: [string, string] | null;
  /** Tahap yang menandai output (hasil kerja) sebelum outcome (tahap akhir). */
  outputStage: string;
  stages: FlowStageDef[];
}

const st = (
  key: string,
  label: [string, string],
  waiting: [string, string],
  slaDays: number | null,
  dept: [string, string],
  optional = false,
): FlowStageDef => ({ key, label, waiting, slaDays, dept, ...(optional ? { optional } : {}) });

export const FLOW_DEFS: Record<FlowProcess, FlowDef> = {
  o2c: {
    key: "o2c",
    outputStage: "delivered",
    label: ["Order-to-Cash (Penjualan)", "Order-to-Cash"],
    description: [
      "Dari penawaran ke pelanggan sampai uang pembayaran diterima.",
      "From quotation to the customer until the payment is received.",
    ],
    model: "sale_order",
    permission: "sales.read",
    chain: {
      input: ["Permintaan & penawaran", "Requests & quotations"],
      process: ["Pesanan, pengiriman, penagihan", "Orders, delivery, invoicing"],
      output: ["Barang/jasa terkirim & faktur", "Goods/services delivered & invoices"],
      outcome: ["Kas diterima", "Cash collected"],
    },
    valueLabel: ["Nilai pesanan", "Order value"],
    stages: [
      st("quote", ["Penawaran", "Quotation"], ["Keputusan pelanggan", "Customer decision"], 14, [
        "Penjualan",
        "Sales",
      ]),
      st("order", ["Pesanan", "Order"], ["Pengiriman barang", "Delivery"], 3, ["Gudang", "Warehouse"]),
      st("delivered", ["Terkirim", "Delivered"], ["Penerbitan faktur", "Invoicing"], 2, [
        "Keuangan",
        "Finance",
      ]),
      st("invoiced", ["Ditagih", "Invoiced"], ["Pembayaran pelanggan", "Customer payment"], 30, [
        "Keuangan",
        "Finance",
      ]),
      st("paid", ["Lunas", "Paid"], ["—", "—"], null, ["Keuangan", "Finance"]),
    ],
  },
  p2p: {
    key: "p2p",
    outputStage: "received",
    label: ["Procure-to-Pay (Pembelian)", "Procure-to-Pay"],
    description: [
      "Dari permintaan penawaran ke pemasok sampai tagihannya dibayar.",
      "From the request for quotation to the supplier until their bill is paid.",
    ],
    model: "purchase_order",
    permission: "purchase.read",
    chain: {
      input: ["Kebutuhan & RFQ", "Needs & RFQs"],
      process: ["Persetujuan, PO, penerimaan", "Approval, PO, receipt"],
      output: ["Barang diterima & tagihan pemasok", "Goods received & vendor bills"],
      outcome: ["Pemasok dibayar", "Supplier paid"],
    },
    valueLabel: ["Nilai PO", "PO value"],
    stages: [
      st("rfq", ["RFQ", "RFQ"], ["Penawaran pemasok", "Supplier quote"], 7, ["Pembelian", "Purchasing"]),
      st(
        "approval",
        ["Menunggu persetujuan", "Awaiting approval"],
        ["Persetujuan", "Approval"],
        2,
        ["Manajemen", "Management"],
        true,
      ),
      st("ordered", ["PO", "PO"], ["Kedatangan barang", "Goods receipt"], 14, ["Gudang", "Warehouse"]),
      st("received", ["Diterima", "Received"], ["Tagihan pemasok", "Vendor bill"], 7, [
        "Keuangan",
        "Finance",
      ]),
      st("billed", ["Ditagih pemasok", "Billed"], ["Pembayaran", "Payment"], 30, ["Keuangan", "Finance"]),
      st("paid", ["Dibayar", "Paid"], ["—", "—"], null, ["Keuangan", "Finance"]),
    ],
  },
  mfg: {
    key: "mfg",
    outputStage: "qc",
    label: ["Plan-to-Produce (Produksi)", "Plan-to-Produce"],
    description: [
      "Dari rencana produksi sampai barang jadi lolos pemeriksaan mutu.",
      "From the production plan until finished goods pass quality control.",
    ],
    model: "production_order",
    permission: "mrp.read",
    chain: {
      input: ["Bahan & rencana", "Materials & plan"],
      process: ["Produksi di pusat kerja", "Work-center operations"],
      output: ["Barang jadi", "Finished goods"],
      outcome: ["Barang jadi lolos mutu", "Goods passed QC"],
    },
    valueLabel: ["Biaya produksi", "Production cost"],
    stages: [
      st("draft", ["Rencana", "Planned"], ["Konfirmasi", "Confirmation"], 3, ["PPIC", "Planning"]),
      st("confirmed", ["Dikonfirmasi", "Confirmed"], ["Mulai produksi", "Production start"], 3, [
        "Produksi",
        "Production",
      ]),
      st("in_progress", ["Berjalan", "In progress"], ["Selesai produksi", "Completion"], 5, [
        "Produksi",
        "Production",
      ]),
      st("qc", ["Pemeriksaan mutu", "Quality check"], ["Keputusan QC", "QC decision"], 2, [
        "Mutu",
        "Quality",
      ]),
      st("done", ["Selesai", "Done"], ["—", "—"], null, ["Produksi", "Production"]),
    ],
  },
  h2p: {
    key: "h2p",
    outputStage: "active",
    label: ["Hire-to-Pay (SDM)", "Hire-to-Pay"],
    description: [
      "Dari pelamar masuk sampai karyawan baru menerima gaji pertamanya.",
      "From a new applicant until the new hire receives their first salary.",
    ],
    model: "employee",
    permission: "hr.read",
    chain: {
      input: ["Lowongan & pelamar", "Openings & applicants"],
      process: ["Seleksi & onboarding", "Selection & onboarding"],
      output: ["Karyawan aktif", "Active employees"],
      outcome: ["Gaji pertama dibayar", "First salary paid"],
    },
    valueLabel: null,
    stages: [
      st("applying", ["Rekrutmen", "Recruiting"], ["Keputusan rekrut", "Hiring decision"], 30, ["SDM", "HR"]),
      st("hired", ["Onboarding", "Onboarding"], ["Onboarding selesai", "Onboarding done"], 14, ["SDM", "HR"]),
      st("active", ["Aktif", "Active"], ["Payroll pertama", "First payroll"], 35, ["Payroll", "Payroll"]),
      st("payroll", ["Payroll diproses", "Payroll processed"], ["Pembayaran gaji", "Salary payment"], 5, [
        "Keuangan",
        "Finance",
      ]),
      st("paid", ["Gaji dibayar", "Salary paid"], ["—", "—"], null, ["Keuangan", "Finance"]),
    ],
  },
};

/** Satu dokumen dalam alur: waktu masuk tiap tahap yang sudah dicapai (ISO tanggal/waktu). */
export interface FlowItem {
  id: string;
  model: RecordModel;
  name: string;
  partner?: string | null;
  times: Record<string, string | null | undefined>;
  /** Batas waktu tahap sekarang dari dokumen (berlaku, jadwal kirim, jatuh tempo). */
  due?: string | null;
  value?: number | null;
  ownerId?: string | null;
  /** Tautan khusus bila dokumen bukan model standar (mis. pelamar). */
  href?: string | null;
}

export interface FlowOwner {
  name: string;
  departmentId?: string | null;
  department?: string | null;
}

export type FlowStatus = "on_time" | "at_risk" | "late";

export interface FlowWorkItem {
  id: string;
  model: RecordModel;
  name: string;
  partner: string | null;
  stage: string;
  since: string;
  ageDays: number;
  due: string | null;
  status: FlowStatus;
  value: number | null;
  ownerId: string | null;
  owner: string | null;
  department: string | null;
  href: string | null;
}

export interface FlowStageSummary {
  key: string;
  label: [string, string];
  waiting: [string, string];
  slaDays: number | null;
  departmentId: string | null;
  /** Dokumen yang sedang berada di tahap ini. */
  count: number;
  value: number;
  late: number;
  atRisk: number;
  avgAge: number | null;
  maxAge: number | null;
  /** Kohort periode: dokumen yang mencapai tahap ini & % terhadap tahap pertama. */
  reached: number;
  reachedPct: number | null;
  /** Rata-rata hari tinggal di tahap ini (dokumen yang sudah melewatinya dalam periode). */
  avgDays: number | null;
}

export interface FlowSummary {
  process: FlowProcess;
  stages: FlowStageSummary[];
  /** Dokumen yang mencapai tahap akhir dalam periode. */
  completed: { count: number; value: number; cycleMedian: number | null; cycleP90: number | null };
  /** Tahap dengan lama tinggal rata-rata terbesar (atau keterlambatan terbanyak). */
  bottleneck: string | null;
  wip: { count: number; value: number; late: number };
  owners: {
    ownerId: string | null;
    owner: string;
    department: string | null;
    count: number;
    late: number;
    value: number;
  }[];
  departments: { department: string; count: number; late: number; value: number }[];
}

const DAY = 864e5;
const toTime = (s: string | null | undefined) =>
  s ? new Date(s.length === 10 ? `${s}T00:00:00Z` : s).getTime() : NaN;
export const flowDays = (a: string, b: string) => Math.max(0, Math.round((toTime(b) - toTime(a)) / DAY));
const round1 = (n: number) => Math.round(n * 10) / 10;
const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return round1(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo));
};

/**
 * Tahap sekarang: tahap terakhir yang tercapai berurutan. Tahap opsional yang tidak dilalui dilewati; lompatan pada
 * tahap wajib tidak dianggap maju (mis. sudah ditagih tetapi belum dikirim → tetap di "Pesanan").
 */
export function currentStage(def: FlowDef, item: Pick<FlowItem, "times">): string | null {
  let cur: string | null = null;
  for (const s of def.stages) {
    if (item.times[s.key]) cur = s.key;
    else if (!s.optional) break;
  }
  return cur;
}

/**
 * Waktu tahap dibuat tidak menurun: tahap tidak mungkin dimasuki setelah tahap berikutnya (data impor/riwayat lama,
 * mis. waktu konfirmasi tercatat saat migrasi data). Waktu yang lebih baru dipangkas ke waktu tahap sesudahnya.
 */
export function monotonicTimes(def: FlowDef, times: FlowItem["times"]): FlowItem["times"] {
  const out = { ...times };
  let next: string | null = null;
  for (let i = def.stages.length - 1; i >= 0; i--) {
    const k = def.stages[i]!.key;
    const t = out[k];
    if (!t) continue;
    if (next && toTime(t) > toTime(next)) out[k] = next;
    next = out[k]!;
  }
  return out;
}

/**
 * Status tahap. Bila dokumen punya batas sendiri (masa berlaku, jadwal kirim, jatuh tempo), batas itu yang dipakai:
 * terlambat bila lewat, berisiko bila ≤ 2 hari lagi. Tanpa batas dokumen dipakai SLA tahap: terlambat bila umur
 * melebihi SLA, berisiko bila ≥ 80% SLA.
 */
export function stageStatus(
  since: string,
  today: string,
  slaDays: number | null,
  due?: string | null,
): FlowStatus {
  if (due) {
    const left = Math.round((toTime(due) - toTime(today)) / DAY);
    return left < 0 ? "late" : left <= 2 ? "at_risk" : "on_time";
  }
  if (slaDays === null || slaDays < 0) return "on_time";
  const age = flowDays(since, today);
  if (age > slaDays) return "late";
  return slaDays > 0 && age >= slaDays * 0.8 ? "at_risk" : "on_time";
}

const inRange = (t: string | null | undefined, from?: string, to?: string) => {
  if (!t) return false;
  const d = t.slice(0, 10);
  return (!from || d >= from) && (!to || d <= to);
};

/** Dokumen yang sedang dikerjakan (belum di tahap akhir) beserta umur & status. */
export function workItems(
  def: FlowDef,
  items: FlowItem[],
  opts: { today: string; sla: Record<string, number | null>; owners?: Map<string, FlowOwner> },
): FlowWorkItem[] {
  const last = def.stages[def.stages.length - 1]!.key;
  const out: FlowWorkItem[] = [];
  for (const it of items) {
    const stage = currentStage(def, it);
    if (!stage || stage === last) continue;
    const since = it.times[stage]!;
    const owner = it.ownerId ? opts.owners?.get(it.ownerId) : undefined;
    out.push({
      id: it.id,
      model: it.model,
      name: it.name,
      partner: it.partner ?? null,
      stage,
      since,
      ageDays: flowDays(since, opts.today),
      due: it.due ?? null,
      status: stageStatus(since, opts.today, opts.sla[stage] ?? null, it.due),
      value: it.value ?? null,
      ownerId: it.ownerId ?? null,
      owner: owner?.name ?? null,
      department: owner?.department ?? null,
      href: it.href ?? null,
    });
  }
  return out;
}

/** Ringkasan alur: per tahap (WIP, umur, SLA, kohort, lama tinggal), selesai & waktu siklus, pemilik, departemen. */
export function summarizeFlow(
  def: FlowDef,
  items: FlowItem[],
  opts: {
    today: string;
    from?: string;
    to?: string;
    sla: Record<string, number | null>;
    departments?: Record<string, string | null>;
    owners?: Map<string, FlowOwner>;
  },
): FlowSummary {
  const keys = def.stages.map((s) => s.key);
  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const work = workItems(def, items, opts);
  const cohort = items.filter((it) => inRange(it.times[first], opts.from, opts.to));
  const completed = items.filter(
    (it) => currentStage(def, it) === last && inRange(it.times[last], opts.from, opts.to),
  );

  // Lama tinggal per tahap: dari masuk tahap sampai tahap berikutnya yang tercapai (dokumen yang keluar dalam periode).
  const durations = new Map<string, number[]>();
  for (const it of items) {
    for (let i = 0; i < keys.length - 1; i++) {
      const a = it.times[keys[i]!];
      if (!a) continue;
      const nextKey = keys.slice(i + 1).find((k) => it.times[k]);
      const b = nextKey ? it.times[nextKey] : null;
      if (!b || !inRange(b, opts.from, opts.to)) continue;
      const list = durations.get(keys[i]!) ?? [];
      list.push(flowDays(a, b));
      durations.set(keys[i]!, list);
    }
  }
  const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);

  const stages: FlowStageSummary[] = def.stages.map((s) => {
    const here = s.key === last ? [] : work.filter((w) => w.stage === s.key);
    const ages = here.map((w) => w.ageDays);
    const reached = cohort.filter((it) => it.times[s.key]).length;
    return {
      key: s.key,
      label: s.label,
      waiting: s.waiting,
      slaDays: opts.sla[s.key] ?? null,
      departmentId: opts.departments?.[s.key] ?? null,
      count: s.key === last ? completed.length : here.length,
      value: round1(
        (s.key === last ? completed.map((c) => c.value ?? 0) : here.map((w) => w.value ?? 0)).reduce(
          (a, b) => a + b,
          0,
        ),
      ),
      late: here.filter((w) => w.status === "late").length,
      atRisk: here.filter((w) => w.status === "at_risk").length,
      avgAge: avg(ages),
      maxAge: ages.length ? Math.max(...ages) : null,
      reached,
      reachedPct: cohort.length ? round1((reached / cohort.length) * 100) : null,
      avgDays: avg(durations.get(s.key) ?? []),
    };
  });

  const cycles = completed
    .map((it) => {
      const start = keys.map((k) => it.times[k]).find(Boolean);
      return start ? flowDays(start, it.times[last]!) : null;
    })
    .filter((x): x is number => x !== null)
    .sort((a, b) => a - b);

  // Hambatan: tahap dengan dokumen terlambat terbanyak; bila tidak ada, lama tinggal rata-rata terbesar.
  const open = stages.filter((s) => s.key !== last);
  const byLate = [...open].sort((a, b) => b.late - a.late || (b.avgDays ?? 0) - (a.avgDays ?? 0))[0];
  const byDays = [...open].sort((a, b) => (b.avgDays ?? -1) - (a.avgDays ?? -1))[0];
  const bottleneck = byLate && byLate.late > 0 ? byLate.key : byDays && byDays.avgDays ? byDays.key : null;

  const ownerMap = new Map<string, FlowSummary["owners"][number]>();
  const deptMap = new Map<string, FlowSummary["departments"][number]>();
  for (const w of work) {
    const ok = w.ownerId ?? "";
    const o = ownerMap.get(ok) ?? {
      ownerId: w.ownerId,
      owner: w.owner ?? "—",
      department: w.department,
      count: 0,
      late: 0,
      value: 0,
    };
    o.count++;
    if (w.status === "late") o.late++;
    o.value = round1(o.value + (w.value ?? 0));
    ownerMap.set(ok, o);
    const dk = w.department ?? "—";
    const d = deptMap.get(dk) ?? { department: dk, count: 0, late: 0, value: 0 };
    d.count++;
    if (w.status === "late") d.late++;
    d.value = round1(d.value + (w.value ?? 0));
    deptMap.set(dk, d);
  }

  return {
    process: def.key,
    stages,
    completed: {
      count: completed.length,
      value: round1(completed.reduce((s, c) => s + (c.value ?? 0), 0)),
      cycleMedian: quantile(cycles, 0.5),
      cycleP90: quantile(cycles, 0.9),
    },
    bottleneck,
    wip: {
      count: work.length,
      value: round1(work.reduce((s, w) => s + (w.value ?? 0), 0)),
      late: work.filter((w) => w.status === "late").length,
    },
    owners: [...ownerMap.values()].sort((a, b) => b.late - a.late || b.count - a.count).slice(0, 30),
    departments: [...deptMap.values()].sort((a, b) => b.late - a.late || b.count - a.count),
  };
}

/** Pengaturan SLA & departemen per tahap (`PUT /flow/:process/settings`). */
export const flowSettingsSchema = z.object({
  stages: z
    .array(
      z.object({
        stage: z.string().trim().min(1).max(40),
        slaDays: z.number().int().min(0).max(3650).nullable(),
        departmentId: z.string().uuid().nullable(),
      }),
    )
    .max(20),
});
export type FlowSettingsInput = z.infer<typeof flowSettingsSchema>;
