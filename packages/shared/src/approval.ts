/** Logika murni mesin persetujuan generik: pembentukan tahap (DoA), hasil keputusan, validasi field. */

export type ApprovalMode = "sequential" | "parallel";
export type StepState = "pending" | "approved" | "refused" | "skipped";

export interface CategoryApprover {
  /** Salah satu: user tertentu, atau peran (semua pemegang peran di perusahaan). */
  userId?: string | null;
  roleId?: string | null;
  label?: string | null;
  required: boolean;
  /** Batas nominal DoA: tahap berlaku bila nominal ≥ batas; null = selalu. */
  minAmount?: string | number | null;
}

export interface PlannedStep {
  sequence: number;
  /** Keduanya null = diputuskan HR. */
  approverUserId: string | null;
  approverRoleId?: string | null;
  label: string | null;
  required: boolean;
}

/**
 * Tahap persetujuan untuk permintaan baru: atasan langsung (bila `managerFirst`), lalu penyetuju kategori yang
 * batas nominalnya terpenuhi. Pemohon sendiri & duplikat dibuang (larangan menyetujui permintaan sendiri); bila tidak
 * ada tahap tersisa, permintaan diputuskan HR.
 */
export function buildApprovalSteps(input: {
  managerFirst: boolean;
  approvers: CategoryApprover[];
  amount?: string | number | null;
  managerUserId?: string | null;
  requesterUserId?: string | null;
}): PlannedStep[] {
  const amount = Number(input.amount ?? 0);
  const candidates: Omit<PlannedStep, "sequence">[] = [];
  if (input.managerFirst && input.managerUserId)
    candidates.push({ approverUserId: input.managerUserId, label: "Atasan langsung", required: true });
  for (const a of input.approvers) {
    if (
      a.minAmount !== null &&
      a.minAmount !== undefined &&
      a.minAmount !== "" &&
      amount < Number(a.minAmount)
    )
      continue;
    candidates.push({
      approverUserId: a.userId ?? null,
      ...(a.roleId ? { approverRoleId: a.roleId } : {}),
      label: a.label ?? null,
      required: a.required,
    });
  }
  const seen = new Map<string, PlannedStep>();
  const steps: PlannedStep[] = [];
  for (const c of candidates) {
    const key = c.approverUserId
      ? `u:${c.approverUserId}`
      : c.approverRoleId
        ? `r:${c.approverRoleId}`
        : null;
    if (!key || c.approverUserId === input.requesterUserId) continue;
    const prev = seen.get(key);
    if (prev) {
      // Penyetuju yang sama muncul lagi: cukup sekali, tapi tetap wajib bila salah satunya wajib.
      if (c.required) prev.required = true;
      continue;
    }
    const step: PlannedStep = { ...c, sequence: steps.length + 1 };
    seen.set(key, step);
    steps.push(step);
  }
  return steps.length ? steps : [{ sequence: 1, approverUserId: null, label: "HR", required: true }];
}

export interface StepStatus {
  sequence: number;
  required: boolean;
  state: StepState;
}

/**
 * Hasil permintaan dari status tahapnya. Penolakan mana pun menolak permintaan. Disetujui bila semua tahap wajib
 * setuju dan jumlah persetujuan mencapai minimum (0 = semua tahap). `open` = urutan tahap yang boleh diputuskan
 * sekarang: berurutan → tahap pending terendah; paralel → semua tahap pending.
 */
export function requestOutcome(
  steps: StepStatus[],
  mode: ApprovalMode,
  minApprovals = 0,
): { state: "submitted" | "approved" | "refused"; open: number[] } {
  if (steps.some((s) => s.state === "refused")) return { state: "refused", open: [] };
  const active = steps.filter((s) => s.state !== "skipped");
  const approved = active.filter((s) => s.state === "approved").length;
  const needed = minApprovals > 0 ? Math.min(minApprovals, active.length) : active.length;
  const requiredDone = active.every((s) => !s.required || s.state === "approved");
  if (requiredDone && approved >= needed) return { state: "approved", open: [] };
  const pending = active.filter((s) => s.state === "pending").sort((a, b) => a.sequence - b.sequence);
  return {
    state: "submitted",
    open: mode === "parallel" ? pending.map((s) => s.sequence) : pending.slice(0, 1).map((s) => s.sequence),
  };
}

export type ApprovalFieldConfig = Partial<
  Record<
    | "date"
    | "period"
    | "quantity"
    | "amount"
    | "reference"
    | "location"
    | "contact"
    | "description"
    | "attachment",
    "required" | "optional" | "none"
  >
>;

/** Label field untuk pesan validasi. */
export const APPROVAL_FIELD_LABELS: Record<keyof ApprovalFieldConfig, string> = {
  date: "Tanggal",
  period: "Periode",
  quantity: "Jumlah",
  amount: "Nominal",
  reference: "Referensi",
  location: "Lokasi",
  contact: "Kontak",
  description: "Keterangan",
  attachment: "Lampiran",
};

const empty = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Field wajib yang belum diisi (nama field input: `period` = dateFrom & dateTo). */
export function missingApprovalFields(
  fields: ApprovalFieldConfig,
  value: {
    date?: string | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    quantity?: string | number | null;
    amount?: string | number | null;
    reference?: string | null;
    location?: string | null;
    contact?: string | null;
    description?: string | null;
    hasAttachment?: boolean;
  },
): (keyof ApprovalFieldConfig)[] {
  const missing: (keyof ApprovalFieldConfig)[] = [];
  for (const [key, mode] of Object.entries(fields) as [keyof ApprovalFieldConfig, string][]) {
    if (mode !== "required") continue;
    const absent =
      key === "period"
        ? empty(value.dateFrom) || empty(value.dateTo)
        : key === "attachment"
          ? !value.hasAttachment
          : empty(value[key]);
    if (absent) missing.push(key);
  }
  return missing;
}

/** Kategori bawaan BLST (PRD Persetujuan): diisi otomatis untuk perusahaan yang belum punya kategori. */
export const DEFAULT_APPROVAL_CATEGORIES: {
  code: string;
  name: string;
  prefix: string;
  description: string;
  fields: ApprovalFieldConfig;
}[] = [
  {
    code: "FPK",
    name: "Formulir Permintaan Karyawan",
    prefix: "FPK",
    description: "Permintaan penambahan tenaga kerja: posisi, jumlah, alasan, estimasi biaya.",
    fields: { quantity: "required", amount: "optional", date: "optional", description: "required" },
  },
  {
    code: "DINAS",
    name: "Perjalanan Dinas",
    prefix: "SPD",
    description: "Surat perintah perjalanan dinas dengan tujuan, periode, dan estimasi biaya.",
    fields: { period: "required", location: "required", amount: "optional", description: "required" },
  },
  {
    code: "UANG_MUKA",
    name: "Uang Muka",
    prefix: "UM",
    description: "Uang muka kegiatan/dinas yang dipertanggungjawabkan dengan klaim biaya.",
    fields: { amount: "required", date: "required", reference: "optional", description: "required" },
  },
  {
    code: "LEMBUR",
    name: "Lembur Terencana",
    prefix: "LBR",
    description: "Rencana lembur sebelum dilaksanakan: tanggal, jumlah jam, alasan.",
    fields: { date: "required", quantity: "required", description: "required" },
  },
  {
    code: "PINJAM",
    name: "Peminjaman Aset/Kendaraan",
    prefix: "PJM",
    description: "Peminjaman aset atau kendaraan dinas untuk periode tertentu.",
    fields: { period: "required", reference: "required", location: "optional", description: "optional" },
  },
  {
    code: "KONTRAK",
    name: "Persetujuan Kontrak/Perjanjian",
    prefix: "KTR",
    description: "Persetujuan draf kontrak atau perjanjian dengan pihak ketiga.",
    fields: {
      contact: "required",
      reference: "optional",
      amount: "optional",
      period: "optional",
      attachment: "required",
    },
  },
  {
    code: "BAYAR",
    name: "Permohonan Pembayaran",
    prefix: "PMB",
    description: "Permohonan pembayaran kepada pihak ketiga.",
    fields: {
      amount: "required",
      contact: "required",
      date: "optional",
      reference: "optional",
      attachment: "required",
    },
  },
  {
    code: "UMUM",
    name: "Persetujuan Umum",
    prefix: "PRS",
    description: "Permintaan persetujuan lain yang tidak punya kategori khusus.",
    fields: { description: "required", amount: "optional", attachment: "optional" },
  },
];
