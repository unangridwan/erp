/**
 * Dimuat sebelum aplikasi: `node --import ./dist/instrument.js dist/main.js`.
 * - Tracing OpenTelemetry (HTTP, Express, Nest, Redis; query Postgres lewat @erp/db) dikirim lewat OTLP/HTTP bila
 *   OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_TRACES_ENDPOINT diisi. Sampling mengikuti OTEL_TRACES_SAMPLER.
 * - Pelaporan error ke Sentry bila SENTRY_DSN diisi (error saja; tracing tetap lewat OpenTelemetry).
 * Tanpa variabel tersebut berkas ini tidak memuat apa pun.
 */
import { register } from "node:module";
// Subpath ringan (tanpa driver Postgres) agar driver `postgres` baru dimuat setelah hook instrumentasi terpasang.
import { loadEnv } from "@erp/db/load-env";
import { setErrorReporter } from "./common/error-reporting.js";

loadEnv();
const env = process.env;

if (
  (env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) &&
  env.OTEL_SDK_DISABLED !== "true"
) {
  // Modul ESM (dan CJS yang diimpor dari ESM) hanya bisa diinstrumentasi lewat loader hook.
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  // Hanya trace; metrik tetap di /metrics (Prometheus) dan log di stdout.
  env.OTEL_METRICS_EXPORTER ??= "none";
  env.OTEL_LOGS_EXPORTER ??= "none";
  const [
    { NodeSDK },
    { OTLPTraceExporter },
    { HttpInstrumentation },
    { ExpressInstrumentation },
    { NestInstrumentation },
    { IORedisInstrumentation },
  ] = await Promise.all([
    import("@opentelemetry/sdk-node"),
    import("@opentelemetry/exporter-trace-otlp-http"),
    import("@opentelemetry/instrumentation-http"),
    import("@opentelemetry/instrumentation-express"),
    import("@opentelemetry/instrumentation-nestjs-core"),
    import("@opentelemetry/instrumentation-ioredis"),
  ]);
  const quiet = (url: string | undefined) =>
    !!url && (url.startsWith("/health") || url.startsWith("/metrics"));
  const sdk = new NodeSDK({
    serviceName: env.OTEL_SERVICE_NAME ?? "erp-api",
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => quiet(req.url) }),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new IORedisInstrumentation(),
    ],
  });
  sdk.start();
  process.once("SIGTERM", () => void sdk.shutdown().catch(() => undefined));
}

if (env.SENTRY_DSN) {
  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? "development",
    release: env.SENTRY_RELEASE,
    // Tracing ditangani OpenTelemetry di atas; Sentry hanya menerima error (tanpa tracesSampleRate agar Sentry
    // tidak memasang instrumentasi performanya sendiri).
    skipOpenTelemetrySetup: true,
    sendDefaultPii: false,
  });
  setErrorReporter((error, context) => {
    const { tenantId, userId, reqId, ...rest } = context;
    Sentry.withScope((scope) => {
      if (userId) scope.setUser({ id: userId });
      if (tenantId) scope.setTag("tenant_id", tenantId);
      if (reqId) scope.setTag("request_id", reqId);
      for (const [k, v] of Object.entries(rest)) if (v) scope.setTag(k, v);
      Sentry.captureException(error);
    });
  });
  process.once("SIGTERM", () => void Sentry.flush(2000).catch(() => undefined));
}
