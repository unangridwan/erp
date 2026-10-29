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
  async next(tx: Db, code: string, companyId: string, date = new Date(), prefix?: string): Promise<string> {
    // Tanggal dokumen dikirim sebagai YYYY-MM-DDT00:00:00Z: tahun UTC agar tidak bergeser di zona waktu server.
    const year = date.getUTCFullYear();
    await tx
      .insert(schema.sequences)
      .values({ companyId, code, prefix: prefix ?? DEFAULT_PREFIX[code] ?? code.toUpperCase() })
      .onConflictDoNothing();

    const [seq] = await tx
      .select()
      .from(schema.sequences)
      .where(and(eq(schema.sequences.companyId, companyId), eq(schema.sequences.code, code)))
      .for("update");
    if (!seq) throw new Error(`Sequence ${code} tidak ditemukan`);

    if (!seq.resetYearly) {
      await tx
        .update(schema.sequences)
        .set({ nextNumber: seq.nextNumber + 1, updatedAt: sql`now()` })
        .where(eq(schema.sequences.id, seq.id));
      return formatSequence(seq.prefix, seq.nextNumber, seq.padding, null);
    }

    // Reset tahunan: penghitung terpisah per tahun dokumen, sehingga dokumen bertanggal tahun lain (mis. tanggal
    // masuk karyawan lama, jurnal mundur) melanjutkan nomor tahun itu, bukan mengulang dari 1.
    const SY = schema.sequenceYears;
    const [counter] = await tx
      .insert(SY)
      .values({ sequenceId: seq.id, year, nextNumber: 2 })
      .onConflictDoUpdate({
        target: [SY.sequenceId, SY.year],
        set: { nextNumber: sql`${SY.nextNumber} + 1` },
      })
      .returning({ next: SY.nextNumber });
    const number = counter!.next - 1;
    // Ringkasan tahun terakhir di `sequences` (dipakai tampilan daftar urutan).
    if (seq.currentYear === null || year >= seq.currentYear)
      await tx
        .update(schema.sequences)
        .set({ nextNumber: counter!.next, currentYear: year, updatedAt: sql`now()` })
        .where(eq(schema.sequences.id, seq.id));
    return formatSequence(seq.prefix, number, seq.padding, year);
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
