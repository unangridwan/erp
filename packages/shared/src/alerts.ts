import { z } from "zod";

/**
 * Peringatan dini otomatis: aturan yang diperiksa harian dan mengirim notifikasi ringkas (satu per orang per aturan
 * per hari) sebelum masalah membesar — dokumen lewat SLA, stok menipis, piutang menua, anggaran hampir habis, target
 * tertinggal laju, persetujuan tertahan, pemasok sering terlambat, dan proyeksi kas negatif.
 */
export type AlertRecipient = "owner" | "manager" | "role";

export interface AlertParamDef {
  key: string;
  label: [string, string];
  min: number;
  max: number;
  default: number;
  unit: [string, string];
}

export interface AlertDef {
  key: string;
  label: [string, string];
  description: [string, string];
  /** Hak untuk menghitung aturan (pemilik pengaturan) & hak penerima peran. */
  permission: string;
  params: AlertParamDef[];
  /** Penerima yang bisa dipilih & bawaannya. `role` = pengguna yang punya hak `rolePermission`. */
  recipients: AlertRecipient[];
  rolePermission: string;
  defaultRecipients: AlertRecipient[];
  /** Tautan halaman tindak lanjut. */
  link: string;
}

const days = (key: string, label: [string, string], def: number, max = 365): AlertParamDef => ({
  key,
  label,
  min: 0,
  max,
  default: def,
  unit: ["hari", "days"],
});
const percent = (key: string, label: [string, string], def: number): AlertParamDef => ({
  key,
  label,
  min: 1,
  max: 100,
  default: def,
  unit: ["%", "%"],
});

export const ALERT_DEFS: AlertDef[] = [
  {
    key: "flow_late",
    label: ["Dokumen lewat SLA", "Documents past SLA"],
    description: [
      "Dokumen alur bisnis (pesanan, PO, produksi, rekrutmen) yang tertahan di tahapnya melewati SLA atau batas dokumen.",
      "Business-flow documents (orders, POs, production, hiring) stuck in a stage past the SLA or the document deadline.",
    ],
    permission: "",
    params: [days("graceDays", ["Toleransi setelah lewat", "Grace after late"], 0, 90)],
    rolePermission: "settings.manage",
    recipients: ["owner", "manager", "role"],
    defaultRecipients: ["owner", "manager"],
    link: "/flow/handoffs",
  },
  {
    key: "stock_low",
    label: ["Stok di bawah minimum", "Stock below minimum"],
    description: [
      "Produk dengan aturan stok minimum yang perkiraan stoknya (stok + masuk − keluar + RFQ) di bawah minimum.",
      "Products with a reorder rule whose forecast (on hand + incoming − outgoing + RFQs) is below the minimum.",
    ],
    permission: "purchase.read",
    params: [],
    rolePermission: "purchase.write",
    recipients: ["role"],
    defaultRecipients: ["role"],
    link: "/purchase/replenishment",
  },
  {
    key: "ar_overdue",
    label: ["Piutang menua", "Aging receivables"],
    description: [
      "Faktur pelanggan yang belum lunas lewat jatuh tempo lebih dari N hari.",
      "Unpaid customer invoices overdue by more than N days.",
    ],
    permission: "accounting.read",
    params: [days("overdueDays", ["Lewat jatuh tempo lebih dari", "Overdue by more than"], 30)],
    rolePermission: "accounting.write",
    recipients: ["owner", "role"],
    defaultRecipients: ["owner", "role"],
    link: "/accounting/aged",
  },
  {
    key: "budget_threshold",
    label: ["Anggaran hampir habis", "Budget nearly used"],
    description: [
      "Cost center/departemen yang realisasi bebannya mencapai ambang persentase anggaran tahun berjalan.",
      "Cost centers/departments whose spending reaches the threshold of this year's budget.",
    ],
    permission: "accounting.read",
    params: [percent("threshold", ["Ambang pemakaian", "Usage threshold"], 90)],
    rolePermission: "accounting.manage",
    recipients: ["manager", "role"],
    defaultRecipients: ["manager", "role"],
    link: "/flow/money",
  },
  {
    key: "goal_behind",
    label: ["Target tertinggal laju", "Goals behind pace"],
    description: [
      "Sasaran aktif berstatus merah: capaian di bawah 70% dari yang semestinya tercapai pada titik waktu ini.",
      "Active goals rated red: progress below 70% of where it should be by now.",
    ],
    permission: "",
    params: [],
    rolePermission: "hr.manage",
    recipients: ["owner", "manager", "role"],
    defaultRecipients: ["owner", "manager"],
    link: "/flow/scorecard",
  },
  {
    key: "approval_waiting",
    label: ["Persetujuan tertahan", "Approvals waiting"],
    description: [
      "PO yang menunggu persetujuan lebih dari N hari.",
      "Purchase orders waiting for approval for more than N days.",
    ],
    permission: "purchase.read",
    params: [days("waitDays", ["Menunggu lebih dari", "Waiting more than"], 2, 60)],
    rolePermission: "purchase.approve",
    recipients: ["owner", "role"],
    defaultRecipients: ["owner", "role"],
    link: "/purchase/orders",
  },
  {
    key: "supplier_late",
    label: ["Pemasok sering terlambat", "Suppliers often late"],
    description: [
      "Pemasok dengan penerimaan tepat waktu di bawah ambang dalam 90 hari terakhir (minimal 3 penerimaan).",
      "Suppliers whose on-time receipts fall below the threshold in the last 90 days (at least 3 receipts).",
    ],
    permission: "purchase.read",
    params: [percent("threshold", ["Tepat waktu di bawah", "On time below"], 80)],
    rolePermission: "purchase.write",
    recipients: ["role"],
    defaultRecipients: ["role"],
    link: "/flow/supply",
  },
  {
    key: "cash_negative",
    label: ["Proyeksi kas negatif", "Negative cash forecast"],
    description: [
      "Proyeksi kas 13 minggu menunjukkan saldo kas di bawah batas minimum.",
      "The 13-week cash forecast shows the cash balance falling below the minimum.",
    ],
    permission: "accounting.read",
    params: [
      {
        key: "minBalance",
        label: ["Saldo minimum", "Minimum balance"],
        min: 0,
        max: 1e15,
        default: 0,
        unit: ["Rp", "IDR"],
      },
    ],
    rolePermission: "accounting.manage",
    recipients: ["role"],
    defaultRecipients: ["role"],
    link: "/flow/money",
  },
];

export const ALERT_BY_KEY = new Map(ALERT_DEFS.map((d) => [d.key, d]));

/** Nilai parameter efektif: tersimpan bila valid, selain itu bawaan. */
export function alertParams(def: AlertDef, saved: Record<string, unknown> | null | undefined) {
  return Object.fromEntries(
    def.params.map((p) => {
      const v = Number(saved?.[p.key]);
      return [p.key, Number.isFinite(v) && v >= p.min && v <= p.max ? v : p.default];
    }),
  ) as Record<string, number>;
}

export const alertRuleSchema = z.object({
  active: z.boolean(),
  params: z.record(z.string(), z.number()).default({}),
  recipients: z
    .array(z.enum(["owner", "manager", "role"]))
    .max(3)
    .default([]),
});
export type AlertRuleInput = z.infer<typeof alertRuleSchema>;

/** Ringkas temuan per penerima: satu notifikasi berisi jumlah & contoh teratas. */
export function digestFor(
  findings: { userId: string; item: string }[],
  limit = 5,
): Map<string, { count: number; items: string[] }> {
  const out = new Map<string, { count: number; items: string[] }>();
  for (const f of findings) {
    const d = out.get(f.userId) ?? { count: 0, items: [] };
    d.count++;
    if (d.items.length < limit) d.items.push(f.item);
    out.set(f.userId, d);
  }
  return out;
}
