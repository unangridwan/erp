/**
 * Pesan error API dalam bahasa Inggris untuk klien yang meminta `Accept-Language: en`. Pesan ditulis dalam Bahasa
 * Indonesia di kode; di sini diterjemahkan pesan tetap yang umum dan pola pesan bertemplat (mis. "X tidak ditemukan").
 * Pesan yang belum ada terjemahannya dikirim apa adanya. Kamus per modul ada di error-messages-en.ts.
 */
import { MESSAGES_EN } from "./error-messages-en.js";

const EXACT: Record<string, string> = {
  "Validasi gagal": "Validation failed",
  "Butuh autentikasi": "Authentication required",
  "Akses ditolak": "Access denied",
  "Akun dinonaktifkan": "Account disabled",
  "User tidak aktif": "User is inactive",
  "Tenant, email, atau password salah": "Wrong tenant, email, or password",
  "Sesi berakhir, silakan masuk lagi": "Session expired, please sign in again",
  "Masukkan kode 2FA": "Enter your 2FA code",
  "Kode 2FA salah": "Wrong 2FA code",
  "2FA belum aktif": "2FA is not enabled",
  "2FA sudah aktif; nonaktifkan dulu untuk membuat secret baru":
    "2FA is already enabled; disable it first to create a new secret",
  "Jalankan setup 2FA terlebih dahulu": "Run 2FA setup first",
  "Slug tenant sudah dipakai": "Tenant slug is already taken",
  "Token tidak valid atau kedaluwarsa": "Invalid or expired token",
  "Undangan tidak valid atau sudah kedaluwarsa": "Invalid or expired invitation",
  "Tidak punya akses ke perusahaan ini": "No access to this company",
  "Khusus admin platform": "Platform administrators only",
  "Terjadi kesalahan pada server": "Internal server error",
  "Data sudah ada (duplikat)": "Duplicate record",
  "Data terkait tidak ditemukan atau masih dipakai": "Related record not found or still in use",
  "Data melanggar aturan validasi": "Data violates a validation rule",
  "Data rujukan tidak ditemukan": "Referenced record not found",
  "Impor dibatalkan: ada baris tidak valid": "Import cancelled: some rows are invalid",
  "Berkas impor kosong": "Import file is empty",
  "Kirim salah satu: csv atau xlsx": "Send either csv or xlsx",
  "Berkas Excel tidak valid (gunakan format .xlsx)": "Invalid Excel file (use .xlsx)",
  "Langganan berakhir — data hanya bisa dibaca. Perpanjang di menu Langganan.":
    "Subscription ended — data is read-only. Renew it under Subscription.",
  "Pilih paket langganan": "Choose a subscription plan",
  "Tenant ini mewajibkan login lewat SSO": "This tenant requires single sign-on",
  "SSO belum diaktifkan untuk tenant ini": "SSO is not enabled for this tenant",
  "Permintaan SSO tidak valid": "Invalid SSO request",
  "Permintaan SSO kedaluwarsa, ulangi login": "SSO request expired, please sign in again",
  "Sesi peramban SSO tidak cocok, ulangi login dari halaman masuk":
    "SSO browser session mismatch, start again from the sign-in page",
  "Email belum diverifikasi di penyedia identitas": "Email is not verified at the identity provider",
  "Penyedia identitas tidak mengirim email": "The identity provider did not send an email",
  "Tanggal akhir sebelum tanggal mulai": "End date is before start date",
  "Isi harga satuan": "Enter a unit price",
  "Isi deskripsi atau pilih produk": "Enter a description or pick a product",
  "Payroll sudah diposting": "Payroll is already posted",
  "Konsolidasi final tidak bisa diubah": "A final consolidation cannot be changed",
  "Sumber kurs masih manual; pilih sumber otomatis dulu":
    "Rate source is manual; choose an automatic source first",
  // Pesan validasi skema (zod) yang ditulis dalam Bahasa Indonesia.
  "Harus lebih dari 0": "Must be greater than 0",
  "Format YYYY-MM": "Format YYYY-MM",
  "NPWP/NIK 16 digit": "NPWP/NIK must be 16 digits",
  "Nomor tidak valid": "Invalid number",
  "Pilih minimal satu dokumen": "Select at least one document",
  "URL issuer tidak valid": "Invalid issuer URL",
  "Domain tidak valid": "Invalid domain",
  "Kode barang/jasa Coretax 6 digit": "Coretax goods/service code must be 6 digits",
};

/** Kata benda untuk pola "<X> tidak ditemukan". */
const NOUNS: Record<string, string> = {
  data: "Record",
  dokumen: "Document",
  entri: "Entry",
  "baris jurnal": "Journal line",
  jurnal: "Journal",
  akun: "Account",
  "akun grup": "Group account",
  perusahaan: "Company",
  "perusahaan induk": "Parent company",
  tenant: "Tenant",
  partner: "Partner",
  kontak: "Contact",
  produk: "Product",
  gudang: "Warehouse",
  lokasi: "Location",
  transfer: "Transfer",
  pesanan: "Order",
  faktur: "Invoice",
  tagihan: "Bill",
  "faktur pajak": "Tax invoice",
  "faktur pajak masukan": "Input tax invoice",
  "bukti potong": "Withholding slip",
  "nota retur": "Return note",
  "rentang nsfp": "NSFP range",
  "daftar harga": "Pricelist",
  karyawan: "Employee",
  kontrak: "Contract",
  "pengajuan cuti": "Leave request",
  lembur: "Overtime",
  pinjaman: "Loan",
  "komponen gaji": "Salary component",
  paket: "Plan",
  "peran bawaan": "Default role",
  pemasok: "Vendor",
  user: "User",
  pengguna: "User",
};

const noun = (s: string) => NOUNS[s.trim().toLowerCase()];

const PATTERNS: [RegExp, (...m: string[]) => string | undefined][] = [
  [
    /^Sebagian (.+) tidak ditemukan$/,
    (n) => (noun(n) ? `Some ${noun(n)!.toLowerCase()}s were not found` : undefined),
  ],
  [
    /^(.+?) tidak ditemukan di perusahaan ini$/,
    (n) => (noun(n) ? `${noun(n)} not found in this company` : undefined),
  ],
  [/^(.+?) tidak ditemukan$/, (n) => (noun(n) ? `${noun(n)} not found` : undefined)],
  [
    /^Terlalu banyak percobaan\. Coba lagi dalam (\d+) detik\.$/,
    (s) => `Too many attempts. Try again in ${s} seconds.`,
  ],
  [/^Butuh permission (.+)$/, (p) => `Permission required: ${p}`],
  [
    /^Anda tidak diizinkan masuk ke (.+); hubungi administrator$/,
    (n) => `You are not allowed to sign in to ${n}; contact your administrator`,
  ],
  [/^Mata uang (\S+) tidak dikenal$/, (c) => `Unknown currency ${c}`],
  [/^Mata uang tidak dikenal: (.+)$/, (c) => `Unknown currencies: ${c}`],
  [/^Kurs (\S+) pada\/sebelum (\S+) belum diisi$/, (c, d) => `No ${c} rate on or before ${d}`],
  [/^Maksimal (\d+) baris per impor$/, (n) => `At most ${n} rows per import`],
  [/^Jurnal tidak seimbang \(selisih (.+)\)$/, (d) => `Entry is not balanced (difference ${d})`],
  [/^Tahun fiskal (\d+) sudah ditutup$/, (y) => `Fiscal year ${y} is already closed`],
  [/^Domain (\S+) tidak diizinkan untuk tenant ini$/, (d) => `Domain ${d} is not allowed for this tenant`],
  [
    /^Akun (\S+) belum terdaftar di tenant ini; minta admin mengundang Anda$/,
    (e) => `Account ${e} is not registered in this tenant; ask an administrator to invite you`,
  ],
  [
    /^Modul (\S+) tidak termasuk paket (.+)\. Tingkatkan paket di menu Langganan\.$/,
    (m, p) => `Module ${m} is not included in the ${p} plan. Upgrade under Subscription.`,
  ],
  [
    /^Paket (.+) maksimal (\d+) pengguna aktif\. Tingkatkan paket Anda\.$/,
    (p, n) => `The ${p} plan allows at most ${n} active users. Upgrade your plan.`,
  ],
  [
    /^Paket (.+) maksimal (\d+) perusahaan\. Tingkatkan paket Anda\.$/,
    (p, n) => `The ${p} plan allows at most ${n} companies. Upgrade your plan.`,
  ],
  [/^Gagal mengambil kurs: (.+)$/, (m) => `Failed to fetch rates: ${m}`],
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Pesan tetap dari kamus modul, dan template (`{}`) yang dikompilasi menjadi regex. */
const STATIC = new Map<string, string>();
const TEMPLATES: [RegExp, string][] = [];
for (const [id, en] of Object.entries(MESSAGES_EN)) {
  if (!id.includes("{}")) STATIC.set(id, en);
  else TEMPLATES.push([new RegExp(`^${id.split("{}").map(escape).join("(.+?)")}$`, "s"), en]);
}

export function translateMessage(message: string): string {
  const exact = EXACT[message] ?? STATIC.get(message);
  if (exact) return exact;
  for (const [re, en] of TEMPLATES) {
    const m = re.exec(message);
    if (m) return en.replace(/\{(\d+)\}/g, (_, i: string) => m[Number(i) + 1] ?? "");
  }
  for (const [re, fn] of PATTERNS) {
    const m = re.exec(message);
    if (m) {
      const out = fn(...m.slice(1));
      if (out) return out;
    }
  }
  return message;
}

/** Bahasa yang diminta klien: "en" bila Accept-Language mengutamakan Inggris (selain itu Indonesia). */
export function preferredLanguage(header: string | undefined): "id" | "en" {
  if (!header) return "id";
  const langs = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().toLowerCase().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: (tag ?? "").split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((l) => l.lang === "en" || l.lang === "id")
    .sort((a, b) => b.q - a.q);
  return langs[0]?.lang === "en" ? "en" : "id";
}

/** Terjemahkan isi respons error (message & errors[].message); bentuk lain dikembalikan apa adanya. */
export function localizeErrorBody(body: unknown, lang: "id" | "en"): unknown {
  if (lang === "id" || typeof body !== "object" || body === null) {
    return typeof body === "string" && lang === "en" ? translateMessage(body) : body;
  }
  const b = body as { message?: unknown; errors?: unknown };
  const out: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if (typeof b.message === "string") out.message = translateMessage(b.message);
  else if (Array.isArray(b.message))
    out.message = b.message.map((m) => (typeof m === "string" ? translateMessage(m) : m));
  if (Array.isArray(b.errors))
    out.errors = b.errors.map((e) =>
      e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
        ? { ...e, message: translateMessage((e as { message: string }).message) }
        : e,
    );
  return out;
}
