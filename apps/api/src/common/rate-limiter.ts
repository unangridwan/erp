import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { Redis } from "ioredis";

/** Penyimpanan hitungan percobaan (fixed window): kembalikan jumlah percobaan & sisa waktu jendela (ms). */
export interface RateStore {
  hit(key: string, windowMs: number, now: number): Promise<{ count: number; ttlMs: number }>;
  reset(key: string): Promise<void>;
  close?(): Promise<void>;
}

/** Token injeksi untuk mengganti penyimpanan (mis. di test). */
export const RATE_STORE = "RATE_STORE";

/** Penyimpanan memori: cukup untuk satu instance (dan untuk test). */
export class MemoryRateStore implements RateStore {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowMs: number, now: number) {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      this.sweep(now);
      return { count: 1, ttlMs: windowMs };
    }
    entry.count++;
    return { count: entry.count, ttlMs: entry.resetAt - now };
  }

  async reset(key: string) {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

// INCR + PEXPIRE atomik: jendela dimulai pada percobaan pertama.
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {c, ttl}`;

/** Penyimpanan Redis: hitungan dibagi semua instance API. */
export class RedisRateStore implements RateStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "erp:rl:",
  ) {}

  async hit(key: string, windowMs: number) {
    const [count, ttlMs] = (await this.redis.eval(HIT_SCRIPT, 1, this.prefix + key, String(windowMs))) as [
      number,
      number,
    ];
    return { count, ttlMs };
  }

  async reset(key: string) {
    await this.redis.del(this.prefix + key);
  }

  async close() {
    await this.redis.quit().catch(() => undefined);
  }
}

/** Satu koneksi Redis per URL untuk seluruh proses (RateLimiter bisa diinstansiasi beberapa modul). */
const shared = new Map<string, { store: RedisRateStore; users: number }>();

function redisStore(url: string): RedisRateStore {
  const existing = shared.get(url);
  if (existing) {
    existing.users++;
    return existing.store;
  }
  const redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false });
  redis.on("error", () => undefined); // dicatat saat percobaan gagal (lihat RateLimiter)
  const store = new RedisRateStore(redis);
  shared.set(url, { store, users: 1 });
  return store;
}

/**
 * Pembatas percobaan fixed window. Dengan `RATE_LIMIT_REDIS_URL` (atau `REDIS_URL` di produksi) hitungan disimpan di
 * Redis sehingga berlaku lintas instance; bila Redis tidak terjangkau, sementara memakai memori instance ini agar login
 * tetap terlindungi tanpa memblokir semua pengguna.
 */
@Injectable()
export class RateLimiter implements OnApplicationShutdown {
  private readonly logger = new Logger("RateLimiter");
  private readonly fallback = new MemoryRateStore();
  private readonly store: RateStore;
  private readonly url: string | undefined;
  private warnedAt = 0;

  constructor(@Optional() @Inject(RATE_STORE) store?: RateStore) {
    this.url =
      process.env.RATE_LIMIT_REDIS_URL ||
      (process.env.NODE_ENV === "production" ? process.env.REDIS_URL : undefined) ||
      undefined;
    this.store = store ?? (this.url ? redisStore(this.url) : this.fallback);
  }

  /** Catat satu percobaan; lempar 429 bila melebihi `max` dalam `windowMs`. */
  async consume(key: string, max: number, windowMs: number, now = Date.now()) {
    const { count, ttlMs } = await this.hit(key, windowMs, now);
    if (count > max) {
      const retryAfter = Math.max(1, Math.ceil(ttlMs / 1000));
      throw new HttpException(
        {
          statusCode: 429,
          message: `Terlalu banyak percobaan. Coba lagi dalam ${retryAfter} detik.`,
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async reset(key: string) {
    await this.store.reset(key).catch(() => this.fallback.reset(key));
  }

  async onApplicationShutdown() {
    if (!this.url) return;
    const entry = shared.get(this.url);
    if (entry && --entry.users === 0) {
      shared.delete(this.url);
      await entry.store.close();
    }
  }

  private async hit(key: string, windowMs: number, now: number) {
    try {
      return await this.store.hit(key, windowMs, now);
    } catch (e) {
      if (now - this.warnedAt > 60_000) {
        this.warnedAt = now;
        this.logger.warn(`Redis rate limiter tidak terjangkau, memakai memori: ${(e as Error).message}`);
      }
      return this.fallback.hit(key, windowMs, now);
    }
  }
}
