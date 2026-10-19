import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module.js";
import { hasDb } from "./helpers.js";

describe("health, header keamanan & metrik", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.METRICS_TOKEN = "metrics-token-uji";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(() => {
    delete process.env.METRICS_TOKEN;
    return app.close();
  });

  it("GET /health mengembalikan status ok", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body.status).toBe("ok");
  });

  it("header keamanan & ID korelasi request", async () => {
    const res = await request(app.getHttpServer())
      .get("/health")
      .set("X-Request-Id", "req-abc.123")
      .expect(200);
    expect(res.headers).toMatchObject({
      "x-request-id": "req-abc.123",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "cache-control": "no-store",
    });
    expect(res.headers["x-powered-by"]).toBeUndefined();
    // ID dari klien yang tidak wajar diganti.
    const bad = await request(app.getHttpServer()).get("/health").set("X-Request-Id", "<script>").expect(200);
    expect(bad.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("metrik Prometheus butuh token", async () => {
    await request(app.getHttpServer()).get("/health");
    await request(app.getHttpServer()).get("/metrics").expect(401);
    const res = await request(app.getHttpServer())
      .get("/metrics")
      .set("Authorization", "Bearer metrics-token-uji")
      .expect(200);
    expect(res.text).toContain('http_requests_total{method="GET",route="/health",status="200"}');
    expect(res.text).toContain("http_request_duration_seconds_bucket");
    expect(res.text).toContain("process_resident_memory_bytes");
  });

  it.skipIf(!hasDb)("GET /health/ready memeriksa database", async () => {
    const res = await request(app.getHttpServer()).get("/health/ready").expect(200);
    expect(res.body).toMatchObject({ status: "ok", database: "ok" });
    expect(res.body.migrations).toBeGreaterThanOrEqual(9);
  });
});
