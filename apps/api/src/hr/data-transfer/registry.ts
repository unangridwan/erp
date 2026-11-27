import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { personalVisible } from "../privacy.js";
import { and, desc, eq, inArray, schema, type Db } from "@erp/db";
import { hasPermission, type Permission } from "@erp/shared";
import { z } from "zod";
import { currentContext } from "../../common/request-context.js";
import { PayrollService } from "../../payroll/payroll.service.js";
import { ChecklistService } from "../checklist.service.js";
import { ContractService } from "../contract.service.js";
import { EmployeeService } from "../employee.service.js";
import { HistoryService } from "../history.service.js";
import { ScheduleService } from "../schedule.service.js";
import type { Ctx, Dataset } from "./core.js";
import { hrDatasets } from "./datasets-hr.js";
import { payrollDatasets } from "./datasets-payroll.js";

const can = (p: Permission) => hasPermission(currentContext().permissions, p);

/**
 * Dataset HR & Payroll (dipakai impor/ekspor data dan pembuat laporan). Hak dicek terhadap user di konteks request
 * aktif; data sensitif hanya untuk pemegang hak kelola.
 */
@Injectable()
export class DatasetRegistry {
  private readonly datasets: Map<string, Dataset>;

  constructor(
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
    @Inject(EmployeeService) employees: EmployeeService,
    @Inject(HistoryService) history: HistoryService,
    @Inject(ChecklistService) checklists: ChecklistService,
    @Inject(ContractService) contracts: ContractService,
    @Inject(PayrollService) payroll: PayrollService,
  ) {
    this.datasets = new Map(
      [
        ...hrDatasets({ schedules, employees, history, checklists, contracts }),
        ...payrollDatasets(payroll, employees),
      ].map((d) => [d.key, d]),
    );
  }

  /** Dataset yang boleh dibaca user aktif. */
  readable() {
    return [...this.datasets.values()].filter((d) => can(d.read));
  }

  get(key: string, access: "read" | "write" = "read") {
    const d = this.datasets.get(key);
    if (!d) throw new NotFoundException("Dataset tidak ditemukan");
    if (!can(d.read)) throw new ForbiddenException(`Butuh permission ${d.read}`);
    if (access === "write") {
      if (!d.write) throw new BadRequestException("Dataset ini hanya bisa diekspor");
      if (!can(d.write)) throw new ForbiddenException(`Butuh permission ${d.write}`);
    }
    return d;
  }

  async ctx(tx: Db, d: Dataset, runId?: string): Promise<Ctx> {
    if (d.needsRun && !runId) throw new BadRequestException("Pilih periode payroll");
    return this.baseCtx(tx, d, runId);
  }

  /** Konteks tanpa syarat periode (untuk daftar kolom dataset slip sebelum periode dipilih). */
  async baseCtx(tx: Db, d: Dataset, runId?: string): Promise<Ctx> {
    const companyId = currentContext().companyId;
    if (runId && !z.string().uuid().safeParse(runId).success)
      throw new BadRequestException("Payroll tidak ditemukan");
    return {
      companyId,
      manage: d.app === "payroll" ? can("payroll.write") : personalVisible(),
      timeZone: await this.schedules.timezone(tx, companyId),
      runId,
    };
  }

  /** Kolom yang boleh dilihat user (data sensitif hanya untuk pemegang hak kelola). */
  async visibleColumns(tx: Db, d: Dataset, ctx: Ctx) {
    return (await d.columns(tx, ctx)).filter((c) => !c.sensitive || ctx.manage);
  }

  /** Payroll terposting terakhir perusahaan aktif (untuk laporan slip terjadwal). */
  async latestRunId(tx: Db) {
    const [run] = await tx
      .select({ id: schema.payrollRuns.id })
      .from(schema.payrollRuns)
      .where(
        and(
          eq(schema.payrollRuns.companyId, currentContext().companyId),
          inArray(schema.payrollRuns.state, ["done", "paid"]),
        ),
      )
      .orderBy(desc(schema.payrollRuns.periodStart), desc(schema.payrollRuns.createdAt))
      .limit(1);
    if (!run) throw new BadRequestException("Belum ada payroll terposting");
    return run.id;
  }
}
