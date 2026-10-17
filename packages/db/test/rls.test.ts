import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/migrate.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("row-level security per tenant", () => {
  const sql = postgres(url ?? "", { onnotice: () => {} });
  let tenantA = "";
  let tenantB = "";

  /** Jalankan query sebagai role aplikasi dengan konteks tenant tertentu. */
  const asTenant = <T>(tenantId: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx`set local role app_user`;
      await tx`select set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }) as Promise<T>;

  beforeAll(async () => {
    await migrate(url!);
    const suffix = Math.random().toString(36).slice(2, 8);
    [{ id: tenantA }] =
      await sql`insert into tenants (slug, name) values (${"a-" + suffix}, 'A') returning id`;
    [{ id: tenantB }] =
      await sql`insert into tenants (slug, name) values (${"b-" + suffix}, 'B') returning id`;
    await asTenant(
      tenantA,
      (tx) => tx`insert into companies (code, name, entity_type) values ('HOLD', 'A Holding', 'holding')`,
    );
    await asTenant(tenantB, (tx) => tx`insert into companies (code, name) values ('SUB', 'B Sub')`);
  });

  afterAll(async () => {
    await sql`delete from tenants where id in (${tenantA}, ${tenantB})`;
    await sql.end();
  });

  it("tenant A hanya melihat perusahaannya sendiri", async () => {
    const rows = await asTenant(tenantA, (tx) => tx`select code, tenant_id from companies`);
    expect(rows.map((r) => r.code)).toEqual(["HOLD"]);
  });

  it("tanpa konteks tenant tidak ada baris terlihat", async () => {
    const rows = await sql.begin(async (tx) => {
      await tx`set local role app_user`;
      return tx`select id from companies`;
    });
    expect(rows).toHaveLength(0);
  });

  it("menolak insert ke tenant lain", async () => {
    await expect(
      asTenant(
        tenantA,
        (tx) => tx`insert into companies (tenant_id, code, name) values (${tenantB}, 'X', 'X')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("menghubungkan anak ke holding dengan kepemilikan", async () => {
    const result = await asTenant(tenantA, async (tx) => {
      const [holding] = await tx`select id from companies where code = 'HOLD'`;
      const [child] =
        await tx`insert into companies (parent_id, code, name) values (${holding!.id}, 'SUB1', 'Anak 1') returning id`;
      await tx`insert into ownership_history (parent_company_id, child_company_id, pct, method, valid_from)
               values (${holding!.id}, ${child!.id}, 80, 'full', '2026-01-01')`;
      await tx`insert into branches (company_id, code, name) values (${child!.id}, 'JKT', 'Cabang Jakarta')`;
      return tx`select pct::text from ownership_history`;
    });
    expect(result[0]!.pct).toBe("80.0000");
  });
});
