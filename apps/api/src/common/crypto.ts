import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Token acak URL-safe. */
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

/**
 * Token yang membawa tenant: `<tenantId>.<rahasia>`. Tenant dibutuhkan untuk mencari hash token
 * di bawah RLS; hanya hash bagian rahasia yang disimpan di database.
 */
export function issueTenantToken(tenantId: string): { token: string; hash: string } {
  const token = `${tenantId}.${randomToken()}`;
  return { token, hash: sha256(token) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTenantToken(token: string): { tenantId: string; hash: string } | undefined {
  const tenantId = token.split(".", 1)[0] ?? "";
  if (!UUID.test(tenantId) || token.length < tenantId.length + 20) return undefined;
  return { tenantId, hash: sha256(token) };
}

/** Enkripsi AES-256-GCM; format: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plaintext: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(key), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decrypt(payload: string, key: string): string {
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Format data terenkripsi tidak dikenal");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(key), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

const deriveKey = (key: string) => createHash("sha256").update(key).digest();
