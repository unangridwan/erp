import { and, eq, inArray, schema, type Db } from "@erp/db";
import { DEFAULT_APPROVAL_CATEGORIES } from "@erp/shared";

const CAT = schema.approvalCategories;

type Fields = Partial<Record<"amount" | "quantity" | "date" | "description", "required" | "optional">>;

export interface SystemCategory {
  def: { code: string; name: string; prefix: string; description: string; fields: Fields };
  /** Dokumen yang meminta persetujuan lewat kategori ini (ditampilkan di Pengaturan › Aturan Persetujuan). */
  usedBy: readonly [id: string, en: string];
  sequence: number;
  /** Atasan pemohon menjadi penyetuju pertama (default: tidak). */
  managerFirst?: boolean;
}

const amountDesc = { amount: "required", description: "required" } as const;

/**
 * Kategori persetujuan yang dipakai dokumen sistem (bukan permintaan bebas). Dibuat otomatis per perusahaan agar
 * penyetujunya bisa diatur sebelum dokumen pertama diajukan; kode & prefixnya tetap dan kategori tidak bisa dihapus.
 */
export const SYSTEM_APPROVAL_CATEGORIES = {
  PAYROLL: {
    def: {
      code: "PAYROLL",
      name: "Payroll Run",
      prefix: "PYR",
      description:
        "Persetujuan payroll run sebelum diposting: jumlah slip, total bruto, neto, PPh 21, dan BPJS.",
      fields: amountDesc,
    },
    usedBy: ["Payroll run", "Payroll run"],
    sequence: 910,
  },
  MUTASI: {
    def: {
      code: "MUTASI",
      name: "Mutasi & Promosi",
      prefix: "MTS",
      description:
        "Persetujuan SK mutasi/promosi/demosi/penyesuaian upah sebelum diterapkan (jabatan, departemen, golongan, upah baru).",
      fields: amountDesc,
    },
    usedBy: ["SK promosi, mutasi & penyesuaian upah", "Promotion, transfer & wage decrees"],
    sequence: 910,
  },
  PENAWARAN: {
    def: {
      code: "PENAWARAN",
      name: "Penawaran Kerja",
      prefix: "OFR",
      description:
        "Persetujuan penawaran kerja sebelum dikirim ke pelamar (posisi, jenis kontrak, gaji ditawarkan).",
      fields: amountDesc,
    },
    usedBy: ["Penawaran kerja", "Job offers"],
    sequence: 910,
  },
  KASBON: {
    def: {
      code: "KASBON",
      name: "Kasbon Karyawan",
      prefix: "KSB",
      description:
        "Persetujuan kasbon (uang muka karyawan) sebelum dicairkan: keperluan, jumlah, dan batas pertanggungjawaban.",
      fields: amountDesc,
    },
    usedBy: ["Kasbon / uang muka karyawan", "Employee cash advances"],
    sequence: 20,
    managerFirst: true,
  },
  KENAIKAN: {
    def: {
      code: "KENAIKAN",
      name: "Kenaikan Gaji",
      prefix: "KNK",
      description: "Persetujuan siklus kenaikan gaji: daftar usulan, anggaran, dan tambahan biaya tahunan.",
      fields: amountDesc,
    },
    usedBy: ["Siklus kenaikan gaji", "Salary review cycles"],
    sequence: 900,
  },
  MPP: {
    def: {
      code: "MPP",
      name: "Man Power Planning",
      prefix: "MPP",
      description:
        "Persetujuan rencana tenaga kerja departemen per tahun: posisi, headcount, dan biaya tahunan.",
      fields: amountDesc,
    },
    usedBy: ["Rencana tenaga kerja", "Manpower plans"],
    sequence: 910,
  },
  FPK: {
    def: {
      code: "FPK",
      name: "Formulir Permintaan Karyawan",
      prefix: "FPK",
      description: "Permintaan penambahan tenaga kerja: posisi, jumlah, alasan, estimasi biaya.",
      fields: { quantity: "required", amount: "optional", date: "optional", description: "required" },
    },
    usedBy: ["Permintaan karyawan (dalam MPP)", "Hiring requests (planned)"],
    sequence: 10,
    managerFirst: true,
  },
  FPK_NP: {
    def: {
      code: "FPK_NP",
      name: "FPK di luar MPP",
      prefix: "FPK",
      description:
        "Penambahan karyawan yang tidak ada di Man Power Planning yang disetujui. Tambahkan penyetuju (mis. direksi) di kategori ini.",
      fields: { quantity: "required", amount: "optional", date: "optional", description: "required" },
    },
    usedBy: ["Permintaan karyawan (di luar MPP)", "Hiring requests (unplanned)"],
    sequence: 15,
    managerFirst: true,
  },
  PAYRUN: {
    def: {
      code: "PAYRUN",
      name: "Pembayaran Pemasok",
      prefix: "PAY",
      description: "Persetujuan payment run: daftar tagihan pemasok yang akan dibayar dan totalnya.",
      fields: amountDesc,
    },
    usedBy: ["Payment run pemasok", "Vendor payment runs"],
    sequence: 910,
  },
  KONTRAK_BELI: {
    def: {
      code: "KONTRAK_BELI",
      name: "Kontrak Pembelian",
      prefix: "KPB",
      description: "Persetujuan kontrak pembelian (blanket order): pemasok, periode, harga & komitmen.",
      fields: amountDesc,
    },
    usedBy: ["Kontrak pembelian", "Purchase contracts"],
    sequence: 920,
  },
  OPNAME: {
    def: {
      code: "OPNAME",
      name: "Selisih Stock Opname",
      prefix: "SOP",
      description: "Persetujuan selisih hitung fisik persediaan sebelum diposting sebagai penyesuaian.",
      fields: amountDesc,
    },
    usedBy: ["Selisih stock opname", "Stock count differences"],
    sequence: 930,
  },
} as const satisfies Record<string, SystemCategory>;

export type SystemCategoryCode = keyof typeof SYSTEM_APPROVAL_CATEGORIES;

export const isSystemCategory = (code: string): code is SystemCategoryCode =>
  Object.prototype.hasOwnProperty.call(SYSTEM_APPROVAL_CATEGORIES, code);

/** Penanda kategori sistem untuk respons API. */
export function systemInfo(code: string) {
  const sys = isSystemCategory(code) ? (SYSTEM_APPROVAL_CATEGORIES[code] as SystemCategory) : null;
  return { system: !!sys, usedBy: sys ? sys.usedBy : null };
}

/** Kategori contoh untuk permintaan bebas, sekali saat perusahaan belum punya kategori apa pun. */
export async function ensureDefaultCategories(tx: Db, companyId: string) {
  const [any] = await tx.select({ id: CAT.id }).from(CAT).where(eq(CAT.companyId, companyId)).limit(1);
  if (any) return;
  await tx
    .insert(CAT)
    .values(DEFAULT_APPROVAL_CATEGORIES.map((c, i) => ({ ...c, companyId, sequence: (i + 1) * 10 })))
    .onConflictDoNothing();
}

/** Pastikan semua kategori sistem ada untuk perusahaan ini (yang sudah ada tidak diubah). */
export async function ensureSystemCategories(tx: Db, companyId: string) {
  await ensureDefaultCategories(tx, companyId);
  const codes = Object.keys(SYSTEM_APPROVAL_CATEGORIES);
  const existing = new Set(
    (
      await tx
        .select({ code: CAT.code })
        .from(CAT)
        .where(and(eq(CAT.companyId, companyId), inArray(CAT.code, codes)))
    ).map((r) => r.code),
  );
  const missing = Object.values(SYSTEM_APPROVAL_CATEGORIES as Record<string, SystemCategory>).filter(
    (c) => !existing.has(c.def.code),
  );
  if (missing.length)
    await tx.insert(CAT).values(
      missing.map((c) => ({
        ...c.def,
        companyId,
        managerFirst: c.managerFirst ?? false,
        sequence: c.sequence,
      })),
    );
}

/** Id kategori sistem untuk perusahaan ini (dibuat bila belum ada). */
export async function systemCategoryId(tx: Db, companyId: string, code: SystemCategoryCode) {
  const find = async () =>
    (
      await tx
        .select({ id: CAT.id })
        .from(CAT)
        .where(and(eq(CAT.companyId, companyId), eq(CAT.code, code)))
        .limit(1)
    )[0]?.id;
  const found = await find();
  if (found) return found;
  await ensureSystemCategories(tx, companyId);
  return (await find())!;
}
