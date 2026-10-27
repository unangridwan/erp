import { Inject, Injectable } from "@nestjs/common";
import { eq, schema, type Db } from "@erp/db";
import { exportJWK, generateKeyPair, importJWK, type JWK, type KeyLike } from "jose";
import { randomUUID } from "node:crypto";
import { decrypt, encrypt } from "../common/crypto.js";
import { OWNER_DB } from "../common/database.js";
import { CONFIG, type AppConfig } from "../config.js";

/** Kunci RS256 penanda tangan id_token. Dibuat otomatis saat pertama dipakai, disimpan terenkripsi. */
@Injectable()
export class OidcKeysService {
  private signing?: Promise<{ kid: string; key: KeyLike | Uint8Array }>;

  constructor(
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  signingKey() {
    this.signing ??= this.loadOrCreate().catch((e: unknown) => {
      this.signing = undefined;
      throw e;
    });
    return this.signing;
  }

  /** JWKS publik: semua kunci aktif (agar token lama tetap terverifikasi saat rotasi). */
  async jwks() {
    await this.signingKey();
    const rows = await this.ownerDb
      .select({ jwk: schema.oidcKeys.publicJwk })
      .from(schema.oidcKeys)
      .where(eq(schema.oidcKeys.active, true));
    return { keys: rows.map((r) => r.jwk) };
  }

  private async loadOrCreate() {
    const rows = await this.ownerDb
      .select()
      .from(schema.oidcKeys)
      .where(eq(schema.oidcKeys.active, true))
      .orderBy(schema.oidcKeys.createdAt);
    for (const row of rows) {
      let jwk: JWK;
      try {
        jwk = JSON.parse(decrypt(row.privateJwkEnc, this.config.encryptionKey)) as JWK;
      } catch {
        // Terenkripsi dengan ENCRYPTION_KEY lain (kunci diganti): lewati, kunci publiknya tetap di JWKS.
        continue;
      }
      return { kid: row.kid, key: await importJWK(jwk, "RS256") };
    }
    const kid = randomUUID();
    const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
    const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: "RS256" };
    // Dua proses yang membuat kunci bersamaan sama-sama valid: JWKS memuat semua kunci aktif.
    await this.ownerDb.insert(schema.oidcKeys).values({
      kid,
      privateJwkEnc: encrypt(JSON.stringify(privateJwk), this.config.encryptionKey),
      publicJwk,
    });
    return { kid, key: privateKey };
  }
}
