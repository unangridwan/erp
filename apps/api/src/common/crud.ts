import {
  BadRequestException,
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
  Query,
  Res,
  type Type,
} from "@nestjs/common";
import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type Db,
  type PgColumn,
  type PgTable,
  type SQL,
} from "@erp/db";
import { ALL_PERMISSIONS, parseCsv, toCsv, type Permission } from "@erp/shared";
import type { Response } from "express";
import { z } from "zod";
import type { AnyZodObject } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "./database.js";
import { currentContext } from "./request-context.js";
import { coerceCsvRow, exportColumns, parseXlsx, toXlsx } from "./csv-import.js";
import { parse } from "./zod.js";

type Table = PgTable & { id: PgColumn };

export interface CrudOptions<T extends Table> {
  /** Path URL, mis. "partners". */
  path: string;
  /** Nama model untuk log aktivitas, mis. "partner". */
  model: string;
  table: T;
  schema: AnyZodObject;
  read: Permission;
  write: Permission;
  /** Kolom yang dicari oleh parameter `q`. */
  searchColumns: PgColumn[];
  orderBy: PgColumn;
  /** Kolom company_id opsional: baris null = milik bersama grup; selain itu dibatasi perusahaan yang boleh diakses. */
  companyColumn?: PgColumn;
  /**
   * Data milik satu perusahaan (mis. bagan akun): list hanya menampilkan perusahaan aktif, dan
   * `companyId` diisi otomatis dengan perusahaan aktif saat membuat data.
   */
  perCompany?: boolean;
  /**
   * Field yang merujuk tabel lain. Pemeriksaan FK Postgres mengabaikan RLS, jadi setiap id rujukan
   * dicek terlihat oleh tenant pemanggil sebelum disimpan.
   */
  refs?: Record<string, Table>;
  /** Validasi tambahan sebelum simpan. */
  beforeSave?: (tx: Db, values: Record<string, unknown>, id?: string) => Promise<void>;
  /** Dipanggil sebelum menghapus (mis. menolak penghapusan data yang sudah dipakai). */
  beforeDelete?: (tx: Db, row: Record<string, unknown>) => Promise<void>;
  /** Dipanggil setelah baris baru dibuat, dalam transaksi yang sama. */
  afterCreate?: (tx: Db, row: Record<string, unknown> & { id: string }) => Promise<void>;
}

/** Pastikan setiap id rujukan ada dan terlihat (RLS) oleh tenant saat ini. */
export async function assertRefsVisible(
  tx: Db,
  refs: Record<string, Table>,
  values: Record<string, unknown>,
) {
  for (const [field, refTable] of Object.entries(refs)) {
    const id = values[field];
    if (typeof id !== "string") continue;
    const [found] = await tx.select({ id: refTable.id }).from(refTable).where(eq(refTable.id, id));
    if (!found)
      throw new BadRequestException({
        message: "Validasi gagal",
        errors: [{ path: field, message: "Data rujukan tidak ditemukan" }],
      });
  }
}

const MAX_LIMIT = 200;
const MAX_IMPORT_ROWS = 5000;
const EXPORT_LIMIT = 50_000;
/** Isi CSV, atau berkas .xlsx dalam base64. */
const importBody = z
  .object({
    csv: z.string().min(1).max(10_000_000).optional(),
    xlsx: z.string().min(1).max(14_000_000).optional(),
  })
  .refine((b) => !!b.csv !== !!b.xlsx, "Kirim salah satu: csv atau xlsx");

/**
 * Membuat controller REST standar (list/get/create/update/delete) untuk sebuah tabel master,
 * lengkap dengan RLS tenant, pembatasan perusahaan, permission, dan log aktivitas.
 */
export function createCrudController<T extends Table>(opts: CrudOptions<T>): Type<unknown> {
  const table = opts.table as unknown as Table & Record<string, PgColumn>;
  const hasActive = "active" in table;
  const hasUpdatedAt = "updatedAt" in table;

  const companyFilter = (): SQL | undefined => {
    const ctx = currentContext();
    if (opts.companyColumn && opts.perCompany) return eq(opts.companyColumn, ctx.companyId);
    if (!opts.companyColumn || ctx.permissions.includes(ALL_PERMISSIONS)) return undefined;
    return or(isNull(opts.companyColumn), inArray(opts.companyColumn, ctx.companyIds));
  };

  const assertCompanyAllowed = (values: Record<string, unknown>) => {
    const companyId = values.companyId;
    if (typeof companyId === "string" && !currentContext().companyIds.includes(companyId)) {
      throw new NotFoundException("Perusahaan tidak ditemukan");
    }
  };

  const listFilter = (query: Record<string, string | undefined>): SQL | undefined => {
    const filters: (SQL | undefined)[] = [companyFilter()];
    if (query.q && opts.searchColumns.length) {
      const term = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      filters.push(or(...opts.searchColumns.map((c) => ilike(c, term))));
    }
    if (hasActive && query.active !== "all") filters.push(eq(table.active!, query.active !== "false"));
    return and(...filters);
  };

  @Controller(opts.path)
  class CrudController {
    constructor(
      @Inject(TenantDb) readonly tenantDb: TenantDb,
      @Inject(ActivityService) readonly activity: ActivityService,
    ) {}

    @Get()
    @RequirePermission(opts.read)
    list(@Query() query: Record<string, string | undefined>) {
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), MAX_LIMIT);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const where = listFilter(query);

      return this.tenantDb.run(async (tx) => {
        const items = await tx
          .select()
          .from(table)
          .where(where)
          .orderBy(asc(opts.orderBy))
          .limit(limit)
          .offset(offset);
        const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(table).where(where);
        return { items, total, limit, offset };
      });
    }

    /** Ekspor CSV dengan filter yang sama seperti list. Didaftarkan sebelum `:id` agar tidak tertangkap rute itu. */
    @Get("export")
    @RequirePermission(opts.read)
    async export(@Query() query: Record<string, string | undefined>, @Res() res: Response) {
      const rows = await this.tenantDb.run((tx) =>
        tx.select().from(table).where(listFilter(query)).orderBy(asc(opts.orderBy)).limit(EXPORT_LIMIT),
      );
      if (query.format === "xlsx")
        return res
          .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
          .attachment(`${opts.path}.xlsx`)
          .send(await toXlsx(opts.path, exportColumns(opts.schema), rows as Record<string, unknown>[]));
      res
        .type("text/csv; charset=utf-8")
        .attachment(`${opts.path}.csv`)
        .send("\uFEFF" + toCsv(exportColumns(opts.schema), rows as Record<string, unknown>[]));
    }

    /**
     * Impor CSV: baris dengan `id` memperbarui data yang ada, tanpa `id` membuat baru.
     * Semua baris divalidasi dulu; bila ada yang gagal, tidak ada yang disimpan.
     */
    @Post("import")
    @HttpCode(200)
    @RequirePermission(opts.write)
    async import(@Body() body: unknown) {
      const input = parse(importBody, body);
      let rows: Record<string, string>[];
      try {
        rows = input.xlsx ? await parseXlsx(input.xlsx) : parseCsv(input.csv!);
      } catch (e) {
        throw new BadRequestException(e instanceof Error ? e.message : "Berkas tidak valid");
      }
      if (rows.length === 0) throw new BadRequestException("Berkas impor kosong");
      if (rows.length > MAX_IMPORT_ROWS)
        throw new BadRequestException(`Maksimal ${MAX_IMPORT_ROWS} baris per impor`);

      const errors: { row: number; path: string; message: string }[] = [];
      const parsed = rows.map((raw, i) => {
        const id = raw.id?.trim() || undefined;
        const schema = id ? opts.schema.partial() : opts.schema;
        const result = schema.safeParse(coerceCsvRow(opts.schema, raw));
        if (!result.success) {
          for (const issue of result.error.issues) {
            errors.push({ row: i + 2, path: issue.path.join("."), message: issue.message });
          }
        }
        return { id, values: result.success ? (result.data as Record<string, unknown>) : {} };
      });
      if (errors.length)
        throw new BadRequestException({ message: "Impor dibatalkan: ada baris tidak valid", errors });

      return this.tenantDb.run(async (tx) => {
        let created = 0;
        let updated = 0;
        for (const [i, { id, values }] of parsed.entries()) {
          try {
            if (opts.perCompany && !id) values.companyId ??= currentContext().companyId;
            assertCompanyAllowed(values);
            await assertRefsVisible(tx, opts.refs ?? {}, values);
            if (id) {
              const before = await this.find(tx, id);
              if (opts.perCompany) delete values.companyId;
              await opts.beforeSave?.(tx, { companyId: before.companyId, ...values }, id);
              await tx
                .update(table)
                .set({ ...values, ...(hasUpdatedAt ? { updatedAt: sql`now()` } : {}) })
                .where(eq(table.id, id));
              await this.activity.log(tx, {
                resModel: opts.model,
                resId: id,
                action: "update",
                message: input.xlsx ? "Impor Excel" : "Impor CSV",
              });
              updated++;
            } else {
              await opts.beforeSave?.(tx, values);
              const [row] = await tx.insert(table).values(values).returning();
              const createdRow = row as Record<string, unknown> & { id: string };
              await opts.afterCreate?.(tx, createdRow);
              await this.activity.log(tx, {
                resModel: opts.model,
                resId: createdRow.id,
                action: "create",
                message: input.xlsx ? "Impor Excel" : "Impor CSV",
              });
              created++;
            }
          } catch (e) {
            // Sertakan nomor baris agar user tahu baris mana yang gagal; transaksi otomatis di-rollback.
            if (e instanceof BadRequestException || e instanceof NotFoundException) {
              const response = e.getResponse() as {
                message?: string;
                errors?: { path: string; message: string }[];
              };
              throw new BadRequestException({
                message: `Impor dibatalkan pada baris ${i + 2}`,
                errors: (response.errors ?? [{ path: "", message: response.message ?? e.message }]).map(
                  (err) => ({
                    row: i + 2,
                    ...err,
                  }),
                ),
              });
            }
            throw e;
          }
        }
        return { created, updated };
      });
    }

    @Get(":id")
    @RequirePermission(opts.read)
    get(@Param("id", ParseUUIDPipe) id: string) {
      return this.tenantDb.run((tx) => this.find(tx, id));
    }

    @Post()
    @RequirePermission(opts.write)
    create(@Body() body: unknown) {
      const values = parse(opts.schema, body);
      if (opts.perCompany) values.companyId ??= currentContext().companyId;
      assertCompanyAllowed(values);
      return this.tenantDb.run(async (tx) => {
        await assertRefsVisible(tx, opts.refs ?? {}, values);
        await opts.beforeSave?.(tx, values);
        const [row] = await tx.insert(table).values(values).returning();
        const created = row as Record<string, unknown> & { id: string };
        await opts.afterCreate?.(tx, created);
        await this.activity.log(tx, { resModel: opts.model, resId: created.id, action: "create" });
        return created;
      });
    }

    @Patch(":id")
    @RequirePermission(opts.write)
    update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
      const values = parse(opts.schema.partial().strip(), body);
      // Field yang tidak dikirim tidak diubah (default zod tidak boleh menimpa nilai lama).
      // Data per-perusahaan tidak boleh dipindah ke perusahaan lain.
      const sent = Object.fromEntries(
        Object.entries(values).filter(
          ([k]) =>
            body !== null && typeof body === "object" && k in body && !(opts.perCompany && k === "companyId"),
        ),
      );
      assertCompanyAllowed(sent);
      return this.tenantDb.run(async (tx) => {
        const before = await this.find(tx, id);
        await assertRefsVisible(tx, opts.refs ?? {}, sent);
        await opts.beforeSave?.(tx, { companyId: before.companyId, ...sent }, id);
        if (Object.keys(sent).length === 0) return before;
        const [row] = await tx
          .update(table)
          .set({ ...sent, ...(hasUpdatedAt ? { updatedAt: sql`now()` } : {}) })
          .where(eq(table.id, id))
          .returning();
        const changes = Object.fromEntries(
          Object.entries(sent)
            .filter(([k, v]) => before[k] !== v)
            .map(([k, v]) => [k, { from: before[k], to: v }]),
        );
        await this.activity.log(tx, { resModel: opts.model, resId: id, action: "update", changes });
        return row;
      });
    }

    @Delete(":id")
    @HttpCode(204)
    @RequirePermission(opts.write)
    remove(@Param("id", ParseUUIDPipe) id: string) {
      return this.tenantDb.run(async (tx) => {
        const row = await this.find(tx, id);
        await opts.beforeDelete?.(tx, row);
        await tx.delete(table).where(eq(table.id, id));
        await this.activity.log(tx, { resModel: opts.model, resId: id, action: "delete" });
      });
    }

    async find(tx: Db, id: string): Promise<Record<string, unknown>> {
      const [row] = await tx
        .select()
        .from(table)
        .where(and(eq(table.id, id), companyFilter()));
      if (!row) throw new NotFoundException("Data tidak ditemukan");
      return row as Record<string, unknown>;
    }
  }

  Object.defineProperty(CrudController, "name", { value: `${opts.model}CrudController` });
  return CrudController;
}
