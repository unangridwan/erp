import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
} from "@nestjs/common";
import { and, eq, schema, type Db } from "@erp/db";
import {
  biDrillSchema,
  biQuerySchema,
  builtinDocument,
  businessToday,
  comparisonRange,
  drillVisual,
  reportConfigSchema,
  reportResultToVisual,
  runVisual,
  shiftTimeKey,
  SINGLE_VALUE_VISUALS,
  type BiDocument,
  type BiFilter,
  type BiQueryInput,
  type BiResult,
  type BiVisual,
} from "@erp/shared";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";
import { parse } from "../common/zod.js";
import { dashboardDocument, findDashboard } from "./dashboard-store.js";
import { ReportDatasets } from "./report-datasets.js";
import { ReportsService } from "./reports.module.js";

type Loaded = Awaited<ReturnType<ReportsService["load"]>>;
interface Period {
  from?: string;
  to?: string;
}

/** Kolom yang dirujuk visual (untuk cek kolom data pribadi). */
function referencedColumns(v: BiVisual) {
  return [
    ...v.axis.map((f) => f.column),
    ...(v.legend ? [v.legend.column] : []),
    ...v.values.map((m) => m.column ?? "").filter((c) => c && c !== "*"),
    ...v.columns,
    ...v.filters.map((f) => f.column),
  ];
}

/** Rentang yang sama tahun lalu; periode berjalan dipotong s.d. hari ini agar sebanding (YTD vs YTD). */
function lastYearRange(from: string, to: string): Period {
  const today = businessToday();
  const end = to > today && from <= today ? today : to;
  return { from: shiftTimeKey(from, -1), to: shiftTimeKey(end, -1) };
}

/**
 * Mesin BI (dashboard v2): jalankan banyak visual sekaligus dengan filter dashboard/halaman/silang/slicer, drill, dan
 * pembanding waktu. Tiap dataset dimuat sekali per permintaan; hak baca dicek per visual.
 */
@Controller()
export class BiController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(ReportsService) private readonly reports: ReportsService,
    @Inject(ReportDatasets) private readonly datasets: ReportDatasets,
  ) {}

  @Post("bi/query")
  @HttpCode(200)
  query(@Body() body: unknown) {
    const input = parse(biQuerySchema, body);
    return this.tenantDb.run(async (tx) => {
      let visuals: BiVisual[];
      let docFilters: BiFilter[] = [];
      let owner: string | undefined;
      if (input.visuals) visuals = input.visuals;
      else {
        let doc: BiDocument | null;
        if (input.builtin) doc = builtinDocument(input.builtin);
        else {
          const d = await findDashboard(tx, input.dashboardId!);
          doc = dashboardDocument(d);
          owner = d.ownerId;
        }
        if (!doc) throw new NotFoundException("Dashboard tidak ditemukan");
        const page = input.pageId ? doc.pages.find((p) => p.id === input.pageId) : doc.pages[0];
        if (!page) throw new NotFoundException("Halaman dashboard tidak ditemukan");
        visuals = page.visuals;
        docFilters = [...doc.filters, ...page.filters];
      }
      const cache = new Map<string, Promise<Loaded>>();
      const results: BiResult[] = [];
      for (const v of visuals)
        results.push(await this.runOne(tx, v, input, [...docFilters, ...input.filters], cache, owner));
      return { from: input.from ?? null, to: input.to ?? null, visuals: results };
    });
  }

  /** Lihat data: baris penyusun titik/kelompok visual (filter visual, konteks, periode, nilai yang diklik). */
  @Post("bi/drill")
  @HttpCode(200)
  drill(@Body() body: unknown) {
    const input = parse(biDrillSchema, body);
    const v = input.visual;
    return this.tenantDb.run(async (tx) => {
      if (!v.dataset || !this.datasets.canRead(v.dataset))
        throw new NotFoundException("Dataset tidak ditemukan");
      const params = {
        ...v.params,
        ...(!v.ignorePeriod && input.from ? { from: input.from } : {}),
        ...(!v.ignorePeriod && input.to ? { to: input.to } : {}),
      };
      const referenced = [...referencedColumns(v), ...input.match.map((m) => m.column)];
      const loaded = await this.reports.load(tx, v.dataset, params, referenced);
      try {
        return {
          ...drillVisual(
            loaded.rows,
            loaded.columns,
            v,
            { filters: input.filters.filter((f) => f.source !== v.id) },
            input.match,
          ),
          title: loaded.title,
        };
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : String(e));
      }
    });
  }

  private load(
    tx: Db,
    cache: Map<string, Promise<Loaded>>,
    dataset: string,
    params: Record<string, string>,
  ): Promise<Loaded> {
    const key = JSON.stringify([dataset, Object.entries(params).sort()]);
    let p = cache.get(key);
    if (!p) {
      p = this.reports.load(tx, dataset, params, []);
      // Galat muat (mis. filter dataset tidak valid) dilaporkan per visual; jangan simpan di cache sebagai penolakan.
      p.catch(() => cache.delete(key));
      cache.set(key, p);
    }
    return p;
  }

  private async runOne(
    tx: Db,
    v: BiVisual,
    input: BiQueryInput,
    filters: BiFilter[],
    cache: Map<string, Promise<Loaded>>,
    owner?: string,
  ): Promise<BiResult> {
    const fail = (error: string): BiResult => ({
      id: v.id,
      type: v.type,
      error,
      fields: [],
      rows: [],
      categories: [],
      series: [],
      totals: {},
      rowCount: 0,
    });
    if (v.type === "text") return { ...fail(""), error: undefined };
    const period: Period = v.ignorePeriod ? {} : { from: input.from, to: input.to };
    const withPeriod = (params: Record<string, string>, p: Period) => ({
      ...params,
      ...(p.from ? { from: p.from } : {}),
      ...(p.to ? { to: p.to } : {}),
    });
    try {
      if (v.reportId) return await this.runReportVisual(tx, v, period, owner, withPeriod);
      if (!this.datasets.canRead(v.dataset)) return { ...fail(""), error: undefined, hidden: true };
      const loaded = await this.load(tx, cache, v.dataset, withPeriod(v.params, period));
      if (referencedColumns(v).some((k) => loaded.restricted.includes(k)))
        return fail("Kolom data pribadi hanya untuk pemegang hak kelola");

      // Pembanding waktu hanya bila dashboard memakai periode.
      const showAs = new Set(v.values.map((m) => m.showAs));
      const single = SINGLE_VALUE_VISUALS.includes(v.type);
      const compare = v.options.compare ?? (v.type === "kpi" ? "prev_period" : "none");
      const hasPeriod = !!(period.from && period.to);
      const needLastYear =
        hasPeriod && (showAs.has("yoy") || showAs.has("last_year") || (single && compare === "last_year"));
      const needPrevious =
        hasPeriod && (showAs.has("vs_prev_period") || (single && compare === "prev_period"));
      const lastYear = needLastYear
        ? (
            await this.load(
              tx,
              cache,
              v.dataset,
              withPeriod(v.params, lastYearRange(period.from!, period.to!)),
            )
          ).rows
        : undefined;
      const previousPeriod = needPrevious
        ? (
            await this.load(
              tx,
              cache,
              v.dataset,
              withPeriod(v.params, comparisonRange(period.from!, period.to!, businessToday())),
            )
          ).rows
        : undefined;
      return runVisual(loaded.rows, loaded.columns, v, {
        filters,
        drill: input.drill[v.id],
        lastYear,
        previousPeriod,
      });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Visual dari laporan tersimpan: laporan milik user, dibagikan, atau milik pemilik dashboard (dashboard bersama
   * memakai laporan pribadi pemiliknya); hak baca dataset tetap dicek untuk user aktif.
   */
  private async runReportVisual(
    tx: Db,
    v: BiVisual,
    period: Period,
    owner: string | undefined,
    withPeriod: (params: Record<string, string>, p: Period) => Record<string, string>,
  ): Promise<BiResult> {
    const ctx = currentContext();
    const R = schema.savedReports;
    const [r] = await tx
      .select()
      .from(R)
      .where(and(eq(R.id, v.reportId!), eq(R.companyId, ctx.companyId)));
    const allowed = r && (r.ownerId === ctx.userId || r.visibility === "shared" || r.ownerId === owner);
    if (!allowed || !this.datasets.canRead(r.dataset))
      return {
        id: v.id,
        type: v.type,
        hidden: true,
        fields: [],
        rows: [],
        categories: [],
        series: [],
        totals: {},
        rowCount: 0,
      };
    const config = reportConfigSchema.parse(r.config);
    const run = { ...config, filters: withPeriod(config.filters, period) };
    const result = await this.reports.execute(tx, r.dataset, run);
    return reportResultToVisual(v, result, config.chart);
  }
}
