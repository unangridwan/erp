import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, schema, sql, type Db } from "@erp/db";
import { depreciationSchedule, type assetDisposeSchema } from "@erp/shared";
import { Decimal } from "decimal.js";
import type { z } from "zod";
import { currentContext } from "../common/request-context.js";
import { assertCompanyAccounts, assertCompanyJournal, assertDimensions, loadBooks } from "./context.js";
import { MoveService } from "./move.service.js";

const nextMonthStart = (date: string) => {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

/** Validasi sebelum simpan (dipakai CRUD): hanya draft yang bisa diubah; akun & jurnal milik perusahaan. */
export async function validateAsset(tx: Db, values: Record<string, unknown>, id?: string) {
  const companyId = String(values.companyId ?? currentContext().companyId);
  if (id) {
    const [asset] = await tx
      .select({ state: schema.assets.state })
      .from(schema.assets)
      .where(eq(schema.assets.id, id));
    if (asset && asset.state !== "draft")
      throw new BadRequestException("Aset yang sudah berjalan tidak bisa diubah");
  }
  const refs = (["assetAccountId", "depreciationAccountId", "expenseAccountId"] as const)
    .filter((k) => typeof values[k] === "string")
    .map((k) => ({ path: k, id: values[k] as string }));
  await assertCompanyAccounts(tx, companyId, refs);
  if (!id && !values.journalId) values.journalId = (await loadBooks(tx, companyId)).settings.generalJournalId;
  if (typeof values.journalId === "string")
    await assertCompanyJournal(tx, companyId, values.journalId, ["general"]);
  await assertDimensions(tx, companyId, [
    values as { branchId?: string; businessUnitId?: string; costCenterId?: string },
  ]);
  if (
    values.firstDepreciationDate &&
    values.acquisitionDate &&
    String(values.firstDepreciationDate) < String(values.acquisitionDate)
  ) {
    throw new BadRequestException("Tanggal mulai penyusutan tidak boleh sebelum tanggal perolehan");
  }
}

@Injectable()
export class AssetService {
  constructor(@Inject(MoveService) private readonly moves: MoveService) {}

  async get(tx: Db, id: string) {
    const [asset] = await tx
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, id), eq(schema.assets.companyId, currentContext().companyId)));
    if (!asset) throw new NotFoundException("Aset tidak ditemukan");
    const schedule = await tx
      .select({ line: schema.assetDepreciationLines, moveName: schema.accountMoves.name })
      .from(schema.assetDepreciationLines)
      .leftJoin(schema.accountMoves, eq(schema.accountMoves.id, schema.assetDepreciationLines.moveId))
      .where(eq(schema.assetDepreciationLines.assetId, id))
      .orderBy(asc(schema.assetDepreciationLines.sequence));
    return { ...asset, schedule: schedule.map((r) => ({ ...r.line, moveName: r.moveName })) };
  }

  /** Konfirmasi aset: buat jadwal penyusutan dan ubah status menjadi berjalan. */
  async confirm(tx: Db, id: string) {
    const asset = await this.get(tx, id);
    if (asset.state !== "draft") throw new BadRequestException("Aset sudah dikonfirmasi");
    const books = await loadBooks(tx, asset.companyId);
    const lines = depreciationSchedule({
      cost: asset.cost,
      salvageValue: asset.salvageValue,
      usefulLifeMonths: asset.usefulLifeMonths,
      method: asset.method,
      firstDepreciationDate: asset.firstDepreciationDate,
      decimals: books.decimals,
    });
    await tx.insert(schema.assetDepreciationLines).values(lines.map((l) => ({ ...l, assetId: id })));
    await tx
      .update(schema.assets)
      .set({ state: "running", updatedAt: sql`now()` })
      .where(eq(schema.assets.id, id));
    return this.get(tx, id);
  }

  /** Posting semua penyusutan yang jatuh pada/sebelum `date` untuk aset berjalan di perusahaan aktif. */
  async depreciate(tx: Db, date: string, assetId?: string) {
    const companyId = currentContext().companyId;
    const due = await tx
      .select({ line: schema.assetDepreciationLines, asset: schema.assets })
      .from(schema.assetDepreciationLines)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.assetDepreciationLines.assetId))
      .where(
        and(
          eq(schema.assets.companyId, companyId),
          eq(schema.assets.state, "running"),
          isNull(schema.assetDepreciationLines.moveId),
          lte(schema.assetDepreciationLines.date, date),
          assetId ? eq(schema.assets.id, assetId) : undefined,
        ),
      )
      .orderBy(asc(schema.assetDepreciationLines.date), asc(schema.assets.name))
      .for("update", { of: schema.assetDepreciationLines });

    const touched = new Set<string>();
    for (const { line, asset } of due) {
      // Baris bernilai nol (mungkin di akhir saldo menurun) tidak perlu dijurnal.
      if (Number(line.amount) === 0) continue;
      const label = `Penyusutan ${asset.code ? `${asset.code} ` : ""}${asset.name} (${line.sequence}/${asset.usefulLifeMonths})`;
      const moveId = await this.moves.createEntry(
        tx,
        {
          journalId: asset.journalId,
          date: line.date,
          ref: label,
          lines: [
            {
              accountId: asset.expenseAccountId,
              name: label,
              debit: line.amount,
              credit: "0",
              branchId: asset.branchId,
              businessUnitId: asset.businessUnitId,
              costCenterId: asset.costCenterId,
            },
            {
              accountId: asset.depreciationAccountId,
              name: label,
              debit: "0",
              credit: line.amount,
              branchId: asset.branchId,
              businessUnitId: asset.businessUnitId,
              costCenterId: asset.costCenterId,
            },
          ],
        },
        companyId,
      );
      await this.moves.post(tx, moveId);
      await tx
        .update(schema.assetDepreciationLines)
        .set({ moveId })
        .where(eq(schema.assetDepreciationLines.id, line.id));
      touched.add(asset.id);
    }
    // Aset yang seluruh jadwalnya sudah diposting menjadi selesai.
    for (const assetId of touched) {
      const [open] = await tx
        .select({ id: schema.assetDepreciationLines.id })
        .from(schema.assetDepreciationLines)
        .where(
          and(
            eq(schema.assetDepreciationLines.assetId, assetId),
            isNull(schema.assetDepreciationLines.moveId),
            sql`${schema.assetDepreciationLines.amount} <> 0`,
          ),
        )
        .limit(1);
      if (!open)
        await tx
          .update(schema.assets)
          .set({ state: "closed", updatedAt: sql`now()` })
          .where(eq(schema.assets.id, assetId));
    }
    return { posted: due.filter((d) => Number(d.line.amount) !== 0).length, assets: touched.size };
  }

  /**
   * Lepas aset: penyusutan sampai tanggal pelepasan diposting (bulan pelepasan tidak disusutkan), sisa jadwal
   * dihapus, lalu jurnal pelepasan menghapus harga perolehan & akumulasi penyusutan dengan selisih (nilai buku) ke
   * akun laba/rugi pelepasan. Penjualan juga membuat & memposting faktur pelanggan ke akun yang sama, sehingga
   * saldonya = harga jual − nilai buku. Bila pembelinya perusahaan grup, draf aset dibuat di buku pembeli.
   */
  async dispose(tx: Db, id: string, input: z.infer<typeof assetDisposeSchema>) {
    const asset = await this.get(tx, id);
    if (asset.state !== "running" && asset.state !== "closed")
      throw new BadRequestException("Hanya aset yang sudah dikonfirmasi dan belum dilepas yang bisa dilepas");
    if (input.date < asset.acquisitionDate)
      throw new BadRequestException("Tanggal pelepasan tidak boleh sebelum tanggal perolehan");
    const books = await loadBooks(tx, asset.companyId);
    const disposalAccountId = books.settings.assetDisposalAccountId;
    if (!disposalAccountId)
      throw new BadRequestException("Akun laba/rugi pelepasan aset belum diatur di pengaturan akuntansi");
    const sale = input.kind === "sale";
    if (sale && (!input.partnerId || input.price === undefined))
      throw new BadRequestException("Penjualan aset memerlukan pembeli dan harga jual");

    if (asset.state === "running") await this.depreciate(tx, input.date, id);
    const posted = await tx
      .select({ amount: schema.assetDepreciationLines.amount })
      .from(schema.assetDepreciationLines)
      .where(
        and(eq(schema.assetDepreciationLines.assetId, id), isNotNull(schema.assetDepreciationLines.moveId)),
      );
    const remaining = await tx
      .delete(schema.assetDepreciationLines)
      .where(
        and(
          eq(schema.assetDepreciationLines.assetId, id),
          isNull(schema.assetDepreciationLines.moveId),
          gt(schema.assetDepreciationLines.date, input.date),
        ),
      )
      .returning({ id: schema.assetDepreciationLines.id });
    const accumulated = posted.reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const bookValue = new Decimal(asset.cost).minus(accumulated);
    const label = `Pelepasan aset ${asset.code ? `${asset.code} ` : ""}${asset.name}`;
    const dims = {
      branchId: asset.branchId,
      businessUnitId: asset.businessUnitId,
      costCenterId: asset.costCenterId,
    };

    let invoiceId: string | null = null;
    if (sale) {
      invoiceId = await this.moves.createInvoice(
        tx,
        {
          moveType: "out_invoice",
          partnerId: input.partnerId!,
          date: input.date,
          ref: label,
          lines: [
            {
              name: `Penjualan aset ${asset.code ? `${asset.code} ` : ""}${asset.name}`,
              quantity: "1",
              priceUnit: input.price!,
              discount: "0",
              accountId: disposalAccountId,
              taxIds: input.taxIds,
              ...dims,
            },
          ],
        },
        asset.companyId,
      );
      await this.moves.post(tx, invoiceId);
    }
    const entryLines = [
      ...(accumulated.gt(0)
        ? [
            {
              accountId: asset.depreciationAccountId,
              name: label,
              debit: accumulated.toFixed(2),
              credit: "0",
              ...dims,
            },
          ]
        : []),
      ...(bookValue.gt(0)
        ? [{ accountId: disposalAccountId, name: label, debit: bookValue.toFixed(2), credit: "0", ...dims }]
        : []),
      { accountId: asset.assetAccountId, name: label, debit: "0", credit: asset.cost, ...dims },
    ];
    const moveId = await this.moves.createEntry(
      tx,
      { journalId: asset.journalId, date: input.date, ref: label, lines: entryLines },
      asset.companyId,
    );
    await this.moves.post(tx, moveId);
    const gain = new Decimal(sale ? input.price! : 0).minus(bookValue);
    await tx
      .update(schema.assets)
      .set({
        state: "disposed",
        disposalDate: input.date,
        disposalKind: input.kind,
        disposalPrice: sale ? input.price! : null,
        disposalPartnerId: sale ? input.partnerId! : null,
        disposalMoveId: moveId,
        disposalInvoiceId: invoiceId,
        disposalGain: gain.toFixed(2),
        updatedAt: sql`now()`,
      })
      .where(eq(schema.assets.id, id));

    let transfer: { assetId: string | null; message: string | null } = { assetId: null, message: null };
    if (sale && input.transferToGroup)
      transfer = await this.transferToGroup(tx, asset, input, remaining.length);
    return { ...(await this.get(tx, id)), bookValue: bookValue.toFixed(2), transfer };
  }

  /** Penjualan ke perusahaan grup: siapkan draf aset di buku pembeli (akun dipadankan berdasarkan kode). */
  private async transferToGroup(
    tx: Db,
    asset: Awaited<ReturnType<AssetService["get"]>>,
    input: z.infer<typeof assetDisposeSchema>,
    remainingMonths: number,
  ) {
    const [partner] = await tx
      .select({ icCompanyId: schema.partners.icCompanyId })
      .from(schema.partners)
      .where(eq(schema.partners.id, input.partnerId!));
    const buyerId = partner?.icCompanyId;
    if (!buyerId || buyerId === asset.companyId) return { assetId: null, message: null };
    if (!currentContext().companyIds.includes(buyerId))
      return {
        assetId: null,
        message: "Tidak punya akses ke perusahaan pembeli; catat aset di sana secara manual",
      };
    const local = await tx
      .select({ id: schema.accounts.id, code: schema.accounts.code })
      .from(schema.accounts)
      .where(
        inArray(schema.accounts.id, [
          asset.assetAccountId,
          asset.depreciationAccountId,
          asset.expenseAccountId,
        ]),
      );
    const codeOf = new Map(local.map((a) => [a.id, a.code]));
    const target = await tx
      .select({ id: schema.accounts.id, code: schema.accounts.code })
      .from(schema.accounts)
      .where(
        and(
          eq(schema.accounts.companyId, buyerId),
          inArray(
            schema.accounts.code,
            [...codeOf.values()].filter((c): c is string => Boolean(c)),
          ),
        ),
      );
    const idOf = (localId: string) => target.find((t) => t.code === codeOf.get(localId))?.id;
    const [assetAccountId, depreciationAccountId, expenseAccountId] = [
      idOf(asset.assetAccountId),
      idOf(asset.depreciationAccountId),
      idOf(asset.expenseAccountId),
    ];
    if (!assetAccountId || !depreciationAccountId || !expenseAccountId)
      return {
        assetId: null,
        message: "Akun aset di perusahaan pembeli tidak ditemukan; catat aset secara manual",
      };
    const buyerBooks = await loadBooks(tx, buyerId);
    const price = new Decimal(input.price!);
    const salvage = new Decimal(asset.salvageValue).lt(price) ? asset.salvageValue : "0";
    const [created] = await tx
      .insert(schema.assets)
      .values({
        companyId: buyerId,
        code: asset.code,
        name: asset.name,
        method: asset.method,
        acquisitionDate: input.date,
        // Penjual sudah menyusutkan sampai bulan sebelum pelepasan; pembeli mulai bulan berikutnya.
        firstDepreciationDate: nextMonthStart(input.date),
        cost: price.toFixed(2),
        salvageValue: salvage,
        usefulLifeMonths: Math.max(1, remainingMonths),
        assetAccountId,
        depreciationAccountId,
        expenseAccountId,
        journalId: buyerBooks.settings.generalJournalId,
        sourceAssetId: asset.id,
      })
      .returning({ id: schema.assets.id });
    return { assetId: created!.id, message: null };
  }
}
