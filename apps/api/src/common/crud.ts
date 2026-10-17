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
import { ALL_PERMISSIONS, type Permission } from "@erp/shared";
import type { AnyZodObject } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "./database.js";
import { currentContext } from "./request-context.js";
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
   * Field yang merujuk tabel lain. Pemeriksaan FK Postgres mengabaikan RLS, jadi setiap id rujukan
   * dicek terlihat oleh tenant pemanggil sebelum disimpan.
   */
  refs?: Record<string, Table>;
  /** Validasi tambahan sebelum simpan. */
  beforeSave?: (tx: Db, values: Record<string, unknown>, id?: string) => Promise<void>;
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
    if (!opts.companyColumn || ctx.permissions.includes(ALL_PERMISSIONS)) return undefined;
    return or(isNull(opts.companyColumn), inArray(opts.companyColumn, ctx.companyIds));
  };

  const assertCompanyAllowed = (values: Record<string, unknown>) => {
    const companyId = values.companyId;
    if (typeof companyId === "string" && !currentContext().companyIds.includes(companyId)) {
      throw new NotFoundException("Perusahaan tidak ditemukan");
    }
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
      const filters: (SQL | undefined)[] = [companyFilter()];
      if (query.q) {
        const term = `%${query.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        filters.push(or(...opts.searchColumns.map((c) => ilike(c, term))));
      }
      if (hasActive && query.active !== "all") filters.push(eq(table.active!, query.active !== "false"));
      const where = and(...filters);

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

    @Get(":id")
    @RequirePermission(opts.read)
    get(@Param("id", ParseUUIDPipe) id: string) {
      return this.tenantDb.run((tx) => this.find(tx, id));
    }

    @Post()
    @RequirePermission(opts.write)
    create(@Body() body: unknown) {
      const values = parse(opts.schema, body);
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
      const sent = Object.fromEntries(
        Object.entries(values).filter(([k]) => body !== null && typeof body === "object" && k in body),
      );
      assertCompanyAllowed(sent);
      return this.tenantDb.run(async (tx) => {
        const before = await this.find(tx, id);
        await assertRefsVisible(tx, opts.refs ?? {}, sent);
        await opts.beforeSave?.(tx, sent, id);
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
        await this.find(tx, id);
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
