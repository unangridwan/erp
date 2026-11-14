export interface AppConfig {
  databaseUrl: string;
  jwtSecret: Uint8Array;
  /** Masa berlaku access token (format jose, mis. "15m"). */
  accessTtl: string;
  refreshTtlDays: number;
  /** Kunci untuk enkripsi kolom sensitif (secret 2FA, dst.). */
  encryptionKey: string;
  webOrigin: string;
  /** URL publik API (untuk redirect URI SSO), mis. https://api.erpku.id. */
  apiOrigin: string;
  /** "smtp://host:port" atau "json" (tidak mengirim, untuk test). */
  mailTransport: string;
  mailFrom: string;
  billing: {
    /** Paket untuk masa uji coba tenant baru. */
    trialPlan: string;
    trialDays: number;
    /** Hari toleransi setelah periode berakhir sebelum tenant menjadi baca-saja. */
    graceDays: number;
    /** Instruksi transfer manual bila payment gateway belum dikonfigurasi. */
    bankInfo: string;
    xenditSecretKey: string | null;
    xenditCallbackToken: string | null;
    /** Jalankan penjadwal perpanjangan otomatis (dimatikan saat test). */
    scheduler: boolean;
  };
  /** Sumber kurs otomatis (API Frankfurter: kurs referensi ECB) & penjadwal harian. */
  fx: { frankfurterUrl: string; scheduler: boolean };
  /** Email pengingat HR harian (dokumen kedaluwarsa, kontrak PKWT berakhir). */
  hrReminder: { scheduler: boolean };
  /** Pengirim webhook aplikasi terhubung (tiap 30 detik). */
  webhook: { scheduler: boolean };
  reports: { scheduler: boolean };
  /** Penagihan bertingkat (dunning) otomatis harian. */
  dunning: { scheduler: boolean };
  /** Posting otomatis jurnal pengakuan penangguhan & pembuatan jurnal berulang. */
  accounting: { scheduler: boolean };
  /** Pengirim email notifikasi (outbox, tiap menit). */
  notifyEmail: { scheduler: boolean };
  /** Aturan otomatis (event tiap 30 dtk, tanggal & jadwal). */
  automation: { scheduler: boolean };
  maintenance: { scheduler: boolean };
  /** Token untuk GET /metrics (Prometheus); kosong = endpoint dimatikan. */
  metricsToken: string | null;
  logFormat: "json" | "pretty" | "off";
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.length < 32) throw new Error(`${name} minimal 32 karakter`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL belum di-set");
  if (env.NODE_ENV === "production") assertProductionSecrets(env);
  return {
    databaseUrl,
    jwtSecret: new TextEncoder().encode(secret(env, "JWT_SECRET")),
    accessTtl: env.ACCESS_TOKEN_TTL ?? "15m",
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    encryptionKey: secret(env, "ENCRYPTION_KEY"),
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
    apiOrigin: (env.API_ORIGIN ?? `http://localhost:${env.PORT ?? 3001}`).replace(/\/+$/, ""),
    mailTransport: env.MAIL_TRANSPORT ?? "smtp://localhost:1025",
    mailFrom: env.MAIL_FROM ?? "ERP <no-reply@erp.local>",
    billing: {
      trialPlan: env.TRIAL_PLAN ?? "enterprise",
      trialDays: Number(env.TRIAL_DAYS ?? 14),
      graceDays: Number(env.BILLING_GRACE_DAYS ?? 7),
      bankInfo:
        env.BILLING_BANK_INFO ??
        "Transfer ke rekening yang tertera pada tagihan, lalu kirim bukti transfer ke tim kami.",
      xenditSecretKey: env.XENDIT_SECRET_KEY || null,
      xenditCallbackToken: env.XENDIT_CALLBACK_TOKEN || null,
      scheduler: env.BILLING_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    fx: {
      frankfurterUrl: (env.FX_FRANKFURTER_URL ?? "https://api.frankfurter.app").replace(/\/+$/, ""),
      scheduler: env.FX_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    hrReminder: {
      scheduler: env.HR_REMINDER_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    webhook: {
      scheduler: env.WEBHOOK_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    reports: {
      scheduler: env.REPORT_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    dunning: {
      scheduler: env.DUNNING_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    accounting: {
      scheduler: env.ACCOUNTING_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    notifyEmail: {
      scheduler: env.NOTIFY_EMAIL_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    automation: {
      scheduler: env.AUTOMATION_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    maintenance: {
      scheduler: env.MAINTENANCE_SCHEDULER !== "off" && env.NODE_ENV !== "test" && !env.VITEST,
    },
    metricsToken: env.METRICS_TOKEN || null,
    logFormat: (env.LOG_FORMAT as "json" | "pretty" | "off" | undefined) ?? (env.VITEST ? "off" : "pretty"),
  };
}

/** Produksi: tolak nilai contoh dari .env.example dan secret yang dipakai ulang. */
function assertProductionSecrets(env: NodeJS.ProcessEnv) {
  for (const name of ["JWT_SECRET", "ENCRYPTION_KEY"]) {
    if (env[name]?.startsWith("ganti-dengan")) throw new Error(`${name} masih memakai nilai contoh`);
  }
  if (env.JWT_SECRET === env.ENCRYPTION_KEY) throw new Error("JWT_SECRET dan ENCRYPTION_KEY harus berbeda");
  if (!env.WEB_ORIGIN?.startsWith("https://")) throw new Error("WEB_ORIGIN produksi harus https://");
}

export const CONFIG = Symbol("CONFIG");
