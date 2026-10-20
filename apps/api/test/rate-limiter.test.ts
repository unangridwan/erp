import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryRateStore, RateLimiter, RedisRateStore, type RateStore } from "../src/common/rate-limiter.js";

const MINUTE = 60_000;

const scenario = (make: () => RateStore) => async () => {
  const limiter = new RateLimiter(make());
  const key = `t-${Math.random().toString(36).slice(2)}`;
  for (let i = 0; i < 3; i++) await limiter.consume(key, 3, MINUTE);
  const err = await limiter
    .consume(key, 3, MINUTE)
    .catch((e: { getStatus(): number; getResponse(): object }) => e);
  expect(err.getStatus()).toBe(429);
  expect(err.getResponse()).toMatchObject({ statusCode: 429, retryAfter: expect.any(Number) });
  await limiter.reset(key);
  await limiter.consume(key, 3, MINUTE);
};

describe("pembatas percobaan", () => {
  it(
    "memori: melewati batas → 429, reset membuka kembali",
    scenario(() => new MemoryRateStore()),
  );

  it("jendela berakhir → hitungan mulai lagi", async () => {
    const limiter = new RateLimiter(new MemoryRateStore());
    await limiter.consume("k", 1, MINUTE, 0);
    await expect(limiter.consume("k", 1, MINUTE, 1000)).rejects.toThrow(/Terlalu banyak/);
    await limiter.consume("k", 1, MINUTE, MINUTE + 1);
  });

  it("penyimpanan gagal → memakai memori instance (tetap membatasi)", async () => {
    const broken: RateStore = {
      hit: () => Promise.reject(new Error("ECONNREFUSED")),
      reset: () => Promise.reject(new Error("ECONNREFUSED")),
    };
    const limiter = new RateLimiter(broken);
    await limiter.consume("x", 1, MINUTE);
    await expect(limiter.consume("x", 1, MINUTE)).rejects.toThrow(/Terlalu banyak/);
  });

  const url = process.env.REDIS_TEST_URL;
  describe.skipIf(!url)("Redis", () => {
    const clients: Redis[] = [];
    const store = () => {
      const r = new Redis(url!);
      clients.push(r);
      return new RedisRateStore(r, "erp:test:rl:");
    };
    afterAll(async () => {
      await Promise.all(clients.map((c) => c.quit()));
    });

    it("hitungan dibagi antar-instance (dua koneksi berbeda)", async () => {
      const a = new RateLimiter(store());
      const b = new RateLimiter(store());
      const key = `shared-${Date.now()}`;
      await a.consume(key, 2, MINUTE);
      await b.consume(key, 2, MINUTE);
      await expect(a.consume(key, 2, MINUTE)).rejects.toThrow(/Terlalu banyak/);
      const ttl = await clients[0]!.pttl(`erp:test:rl:${key}`);
      expect(ttl).toBeGreaterThan(MINUTE - 5000);
      await b.reset(key);
      await a.consume(key, 2, MINUTE);
    });

    it("skenario dasar", scenario(store));
  });
});
