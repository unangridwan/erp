import type { LoggerService, LogLevel } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { contextSlot } from "./request-context.js";

// ---- Log terstruktur ----

export type LogFormat = "json" | "pretty" | "off";

/** Logger Nest berformat JSON satu baris (siap dikirim ke Loki/ELK/CloudWatch). */
export class JsonLogger implements LoggerService {
  constructor(private readonly format: LogFormat = "json") {}

  private write(level: LogLevel, message: unknown, rest: unknown[]) {
    if (this.format === "off") return;
    const context = typeof rest.at(-1) === "string" ? (rest.pop() as string) : undefined;
    const fields =
      message && typeof message === "object"
        ? (message as Record<string, unknown>)
        : { msg: String(message) };
    const error = rest.find((r) => typeof r === "string" && r.includes("\n    at "));
    const line = {
      time: new Date().toISOString(),
      level,
      context,
      ...fields,
      ...(error ? { stack: error } : {}),
    };
    if (this.format === "pretty") {
      const { time, level: l, context: c, msg, ...extra } = line as Record<string, unknown>;
      const tail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
      (l === "error" ? process.stderr : process.stdout).write(
        `${time} ${String(l).toUpperCase()} [${c ?? "app"}] ${msg ?? ""}${tail}\n`,
      );
      return;
    }
    (level === "error" ? process.stderr : process.stdout).write(`${JSON.stringify(line)}\n`);
  }

  log(message: unknown, ...rest: unknown[]) {
    this.write("log", message, rest);
  }
  error(message: unknown, ...rest: unknown[]) {
    this.write("error", message, rest);
  }
  warn(message: unknown, ...rest: unknown[]) {
    this.write("warn", message, rest);
  }
  debug(message: unknown, ...rest: unknown[]) {
    this.write("debug", message, rest);
  }
  verbose(message: unknown, ...rest: unknown[]) {
    this.write("verbose", message, rest);
  }
}

// ---- Metrik Prometheus ----

const BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, { buckets: number[]; sum: number; count: number }>();
  private readonly started = Date.now();

  observe(method: string, route: string, status: number, seconds: number) {
    const key = `method="${method}",route="${route}",status="${status}"`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
    const dKey = `method="${method}",route="${route}"`;
    const d = this.durations.get(dKey) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
    BUCKETS.forEach((b, i) => {
      if (seconds <= b) d.buckets[i]!++;
    });
    d.sum += seconds;
    d.count++;
    this.durations.set(dKey, d);
  }

  /** Format eksposisi teks Prometheus. */
  render() {
    const mem = process.memoryUsage();
    const lines = [
      "# HELP http_requests_total Jumlah request HTTP.",
      "# TYPE http_requests_total counter",
      ...[...this.requests].map(([k, v]) => `http_requests_total{${k}} ${v}`),
      "# HELP http_request_duration_seconds Durasi request HTTP.",
      "# TYPE http_request_duration_seconds histogram",
      ...[...this.durations].flatMap(([k, d]) => [
        ...BUCKETS.map((b, i) => `http_request_duration_seconds_bucket{${k},le="${b}"} ${d.buckets[i]}`),
        `http_request_duration_seconds_bucket{${k},le="+Inf"} ${d.count}`,
        `http_request_duration_seconds_sum{${k}} ${d.sum.toFixed(6)}`,
        `http_request_duration_seconds_count{${k}} ${d.count}`,
      ]),
      "# TYPE process_resident_memory_bytes gauge",
      `process_resident_memory_bytes ${mem.rss}`,
      "# TYPE nodejs_heap_used_bytes gauge",
      `nodejs_heap_used_bytes ${mem.heapUsed}`,
      "# TYPE process_uptime_seconds gauge",
      `process_uptime_seconds ${((Date.now() - this.started) / 1000).toFixed(0)}`,
    ];
    return `${lines.join("\n")}\n`;
  }
}

export const metrics = new Metrics();

// ---- Middleware request ----

const REQUEST_ID = /^[\w.-]{1,100}$/;

/**
 * Per request: ID korelasi (X-Request-Id), header keamanan, log akses terstruktur, dan metrik.
 * Body/query tidak pernah dicatat (bisa memuat data pribadi atau token).
 */
export function requestMiddleware(logger: LoggerService, production: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers["x-request-id"];
    const id = typeof incoming === "string" && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    (req as Request & { id: string }).id = id;
    res.setHeader("X-Request-Id", id);
    // API JSON: tidak pernah dirender sebagai halaman, tidak boleh di-frame, tidak di-cache bila berdata.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Cache-Control", "no-store");
    if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.removeHeader("X-Powered-By");

    const slot = contextSlot();
    const start = process.hrtime.bigint();
    res.on("finish", () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const route = (req.route as { path?: string } | undefined)?.path ?? "unmatched";
      metrics.observe(req.method, route, res.statusCode, seconds);
      if (req.path.startsWith("/health") || req.path === "/metrics") return;
      logger.log(
        {
          msg: "request",
          reqId: id,
          method: req.method,
          path: req.path,
          route,
          status: res.statusCode,
          ms: Math.round(seconds * 1000),
          tenantId: slot?.ctx?.tenantId,
          userId: slot?.ctx?.userId,
          ip: req.ip,
        },
        "http",
      );
    });
    next();
  };
}
