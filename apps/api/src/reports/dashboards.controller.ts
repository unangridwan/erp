import {
  BadRequestException,
  Module,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import { and, asc, eq, or, schema, sql, type Db } from "@erp/db";
import {
  BUILTIN_DASHBOARDS,
  builtinDashboard,
  builtinDocument,
  dashboardInputSchema,
  documentErrors,
  documentVisuals,
  legacyToDocument,
  type BiDocument,
  businessToday,
  changePercent,
  comparisonRange,
  dashboardPinsSchema,
  dashboardRunSchema,
  kpiValue,
  type DashboardWidget,
  type ReportConfig,
} from "@erp/shared";
import { z } from "zod";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { ReportDatasets } from "./report-datasets.js";
import { BiController } from "./bi.controller.js";
import { dashboardDocument, findDashboard } from "./dashboard-store.js";
import { ReportsModule, ReportsService } from "./reports.module.js";

const D = schema.dashboards;
const PIN = schema.dashboardPins;
const MAX_ROWS = 200;

const duplicateSchema = z
  .object({
    builtin: z.string().max(40).optional(),
    dashboardId: z.string().uuid().optional(),
    name: z.string().max(120).optional(),
  })
  .refine((v) => !!v.builtin !== !!v.dashboardId, "Kirim salah satu: builtin atau dashboardId");

export interface WidgetResult {
  id: string;
  hidden?: boolean;
  error?: string;
  dataset?: string;
  columns?: { key: string; header: string; numeric?: boolean }[];
  rows?: Record<string, unknown>[];
  total?: number;
  value?: number;
  previous?: number | null;
  change?: number | null;
  chart?: ReportConfig["chart"];
}

/** Dashboard BI: bawaan (kode) + kustom (tabel `dashboards`), dijalankan dengan hak pengguna aktif. */
@Controller()
export class DashboardsController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportDatasets) private readonly datasets: ReportDatasets,
  ) {}

  /** Daftar dashboard: bawaan yang punya minimal satu widget terbaca + milik sendiri + dibagikan. */
  @Get("dashboards")
  list() {
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const builtin = BUILTIN_DASHBOARDS.map((d) => ({
        key: d.key,
        name: d.name,
        description: d.description,
        period: d.period,
        widgets: d.widgets.length,
        visible: d.widgets.filter((w) => this.readable(w)).length,
      })).filter((d) => d.visible > 0);
      const custom = await tx
        .select({ d: D, ownerName: schema.users.name })
        .from(D)
        .leftJoin(schema.users, eq(schema.users.id, D.ownerId))
        .where(and(eq(D.companyId, ctx.companyId), or(eq(D.ownerId, ctx.userId), eq(D.visibility, "shared"))))
        .orderBy(asc(D.name));
      const pins = await this.pins(tx);
      return {
        builtin: builtin.map((b) => ({ ...b, pinned: pins.includes(`builtin:${b.key}`) })),
        custom: custom.map((r) => ({
          id: r.d.id,
          name: r.d.name,
          description: r.d.description,
          visibility: r.d.visibility,
          widgets: r.d.document
            ? documentVisuals(dashboardDocument(r.d)).length
            : (r.d.widgets as unknown[]).length,
          ownerName: r.ownerName,
          mine: r.d.ownerId === ctx.userId,
          updatedAt: r.d.updatedAt,
          pinned: pins.includes(r.d.id),
        })),
      };
    });
  }

  @Get("dashboards/builtin/:key")
  builtin(@Param("key") key: string) {
    const d = builtinDashboard(key);
    if (!d) throw new NotFoundException("Dashboard tidak ditemukan");
    return {
      ...d,
      builtin: true,
      widgets: d.widgets.map((w) => ({ ...w, hidden: !this.readable(w) })),
      document: builtinDocument(key),
    };
  }

  @Get("dashboards/:id")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const d = await this.find(tx, id);
      return { ...d, document: dashboardDocument(d), mine: d.ownerId === currentContext().userId };
    });
  }

  @Post("dashboards")
  create(@Body() body: unknown) {
    const input = parse(dashboardInputSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.assertWidgets(tx, input.widgets);
      if (input.document) await this.assertDocument(tx, input.document);
      const ctx = currentContext();
      const [row] = await tx
        .insert(D)
        .values({
          companyId: ctx.companyId,
          ownerId: ctx.userId,
          name: input.name,
          description: input.description ?? null,
          visibility: input.visibility,
          widgets: input.widgets,
          document: input.document ?? null,
        })
        .returning();
      return row!;
    });
  }

  @Patch("dashboards/:id")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(dashboardInputSchema, body);
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id, true);
      await this.assertWidgets(tx, input.widgets);
      if (input.document) await this.assertDocument(tx, input.document);
      const [row] = await tx
        .update(D)
        .set({
          name: input.name,
          description: input.description ?? null,
          visibility: input.visibility,
          widgets: input.widgets,
          // Dokumen tidak dikirim = tetap (klien lama yang hanya mengubah widget tidak menghapus dokumen).
          ...(input.document !== undefined ? { document: input.document } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(D.id, id))
        .returning();
      return row!;
    });
  }

  @Delete("dashboards/:id")
  @HttpCode(204)
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      await this.find(tx, id, true);
      await tx.delete(PIN).where(eq(PIN.ref, id));
      await tx.delete(D).where(eq(D.id, id));
    });
  }

  /** Salin dashboard bawaan / dashboard lain yang terlihat menjadi dashboard pribadi yang bisa diubah. */
  @Post("dashboards/duplicate")
  duplicate(@Body() body: unknown) {
    const input = parse(duplicateSchema, body);
    return this.tenantDb.run(async (tx) => {
      let name: string;
      let widgets: DashboardWidget[];
      let document: BiDocument | null;
      if (input.builtin) {
        const b = builtinDashboard(input.builtin);
        if (!b) throw new NotFoundException("Dashboard tidak ditemukan");
        name = b.name[0];
        widgets = b.widgets.filter((w) => this.readable(w));
        document = legacyToDocument(widgets, b.period);
      } else {
        const d = await this.find(tx, input.dashboardId!);
        name = d.name;
        widgets = d.widgets as DashboardWidget[];
        document = d.document ? dashboardDocument(d) : null;
      }
      const ctx = currentContext();
      const [row] = await tx
        .insert(D)
        .values({
          companyId: ctx.companyId,
          ownerId: ctx.userId,
          name: input.name?.trim() || `${name} (salinan)`,
          visibility: "private",
          widgets,
          document,
        })
        .returning();
      return row!;
    });
  }

  /** Jalankan widget dashboard untuk periode tertentu; galat/hak per widget tidak menggagalkan widget lain. */
  @Post("dashboards/run")
  @HttpCode(200)
  run(@Body() body: unknown) {
    const input = parse(dashboardRunSchema, body);
    return this.tenantDb.run(async (tx) => {
      let widgets: DashboardWidget[];
      let owner: string | undefined;
      if (input.builtin) {
        const b = builtinDashboard(input.builtin);
        if (!b) throw new NotFoundException("Dashboard tidak ditemukan");
        widgets = b.widgets;
      } else if (input.dashboardId) {
        const d = await this.find(tx, input.dashboardId);
        widgets = d.widgets as DashboardWidget[];
        owner = d.ownerId;
      } else widgets = input.widgets!;
      const results: WidgetResult[] = [];
      for (const w of widgets) results.push(await this.runWidget(tx, w, input.from, input.to, owner));
      return { from: input.from ?? null, to: input.to ?? null, widgets: results };
    });
  }

  @Get("me/dashboard-pins")
  myPins() {
    return this.tenantDb.run((tx) => this.pins(tx));
  }

  @Put("me/dashboard-pins")
  setPins(@Body() body: unknown) {
    const input = parse(dashboardPinsSchema, body);
    return this.tenantDb.run(async (tx) => {
      const ctx = currentContext();
      const refs = [...new Set(input.refs)];
      for (const ref of refs) {
        if (ref.startsWith("builtin:")) {
          if (!builtinDashboard(ref.slice(8))) throw new BadRequestException("Dashboard tidak ditemukan");
        } else if (!z.string().uuid().safeParse(ref).success)
          throw new BadRequestException("Dashboard tidak ditemukan");
        else await this.find(tx, ref);
      }
      await tx.delete(PIN).where(and(eq(PIN.companyId, ctx.companyId), eq(PIN.userId, ctx.userId)));
      if (refs.length)
        await tx
          .insert(PIN)
          .values(refs.map((ref, i) => ({ companyId: ctx.companyId, userId: ctx.userId, ref, sequence: i })));
      return refs;
    });
  }

  // ---- internal ----

  private readable(w: DashboardWidget) {
    return "dataset" in w.source ? this.datasets.canRead(w.source.dataset) : true;
  }

  /**
   * Sumber widget. Laporan tersimpan boleh milik pengguna, dibagikan, atau milik pemilik dashboard (dashboard bersama
   * memakai laporan pribadi pemiliknya); hak baca dataset tetap dicek untuk pengguna aktif.
   */
  private async resolve(
    tx: Db,
    w: DashboardWidget,
    dashboardOwner?: string,
  ): Promise<{ dataset: string; config: ReportConfig }> {
    if ("dataset" in w.source) return { dataset: w.source.dataset, config: w.source.config };
    const ctx = currentContext();
    const R = schema.savedReports;
    const [r] = await tx
      .select()
      .from(R)
      .where(and(eq(R.id, w.source.reportId), eq(R.companyId, ctx.companyId)));
    const allowed =
      r && (r.ownerId === ctx.userId || r.visibility === "shared" || r.ownerId === dashboardOwner);
    if (!allowed) throw new NotFoundException("Laporan tidak ditemukan");
    return { dataset: r.dataset, config: r.config as ReportConfig };
  }

  private async runWidget(
    tx: Db,
    w: DashboardWidget,
    from?: string,
    to?: string,
    owner?: string,
  ): Promise<WidgetResult> {
    let source: { dataset: string; config: ReportConfig };
    try {
      source = await this.resolve(tx, w, owner);
    } catch {
      return { id: w.id, hidden: true };
    }
    if (!this.datasets.canRead(source.dataset)) return { id: w.id, hidden: true };
    const withPeriod = (f?: string, t?: string): ReportConfig =>
      w.ignorePeriod || (!f && !t)
        ? source.config
        : {
            ...source.config,
            filters: { ...source.config.filters, ...(f ? { from: f } : {}), ...(t ? { to: t } : {}) },
          };
    try {
      // Savepoint agar galat satu widget (mis. data rusak) tidak membatalkan transaksi widget lain.
      const result = await tx.transaction((sp) =>
        this.reports.execute(sp, source.dataset, withPeriod(from, to)),
      );
      const out: WidgetResult = {
        id: w.id,
        dataset: source.dataset,
        columns: result.columns,
        rows: result.rows.slice(0, MAX_ROWS),
        total: result.total,
        chart: source.config.chart ?? null,
      };
      if (w.type === "kpi") {
        out.value = kpiValue(result);
        if (w.compare && !w.ignorePeriod && from && to) {
          const prev = comparisonRange(from, to, businessToday());
          const before = await tx.transaction((sp) =>
            this.reports.execute(sp, source.dataset, withPeriod(prev.from, prev.to)),
          );
          out.previous = kpiValue(before);
          out.change = changePercent(out.value, out.previous);
        }
      }
      return out;
    } catch (e) {
      return { id: w.id, dataset: source.dataset, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async assertWidgets(tx: Db, widgets: DashboardWidget[]) {
    const ids = new Set<string>();
    for (const [i, w] of widgets.entries()) {
      if (ids.has(w.id))
        throw new BadRequestException({
          message: "Validasi gagal",
          errors: [{ path: `widgets.${i}.id`, message: "Id widget ganda" }],
        });
      ids.add(w.id);
      if ("reportId" in w.source) await this.reports.find(tx, w.source.reportId);
      else if (!this.datasets.exists(w.source.dataset))
        throw new BadRequestException({
          message: "Validasi gagal",
          errors: [{ path: `widgets.${i}.source.dataset`, message: "Dataset tidak ditemukan" }],
        });
    }
  }

  /** Dokumen v2: id unik, rumus valid, dataset & laporan sumber ada. */
  private async assertDocument(tx: Db, doc: BiDocument) {
    const errors = documentErrors(doc);
    doc.pages.forEach((p, pi) =>
      p.visuals.forEach((v, vi) => {
        if (v.dataset && !this.datasets.exists(v.dataset))
          errors.push({
            path: `document.pages.${pi}.visuals.${vi}.dataset`,
            message: "Dataset tidak ditemukan",
          });
      }),
    );
    if (errors.length)
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: errors.map((e) => ({
          ...e,
          path: e.path.startsWith("document.") ? e.path : `document.${e.path}`,
        })),
      });
    for (const v of documentVisuals(doc)) if (v.reportId) await this.reports.find(tx, v.reportId);
  }

  private async pins(tx: Db) {
    const ctx = currentContext();
    const rows = await tx
      .select({ ref: PIN.ref })
      .from(PIN)
      .where(and(eq(PIN.companyId, ctx.companyId), eq(PIN.userId, ctx.userId)))
      .orderBy(asc(PIN.sequence));
    return rows.map((r) => r.ref);
  }

  private find(tx: Db, id: string, owner = false) {
    return findDashboard(tx, id, owner);
  }
}

@Module({ imports: [ReportsModule], controllers: [DashboardsController, BiController] })
export class DashboardsModule {}
