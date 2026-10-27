import { ForbiddenException } from "@nestjs/common";
import { and, count, eq, schema, sql, type Db } from "@erp/db";

/** Batas paket tenant saat ini; dibaca dalam transaksi tenant (RLS membatasi ke langganan sendiri). */
async function planLimits(tx: Db) {
  const [row] = await tx.execute<{
    name: string;
    max_users: number | null;
    max_companies: number | null;
  }>(sql`
    select p.name, p.max_users, p.max_companies from subscriptions s join plans p on p.id = s.plan_id`);
  return row;
}

/** Tolak penambahan user aktif melebihi batas paket. */
export async function assertUserLimit(tx: Db, adding = 1) {
  const plan = await planLimits(tx);
  if (!plan || plan.max_users === null) return;
  const [{ n } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(schema.users)
    .where(and(eq(schema.users.active, true), eq(schema.users.kind, "human")));
  if (n + adding > plan.max_users)
    throw new ForbiddenException(
      `Paket ${plan.name} maksimal ${plan.max_users} pengguna aktif. Tingkatkan paket Anda.`,
    );
}

/** Tolak penambahan perusahaan melebihi batas paket. */
export async function assertCompanyLimit(tx: Db) {
  const plan = await planLimits(tx);
  if (!plan || plan.max_companies === null) return;
  const [{ n } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(schema.companies)
    .where(eq(schema.companies.active, true));
  if (n + 1 > plan.max_companies)
    throw new ForbiddenException(
      `Paket ${plan.name} maksimal ${plan.max_companies} perusahaan. Tingkatkan paket Anda.`,
    );
}
