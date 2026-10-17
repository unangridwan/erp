import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { CONFIG, type AppConfig } from "./config.js";

const app = await NestFactory.create(AppModule);
app.enableCors({ origin: app.get<AppConfig>(CONFIG).webOrigin });
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3001));
