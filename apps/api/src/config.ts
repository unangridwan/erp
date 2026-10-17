export interface AppConfig {
  databaseUrl: string;
  jwtSecret: Uint8Array;
  /** Masa berlaku access token (format jose, mis. "15m"). */
  accessTtl: string;
  refreshTtlDays: number;
  /** Kunci untuk enkripsi kolom sensitif (secret 2FA, dst.). */
  encryptionKey: string;
  webOrigin: string;
  /** "smtp://host:port" atau "json" (tidak mengirim, untuk test). */
  mailTransport: string;
  mailFrom: string;
}

function secret(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value || value.length < 32) throw new Error(`${name} minimal 32 karakter`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL belum di-set");
  return {
    databaseUrl,
    jwtSecret: new TextEncoder().encode(secret(env, "JWT_SECRET")),
    accessTtl: env.ACCESS_TOKEN_TTL ?? "15m",
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    encryptionKey: secret(env, "ENCRYPTION_KEY"),
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
    mailTransport: env.MAIL_TRANSPORT ?? "smtp://localhost:1025",
    mailFrom: env.MAIL_FROM ?? "ERP <no-reply@erp.local>",
  };
}

export const CONFIG = Symbol("CONFIG");
