import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, desc, eq, inArray, schema, sql, type Db, type SQL } from "@erp/db";
import {
  efakturXml,
  idtku,
  isApprovedStatus,
  parseCoretaxNumbers,
  parseCsv,
  parseInputTaxInvoices,
  taxInvoiceLine,
  taxInvoiceTotals,
  tin16,
  vatPosition,
  type BuyerDocument,
  type TrxCode,
  type taxInvoiceUpdateSchema,
} from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { ActivityService } from "../activity/activity.service.js";
import { currentContext } from "../common/request-context.js";
import { companyTaxIds, periodRange, xmlFileName } from "./company-tax.js";

const TI = schema.taxInvoices;
const TIL = schema.taxInvoiceLines;
const ITI = schema.inputTaxInvoices;
const VAT_KINDS = ["vat", "vat_luxury"] as const;

type Header = Omit<typeof TI.$inferInsert, "companyId" | "moveId">;
type LineRow = Omit<typeof TIL.$inferInsert, "taxInvoiceId">;

@Injectable()
export class TaxInvoiceService {
  constructor(@Inject(ActivityService) private readonly activity: ActivityService) {}

  // ---- Faktur pajak keluaran ----

  async list(tx: Db, query: { year?: string; month?: string; state?: string }) {
    const filters: (SQL | undefined)[] = [eq(TI.companyId, currentContext().companyId)];
    if (query.year) filters.push(eq(TI.periodYear, Number(query.year)));
    if (query.month) filters.push(eq(TI.periodMonth, Number(query.month)));
    if (query.state) filters.push(eq(TI.state, query.state as (typeof schema.TAX_DOC_STATES)[number]));
    const rows = await tx
      .select({
        doc: TI,
        moveName: schema.accountMoves.name,
        reversed: sql<boolean>`${schema.accountMoves.paymentState} = 'reversed'`,
      })
      .from(TI)
      .innerJoin(schema.accountMoves, eq(schema.accountMoves.id, TI.moveId))
      .where(and(...filters))
      .orderBy(desc(TI.invoiceDate), desc(TI.createdAt));
    return rows.map((r) => ({ ...r.doc, moveName: r.moveName, reversed: r.reversed }));
  }

  async get(tx: Db, id: string) {
    const doc = await this.find(tx, id);
    const lines = await tx.select().from(TIL).where(eq(TIL.taxInvoiceId, id)).orderBy(asc(TIL.sequence));
    return { ...doc, lines };
  }

  /** Buat draft faktur pajak untuk setiap faktur penjualan ber-PPN yang belum punya, dalam satu masa. */
  async generate(tx: Db, input: { year: number; month: number }) {
    const companyId = currentContext().companyId;
    const seller = await companyTaxIds(tx, companyId);
    if (!seller.pkp)
      throw new BadRequestException("Perusahaan belum ditandai PKP; faktur pajak hanya untuk PKP");
    const { from, to } = periodRange(input.year, input.month);
    const moves = await tx.execute<{ id: string; name: string }>(sql`
      select m.id, m.name from account_moves m
      where m.company_id = ${companyId} and m.state = 'posted' and m.move_type = 'out_invoice'
        and m.payment_state <> 'reversed' and m.date between ${from} and ${to}
        and exists (select 1 from account_move_lines l join taxes t on t.id = l.tax_line_id
                    where l.move_id = m.id and t.tax_kind in ('vat', 'vat_luxury'))
        and not exists (select 1 from tax_invoices ti where ti.move_id = m.id and ti.state <> 'cancelled')
      order by m.date, m.name`);
    const created: string[] = [];
    const skipped: { moveId: string; name: string; reason: string }[] = [];
    for (const move of moves) {
      try {
        const snapshot = await this.snapshot(tx, move.id, seller.idtku);
        const [row] = await tx
          .insert(TI)
          .values({ ...snapshot.header, companyId, moveId: move.id })
          .returning({ id: TI.id });
        await tx.insert(TIL).values(snapshot.lines.map((l) => ({ ...l, taxInvoiceId: row!.id })));
        created.push(row!.id);
      } catch (e) {
        if (!(e instanceof BadRequestException)) throw e;
        skipped.push({ moveId: move.id, name: move.name, reason: e.message });
      }
    }
    return { created: created.length, ids: created, skipped };
  }

  /** Ubah kode transaksi / keterangan fasilitas (draft), lalu hitung ulang dari faktur sumber. */
  async update(tx: Db, id: string, input: z.infer<typeof taxInvoiceUpdateSchema>) {
    const doc = await this.find(tx, id);
    if (doc.state !== "draft") throw new BadRequestException("Hanya faktur pajak draft yang bisa diubah");
    const seller = await companyTaxIds(tx, doc.companyId);
    const snapshot = await this.snapshot(tx, doc.moveId, seller.idtku, {
      trxCode: (input.trxCode ?? doc.trxCode) as TrxCode,
      addInfo: input.addInfo !== undefined ? input.addInfo : doc.addInfo,
      facilityStamp: input.facilityStamp !== undefined ? input.facilityStamp : doc.facilityStamp,
      customDoc: input.customDoc !== undefined ? input.customDoc : doc.customDoc,
    });
    await tx
      .update(TI)
      .set({ ...snapshot.header, updatedAt: sql`now()` })
      .where(eq(TI.id, id));
    await tx.delete(TIL).where(eq(TIL.taxInvoiceId, id));
    await tx.insert(TIL).values(snapshot.lines.map((l) => ({ ...l, taxInvoiceId: id })));
    return this.get(tx, id);
  }

  /** Ekspor XML TaxInvoiceBulk; draft & yang sudah pernah diekspor boleh diekspor ulang. */
  async export(tx: Db, ids: string[]) {
    const companyId = currentContext().companyId;
    const seller = await companyTaxIds(tx, companyId);
    const docs = await tx
      .select()
      .from(TI)
      .where(and(inArray(TI.id, ids), eq(TI.companyId, companyId)))
      .orderBy(asc(TI.invoiceDate), asc(TI.ref));
    if (docs.length !== new Set(ids).size)
      throw new NotFoundException("Sebagian faktur pajak tidak ditemukan");
    const bad = docs.find((d) => d.state !== "draft" && d.state !== "exported");
    if (bad) throw new BadRequestException(`Faktur pajak ${bad.ref} berstatus ${bad.state}`);
    const facility = docs.find(
      (d) => (d.trxCode === "07" || d.trxCode === "08") && (!d.addInfo || !d.facilityStamp),
    );
    if (facility)
      throw new BadRequestException(
        `Faktur pajak ${facility.ref} (kode ${facility.trxCode}) butuh keterangan tambahan & cap fasilitas`,
      );
    const lines = await tx
      .select()
      .from(TIL)
      .where(inArray(TIL.taxInvoiceId, ids))
      .orderBy(asc(TIL.sequence));
    const content = efakturXml(
      seller.tin,
      docs.map((d) => ({
        invoiceDate: d.invoiceDate,
        trxCode: d.trxCode as TrxCode,
        addInfo: d.addInfo,
        customDoc: d.customDoc,
        facilityStamp: d.facilityStamp,
        ref: d.ref,
        sellerIdtku: d.sellerIdtku,
        buyerTin: d.buyerTin,
        buyerDocument: d.buyerDocument as BuyerDocument,
        buyerDocumentNumber: d.buyerDocumentNumber,
        buyerCountry: d.buyerCountry,
        buyerName: d.buyerName,
        buyerAddress: d.buyerAddress,
        buyerEmail: d.buyerEmail,
        buyerIdtku: d.buyerIdtku,
        lines: lines
          .filter((l) => l.taxInvoiceId === d.id)
          .map((l) => ({
            opt: l.opt,
            code: l.code,
            name: l.name,
            unit: l.unit,
            price: l.price,
            qty: new Decimal(l.qty).toString(),
            totalDiscount: l.totalDiscount,
            taxBase: l.taxBase,
            otherTaxBase: l.otherTaxBase,
            vatRate: new Decimal(l.vatRate).toString(),
            vat: l.vat,
            stlgRate: new Decimal(l.stlgRate).toString(),
            stlg: l.stlg,
          })),
      })),
    );
    const first = docs[0]!;
    const fileName = xmlFileName("faktur-keluaran", first.periodYear, first.periodMonth);
    const [batch] = await tx
      .insert(schema.taxExportBatches)
      .values({
        companyId,
        kind: "efaktur",
        fileName,
        content,
        recordCount: docs.length,
        createdBy: currentContext().userId,
      })
      .returning({ id: schema.taxExportBatches.id });
    await tx
      .update(TI)
      .set({ state: "exported", batchId: batch!.id, updatedAt: sql`now()` })
      .where(inArray(TI.id, ids));
    return { fileName, content };
  }

  /** Catat nomor faktur dari Coretax (faktur sudah diunggah & ditandatangani). */
  async approve(tx: Db, id: string, number: string) {
    const doc = await this.find(tx, id);
    if (doc.state === "cancelled") throw new BadRequestException("Faktur pajak sudah dibatalkan");
    const [dup] = await tx
      .select({ id: TI.id })
      .from(TI)
      .where(and(eq(TI.companyId, doc.companyId), eq(TI.efakturNumber, number)));
    if (dup && dup.id !== id) throw new ConflictException(`Nomor faktur ${number} sudah dipakai`);
    await tx
      .update(TI)
      .set({ state: "approved", efakturNumber: number, approvedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(TI.id, id));
    await this.activity.log(tx, {
      resModel: "account_move",
      resId: doc.moveId,
      action: "update",
      message: `Faktur pajak ${number} terbit`,
    });
    return this.get(tx, id);
  }

  /** Impor daftar faktur keluaran dari Coretax: nomor faktur dicocokkan lewat referensi. */
  async importNumbers(tx: Db, csv: string) {
    let rows: ReturnType<typeof parseCoretaxNumbers>;
    try {
      rows = parseCoretaxNumbers(parseCsv(csv));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const companyId = currentContext().companyId;
    let approved = 0;
    const unmatched: string[] = [];
    for (const row of rows) {
      if (!isApprovedStatus(row.status)) continue;
      const [doc] = await tx
        .select({ id: TI.id, state: TI.state })
        .from(TI)
        .where(
          and(eq(TI.companyId, companyId), eq(TI.ref, row.ref), inArray(TI.state, ["draft", "exported"])),
        );
      if (!doc) {
        unmatched.push(row.ref);
        continue;
      }
      await this.approve(tx, doc.id, row.number);
      approved++;
    }
    return { approved, unmatched };
  }

  async cancel(tx: Db, id: string) {
    const doc = await this.find(tx, id);
    if (doc.state === "cancelled") return;
    await tx
      .update(TI)
      .set({ state: "cancelled", updatedAt: sql`now()` })
      .where(eq(TI.id, id));
  }

  private async find(tx: Db, id: string) {
    const [doc] = await tx
      .select()
      .from(TI)
      .where(and(eq(TI.id, id), eq(TI.companyId, currentContext().companyId)));
    if (!doc) throw new NotFoundException("Faktur pajak tidak ditemukan");
    return doc;
  }

  /** Salinan data faktur penjualan + pembeli dalam format Coretax (nilai Rupiah). */
  private async snapshot(
    tx: Db,
    moveId: string,
    sellerIdtku: string,
    override: {
      trxCode?: TrxCode;
      addInfo?: string | null;
      facilityStamp?: string | null;
      customDoc?: string | null;
    } = {},
  ): Promise<{ header: Header; lines: LineRow[] }> {
    const [move] = await tx
      .select({ move: schema.accountMoves, partner: schema.partners })
      .from(schema.accountMoves)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.accountMoves.partnerId))
      .where(eq(schema.accountMoves.id, moveId));
    if (!move) throw new NotFoundException("Faktur tidak ditemukan");
    const { partner } = move;
    const fail = (reason: string) => new BadRequestException(reason);

    const document = partner.taxDocumentType as BuyerDocument;
    const npwp = tin16(partner.npwp);
    let buyerTin = "0000000000000000";
    let buyerIdtku = "0000000000000000000000";
    let documentNumber: string | null = null;
    if (document === "TIN") {
      if (!npwp)
        throw fail(`NPWP pelanggan ${partner.name} belum diisi (atau pilih jenis dokumen NIK/Paspor)`);
      buyerTin = npwp;
      buyerIdtku = idtku(npwp, partner.tku)!;
    } else {
      documentNumber = partner.taxDocumentNumber?.trim() || null;
      if (!documentNumber) throw fail(`Nomor ${document} pelanggan ${partner.name} belum diisi`);
      if (document === "National ID") {
        const nik = tin16(documentNumber);
        if (!nik) throw fail(`NIK pelanggan ${partner.name} harus 16 digit`);
        documentNumber = nik;
        buyerIdtku = idtku(nik, partner.tku)!;
      }
    }
    const address = [partner.street, partner.city, partner.province, partner.postalCode]
      .filter(Boolean)
      .join(", ");
    if (!address) throw fail(`Alamat pelanggan ${partner.name} belum diisi`);

    const rate = new Decimal(move.move.currencyRate);
    const trxCode = override.trxCode ?? (partner.taxTrxCode as TrxCode);
    const sourceLines = await tx
      .select({
        line: schema.accountMoveLines,
        productType: schema.products.productType,
        goodsCode: schema.products.taxGoodsCode,
        unitCode: schema.uoms.coretaxCode,
      })
      .from(schema.accountMoveLines)
      .leftJoin(schema.products, eq(schema.products.id, schema.accountMoveLines.productId))
      .leftJoin(schema.uoms, eq(schema.uoms.id, schema.products.uomId))
      .where(
        and(eq(schema.accountMoveLines.moveId, moveId), eq(schema.accountMoveLines.displayType, "product")),
      )
      .orderBy(asc(schema.accountMoveLines.sequence));
    const taxIds = [...new Set(sourceLines.flatMap((l) => l.line.taxIds))];
    const taxes = taxIds.length
      ? await tx
          .select({
            id: schema.taxes.id,
            amount: schema.taxes.amount,
            baseRatio: schema.taxes.baseRatio,
            kind: schema.taxes.taxKind,
          })
          .from(schema.taxes)
          .where(inArray(schema.taxes.id, taxIds))
      : [];

    const lines: LineRow[] = [];
    for (const { line, productType, goodsCode, unitCode } of sourceLines) {
      const vat = taxes.find(
        (t) => line.taxIds.includes(t.id) && (VAT_KINDS as readonly string[]).includes(t.kind),
      );
      if (!vat) continue;
      // DPP = nilai buku baris (sudah Rupiah); harga satuan dikonversi dengan kurs faktur.
      const taxBase = new Decimal(line.credit).minus(line.debit);
      if (taxBase.lt(0))
        throw fail(
          `Faktur ${move.move.name} punya baris negatif "${line.name ?? ""}" (mis. potongan uang muka) — buat faktur pajaknya langsung di Coretax`,
        );
      const computed = taxInvoiceLine(
        {
          name: line.name || "Barang/Jasa",
          isService: productType === "service",
          goodsCode,
          unitCode,
          price: new Decimal(line.priceUnit ?? 0).times(rate),
          qty: line.quantity ?? 1,
          discount: line.discount,
          taxBase,
          vat: { rate: vat.amount, baseRatio: vat.baseRatio },
        },
        trxCode,
      );
      lines.push({ ...computed, sequence: lines.length });
    }
    if (!lines.length) throw fail(`Faktur ${move.move.name} tidak punya baris ber-PPN`);
    const totals = taxInvoiceTotals(
      lines.map((l) => ({
        ...l,
        qty: String(l.qty),
        vatRate: String(l.vatRate),
        stlgRate: String(l.stlgRate ?? 0),
        stlg: String(l.stlg ?? 0),
        totalDiscount: String(l.totalDiscount ?? 0),
      })),
    );
    const [year, month] = move.move.date.split("-").map(Number) as [number, number];
    return {
      header: {
        trxCode,
        addInfo: override.addInfo ?? null,
        facilityStamp: override.facilityStamp ?? null,
        customDoc: override.customDoc ?? null,
        invoiceDate: move.move.date,
        periodYear: year,
        periodMonth: month,
        ref: move.move.name ?? moveId,
        sellerIdtku,
        buyerTin,
        buyerDocument: document,
        buyerDocumentNumber: documentNumber,
        buyerCountry: partner.countryCode,
        buyerName: partner.name,
        buyerAddress: address,
        buyerEmail: partner.email,
        buyerIdtku,
        ...totals,
      },
      lines,
    };
  }

  // ---- Faktur pajak masukan ----

  async listInput(tx: Db, query: { state?: string; year?: string; month?: string }) {
    const filters: (SQL | undefined)[] = [eq(ITI.companyId, currentContext().companyId)];
    if (query.state) filters.push(eq(ITI.state, query.state as "new"));
    if (query.year && query.month) {
      const { from, to } = periodRange(Number(query.year), Number(query.month));
      filters.push(sql`${ITI.invoiceDate} between ${from} and ${to}`);
    }
    return tx
      .select({
        doc: ITI,
        partnerName: schema.partners.name,
        moveName: schema.accountMoves.name,
      })
      .from(ITI)
      .leftJoin(schema.partners, eq(schema.partners.id, ITI.partnerId))
      .leftJoin(schema.accountMoves, eq(schema.accountMoves.id, ITI.moveId))
      .where(and(...filters))
      .orderBy(desc(ITI.invoiceDate))
      .then((rows) => rows.map((r) => ({ ...r.doc, partnerName: r.partnerName, moveName: r.moveName })));
  }

  /** Impor CSV daftar faktur masukan Coretax, lalu cocokkan otomatis dengan pemasok & tagihan. */
  async importInput(tx: Db, csv: string) {
    let parsed: ReturnType<typeof parseInputTaxInvoices>;
    try {
      parsed = parseInputTaxInvoices(parseCsv(csv));
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const companyId = currentContext().companyId;
    let imported = 0;
    let updated = 0;
    for (const item of parsed.items) {
      const [existing] = await tx
        .select({ id: ITI.id, state: ITI.state })
        .from(ITI)
        .where(and(eq(ITI.companyId, companyId), eq(ITI.efakturNumber, item.efakturNumber)));
      if (existing) {
        // Faktur yang sudah dikreditkan tidak diubah; selainnya ikuti data terbaru Coretax.
        if (existing.state === "new") {
          await tx
            .update(ITI)
            .set({ ...item, updatedAt: sql`now()` })
            .where(eq(ITI.id, existing.id));
          updated++;
        }
        continue;
      }
      await tx.insert(ITI).values({ ...item, companyId });
      imported++;
    }
    const matched = await this.autoMatch(tx, companyId);
    return { imported, updated, matched, errors: parsed.errors };
  }

  /** Cocokkan faktur masukan dengan pemasok (NPWP) dan tagihan posted yang PPN-nya sama (selisih ≤ Rp1). */
  private async autoMatch(tx: Db, companyId: string) {
    const pending = await tx
      .select()
      .from(ITI)
      .where(and(eq(ITI.companyId, companyId), eq(ITI.state, "new"), sql`${ITI.moveId} is null`));
    let matched = 0;
    for (const doc of pending) {
      const [partner] = doc.partnerId
        ? [{ id: doc.partnerId }]
        : await tx.execute<{ id: string }>(sql`
            select id from partners
            where regexp_replace(coalesce(npwp, ''), '\\D', '', 'g') in (${doc.sellerTin}, ${doc.sellerTin.replace(/^0/, "")})
            order by is_supplier desc limit 1`);
      if (!partner) continue;
      const [bill] = await tx.execute<{ id: string }>(sql`
        select m.id from account_moves m
        where m.company_id = ${companyId} and m.state = 'posted' and m.move_type = 'in_invoice'
          and m.partner_id = ${partner.id}
          and m.date between (${doc.invoiceDate}::date - 45) and (${doc.invoiceDate}::date + 45)
          and not exists (select 1 from input_tax_invoices x where x.move_id = m.id)
          and abs((select coalesce(sum(l.debit - l.credit), 0) from account_move_lines l
                   join taxes t on t.id = l.tax_line_id
                   where l.move_id = m.id and t.tax_kind in ('vat', 'vat_luxury')) - ${doc.vat}::numeric) <= 1
        order by abs(m.date - ${doc.invoiceDate}::date) limit 1`);
      await tx
        .update(ITI)
        .set({ partnerId: partner.id, moveId: bill?.id ?? null, updatedAt: sql`now()` })
        .where(eq(ITI.id, doc.id));
      if (bill) matched++;
    }
    return matched;
  }

  async updateInput(tx: Db, id: string, input: { moveId?: string | null; partnerId?: string | null }) {
    const companyId = currentContext().companyId;
    const [doc] = await tx
      .select()
      .from(ITI)
      .where(and(eq(ITI.id, id), eq(ITI.companyId, companyId)));
    if (!doc) throw new NotFoundException("Faktur masukan tidak ditemukan");
    if (input.moveId) {
      const [bill] = await tx
        .select({ partnerId: schema.accountMoves.partnerId })
        .from(schema.accountMoves)
        .where(
          and(
            eq(schema.accountMoves.id, input.moveId),
            eq(schema.accountMoves.companyId, companyId),
            inArray(schema.accountMoves.moveType, ["in_invoice", "in_refund"]),
          ),
        );
      if (!bill) throw new BadRequestException("Tagihan tidak ditemukan di perusahaan ini");
      input.partnerId ??= bill.partnerId;
    }
    if (input.partnerId) {
      const [p] = await tx
        .select({ id: schema.partners.id })
        .from(schema.partners)
        .where(eq(schema.partners.id, input.partnerId));
      if (!p) throw new BadRequestException("Pemasok tidak ditemukan");
    }
    await tx
      .update(ITI)
      .set({
        ...(input.moveId !== undefined ? { moveId: input.moveId } : {}),
        ...(input.partnerId !== undefined ? { partnerId: input.partnerId } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(ITI.id, id));
    return (await this.listInput(tx, {})).find((d) => d.id === id);
  }

  /** Kreditkan faktur masukan pada masa tertentu (maks. 3 masa setelah masa faktur), atau tandai tidak dikreditkan. */
  async creditInput(tx: Db, input: { ids: string[]; credit: boolean; year: number; month: number }) {
    const companyId = currentContext().companyId;
    const docs = await tx
      .select()
      .from(ITI)
      .where(and(inArray(ITI.id, input.ids), eq(ITI.companyId, companyId)));
    if (docs.length !== new Set(input.ids).size)
      throw new NotFoundException("Sebagian faktur tidak ditemukan");
    if (input.credit) {
      const target = input.year * 12 + input.month;
      for (const d of docs) {
        const [y, m] = d.invoiceDate.split("-").map(Number) as [number, number];
        const own = y * 12 + m;
        // UU PPN Pasal 9 ayat (9): dikreditkan paling lama 3 masa pajak setelah berakhirnya masa faktur.
        if (target < own || target > own + 3)
          throw new BadRequestException(
            `Faktur ${d.efakturNumber} hanya bisa dikreditkan pada masa ${m}/${y} s.d. 3 masa berikutnya`,
          );
      }
    }
    await tx
      .update(ITI)
      .set(
        input.credit
          ? { state: "credited", creditYear: input.year, creditMonth: input.month, updatedAt: sql`now()` }
          : { state: "not_credited", creditYear: null, creditMonth: null, updatedAt: sql`now()` },
      )
      .where(inArray(ITI.id, input.ids));
    return { updated: docs.length };
  }

  // ---- Rekap SPT Masa PPN ----

  async vatReport(tx: Db, year: number, month: number) {
    const companyId = currentContext().companyId;
    const { from, to } = periodRange(year, month);
    const [gl] = await tx.execute<{ output: string; input: string }>(sql`
      select
        coalesce(sum(case when t.type_tax_use = 'sale' then l.credit - l.debit end), 0)::text as output,
        coalesce(sum(case when t.type_tax_use = 'purchase' then l.debit - l.credit end), 0)::text as input
      from account_move_lines l
      join account_moves m on m.id = l.move_id
      join taxes t on t.id = l.tax_line_id
      where m.company_id = ${companyId} and m.state = 'posted' and m.date between ${from} and ${to}
        and t.tax_kind in ('vat', 'vat_luxury')`);
    const outputDocs = await tx
      .select({
        state: TI.state,
        count: sql<number>`count(*)::int`,
        taxBase: sql<string>`sum(${TI.taxBase})::text`,
        vat: sql<string>`sum(${TI.vat})::text`,
      })
      .from(TI)
      .where(and(eq(TI.companyId, companyId), eq(TI.periodYear, year), eq(TI.periodMonth, month)))
      .groupBy(TI.state);
    const [credited] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        taxBase: sql<string>`coalesce(sum(${ITI.taxBase}), 0)::text`,
        vat: sql<string>`coalesce(sum(${ITI.vat}), 0)::text`,
      })
      .from(ITI)
      .where(and(eq(ITI.companyId, companyId), eq(ITI.creditYear, year), eq(ITI.creditMonth, month)));
    // Faktur keluaran yang sah: disetujui/diekspor (draft belum dilaporkan).
    const issuedVat = outputDocs
      .filter((d) => d.state === "approved" || d.state === "exported")
      .reduce((s, d) => s.plus(d.vat ?? 0), new Decimal(0));
    return {
      period: { year, month },
      ledger: { outputVat: gl?.output ?? "0", inputVat: gl?.input ?? "0" },
      outputInvoices: outputDocs,
      inputCredited: credited ?? { count: 0, taxBase: "0", vat: "0" },
      position: vatPosition(issuedVat, credited?.vat ?? 0),
    };
  }
}
