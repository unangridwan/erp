import { Controller, Get, Inject, Injectable } from "@nestjs/common";
import { and, eq, schema, sql, type Db } from "@erp/db";
import { RequirePermission } from "../auth/decorators.js";
import { TenantDb } from "../common/database.js";
import { currentContext } from "../common/request-context.js";

/** Prefix bawaan per jenis dokumen; tahun disisipkan otomatis bila reset tahunan. */
const DEFAULT_PREFIX: Record<string, string> = {
  "sale.order": "SO",
  "purchase.order": "PO",
  "account.invoice": "INV",
  "account.bill": "BILL",
  "stock.receipt": "WH/IN",
  "stock.delivery": "WH/OUT",
};

export function formatSequence(prefix: string, number: number, padding: number, year: number | null): string {
  const n = String(number).padStart(padding, "0");
  return year ? `${prefix}/${year}/${n}` : `${prefix}/${n}`;
}

@Injectable()
export class SequenceService {
  /**
   * Ambil nomor berikutnya untuk `code` di perusahaan `companyId`.
   * Wajib dipanggil di dalam transaksi dokumen agar nomor ikut rollback (tanpa celah) — baris dikunci FOR UPDATE.
   */
  async next(tx: Db, code: string, companyId: string, date = new Date()): Promise<string> {
    const year = date.getFullYear();
    await tx
      .insert(schema.sequences)
      .values({ companyId, code, prefix: DEFAULT_PREFIX[code] ?? code.toUpperCase() })
      .onConflictDoNothing();

    const [seq] = await tx
      .select()
      .from(schema.sequences)
      .where(and(eq(schema.sequences.companyId, companyId), eq(schema.sequences.code, code)))
      .for("update");
    if (!seq) throw new Error(`Sequence ${code} tidak ditemukan`);

    const restart = seq.resetYearly && seq.currentYear !== year;
    const number = restart ? 1 : seq.nextNumber;
    await tx
      .update(schema.sequences)
      .set({
        nextNumber: number + 1,
        currentYear: seq.resetYearly ? year : seq.currentYear,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.sequences.id, seq.id));
    return formatSequence(seq.prefix, number, seq.padding, seq.resetYearly ? year : null);
  }
}

@Controller("sequences")
export class SequenceController {
  constructor(@Inject(TenantDb) private readonly tenantDb: TenantDb) {}

  @Get()
  @RequirePermission("settings.manage")
  list() {
    return this.tenantDb.run((tx) =>
      tx.select().from(schema.sequences).where(eq(schema.sequences.companyId, currentContext().companyId)),
    );
  }
}
