import { Controller, Get, Inject, Query } from "@nestjs/common";
import { and, asc, eq, ilike, schema, type SQL } from "@erp/db";
import { z } from "zod";
import { TenantDb } from "../common/database.js";
import { parse } from "../common/zod.js";

const regionQuery = z.object({
  level: z.coerce.number().int().min(1).max(4).optional(),
  parent: z
    .string()
    .regex(/^[\d.]+$/)
    .optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

/** Wilayah Indonesia: provinsi (level 1) → kab/kota (2) → kecamatan (3) → desa/kelurahan (4). */
@Controller("regions")
export class RegionsController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  list(@Query() query: unknown) {
    const input = parse(regionQuery, query);
    const filters: SQL[] = [];
    if (input.level) filters.push(eq(schema.regions.level, input.level));
    if (input.parent) filters.push(eq(schema.regions.parentCode, input.parent));
    if (input.q) filters.push(ilike(schema.regions.name, `%${input.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`));
    return this.tenantDb.run((tx) =>
      tx
        .select()
        .from(schema.regions)
        .where(and(...filters))
        .orderBy(asc(schema.regions.code))
        .limit(input.limit),
    );
  }
}
