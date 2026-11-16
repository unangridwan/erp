import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { and, asc, desc, eq, isNull, lte, or, schema, sql, type Db } from "@erp/db";
import {
  drillReport,
  effectivePermissions,
  latestOccurrence,
  nextOccurrence,
  reportConfigSchema,
  reportScheduleSchema,
  runReport,
  savedReportSchema,
  toCsv,
  type ReportConfig,
  type ReportResult,
  type ReportScheduleInput,
} from "@erp/shared";
import type { Response } from "express";
import PDFDocument from "pdfkit";
import { z } from "zod";
import { loadAccessGrants } from "../auth/auth.service.js";
import { toXlsxBook } from "../common/csv-import.js";
import { OWNER_DB, TenantDb } from "../common/database.js";
import { reportError } from "../common/error-reporting.js";
import { Mailer } from "../common/mailer.js";
import { currentContext, runWithContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { CONFIG, type AppConfig } from "../config.js";
import { RowError } from "../hr/data-transfer/core.js";
import { DataTransferModule } from "../hr/data-transfer/data-transfer.module.js";
import { ReportDatasets } from "./report-datasets.js";
import { HrModule } from "../hr/hr.module.js";
import { ScheduleService } from "../hr/schedule.service.js";

const R = schema.savedReports;
const S = schema.reportSchedules;
const D = schema.reportDeliveries;

type Format = "xlsx" | "csv" | "pdf";
const formatQuery = z.object({ format: z.enum(["xlsx", "csv", "pdf"]).default("xlsx") });
const previewSchema = z.object({ dataset: z.string().min(1).max(60), config: reportConfigSchema });
/** Drilldown: laporan tersimpan (`reportId`) atau dataset + konfigurasi, nilai kelompok yang diklik, filter periode. */
const drillSchema = z
  .object({
    reportId: z.string().uuid().optional(),
    dataset: z.string().min(1).max(60).optional(),
    config: reportConfigSchema.optional(),
    match: z.record(z.string().max(100), z.string().max(500)).default({}),
    filters: z.record(z.string().max(60), z.string().max(200)).default({}),
  })
  .refine((v) => v.reportId || v.dataset, { message: "Isi laporan atau dataset" });
const CONTENT_TYPE: Record<Format, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
};

/** Menjalankan & merender laporan kustom atas dataset HR/Payroll dengan hak user di konteks aktif. */
@Injectable()
export class ReportsService {
  constructor(@Inject(ReportDatasets) readonly registry: ReportDatasets) {}

  /** Dataset yang bisa dipakai user + kolom yang boleh ia lihat. */
  async datasets(tx: Db) {
    const out = [];
    for (const d of this.registry.readable()) {
      const base = await this.registry.baseCtx(tx, d);
      const columns = await this.registry.visibleColumns(tx, d, base);
      out.push({
        key: d.key,
        label: d.label,
        description: d.description,
        app: d.app,
        needsRun: Boolean(d.needsRun),
        filters: d.filters ?? [],
        columns: columns.map((c) => ({ key: c.key, header: c.header, group: c.group, numeric: !!c.numeric })),
      });
    }
    return out;
  }

  /**
   * Jalankan konfigurasi atas dataset: hak baca dataset & kolom sensitif dicek setiap kali (bukan saat disimpan),
   * sehingga laporan bersama/terjadwal tidak membuka data bagi yang kehilangan hak.
   */
  async execute(tx: Db, datasetKey: string, config: ReportConfig): Promise<ReportResult & { title: string }> {
    return this.compute(tx, datasetKey, config, [], (rows, cols) => runReport(rows, cols, config));
  }

  /** Rincian baris penyusun satu kelompok/titik laporan (lihat `drillReport`). */
  async drill(tx: Db, datasetKey: string, config: ReportConfig, match: Record<string, string>) {
    return this.compute(tx, datasetKey, config, Object.keys(match), (rows, cols) =>
      drillReport(rows, cols, config, match),
    );
  }

  private async compute(
    tx: Db,
    datasetKey: string,
    config: ReportConfig,
    extraKeys: string[],
    run: (
      rows: Record<string, unknown>[],
      columns: { key: string; header: string; numeric?: boolean }[],
    ) => ReportResult,
  ): Promise<ReportResult & { title: string }> {
    const d = this.registry.get(datasetKey);
    const filters = { ...config.filters };
    if (d.needsRun && (filters.runId === "latest" || !filters.runId))
      filters.runId = await this.registry.latestRunId(tx);
    const ctx = await this.registry.ctx(tx, d, filters.runId);
    const all = await d.columns(tx, ctx);
    const visible = all.filter((c) => !c.sensitive || ctx.manage);
    const referenced = [
      ...config.columns,
      ...config.conditions.map((c) => c.column),
      ...config.groupBy,
      ...config.aggregates.map((a) => a.column).filter((c) => c !== "*"),
      ...extraKeys,
    ];
    if (referenced.some((k) => all.some((c) => c.key === k && c.sensitive) && !ctx.manage))
      throw new ForbiddenException("Kolom data pribadi hanya untuk pemegang hak kelola");
    let rows: Record<string, unknown>[];
    try {
      rows = await d.rows(tx, ctx, filters);
    } catch (e) {
      if (e instanceof RowError) throw new BadRequestException(e.message);
      throw e;
    }
    try {
      return {
        ...run(
          rows,
          visible.map((c) => ({ key: c.key, header: c.header, numeric: c.numeric })),
        ),
        title: d.label,
      };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : String(e));
    }
  }

  async render(result: ReportResult, format: Format, title: string) {
    const display = (v: unknown) => (v === null || v === undefined ? "" : String(v));
    const totals = Object.keys(result.totals).length
      ? { [result.columns[0]!.key]: "TOTAL", ...result.totals }
      : undefined;
    if (format === "csv") {
      const headers = result.columns.map((c) => c.header);
      const rows = result.rows.map((r) =>
        Object.fromEntries(result.columns.map((c) => [c.header, r[c.key]])),
      );
      return Buffer.from("﻿" + toCsv(headers, rows), "utf8");
    }
    if (format === "xlsx")
      return toXlsxBook([
        {
          name: title,
          columns: result.columns.map((c) => ({ key: c.key, header: c.header, numeric: c.numeric })),
          rows: result.rows,
          totals,
        },
      ]);
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, info: { Title: title } });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const left = doc.page.margins.left;
      const width = doc.page.width - left - doc.page.margins.right;
      const colW = width / Math.max(result.columns.length, 1);
      doc.font("Helvetica-Bold").fontSize(13).text(title, left, 32);
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#555")
        .text(
          `${result.total} baris · dibuat ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
        );
      doc.fillColor("#000");
      let y = doc.y + 8;
      const row = (cells: string[], bold = false) => {
        if (y > doc.page.height - 48) {
          doc.addPage();
          y = 32;
        }
        doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8);
        cells.forEach((cell, i) =>
          doc.text(cell, left + i * colW, y, {
            width: colW - 4,
            height: 22,
            ellipsis: true,
            align: result.columns[i]?.numeric ? "right" : "left",
          }),
        );
        y += 14;
      };
      const fmt = (v: unknown, numeric?: boolean) =>
        numeric && display(v) !== "" && !Number.isNaN(Number(v))
          ? new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 }).format(Number(v))
          : display(v);
      row(
        result.columns.map((c) => c.header),
        true,
      );
      for (const r of result.rows) row(result.columns.map((c) => fmt(r[c.key], c.numeric)));
      if (totals)
        row(
          result.columns.map((c) => fmt(totals[c.key], c.numeric)),
          true,
        );
      doc.end();
    });
  }

  /** Laporan yang boleh dilihat user: miliknya atau yang dibagikan (dan dataset-nya bisa ia baca). */
  async find(tx: Db, id: string, owner = false) {
    const ctx = currentContext();
    const [row] = await tx
      .select()
      .from(R)
      .where(and(eq(R.id, id), eq(R.companyId, ctx.companyId)));
    if (!row || (row.ownerId !== ctx.userId && (owner || row.visibility !== "shared")))
      throw new NotFoundException("Laporan tidak ditemukan");
    this.registry.get(row.dataset);
    return row;
  }

  filename(name: string, format: Format) {
    return `${name.replace(/[^\w-]+/g, "_").slice(0, 60) || "laporan"}-${new Date().toISOString().slice(0, 10)}.${format}`;
  }
}

/**
 * Pengirim laporan terjadwal (tiap 5 menit): jadwal jatuh tempo dijalankan dengan hak pemilik saat ini, dikirim sebagai
 * lampiran email, dicatat di riwayat. Periode diklaim atomik sehingga terkirim tepat sekali per periode.
 */
@Injectable()
export class ReportScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("ReportScheduler");
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(OWNER_DB) private readonly ownerDb: Db,
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(Mailer) private readonly mailer: Mailer,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.reports.scheduler) return;
    this.timer = setInterval(
      () =>
        void this.runDue().catch((e: unknown) => {
          this.logger.error(e);
          reportError(e, { job: "report-scheduler" });
        }),
      5 * 60_000,
    );
    this.timer.unref();
  }

  onApplicationShutdown() {
    clearInterval(this.timer);
  }

  /** Proses jadwal jatuh tempo semua tenant (atau tenant tertentu); mengembalikan jumlah laporan terkirim. */
  async runDue(now = new Date(), tenantIds?: string[]) {
    const tenants =
      tenantIds ??
      (await this.ownerDb.select({ id: schema.tenants.id }).from(schema.tenants)).map((t) => t.id);
    let sent = 0;
    for (const tenantId of tenants) {
      const due = await this.tenantDb.runAs(tenantId, (tx) =>
        tx
          .select({ schedule: S, report: R })
          .from(S)
          .innerJoin(R, eq(R.id, S.reportId))
          .where(and(eq(S.active, true), or(isNull(S.nextRunAt), lte(S.nextRunAt, now)))),
      );
      for (const { schedule, report } of due) {
        const tz = await this.tenantDb.runAs(tenantId, (tx) => this.schedules.timezone(tx, report.companyId));
        const occurrence = latestOccurrence(schedule, now, tz);
        const nextRunAt = nextOccurrence(schedule, now, tz);
        // Klaim periode: hanya satu proses yang berhasil mengubah last_period untuk periode ini.
        const claimed = occurrence
          ? await this.tenantDb.runAs(tenantId, (tx) =>
              tx
                .update(S)
                .set({ lastPeriod: occurrence.period, nextRunAt })
                .where(and(eq(S.id, schedule.id), sql`${S.lastPeriod} is distinct from ${occurrence.period}`))
                .returning({ id: S.id }),
            )
          : [];
        if (!claimed.length) {
          await this.tenantDb.runAs(tenantId, (tx) =>
            tx.update(S).set({ nextRunAt }).where(eq(S.id, schedule.id)),
          );
          continue;
        }
        const ctx = await this.ownerContext(tenantId, report.ownerId, report.companyId);
        const result = await this.deliver(ctx, schedule.id, occurrence!.period, false, tenantId);
        if (result.status === "sent") sent++;
      }
    }
    return sent;
  }

  /** Konteks pemilik laporan: hak efektif saat ini di perusahaan laporan (user nonaktif → tanpa hak). */
  private ownerContext(tenantId: string, userId: string, companyId: string) {
    return this.tenantDb.runAs(tenantId, async (tx) => {
      const [user] = await tx
        .select({ active: schema.users.active })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      const permissions = user?.active
        ? effectivePermissions(await loadAccessGrants(tx, userId), companyId)
        : [];
      return { tenantId, userId, companyIds: [companyId], companyId, permissions };
    });
  }

  /** Jalankan, render, kirim, dan catat satu pengiriman. */
  async deliver(
    ctx: ReturnType<typeof currentContext>,
    scheduleId: string,
    period: string,
    manual: boolean,
    tenantId = ctx.tenantId,
  ) {
    let schedule: typeof S.$inferSelect | undefined;
    let rows = 0;
    try {
      const file = await runWithContext(ctx, () =>
        this.tenantDb.run(async (tx) => {
          const [row] = await tx
            .select({ schedule: S, report: R })
            .from(S)
            .innerJoin(R, eq(R.id, S.reportId))
            .where(eq(S.id, scheduleId));
          if (!row) throw new NotFoundException("Jadwal laporan tidak ditemukan");
          schedule = row.schedule;
          const result = await this.reports.execute(
            tx,
            row.report.dataset,
            reportConfigSchema.parse(row.report.config),
          );
          rows = result.total;
          return {
            name: row.report.name,
            filename: this.reports.filename(row.report.name, row.schedule.format),
            content: await this.reports.render(result, row.schedule.format, row.report.name),
          };
        }),
      );
      await this.mailer.send({
        to: schedule!.recipients.join(", "),
        subject: `Laporan: ${file.name}`,
        text: `Terlampir laporan "${file.name}" (${rows} baris) — ${manual ? "dikirim manual" : `periode ${period}`}.\n\nEmail ini dikirim otomatis oleh ERP sesuai jadwal laporan.`,
        attachments: [
          { filename: file.filename, content: file.content, contentType: CONTENT_TYPE[schedule!.format] },
        ],
      });
      await this.log(tenantId, scheduleId, period, manual, {
        status: "sent",
        rows,
        recipients: schedule!.recipients,
      });
      await this.tenantDb.runAs(tenantId, (tx) =>
        tx
          .update(S)
          .set({ lastSentAt: sql`now()` })
          .where(eq(S.id, scheduleId)),
      );
      return { status: "sent" as const, rows };
    } catch (e) {
      const message =
        e instanceof Error
          ? ((e as { getResponse?: () => { message?: string } }).getResponse?.()?.message ?? e.message)
          : String(e);
      this.logger.warn(`Laporan terjadwal ${scheduleId} gagal: ${message}`);
      await this.log(tenantId, scheduleId, period, manual, {
        status: "failed",
        error: String(message).slice(0, 500),
        recipients: schedule?.recipients ?? [],
      });
      if (manual) throw e;
      return { status: "failed" as const, rows: 0 };
    }
  }

  private log(
    tenantId: string,
    scheduleId: string,
    period: string,
    manual: boolean,
    v: { status: "sent" | "failed"; rows?: number; recipients: string[]; error?: string },
  ) {
    return this.tenantDb.runAs(tenantId, (tx) =>
      tx.insert(D).values({ scheduleId, period, manual, ...v, rows: v.rows ?? null, error: v.error ?? null }),
    );
  }
}

/** Pembuat laporan kustom: laporan tersimpan, pratinjau, ekspor, jadwal kirim email. */
@Controller()
class ReportsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportScheduler) private readonly scheduler: ReportScheduler,
    @Inject(ScheduleService) private readonly schedules: ScheduleService,
  ) {}

  @Get("reports/datasets")
  datasets() {
    return this.tenantDb.run((tx) => this.reports.datasets(tx));
  }

  @Post("saved-reports/preview")
  @HttpCode(200)
  preview(@Body() body: unknown) {
    const input = parse(previewSchema, body);
    return this.tenantDb.run(async (tx) => {
      const result = await this.reports.execute(tx, input.dataset, input.config);
      return { ...result, rows: result.rows.slice(0, 500) };
    });
  }

  /** Drilldown laporan/grafik/widget: baris dataset penyusun satu kelompok, dengan tautan dokumen sumber. */
  @Post("reports/drill")
  @HttpCode(200)
  drill(@Body() body: unknown) {
    const input = parse(drillSchema, body);
    return this.tenantDb.run(async (tx) => {
      let dataset = input.dataset!;
      let config = input.config ?? reportConfigSchema.parse({});
      if (input.reportId) {
        const report = await this.reports.find(tx, input.reportId);
        dataset = report.dataset;
        config = reportConfigSchema.parse(report.config);
      }
      config = { ...config, filters: { ...config.filters, ...input.filters } };
      return this.reports.drill(tx, dataset, config, input.match);
    });
  }

  @Get("saved-reports")
  list() {
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const readable = new Set(this.reports.registry.readable().map((d) => d.key));
      const rows = await tx
        .select({ report: R, ownerName: schema.users.name })
        .from(R)
        .leftJoin(schema.users, eq(schema.users.id, R.ownerId))
        .where(and(eq(R.companyId, ctx.companyId), or(eq(R.ownerId, ctx.userId), eq(R.visibility, "shared"))))
        .orderBy(asc(R.name));
      return rows
        .filter((r) => readable.has(r.report.dataset))
        .map((r) => ({ ...r.report, ownerName: r.ownerName, mine: r.report.ownerId === ctx.userId }));
    });
  }

  @Get("saved-reports/:id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const report = await this.reports.find(tx, id);
      const schedules =
        report.ownerId === currentContext().userId
          ? await tx.select().from(S).where(eq(S.reportId, id)).orderBy(asc(S.createdAt))
          : [];
      return { ...report, mine: report.ownerId === currentContext().userId, schedules };
    });
  }

  @Post("saved-reports")
  create(@Body() body: unknown) {
    const input = parse(savedReportSchema, body);
    return this.tenantDb.run(async (tx) => {
      // Validasi konfigurasi (dataset, kolom, hak) dengan menjalankannya sekali.
      await this.reports.execute(tx, input.dataset, input.config);
      const ctx = currentContext();
      const [row] = await tx
        .insert(R)
        .values({
          ...input,
          description: input.description ?? null,
          companyId: ctx.companyId,
          ownerId: ctx.userId,
        })
        .returning();
      return row!;
    });
  }

  @Patch("saved-reports/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const current = await this.reports.find(tx, id, true);
      const input = parse(savedReportSchema, { ...current, ...(body as object) });
      await this.reports.execute(tx, input.dataset, input.config);
      const [row] = await tx
        .update(R)
        .set({ ...input, description: input.description ?? null, updatedAt: sql`now()` })
        .where(eq(R.id, id))
        .returning();
      return row!;
    });
  }

  @Delete("saved-reports/:id")
  @HttpCode(204)
  async remove(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      await this.reports.find(tx, id, true);
      await tx.delete(R).where(eq(R.id, id));
    });
  }

  @Get("saved-reports/:id/run")
  run(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const report = await this.reports.find(tx, id);
      const result = await this.reports.execute(tx, report.dataset, reportConfigSchema.parse(report.config));
      return { ...result, rows: result.rows.slice(0, 2000), name: report.name };
    });
  }

  @Get("saved-reports/:id/export")
  async export(@Param("id", ParseUUIDPipe) id: string, @Query() query: unknown, @Res() res: Response) {
    const { format } = parse(formatQuery, query);
    const file = await this.tenantDb.run(async (tx) => {
      const report = await this.reports.find(tx, id);
      const result = await this.reports.execute(tx, report.dataset, reportConfigSchema.parse(report.config));
      return {
        name: this.reports.filename(report.name, format),
        content: await this.reports.render(result, format, report.name),
      };
    });
    res.type(CONTENT_TYPE[format]).attachment(file.name).send(file.content);
  }

  // ---- Jadwal (hanya pemilik laporan) ----

  @Post("saved-reports/:id/schedules")
  addSchedule(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(reportScheduleSchema, body);
    return this.tenantDb.run(async (tx) => {
      const report = await this.reports.find(tx, id, true);
      const timing = await this.timing(tx, report.companyId, input);
      const [row] = await tx
        .insert(S)
        .values({
          ...this.scheduleValues(input),
          ...timing,
          reportId: id,
          createdBy: currentContext().userId,
        })
        .returning();
      return row!;
    });
  }

  @Patch("report-schedules/:id")
  updateSchedule(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tenantDb.run(async (tx) => {
      const { schedule, report } = await this.findSchedule(tx, id);
      const input = parse(reportScheduleSchema, { ...schedule, ...(body as object) });
      const timing = await this.timing(tx, report.companyId, input);
      const [row] = await tx
        .update(S)
        .set({ ...this.scheduleValues(input), ...timing, updatedAt: sql`now()` })
        .where(eq(S.id, id))
        .returning();
      return row!;
    });
  }

  @Delete("report-schedules/:id")
  @HttpCode(204)
  async removeSchedule(@Param("id", ParseUUIDPipe) id: string) {
    await this.tenantDb.run(async (tx) => {
      await this.findSchedule(tx, id);
      await tx.delete(S).where(eq(S.id, id));
    });
  }

  @Get("report-schedules/:id/deliveries")
  deliveries(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.findSchedule(tx, id);
      return tx.select().from(D).where(eq(D.scheduleId, id)).orderBy(desc(D.sentAt)).limit(50);
    });
  }

  /** Kirim sekarang (tidak mengubah periode jadwal). */
  @Post("report-schedules/:id/send-now")
  @HttpCode(200)
  async sendNow(@Param("id", ParseUUIDPipe) id: string) {
    const { schedule } = await this.tenantDb.run((tx) => this.findSchedule(tx, id));
    return this.scheduler.deliver(currentContext(), schedule.id, `manual ${new Date().toISOString()}`, true);
  }

  private scheduleValues(input: ReportScheduleInput) {
    return {
      frequency: input.frequency,
      hour: input.hour,
      weekday: input.frequency === "weekly" ? input.weekday! : null,
      monthday: input.frequency === "monthly" ? input.monthday! : null,
      format: input.format,
      recipients: [...new Set(input.recipients)],
      active: input.active,
    };
  }

  /** Jadwal baru/berubah: periode yang sudah lewat dianggap terkirim; kiriman pertama pada jadwal berikutnya. */
  private async timing(tx: Db, companyId: string, input: ReportScheduleInput) {
    const tz = await this.schedules.timezone(tx, companyId);
    const now = new Date();
    return {
      lastPeriod: latestOccurrence(input, now, tz)?.period ?? null,
      nextRunAt: nextOccurrence(input, now, tz),
    };
  }

  private async findSchedule(tx: Db, id: string) {
    const [row] = await tx
      .select({ schedule: S, report: R })
      .from(S)
      .innerJoin(R, eq(R.id, S.reportId))
      .where(and(eq(S.id, id), eq(R.companyId, currentContext().companyId)));
    if (!row || row.report.ownerId !== currentContext().userId)
      throw new NotFoundException("Jadwal laporan tidak ditemukan");
    return row;
  }
}

@Module({
  imports: [HrModule, DataTransferModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportScheduler, ReportDatasets],
  exports: [ReportsService, ReportDatasets],
})
export class ReportsModule {}
