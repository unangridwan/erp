import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { DbExceptionFilter } from "../src/common/db-exception.filter.js";

function run(error: unknown) {
  let status = 0;
  let body: unknown;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new DbExceptionFilter().catch(error, host);
  return { status, body };
}

const pgError = (fields: Record<string, string>) => Object.assign(new Error(fields.message), fields);

describe("DbExceptionFilter", () => {
  it("meneruskan pesan dari trigger aturan bisnis", () => {
    const r = run(
      pgError({
        code: "23514",
        message: "Periode sudah dikunci sampai 2025-12-31",
        where: "PL/pgSQL function erp_check_posted_move() line 18 at RAISE",
      }),
    );
    expect(r).toEqual({
      status: 400,
      body: expect.objectContaining({ message: "Periode sudah dikunci sampai 2025-12-31" }),
    });
  });

  it("menyembunyikan pesan CHECK constraint mentah", () => {
    const r = run(pgError({ code: "23514", message: 'new row violates check constraint "x"' }));
    expect(r.body).toMatchObject({ message: "Data melanggar aturan validasi" });
  });

  it("memetakan duplikat ke 409 dan error drizzle terbungkus lewat cause", () => {
    expect(run(pgError({ code: "23505", message: "dup" })).status).toBe(409);
    expect(
      run(Object.assign(new Error("wrap"), { cause: pgError({ code: "42501", message: "rls" }) })).status,
    ).toBe(403);
  });
});
