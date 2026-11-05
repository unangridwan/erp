import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from "@nestjs/common";
import { and, asc, eq, schema, sql, type Db } from "@erp/db";
import {
  contractPeriodErrors,
  contractTypeSchema,
  DEFAULT_CONTRACT_TYPES,
  type ContractTypeRule,
} from "@erp/shared";
import { fieldError } from "../accounting/context.js";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { parse } from "../common/zod.js";

const T = schema.contractTypes;

/** Jenis kontrak tenant; jenis bawaan dibuat bila belum ada (tenant baru). */
export async function contractTypes(tx: Db) {
  const rows = await tx.select().from(T).orderBy(asc(T.sequence), asc(T.name));
  if (rows.length) return rows;
  await tx
    .insert(T)
    .values(DEFAULT_CONTRACT_TYPES)
    .onConflictDoNothing({ target: [T.tenantId, T.code] });
  return tx.select().from(T).orderBy(asc(T.sequence), asc(T.name));
}

/**
 * Pastikan jenis kontrak dikenal & aktif, lalu periksa aturannya (tanggal berakhir wajib untuk waktu tertentu, batas
 * masa kontrak). `endField` = nama field tanggal berakhir pada input (dateEnd / contractEnd). Jenis nonaktif tetap
 * diterima bila dokumen sudah memakainya (`allowInactive`).
 */
export async function assertContractType(
  tx: Db,
  code: string,
  period?: { dateStart: string; dateEnd?: string | null; endField?: string; field?: string },
  allowInactive?: string | null,
): Promise<ContractTypeRule> {
  const field = period?.field ?? "contractType";
  const rows = await contractTypes(tx);
  const type = rows.find((t) => t.code === code);
  if (!type) throw fieldError(field, `Jenis kontrak "${code}" tidak dikenal`);
  if (!type.active && allowInactive !== code)
    throw fieldError(field, `Jenis kontrak ${type.name} sudah nonaktif`);
  if (period) {
    const error = contractPeriodErrors(type, period.dateStart, period.dateEnd);
    if (error) throw fieldError(period.endField ?? "dateEnd", error);
  }
  return type;
}

/** Nama & judul dokumen jenis kontrak (untuk dokumen & label). */
export async function contractTypeOf(tx: Db, code: string) {
  return (await contractTypes(tx)).find((t) => t.code === code) ?? null;
}

/** Kode jenis kontrak berjangka waktu (wajib tanggal berakhir). */
export async function fixedTermCodes(tx: Db) {
  return (await contractTypes(tx)).filter((t) => t.fixedTerm).map((t) => t.code);
}

const USAGE = sql`(select count(*) from contracts c where c.contract_type = ${T.code})::int
  + (select count(*) from contract_templates c where c.contract_type = ${T.code})::int
  + (select count(*) from hiring_requests c where c.contract_type = ${T.code})::int
  + (select count(*) from job_offers c where c.contract_type = ${T.code})::int`;

/** SDM › Konfigurasi › Jenis Kontrak: master jenis perjanjian kerja (lihat `hr.read`, ubah `hr.manage`). */
@Controller("contract-types")
class ContractTypesController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("hr.read")
  list() {
    return this.tenantDb.run(async (tx) => {
      await contractTypes(tx);
      const rows = await tx
        .select({ type: T, usage: sql<number>`${USAGE}` })
        .from(T)
        .orderBy(asc(T.sequence), asc(T.name));
      return rows.map((r) => ({ ...r.type, usage: r.usage }));
    });
  }

  @Get(":id")
  @RequirePermission("hr.read")
  get(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run((tx) => this.find(tx, id));
  }

  @Post()
  @RequirePermission("hr.manage")
  create(@Body() body: unknown) {
    const input = parse(contractTypeSchema, body);
    return this.tenantDb.run(async (tx) => {
      await contractTypes(tx);
      const [dup] = await tx.select({ id: T.id }).from(T).where(eq(T.code, input.code));
      if (dup) throw fieldError("code", `Kode ${input.code} sudah dipakai`);
      const [row] = await tx.insert(T).values(input).returning();
      return row!;
    });
  }

  @Put(":id")
  @RequirePermission("hr.manage")
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(contractTypeSchema, body);
    return this.tenantDb.run(async (tx) => {
      const before = await this.find(tx, id);
      // Kode tersimpan di dokumen (kontrak, template, FPK, penawaran): tidak bisa diganti.
      if (input.code !== before.code) throw fieldError("code", "Kode jenis kontrak tidak bisa diubah");
      if (before.isSystem && !input.active)
        throw fieldError("active", "Jenis kontrak bawaan (PKWT/PKWTT) tidak bisa dinonaktifkan");
      const [row] = await tx
        .update(T)
        .set({
          ...input,
          description: input.description ?? null,
          legalBasis: input.legalBasis ?? null,
          maxMonths: input.maxMonths ?? null,
          documentTitle: input.documentTitle ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(T.id, id))
        .returning();
      return row!;
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @RequirePermission("hr.manage")
  remove(@Param("id", ParseUUIDPipe) id: string) {
    return this.tenantDb.run(async (tx) => {
      const before = await this.find(tx, id);
      if (before.isSystem)
        throw new BadRequestException("Jenis kontrak bawaan (PKWT/PKWTT) tidak bisa dihapus");
      const [{ usage }] = (await tx
        .select({ usage: sql<number>`${USAGE}` })
        .from(T)
        .where(and(eq(T.id, id)))) as [{ usage: number }];
      if (usage > 0)
        throw new BadRequestException(
          `Jenis kontrak ${before.name} sudah dipakai ${usage} dokumen; nonaktifkan saja agar tidak dipilih lagi`,
        );
      await tx.delete(T).where(eq(T.id, id));
    });
  }

  private async find(tx: Db, id: string) {
    const [row] = await tx.select().from(T).where(eq(T.id, id));
    if (!row) throw new NotFoundException("Jenis kontrak tidak ditemukan");
    return row;
  }
}

@Module({ controllers: [ContractTypesController] })
export class ContractTypesModule {}
