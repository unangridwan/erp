import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../src/client.js";
import { tracingEnabled } from "../src/tracing.js";

const url = process.env.DATABASE_URL;

describe("tracing query postgres.js", () => {
  it("hanya aktif bila exporter OTLP dikonfigurasi", () => {
    expect(tracingEnabled({})).toBe(false);
    expect(tracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318" })).toBe(true);
    expect(tracingEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://c:4318/v1/traces" })).toBe(true);
    expect(tracingEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: "http://c:4318", OTEL_SDK_DISABLED: "true" })).toBe(
      false,
    );
  });

  describe.skipIf(!url)("dengan database", () => {
    const exporter = new InMemorySpanExporter();
    let conn: ReturnType<typeof createDb>;

    beforeAll(() => {
      context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
      trace.setGlobalTracerProvider(
        new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
      );
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://collector:4318";
      conn = createDb(url!, { onnotice: () => {} });
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    });
    afterAll(async () => {
      await conn?.client.end();
      trace.disable();
      context.disable();
    });

    it("span per query (tanpa parameter), transaksi sebagai induk, hasil query tetap sama", async () => {
      exporter.reset();
      const { db } = conn;
      const rows = await db.execute(sql`select ${41}::int + 1 as answer`);
      expect(rows[0]).toEqual({ answer: 42 });
      const inTx = await db.transaction(async (tx) => {
        const [r] = await tx.execute(sql`select ${"rahasia-param"}::text as v`);
        // Savepoint (transaksi bersarang drizzle) tetap terinstrumentasi.
        await tx.transaction(async (sp) => sp.execute(sql`select 1`));
        return r;
      });
      expect(inTx).toEqual({ v: "rahasia-param" });
      // Kueri builder memakai .values() — format hasil tidak boleh berubah.
      const tenants = await db.execute(sql`select count(*)::int as n from pg_class`);
      expect(typeof tenants[0]!.n).toBe("number");

      const spans = exporter.getFinishedSpans();
      const tx = spans.find((s) => s.name === "postgres transaction")!;
      expect(tx).toBeDefined();
      const selects = spans.filter((s) => s.name === "postgres SELECT");
      expect(selects.length).toBeGreaterThanOrEqual(4);
      const inner = selects.filter((s) => s.parentSpanContext?.spanId === tx.spanContext().spanId);
      expect(inner.length).toBeGreaterThanOrEqual(1);
      for (const s of spans) expect(JSON.stringify(s.attributes)).not.toContain("rahasia-param");
      expect(selects[0]!.attributes).toMatchObject({
        "db.system": "postgresql",
        "db.operation.name": "SELECT",
      });
    });

    it("query gagal → span berstatus error, error tetap dilempar", async () => {
      exporter.reset();
      await expect(conn.db.execute(sql`select * from tabel_tidak_ada`)).rejects.toThrow();
      const [span] = exporter.getFinishedSpans();
      expect(span!.status.code).toBe(SpanStatusCode.ERROR);
    });
  });
});
