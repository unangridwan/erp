export interface AppConfig {
  databaseUrl: string;
  jwtSecret: Uint8Array;
  jwtTtl: string;
  webOrigin: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL belum di-set");
  const secret = env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET minimal 32 karakter");
  return {
    databaseUrl,
    jwtSecret: new TextEncoder().encode(secret),
    jwtTtl: env.JWT_TTL ?? "8h",
    webOrigin: env.WEB_ORIGIN ?? "http://localhost:3000",
  };
}

export const CONFIG = Symbol("CONFIG");
