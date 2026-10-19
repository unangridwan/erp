import { sql } from "drizzle-orm";
import { createDb } from "../client.js";
import { runWithDatabase } from "./run.js";

/**
 * Jadikan user admin platform (operator SaaS): `pnpm platform:admin <slug-tenant> <email> [--revoke]`.
 * Admin platform mengelola paket, tenant, dan konfirmasi pembayaran manual di /platform.
 */
const [slug, email, flag] = process.argv.slice(2);
if (!slug || !email) {
  console.error("Pemakaian: pnpm platform:admin <slug-tenant> <email> [--revoke]");
  process.exit(1);
}

await runWithDatabase(async (url) => {
  const { db, client } = createDb(url);
  try {
    const grant = flag !== "--revoke";
    const rows = await db.transaction(async (tx) => {
      const [tenant] = await tx.execute<{ id: string }>(sql`select id from tenants where slug = ${slug}`);
      if (!tenant) return [];
      await tx.execute(sql`select set_config('app.tenant_id', ${tenant.id}, true)`);
      return tx.execute<{ id: string }>(
        sql`update users set platform_admin = ${grant} where tenant_id = ${tenant.id} and email = ${email.toLowerCase()} returning id`,
      );
    });
    if (!rows.length) {
      console.error(`User ${email} di tenant ${slug} tidak ditemukan`);
      process.exitCode = 1;
    } else console.log(`${email} ${grant ? "kini" : "bukan lagi"} admin platform`);
  } finally {
    await client.end();
  }
});
