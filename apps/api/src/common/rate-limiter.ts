import { HttpException, HttpStatus, Injectable } from "@nestjs/common";

/**
 * Pembatas percobaan berbasis memori (fixed window) — cukup untuk satu instance.
 * Untuk banyak instance, ganti penyimpanan dengan Redis.
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  /** Catat satu percobaan; lempar 429 bila melebihi `max` dalam `windowMs`. */
  consume(key: string, max: number, windowMs: number, now = Date.now()) {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      this.sweep(now);
      return;
    }
    entry.count++;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
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

  reset(key: string) {
    this.hits.delete(key);
  }

  private sweep(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
