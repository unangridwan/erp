import type { ArgumentsHost } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { DbExceptionFilter } from "../src/common/db-exception.filter.js";
import { setErrorReporter, type ErrorContext } from "../src/common/error-reporting.js";

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

describe("pelaporan error", () => {
  it("hanya error tak tertangani (500) yang dilaporkan, dengan ID request & route tanpa body", async () => {
    const reported: [unknown, ErrorContext][] = [];
    setErrorReporter((e, c) => reported.push([e, c]));
    try {
      const { NotFoundException } = await import("@nestjs/common");
      const res = { status: () => res, json: () => undefined };
      const host = (req: object) =>
        ({
          switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
        }) as unknown as ArgumentsHost;
      const req = {
        id: "req-1",
        method: "POST",
        route: { path: "/moves" },
        headers: {},
        body: { secret: 1 },
      };
      new DbExceptionFilter().catch(new NotFoundException("Produk tidak ditemukan"), host(req));
      new DbExceptionFilter().catch(pgError({ code: "23505", message: "dup" }), host(req));
      const boom = new TypeError("x is undefined");
      new DbExceptionFilter().catch(boom, host(req));
      expect(reported).toEqual([[boom, { reqId: "req-1", method: "POST", route: "/moves" }]]);
      // Pelapor yang gagal tidak mengganggu respons.
      setErrorReporter(() => {
        throw new Error("sentry down");
      });
      expect(() => new DbExceptionFilter().catch(boom, host(req))).not.toThrow();
    } finally {
      setErrorReporter(null);
    }
  });
});

describe("pesan error dua bahasa", () => {
  const runLang = (error: unknown, lang?: string) => {
    let body: unknown;
    const res = {
      status() {
        return this;
      },
      json(payload: unknown) {
        body = payload;
      },
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => res,
        getRequest: () => ({ headers: { "accept-language": lang } }),
      }),
    } as unknown as ArgumentsHost;
    new DbExceptionFilter().catch(error, host);
    return body as { message: string; errors?: { message: string }[] };
  };

  it("Accept-Language en menerjemahkan pesan tetap, pola, dan pesan validasi; id/tanpa header tetap Indonesia", async () => {
    const { BadRequestException, NotFoundException } = await import("@nestjs/common");
    const v = new BadRequestException({
      message: "Validasi gagal",
      errors: [
        { path: "qty", message: "Harus lebih dari 0" },
        { path: "x", message: "Required" },
      ],
    });
    expect(runLang(v, "en-US,en;q=0.9")).toMatchObject({
      message: "Validation failed",
      errors: [{ message: "Must be greater than 0" }, { message: "Required" }],
    });
    expect(runLang(v, "id-ID,id;q=0.9,en;q=0.8").message).toBe("Validasi gagal");
    expect(runLang(v).message).toBe("Validasi gagal");
    expect(runLang(new NotFoundException("Produk tidak ditemukan"), "en").message).toBe("Product not found");
    expect(runLang(new NotFoundException("Gudang tidak ditemukan di perusahaan ini"), "en").message).toBe(
      "Warehouse not found in this company",
    );
    expect(
      runLang(new BadRequestException("Kurs USD pada/sebelum 2026-01-02 belum diisi"), "en").message,
    ).toBe("No USD rate on or before 2026-01-02");
    // Belum ada terjemahan: dikirim apa adanya.
    expect(runLang(new BadRequestException("Pesan khusus modul"), "en").message).toBe("Pesan khusus modul");
    expect(runLang(pgError({ code: "23505", message: "dup" }), "en").message).toBe("Duplicate record");
  });
});
