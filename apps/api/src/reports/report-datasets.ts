import { ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Db } from "@erp/db";
import { hasPermission } from "@erp/shared";
import { currentContext } from "../common/request-context.js";
import type { Ctx, Dataset } from "../hr/data-transfer/core.js";
import { DatasetRegistry } from "../hr/data-transfer/registry.js";
import { businessDatasets } from "./datasets-business.js";

/**
 * Semua dataset pembuat laporan & dashboard: SDM/Payroll (registry impor/ekspor) + dataset bisnis hanya-baca
 * (penjualan, CRM, akuntansi, pembelian, persediaan, manufaktur, riwayat gaji).
 */
@Injectable()
export class ReportDatasets {
  private readonly business: Map<string, Dataset>;

  constructor(@Inject(DatasetRegistry) private readonly hr: DatasetRegistry) {
    this.business = new Map(businessDatasets().map((d) => [d.key, d]));
  }

  readable(): Dataset[] {
    const perms = currentContext().permissions;
    return [
      ...this.hr.readable(),
      ...[...this.business.values()].filter((d) => hasPermission(perms, d.read)),
    ];
  }

  /** Apakah dataset ada & boleh dibaca user aktif (tanpa melempar galat). */
  canRead(key: string) {
    const b = this.business.get(key);
    if (b) return hasPermission(currentContext().permissions, b.read);
    try {
      this.hr.get(key);
      return true;
    } catch {
      return false;
    }
  }

  get(key: string): Dataset {
    const b = this.business.get(key);
    if (!b) return this.hr.get(key);
    if (!hasPermission(currentContext().permissions, b.read))
      throw new ForbiddenException(`Butuh permission ${b.read}`);
    return b;
  }

  exists(key: string) {
    if (this.business.has(key)) return true;
    try {
      this.hr.get(key);
      return true;
    } catch (e) {
      return !(e instanceof NotFoundException);
    }
  }

  ctx(tx: Db, d: Dataset, runId?: string): Promise<Ctx> {
    return this.hr.ctx(tx, d, runId);
  }

  baseCtx(tx: Db, d: Dataset, runId?: string): Promise<Ctx> {
    return this.hr.baseCtx(tx, d, runId);
  }

  visibleColumns(tx: Db, d: Dataset, ctx: Ctx) {
    return this.hr.visibleColumns(tx, d, ctx);
  }

  latestRunId(tx: Db) {
    return this.hr.latestRunId(tx);
  }
}
