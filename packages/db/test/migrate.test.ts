import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate, pendingMigrations } from "../src/migrate.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("runner migrasi", () => {
  let dir = "";

  beforeAll(async () => {
    await migrate(url!);
    dir = await mkdtemp(join(tmpdir(), "erp-migrate-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("pendingMigrations: kosong setelah migrate; file baru terdeteksi", async () => {
    expect(await pendingMigrations(url!)).toEqual([]);
    const name = `9999_test_${Math.random().toString(36).slice(2, 8)}.sql`;
    await writeFile(join(dir, name), "select 1;");
    expect(await pendingMigrations(url!, dir)).toEqual([name]);
  });

  it("migrasi gagal menyebut nama file dan tidak menerapkan apa pun", async () => {
    const failDir = await mkdtemp(join(tmpdir(), "erp-migrate-fail-"));
    try {
      await writeFile(join(failDir, "9998_ok.sql"), "create table _migrate_probe (id int);");
      await writeFile(join(failDir, "9999_broken.sql"), "select * from tabel_yang_tidak_ada;");
      await expect(migrate(url!, failDir)).rejects.toThrow(/Migrasi 9999_broken\.sql gagal/);
      expect(await pendingMigrations(url!, failDir)).toEqual(["9998_ok.sql", "9999_broken.sql"]);
    } finally {
      await rm(failDir, { recursive: true, force: true });
    }
  });
});
