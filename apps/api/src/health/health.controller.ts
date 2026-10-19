import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { sql, type Db } from "@erp/db";
import type { Response } from "express";
import { Public } from "../auth/decorators.js";
import { OWNER_DB } from "../common/database.js";
import { metrics } from "../common/observability.js";
import { CONFIG, type AppConfig } from "../config.js";

@Controller()
export class HealthController {
  constructor(
    @Inject(OWNER_DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness: proses hidup. */
  @Public()
  @Get("health")
  check() {
    return { status: "ok", service: "erp-api", time: new Date().toISOString() };
  }

  /** Readiness: database terjangkau dan migrasi terpasang (untuk load balancer / orkestrator). */
  @Public()
  @Get("health/ready")
  async ready() {
    try {
      const [row] = await this.db.execute<{ migrations: number }>(
        sql`select count(*)::int as migrations from _migrations`,
      );
      return { status: "ok", database: "ok", migrations: row?.migrations ?? 0 };
    } catch {
      throw new ServiceUnavailableException({ status: "error", database: "unreachable" });
    }
  }

  /** Metrik Prometheus; aktif bila METRICS_TOKEN di-set (Authorization: Bearer <token>). */
  @Public()
  @Get("metrics")
  scrape(@Headers("authorization") auth: string | undefined, @Res() res: Response) {
    const token = this.config.metricsToken;
    if (!token) throw new NotFoundException();
    if (auth !== `Bearer ${token}`) throw new UnauthorizedException();
    res.type("text/plain; version=0.0.4").send(metrics.render());
  }
}
