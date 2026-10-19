import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, desc, eq, inArray, schema, sql, type Db, type SQL } from "@erp/db";
import { digitsOnly, legacyReturnCsv, npwp15 } from "@erp/shared";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { periodRange } from "./company-tax.js";

const R = schema.taxReturns;
const ITI = schema.inputTaxInvoices;

/**
 * Nota retur pajak masukan: dibuat dari nota debit (retur pembelian) yang sudah diposting atas tagihan yang faktur
 * pajak masukannya tercatat. Di Coretax retur dibuat oleh pembeli (menu Retur Pajak Masukan); untuk faktur e-Faktur
 * lama (nomor 16 digit) tersedia CSV impor RM.
 */
@Injectable()
export class TaxReturnService {
  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}

  async list(tx: Db, query: { year?: string; month?: string; state?: string }) {
    const filters: (SQL | undefined)[] = [eq(R.companyId, currentContext().companyId)];
    if (query.year) filters.push(eq(R.periodYear, Number(query.year)));
    if (query.month) filters.push(eq(R.periodMonth, Number(query.month)));
    if (query.state) filters.push(eq(R.state, query.state as "draft"));
    const rows = await tx
      .select({
        doc: R,
        moveName: schema.accountMoves.name,
        partnerName: schema.partners.name,
        efakturNumber: ITI.efakturNumber,
        invoiceDate: ITI.invoiceDate,
        sellerName: ITI.sellerName,
        sellerTin: ITI.sellerTin,
        creditState: ITI.state,
      })
      .from(R)
      .innerJoin(schema.accountMoves, eq(schema.accountMoves.id, R.moveId))
      .leftJoin(schema.partners, eq(schema.partners.id, schema.accountMoves.partnerId))
      .leftJoin(ITI, eq(ITI.id, R.inputTaxInvoiceId))
      .where(and(...filters))
      .orderBy(desc(R.returnDate), asc(R.returnNumber));
    return rows.map(({ doc, ...rest }) => ({
      ...doc,
      ...rest,
      // Faktur e-Faktur lama: 16 digit (kode transaksi + status + NSFP 13 digit).
      legacy: digitsOnly(rest.efakturNumber).length === 16,
    }));
  }

  /** Draft nota retur untuk setiap nota debit ber-PPN yang diposting pada masa itu. */
  async generate(tx: Db, input: { year: number; month: number }) {
    const companyId = currentContext().companyId;
    const { from, to } = periodRange(input.year, input.month);
    const refunds = await tx.execute<{
      id: string;
      name: string;
      date: string;
      partner_id: string;
      reversed_entry_id: string | null;
      tax_base: string;
      vat: string;
      stlg: string;
    }>(sql`
      select m.id, m.name, m.date, m.partner_id, m.reversed_entry_id,
        coalesce((select sum(l.credit - l.debit) from account_move_lines l
                  where l.move_id = m.id and l.display_type = 'product'
                    and exists (select 1 from taxes t where t.id = any(l.tax_ids) and t.tax_kind in ('vat', 'vat_luxury'))), 0)::text as tax_base,
        coalesce((select sum(l.credit - l.debit) from account_move_lines l join taxes t on t.id = l.tax_line_id
                  where l.move_id = m.id and t.tax_kind in ('vat', 'vat_luxury')), 0)::text as vat,
        coalesce((select sum(l.credit - l.debit) from account_move_lines l join taxes t on t.id = l.tax_line_id
                  where l.move_id = m.id and t.tax_kind = 'ppnbm'), 0)::text as stlg
      from account_moves m
      where m.company_id = ${companyId} and m.state = 'posted' and m.move_type = 'in_refund'
        and m.date between ${from} and ${to}
        and not exists (select 1 from tax_returns r where r.move_id = m.id and r.state <> 'cancelled')
      order by m.date, m.name`);
    const created: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const m of refunds) {
      // Nota debit dikreditkan ke beban/persediaan dan PPN masukan (nilai kredit = positif).
      if (Number(m.vat) <= 0) {
        skipped.push({ name: m.name, reason: "Tidak ada PPN masukan yang dikembalikan" });
        continue;
      }
      const inputTaxInvoiceId = await this.matchInvoice(tx, companyId, m.id, m.reversed_entry_id);
      const [row] = await tx
        .insert(R)
        .values({
          companyId,
          moveId: m.id,
          inputTaxInvoiceId,
          returnNumber: m.name,
          returnDate: m.date,
          periodYear: input.year,
          periodMonth: input.month,
          taxBase: m.tax_base,
          vat: m.vat,
          stlg: m.stlg,
          createdBy: currentContext().userId,
        })
        .returning({ id: R.id });
      created.push(row!.id);
    }
    return { created: created.length, ids: created, skipped };
  }

  /**
   * Faktur masukan yang diretur: tagihan yang berbagi baris PO dengan nota debit (retur barang), atau tagihan yang
   * dibalik oleh nota debit ini.
   */
  private async matchInvoice(tx: Db, companyId: string, refundId: string, reversedId: string | null) {
    const [hit] = await tx.execute<{ id: string }>(sql`
      select i.id from input_tax_invoices i
      join account_moves b on b.id = i.move_id
      where i.company_id = ${companyId} and b.move_type = 'in_invoice' and b.state = 'posted'
        and (b.id = ${reversedId}
             or exists (select 1 from account_move_lines bl join account_move_lines rl
                          on rl.purchase_line_id = bl.purchase_line_id
                        where bl.move_id = b.id and rl.move_id = ${refundId}))
      order by b.date desc limit 1`);
    return hit?.id ?? null;
  }

  async update(tx: Db, id: string, inputTaxInvoiceId: string | null) {
    const doc = await this.find(tx, id);
    if (doc.state !== "draft") throw new BadRequestException("Hanya nota retur draft yang bisa diubah");
    if (inputTaxInvoiceId) {
      const [inv] = await tx
        .select({ id: ITI.id })
        .from(ITI)
        .where(and(eq(ITI.id, inputTaxInvoiceId), eq(ITI.companyId, doc.companyId)));
      if (!inv) throw new BadRequestException("Faktur pajak masukan tidak ditemukan");
    }
    await tx
      .update(R)
      .set({ inputTaxInvoiceId, updatedAt: sql`now()` })
      .where(eq(R.id, id));
    return this.get(tx, id);
  }

  /** CSV impor retur pajak masukan e-Faktur 3.x (hanya untuk faktur bernomor lama 16 digit). */
  async exportLegacy(tx: Db, ids: string[]) {
    const companyId = currentContext().companyId;
    const rows = (await this.list(tx, {})).filter((r) => ids.includes(r.id));
    if (rows.length !== new Set(ids).size) throw new NotFoundException("Sebagian nota retur tidak ditemukan");
    const problems: string[] = [];
    for (const r of rows) {
      if (r.state !== "draft" && r.state !== "exported")
        problems.push(`${r.returnNumber}: status ${r.state}`);
      if (!r.efakturNumber) problems.push(`${r.returnNumber}: faktur pajak masukan belum dipilih`);
      else if (!r.legacy)
        problems.push(
          `${r.returnNumber}: faktur ${r.efakturNumber} terbit di Coretax — buat returnya di menu Retur Pajak Masukan Coretax`,
        );
      if (r.sellerTin && !npwp15(r.sellerTin))
        problems.push(`${r.returnNumber}: NPWP penjual bukan format 15 digit`);
    }
    if (problems.length)
      throw new BadRequestException({
        message: "Nota retur belum bisa diekspor",
        errors: problems.map((message) => ({ path: "", message })),
      });
    const content = legacyReturnCsv(
      rows.map((r) => ({
        sellerNpwp15: npwp15(r.sellerTin)!,
        sellerName: r.sellerName ?? r.partnerName ?? "",
        efakturNumber: r.efakturNumber!,
        invoiceDate: r.invoiceDate!,
        creditable: r.creditState === "credited",
        returnNumber: r.returnNumber,
        returnDate: r.returnDate,
        periodMonth: r.periodMonth,
        periodYear: r.periodYear,
        dpp: r.taxBase,
        ppn: r.vat,
        ppnbm: r.stlg,
      })),
    );
    const first = rows[0]!;
    const fileName = `retur-masukan-${first.periodYear}-${String(first.periodMonth).padStart(2, "0")}.csv`;
    const [batch] = await tx
      .insert(schema.taxExportBatches)
      .values({
        companyId,
        kind: "retur_legacy",
        fileName,
        content,
        recordCount: rows.length,
        createdBy: currentContext().userId,
      })
      .returning({ id: schema.taxExportBatches.id });
    await tx
      .update(R)
      .set({ state: "exported", batchId: batch!.id, updatedAt: sql`now()` })
      .where(inArray(R.id, ids));
    return { fileName, content };
  }

  /** Retur sudah dilaporkan (Coretax/e-Faktur): catat nomornya. */
  async approve(tx: Db, id: string, number: string) {
    const doc = await this.find(tx, id);
    if (doc.state === "cancelled") throw new BadRequestException("Nota retur sudah dibatalkan");
    if (!doc.inputTaxInvoiceId) throw new BadRequestException("Pilih faktur pajak masukan yang diretur dulu");
    await tx
      .update(R)
      .set({ state: "approved", coretaxNumber: number, updatedAt: sql`now()` })
      .where(eq(R.id, id));
    await this.activity.log(tx, {
      resModel: "account_move",
      resId: doc.moveId,
      action: "update",
      message: `Nota retur pajak masukan ${number} dilaporkan`,
    });
    return this.get(tx, id);
  }

  async cancel(tx: Db, id: string) {
    await this.find(tx, id);
    await tx
      .update(R)
      .set({ state: "cancelled", updatedAt: sql`now()` })
      .where(eq(R.id, id));
  }

  async get(tx: Db, id: string) {
    const row = (await this.list(tx, {})).find((r) => r.id === id);
    if (!row) throw new NotFoundException("Nota retur tidak ditemukan");
    return row;
  }

  private async find(tx: Db, id: string) {
    const [doc] = await tx
      .select()
      .from(R)
      .where(and(eq(R.id, id), eq(R.companyId, currentContext().companyId)));
    if (!doc) throw new NotFoundException("Nota retur tidak ditemukan");
    return doc;
  }
}
