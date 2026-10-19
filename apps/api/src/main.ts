import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { loadEnv } from "@erp/db";
import { AppModule } from "./app.module.js";
import { JsonLogger, type LogFormat } from "./common/observability.js";
import { CONFIG, type AppConfig } from "./config.js";

// Konfigurasi dibaca saat modul dibuat (setelah baris ini), jadi .env cukup dimuat di sini.
loadEnv();
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  logger: new JsonLogger((process.env.LOG_FORMAT as LogFormat | undefined) ?? "pretty"),
  bodyParser: false,
});
const config = app.get<AppConfig>(CONFIG);
// Impor CSV/XML bisa beberapa MB; batas tetap ada agar body raksasa ditolak.
app.useBodyParser("json", { limit: process.env.BODY_LIMIT ?? "10mb" });
app.useBodyParser("urlencoded", { limit: "1mb", extended: false });
// Di balik reverse proxy (nginx/load balancer), percayai X-Forwarded-For agar IP klien & rate limit benar.
if (process.env.TRUST_PROXY)
  app.set("trust proxy", process.env.TRUST_PROXY === "true" ? true : process.env.TRUST_PROXY);
app.disable("x-powered-by");
app.enableCors({
  origin: config.webOrigin.split(",").map((o) => o.trim()),
  credentials: false,
  exposedHeaders: ["Content-Disposition", "X-Request-Id"],
});
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001));
