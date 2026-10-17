import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadEnv } from "@erp/db";
import { AppModule } from "./app.module.js";
import { CONFIG, type AppConfig } from "./config.js";

// Konfigurasi dibaca saat modul dibuat (setelah baris ini), jadi .env cukup dimuat di sini.
loadEnv();
const app = await NestFactory.create(AppModule);
app.enableCors({ origin: app.get<AppConfig>(CONFIG).webOrigin });
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001));
