import { sql } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Db = PostgresJsDatabase<typeof schema>;

export function createDb(url: string, options: postgres.Options<Record<string, never>> = {}) {
  const client = postgres(url, options);
  return { db: drizzle(client, { schema }), client };
}

/**
 * Jalankan `fn` dalam transaksi dengan konteks tenant aktif.
 * `set_config(..., true)` bersifat lokal-transaksi sehingga aman dipakai dengan connection pool.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Db);
  });
}
