import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { and, desc, eq, or, schema, sql, type Db } from "@erp/db";
import { hasPermission, parseCsv, toCsv, type Permission } from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import { importBody, MAX_IMPORT_ROWS } from "../../common/crud.js";
import { parseXlsx, toXlsxBook, type XlsxSheet } from "../../common/csv-import.js";
import { TenantDb } from "../../common/database.js";
import { currentContext } from "../../common/request-context.js";
import { parse } from "../../common/zod.js";
import { PayrollModule } from "../../payroll/payroll.module.js";
import { HrModule } from "../hr.module.js";
import { logPersonalDataAccess, type PersonalField } from "../privacy.js";
import { Lookups, RowError, type Column, type Ctx, type Dataset, type Outcome, type Row } from "./core.js";
import { DatasetRegistry } from "./registry.js";

const P = schema.exportPresets;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const can = (p: Permission) => hasPermission(currentContext().permissions, p);

/** Batalkan transaksi impor (pratinjau atau ada baris gagal) sambil membawa hasilnya keluar. */
class Rollback {
  constructor(readonly result: ImportResult) {}
}

interface ImportResult {
  dryRun: boolean;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; column: string; message: string }[];
}

const presetSchema = z.object({
  name: z.string().trim().min(1).max(100),
  columns: z.array(z.string().min(1).max(100)).min(1).max(300),
  filters: z.record(z.string().max(200)).default({}),
  shared: z.boolean().default(false),
});

/**
 * Impor & ekspor data HR/Payroll lewat Excel/CSV: template dengan petunjuk & daftar rujukan, ekspor dengan kolom
 * pilihan user (dan profil ekspor tersimpan), impor dengan pratinjau — semua baris divalidasi, satu gagal = batal.
 */
@Controller("data-transfer")
class DataTransferController {
  constructor(
    @Inject(TenantDb) private readonly tenantDb: TenantDb,
    @Inject(DatasetRegistry) private readonly registry: DatasetRegistry,
  ) {}

  private dataset(key: string, access: "read" | "write" = "read") {
    return this.registry.get(key, access);
  }

  private ctx(tx: Db, d: Dataset, runId?: string) {
    return this.registry.ctx(tx, d, runId);
  }

  private visibleColumns(tx: Db, d: Dataset, ctx: Ctx) {
    return this.registry.visibleColumns(tx, d, ctx);
  }

  @Get()
  list() {
    return this.registry.readable().map((d) => ({
      key: d.key,
      label: d.label,
      description: d.description,
      app: d.app,
      canImport: Boolean(d.write && can(d.write)),
      canShare: can(d.admin),
      needsRun: Boolean(d.needsRun),
      filters: d.filters ?? [],
    }));
  }

  /** Kolom dataset (untuk dialog pemilih kolom). */
  @Get(":key/columns")
  columns(@Param("key") key: string, @Query("runId") runId?: string) {
    const d = this.dataset(key);
    return this.tenantDb.run(async (tx) => {
      const ctx = await this.ctx(tx, d, runId).catch((e) => {
        // Kolom slip tanpa periode tetap bisa ditampilkan (tanpa kolom komponen).
        if (d.needsRun && !runId) return null;
        throw e;
      });
      const all = await this.visibleColumns(
        tx,
        d,
        ctx ?? { companyId: currentContext().companyId, manage: false, timeZone: "UTC" },
      );
      return all.map(({ key: k, header, group, required, note, key0 }) => ({
        key: k,
        header,
        group,
        required,
        note,
        key0,
      }));
    });
  }

  @Get(":key/template")
  async template(
    @Param("key") key: string,
    @Query("format") format: string | undefined,
    @Query("runId") runId: string | undefined,
    @Res() res: Response,
  ) {
    const d = this.dataset(key, "write");
    const { columns, refs } = await this.tenantDb.run(async (tx) => {
      const ctx = d.needsRun && !runId ? null : await this.ctx(tx, d, runId);
      const cols = (
        await d.columns(
          tx,
          ctx ?? { companyId: currentContext().companyId, manage: can("hr.manage"), timeZone: "UTC" },
        )
      ).filter((c) => !c.sensitive || (ctx?.manage ?? can("hr.manage")));
      return { columns: cols, refs: await this.referenceSheet(tx) };
    });
    const example = Object.fromEntries(columns.map((c) => [c.key, c.example ?? ""]));
    if (format === "csv") return this.sendCsv(res, `template-${d.key}`, columns, [example]);
    const sheets: XlsxSheet[] = [
      { name: d.label, columns: columns.map((c) => ({ key: c.key, header: c.header })), rows: [example] },
      {
        name: "Petunjuk",
        columns: [
          { key: "header", header: "Kolom", width: 32 },
          { key: "required", header: "Wajib", width: 8 },
          { key: "example", header: "Contoh", width: 22 },
          { key: "note", header: "Keterangan", width: 70 },
        ],
        rows: [
          ...columns.map((c) => ({
            header: c.header,
            required: c.required ? "ya" : "",
            example: c.example,
            note: c.note,
          })),
          {},
          { header: "Tanggal", note: "YYYY-MM-DD atau DD/MM/YYYY; sel tanggal Excel juga diterima" },
          { header: "Ya/tidak", note: "ya/tidak, y/t, 1/0" },
          { header: "Baris contoh", note: "Hapus baris contoh sebelum mengimpor" },
          {
            header: "Pembaruan",
            note: "Untuk data yang sudah ada, sel kosong berarti tidak diubah",
          },
        ],
      },
      ...refs,
    ];
    res
      .type(XLSX)
      .attachment(`template-${d.key}.xlsx`)
      .send(await toXlsxBook(sheets));
  }

  @Get(":key/export")
  async export(
    @Param("key") key: string,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const d = this.dataset(key);
    const { columns, rows } = await this.tenantDb.run(async (tx) => {
      const ctx = await this.ctx(tx, d, query.runId);
      const visible = await this.visibleColumns(tx, d, ctx);
      const all = await d.columns(tx, ctx);
      let columns = visible;
      if (query.columns?.trim()) {
        const wanted = [
          ...new Set(
            query.columns
              .split(",")
              .map((c) => c.trim())
              .filter(Boolean),
          ),
        ];
        const hidden = wanted.filter((k) => all.some((c) => c.key === k && c.sensitive) && !ctx.manage);
        if (hidden.length) throw new ForbiddenException("Kolom data pribadi hanya untuk pemegang hak kelola");
        const unknown = wanted.filter((k) => !visible.some((c) => c.key === k));
        if (unknown.length)
          throw new BadRequestException(`Kolom ekspor tidak dikenal: ${unknown.join(", ")}`);
        const keys = visible.filter((c) => c.key0).map((c) => c.key);
        columns = [...keys, ...wanted.filter((k) => !keys.includes(k))].map((k) =>
          visible.find((c) => c.key === k)!,
        );
      }
      try {
        const rows = await d.rows(tx, ctx, query);
        // UU PDP: ekspor kolom data pribadi dicatat (satu baris log per ekspor).
        const sensitive = columns.filter((c) => c.sensitive).map((c) => c.key);
        if (sensitive.length && rows.length)
          await logPersonalDataAccess(tx, {
            fields: sensitive
              .map((k) =>
                /nik/i.test(k)
                  ? "nik"
                  : /npwp/i.test(k)
                    ? "npwp"
                    : /bank|rekening/i.test(k)
                      ? "bankAccount"
                      : /kk/i.test(k)
                        ? "kkNo"
                        : "salary",
              )
              .filter((f, i, all) => all.indexOf(f) === i) as PersonalField[],
            purpose: `Ekspor data ${d.key}`.slice(0, 200),
            count: rows.length,
          });
        return { columns, rows };
      } catch (e) {
        if (e instanceof RowError) throw new BadRequestException(e.message);
        throw e;
      }
    });
    const name = `${d.key}-${new Date().toISOString().slice(0, 10)}`;
    if (query.format === "csv") return this.sendCsv(res, name, columns, rows);
    const totals =
      columns.some((c) => c.numeric) && d.key === "payslips" ? this.totals(columns, rows) : undefined;
    res
      .type(XLSX)
      .attachment(`${name}.xlsx`)
      .send(
        await toXlsxBook([
          {
            name: d.label,
            columns: columns.map((c) => ({ key: c.key, header: c.header, numeric: c.numeric })),
            rows,
            totals,
          },
        ]),
      );
  }

  /**
   * Impor: `dryRun` = pratinjau (diproses lalu dibatalkan). Kesalahan per baris dikumpulkan (savepoint per baris);
   * bila ada satu saja, tidak ada yang disimpan.
   */
  @Post(":key/import")
  @HttpCode(200)
  async import(@Param("key") key: string, @Body() body: unknown) {
    const d = this.dataset(key, "write");
    const input = parse(
      importBody.and(z.object({ dryRun: z.boolean().default(false), runId: z.string().uuid().optional() })),
      body,
    );
    let raw: Record<string, string>[];
    try {
      raw = input.xlsx ? await parseXlsx(input.xlsx) : parseCsv(input.csv!);
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : "Berkas tidak valid");
    }
    if (raw.length === 0) throw new BadRequestException("Berkas impor kosong");
    if (raw.length > MAX_IMPORT_ROWS)
      throw new BadRequestException(`Maksimal ${MAX_IMPORT_ROWS} baris per impor`);

    const result: ImportResult = { dryRun: input.dryRun, created: 0, updated: 0, skipped: 0, errors: [] };
    try {
      await this.tenantDb.run(async (tx) => {
        const ctx = await this.ctx(tx, d, input.runId);
        const columns = await d.columns(tx, ctx);
        const rows = raw.map((r) => normalize(r, columns));
        const headerOf = (k: string) => columns.find((c) => c.key === k)?.header ?? k;
        const fail = (line: number, column: string, message: string) =>
          result.errors.push({ row: line, column: headerOf(column), message });
        const lookups = new Lookups(tx, ctx.companyId);
        try {
          if (d.importAll) {
            const counts = await d.importAll(
              tx,
              rows.map((row, i) => ({ line: i + 2, row })),
              ctx,
              lookups,
              fail,
            );
            Object.assign(result, counts);
          } else {
            for (const [i, row] of rows.entries()) {
              try {
                const outcome: Outcome = await tx.transaction((sp) =>
                  d.importRow!(sp as unknown as Db, row, ctx, lookups),
                );
                result[outcome]++;
              } catch (e) {
                if (e instanceof RowError) fail(i + 2, e.column, e.message);
                else if (
                  e instanceof BadRequestException ||
                  e instanceof NotFoundException ||
                  e instanceof ForbiddenException
                )
                  fail(i + 2, "", String((e.getResponse() as { message?: string }).message ?? e.message));
                else throw e;
              }
            }
          }
        } catch (e) {
          if (e instanceof RowError) {
            fail(0, e.column, e.message);
          } else throw e;
        }
        if (result.errors.length || input.dryRun) throw new Rollback(result);
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
    if (result.errors.length && !input.dryRun)
      throw new BadRequestException({
        message: "Impor dibatalkan: ada baris tidak valid",
        errors: result.errors.map((err) => ({ row: err.row, path: err.column, message: err.message })),
      });
    return result;
  }

  // ---- Profil ekspor ----

  @Get(":key/presets")
  presets(@Param("key") key: string) {
    this.dataset(key);
    const ctx = currentContext();
    return this.tenantDb.run((tx) =>
      tx
        .select({
          id: P.id,
          name: P.name,
          columns: P.columns,
          filters: P.filters,
          shared: P.shared,
          mine: sql<boolean>`${P.userId} = ${ctx.userId}`,
        })
        .from(P)
        .where(
          and(
            eq(P.companyId, ctx.companyId),
            eq(P.dataset, key),
            or(eq(P.userId, ctx.userId), eq(P.shared, true)),
          ),
        )
        .orderBy(desc(P.shared), P.name),
    );
  }

  @Post(":key/presets")
  createPreset(@Param("key") key: string, @Body() body: unknown) {
    const d = this.dataset(key);
    const input = parse(presetSchema, body);
    if (input.shared && !can(d.admin)) throw new ForbiddenException(`Butuh permission ${d.admin}`);
    const ctx = currentContext();
    return this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .insert(P)
        .values({ ...input, companyId: ctx.companyId, userId: ctx.userId, dataset: key })
        .returning();
      return row!;
    });
  }

  @Delete(":key/presets/:id")
  @HttpCode(204)
  async deletePreset(@Param("key") key: string, @Param("id", ParseUUIDPipe) id: string) {
    const d = this.dataset(key);
    const ctx = currentContext();
    await this.tenantDb.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(P)
        .where(and(eq(P.id, id), eq(P.companyId, ctx.companyId), eq(P.dataset, key)));
      if (!row) throw new NotFoundException("Profil ekspor tidak ditemukan");
      if (row.userId !== ctx.userId && !(row.shared && can(d.admin)))
        throw new ForbiddenException("Hanya pembuat profil yang bisa menghapusnya");
      await tx.delete(P).where(eq(P.id, id));
    });
  }

  // ---- Bantuan ----

  private sendCsv(res: Response, name: string, columns: Column[], rows: Record<string, unknown>[]) {
    const headers = columns.map((c) => c.header);
    const out = rows.map((r) => Object.fromEntries(columns.map((c) => [c.header, r[c.key]])));
    res
      .type("text/csv; charset=utf-8")
      .attachment(`${name}.csv`)
      .send("﻿" + toCsv(headers, out));
  }

  private totals(columns: Column[], rows: Record<string, unknown>[]) {
    const out: Record<string, unknown> = { [columns[0]!.key]: "TOTAL" };
    for (const c of columns.filter((x) => x.numeric && x.key !== "workingDays" && x.key !== "unpaidDays"))
      out[c.key] = rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0).toFixed(2);
    return out;
  }

  /** Lembar daftar rujukan template: nama yang bisa dipakai di kolom rujukan. */
  private async referenceSheet(tx: Db): Promise<XlsxSheet[]> {
    const l = new Lookups(tx, currentContext().companyId);
    const lists: [string, Awaited<ReturnType<Lookups["list"]>>][] = [
      ["Departemen", await l.list("departments")],
      ["Jabatan", await l.list("jobs")],
      ["Golongan", await l.list("grades")],
      ["Cabang", await l.list("branches")],
      ["Jadwal Kerja", await l.list("schedules")],
      ["Jenis Cuti", await l.list("leaveTypes")],
      ["Komponen Gaji", await l.list("components")],
    ];
    const height = Math.max(0, ...lists.map(([, r]) => r.length));
    const rows = Array.from({ length: height }, (_, i) =>
      Object.fromEntries(
        lists.map(([name, r]) => [
          name,
          r[i] ? (r[i]!.code ? `${r[i]!.code} — ${r[i]!.name}` : r[i]!.name) : "",
        ]),
      ),
    );
    return [{ name: "Daftar Rujukan", columns: lists.map(([name]) => ({ key: name, width: 28 })), rows }];
  }
}

/** Judul kolom berkas (header Indonesia atau key) → key kolom dataset; kolom lain dipertahankan apa adanya. */
function normalize(row: Record<string, string>, columns: Column[]): Row {
  const out: Row = {};
  for (const [header, value] of Object.entries(row)) {
    const h = header.trim().toLowerCase();
    const col = columns.find((c) => c.header.toLowerCase() === h || c.key.toLowerCase() === h);
    // Kolom komponen gaji juga dikenali dari kodenya saja (mis. "TJAB").
    const comp = col
      ? undefined
      : columns.find((c) => c.key.startsWith("c_") && c.key.slice(2).toLowerCase() === h);
    out[(col ?? comp)?.key ?? header] = value ?? "";
  }
  return out;
}

@Module({
  imports: [HrModule, PayrollModule],
  controllers: [DataTransferController],
  providers: [DatasetRegistry],
  exports: [DatasetRegistry],
})
export class DataTransferModule {}
