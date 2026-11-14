import { z } from "zod";

/** Event webhook yang bisa dilanggan aplikasi terhubung. */
export const WEBHOOK_EVENTS = [
  "employee.created",
  "employee.updated",
  "employee.archived",
  "employee.reactivated",
  "employee.deleted",
  "department.created",
  "department.updated",
  "department.archived",
  "department.reactivated",
  "department.deleted",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABEL: Record<WebhookEvent, [string, string]> = {
  "employee.created": ["Karyawan dibuat", "Employee created"],
  "employee.updated": ["Karyawan diubah", "Employee updated"],
  "employee.archived": ["Karyawan diarsipkan / keluar", "Employee archived"],
  "employee.reactivated": ["Karyawan diaktifkan kembali", "Employee reactivated"],
  "employee.deleted": ["Karyawan dihapus", "Employee deleted"],
  "department.created": ["Departemen dibuat", "Department created"],
  "department.updated": ["Departemen diubah", "Department updated"],
  "department.archived": ["Departemen diarsipkan", "Department archived"],
  "department.reactivated": ["Departemen diaktifkan kembali", "Department reactivated"],
  "department.deleted": ["Departemen dihapus", "Department deleted"],
};

/** Scope OpenID Connect yang didukung. `employee` menambah klaim data karyawan pada id_token & userinfo. */
export const OAUTH_SCOPES = ["openid", "profile", "email", "employee", "offline_access"] as const;

/** Normalisasi scope: hanya yang dikenal, urutan tetap, `openid` wajib. */
export function normalizeScope(scope: string | null | undefined): string | undefined {
  const asked = new Set((scope ?? "").split(/\s+/).filter(Boolean));
  if (!asked.has("openid")) return undefined;
  return OAUTH_SCOPES.filter((s) => asked.has(s)).join(" ");
}

/** HTTPS wajib, kecuali localhost/127.0.0.1 untuk pengembangan. Tanpa fragmen. */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

const redirectUri = z
  .string()
  .trim()
  .max(500)
  .refine(isAllowedRedirectUri, "URL harus https:// (http:// hanya untuk localhost) dan tanpa #");

export const connectedAppSchema = z.object({
  name: z.string().trim().min(1).max(100),
  redirectUris: z.array(redirectUri).max(10).default([]),
  postLogoutRedirectUris: z.array(redirectUri).max(10).default([]),
  /** Kosong = semua pengguna aktif boleh masuk. */
  allowedRoleIds: z.array(z.string().uuid()).max(50).default([]),
  /** Peran akun layanan (hak API aplikasi); hanya saat membuat — sesudahnya diatur di halaman pengguna. */
  serviceRoleIds: z.array(z.string().uuid()).max(20).optional(),
  webhookUrl: redirectUri.nullish(),
  webhookEvents: z.array(z.enum(WEBHOOK_EVENTS)).default([]),
  active: z.boolean().default(true),
});
export type ConnectedAppInput = z.infer<typeof connectedAppSchema>;

/** Permintaan kode otorisasi dari halaman web `/oauth/authorize` (user sudah login). */
export const oauthAuthorizeSchema = z.object({
  clientId: z.string().min(1).max(200),
  redirectUri: z.string().min(1).max(500),
  responseType: z.literal("code", "response_type harus code"),
  scope: z.string().max(200).default("openid"),
  state: z.string().max(500).optional(),
  nonce: z.string().max(500).optional(),
  codeChallenge: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/, "code_challenge (PKCE) wajib"),
  codeChallengeMethod: z.literal("S256", "code_challenge_method harus S256"),
});
