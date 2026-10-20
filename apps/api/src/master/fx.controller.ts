import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Post,
  Put,
  Query,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { and, desc, eq, inArray, lte, schema, sql, type Db } from "@erp/db";
import { BASE_CURRENCY, convertAmount, fxFetchSchema, fxSettingsSchema } from "@erp/shared";
import { z } from "zod";
import { RequirePermission } from "../auth/decorators.js";
import { CONFIG, type AppConfig } from "../config.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { parse } from "../common/zod.js";
import { reportError } from "../common/error-reporting.js";

@Injectable()
export class FxService {
  /** Kurs terakhir yang berlaku pada/sebelum `date` (IDR per 1 unit). IDR selalu 1. */
  async rateOn(
    tx: Db,
    currencyCode: string,
    date: string,
  ): Promise<{ rate: string; rateDate: string | null }> {
    if (currencyCode === BASE_CURRENCY) return { rate: "1", rateDate: null };
    const [row] = await tx
      .select({ rate: schema.currencyRates.rate, rateDate: schema.currencyRates.rateDate })
      .from(schema.currencyRates)
      .where(
        and(eq(schema.currencyRates.currencyCode, currencyCode), lte(schema.currencyRates.rateDate, date)),
      )
      .orderBy(desc(schema.currencyRates.rateDate))
      .limit(1);
    if (!row) throw new NotFoundException(`Kurs ${currencyCode} pada/sebelum ${date} belum diisi`);
    return row;
  }
}

const convertQuery = z.object({
  from: z.string().length(3).toUpperCase(),
  to: z.string().length(3).toUpperCase().default(BASE_CURRENCY),
  amount: z.string().regex(/^-?\d+(\.\d+)?$/, "Jumlah tidak valid"),
  date: z
    .string()
    .date()
    .default(() => new Date().toISOString().slice(0, 10)),
});

@Controller("fx")
export class FxController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FxService) private readonly fx: FxService,
  ) {}

  @Get("convert")
  @RequirePermission("currency.read")
  convert(@Query() query: unknown) {
    const input = parse(convertQuery, query);
    return this.tenantDb.run(async (tx) => {
      const [target] = await tx.select().from(schema.currencies).where(eq(schema.currencies.code, input.to));
      if (!target) throw new BadRequestException(`Mata uang ${input.to} tidak dikenal`);
      const from = await this.fx.rateOn(tx, input.from, input.date);
      const to = await this.fx.rateOn(tx, input.to, input.date);
      return {
        ...input,
        result: convertAmount(input.amount, from.rate, to.rate, target.decimals),
        fromRate: from,
        toRate: to,
      };
    });
  }
}

type FxSettings = typeof schema.fxSettings.$inferSelect;

/**
 * Sumber kurs otomatis: kurs referensi ECB lewat API Frankfurter (IDR per 1 unit mata uang asing). Untuk keperluan
 * pajak (kurs KMK) tetap isi manual — DJP/Kemenkeu tidak menyediakan API resmi.
 */
@Injectable()
export class FxSyncService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("FxSync");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.fx.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDaily().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "fx-daily" });
        }),
      60 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  async settings(tx: Db): Promise<FxSettings | { source: "manual"; currencies: string[]; daily: boolean }> {
    const [row] = await tx.select().from(schema.fxSettings);
    return row ?? { source: "manual", currencies: ["USD"], daily: false };
  }

  async saveSettings(tx: Db, input: z.infer<typeof fxSettingsSchema>) {
    const known = await tx
      .select({ code: schema.currencies.code })
      .from(schema.currencies)
      .where(inArray(schema.currencies.code, input.currencies.length ? input.currencies : ["-"]));
    const unknown = input.currencies.filter((c) => !known.some((k) => k.code === c));
    if (unknown.length) throw new BadRequestException(`Mata uang tidak dikenal: ${unknown.join(", ")}`);
    await tx
      .insert(schema.fxSettings)
      .values(input)
      .onConflictDoUpdate({ target: schema.fxSettings.tenantId, set: { ...input, updatedAt: sql`now()` } });
    return this.settings(tx);
  }

  /** Ambil kurs untuk tanggal tertentu (default: terbaru) dan simpan; kurs yang sudah ada untuk tanggal itu diperbarui. */
  async fetch(tx: Db, date?: string) {
    const s = await this.settings(tx);
    if (s.source === "manual")
      throw new BadRequestException("Sumber kurs masih manual; pilih sumber otomatis dulu");
    if (!s.currencies.length) throw new BadRequestException("Belum ada mata uang yang dipilih");
    const rates: { currencyCode: string; rateDate: string; rate: string }[] = [];
    try {
      for (const code of s.currencies) {
        const url = `${this.config.fx.frankfurterUrl}/${date ?? "latest"}?from=${code}&to=IDR`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`${code}: HTTP ${res.status}`);
        const body = (await res.json()) as { date?: string; rates?: Record<string, number> };
        const rate = body.rates?.IDR;
        if (!body.date || !rate || !(rate > 0)) throw new Error(`${code}: respons tanpa kurs IDR`);
        rates.push({ currencyCode: code, rateDate: body.date, rate: String(rate) });
      }
    } catch (e) {
      // Dikembalikan (bukan dilempar) agar catatan error tidak ikut dibatalkan bersama transaksi.
      const error = `Gagal mengambil kurs: ${(e as Error).message}`;
      await tx
        .update(schema.fxSettings)
        .set({ lastError: error, updatedAt: sql`now()` })
        .where(sql`true`);
      return { source: s.source, rates: [], error };
    }
    for (const r of rates)
      await tx
        .insert(schema.currencyRates)
        .values(r)
        .onConflictDoUpdate({
          target: [
            schema.currencyRates.tenantId,
            schema.currencyRates.currencyCode,
            schema.currencyRates.rateDate,
          ],
          set: { rate: r.rate },
        });
    await tx
      .update(schema.fxSettings)
      .set({ lastFetchAt: sql`now()`, lastError: null, updatedAt: sql`now()` })
      .where(sql`true`);
    return { source: s.source, rates, error: null };
  }

  /** Penjadwal: tenant dengan pengambilan harian yang belum mengambil kurs dalam 20 jam terakhir. */
  async runDaily() {
    const tenants = await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants);
    let done = 0;
    for (const t of tenants) {
      await this.tenantDb
        .runAs(t.id, async (tx) => {
          const [s] = await tx
            .select()
            .from(schema.fxSettings)
            .where(
              and(
                eq(schema.fxSettings.daily, true),
                sql`${schema.fxSettings.source} <> 'manual'`,
                sql`(${schema.fxSettings.lastFetchAt} is null or ${schema.fxSettings.lastFetchAt} < now() - interval '20 hours')`,
              ),
            );
          if (!s) return;
          const result = await this.fetch(tx);
          if (result.error) throw new Error(result.error);
          done++;
        })
        .catch((e: unknown) => this.logger.warn(`Kurs tenant ${t.id}: ${(e as Error).message}`));
    }
    if (done) this.logger.log(`Kurs otomatis diambil untuk ${done} tenant`);
    return done;
  }
}

@Controller("fx")
export class FxSettingsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(FxSyncService) private readonly sync: FxSyncService,
  ) {}

  @Get("settings")
  @RequirePermission("currency.read")
  settings() {
    return this.tenantDb.run((tx) => this.sync.settings(tx));
  }

  @Put("settings")
  @RequirePermission("currency.write")
  saveSettings(@Body() body: unknown) {
    const input = parse(fxSettingsSchema, body);
    return this.tenantDb.run((tx) => this.sync.saveSettings(tx, input));
  }

  @Post("fetch")
  @HttpCode(200)
  @RequirePermission("currency.write")
  async fetch(@Body() body: unknown) {
    const { date } = parse(fxFetchSchema, body ?? {});
    const result = await this.tenantDb.run((tx) => this.sync.fetch(tx, date));
    if (result.error) throw new BadRequestException(result.error);
    return result;
  }
}
